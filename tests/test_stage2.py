"""Stage 2: engine top-k ranker. These tests need Stockfish and take a few minutes.

The 50 KB round trip is hours of engine time, so it only runs when the
environment variable RUN_SLOW=1 is set.
"""
import os
import subprocess
import sys

import chess
import pytest

from chess_stego import codec, crypto
from chess_stego.rankers import EngineTopKRanker, UciRanker
from conftest import LARGE_PAYLOADS, PASSWORD, SMALL_PAYLOADS

PAYLOADS = {**SMALL_PAYLOADS, "random_1kb": LARGE_PAYLOADS["random_1kb"]}


@pytest.fixture(scope="module", params=[2, 3, 4])
def ranker(request):
    """One Stockfish process per k, shared by all tests in this file."""
    engine_ranker = EngineTopKRanker(k=request.param)
    yield engine_ranker
    engine_ranker.close()


def test_radix_is_k_and_moves_are_legal(ranker):
    board = chess.Board()
    moves = ranker.ordered_moves(board)
    assert len(moves) == ranker.k == len(set(moves))
    assert all(move in board.legal_moves for move in moves)
    # A position with a single legal move has radix 1.
    forced = chess.Board("r7/8/8/8/8/2k5/8/K7 w - - 0 1")  # in check, only Kb1 is legal
    assert [move.uci() for move in ranker.ordered_moves(forced)] == ["a1b1"]


def test_same_position_gives_same_ranking(ranker):
    board = chess.Board()
    for san in ["e4", "c5", "Nf3", "d6", "d4"]:
        board.push_san(san)
    first = ranker.ordered_moves(board)
    ranker.ordered_moves(chess.Board())  # look at something else in between
    assert ranker.ordered_moves(board) == first


@pytest.mark.parametrize("name", PAYLOADS)
def test_roundtrip(ranker, name):
    data = PAYLOADS[name]
    games, stats = codec.encode(crypto.encrypt(data, PASSWORD), ranker)
    assert stats.bits_per_move <= ranker.k.bit_length()
    recovered = crypto.decrypt(codec.decode(codec.to_pgn(games), ranker), PASSWORD)
    assert recovered == data


@pytest.mark.skipif(os.environ.get("RUN_SLOW") != "1", reason="hours of engine time; set RUN_SLOW=1")
def test_roundtrip_50kb():
    engine_ranker = EngineTopKRanker(k=4)
    try:
        data = LARGE_PAYLOADS["random_50kb"]
        games, _ = codec.encode(crypto.encrypt(data, PASSWORD), engine_ranker)
        assert crypto.decrypt(codec.decode(codec.to_pgn(games), engine_ranker), PASSWORD) == data
    finally:
        engine_ranker.close()


def test_wrong_settings_fail_cleanly():
    """Decoding with a different k (or ranker) must fail, not return garbage."""
    k4, k2 = EngineTopKRanker(k=4), EngineTopKRanker(k=2)
    try:
        games, _ = codec.encode(crypto.encrypt(b"secret", PASSWORD), k4)
        pgn = codec.to_pgn(games)
        for wrong in (k2, UciRanker()):
            with pytest.raises((codec.DecodeError, crypto.DecryptionError)):
                crypto.decrypt(codec.decode(pgn, wrong), PASSWORD)
    finally:
        k4.close()
        k2.close()


def test_determinism_across_processes(tmp_path):
    """The most important test: decode in brand-new processes, several times.

    Each CLI call starts its own Python and its own Stockfish, so this proves
    the ranking does not depend on anything left over in memory.
    """
    source, pgn = tmp_path / "in.bin", tmp_path / "games.pgn"
    source.write_bytes(os.urandom(200))
    env = {**os.environ, "CHESS_STEGO_PASSWORD": PASSWORD}
    flags = ["--ranker", "engine", "--k", "3"]

    def run(*args):
        subprocess.run([sys.executable, "-m", "chess_stego", *args, *flags],
                       env=env, check=True, capture_output=True)

    run("encode", str(source), "-o", str(pgn))
    for attempt in range(3):
        out = tmp_path / f"out{attempt}.bin"
        run("decode", str(pgn), "-o", str(out))
        assert out.read_bytes() == source.read_bytes()

"""The in-browser JavaScript port (web/) must agree with the Python version.

These tests run the same JavaScript files the website uses, under Node.js.
They are skipped if Node.js is not installed.
"""
import io
import os
import shutil
import subprocess
from pathlib import Path

import chess.pgn
import pytest

from chess_stego import codec, crypto
from chess_stego.rankers import UciRanker
from conftest import PASSWORD, SMALL_PAYLOADS

ROOT = Path(__file__).resolve().parent.parent
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="Node.js is not installed")


def run_js(command: str, source: Path, target: Path) -> None:
    env = {**os.environ, "CHESS_STEGO_PASSWORD": PASSWORD}
    subprocess.run([NODE, str(ROOT / "web" / "test" / "cli.mjs"), command, str(source), str(target)],
                   check=True, env=env, cwd=ROOT)


def moves_per_game(pgn_text: str) -> list[list[str]]:
    games = []
    pgn = io.StringIO(pgn_text)
    while (game := chess.pgn.read_game(pgn)) is not None:
        games.append([move.uci() for move in game.mainline_moves()])
    return games


def test_js_selftest():
    # Includes a round trip in the engine-guided "natural" style.
    subprocess.run([NODE, str(ROOT / "web" / "test" / "selftest.mjs")], check=True, cwd=ROOT)


def test_natural_style_decodes_in_a_separate_process(tmp_path):
    # The website's engine (Stockfish compiled to WebAssembly) must rank moves
    # identically every time it is started, or the receiver could not decode.
    data = os.urandom(120)
    (tmp_path / "in.bin").write_bytes(data)
    run_js("encode-natural", tmp_path / "in.bin", tmp_path / "games.pgn")
    for attempt in range(2):
        out = tmp_path / f"out{attempt}.bin"
        run_js("decode-natural", tmp_path / "games.pgn", out)
        assert out.read_bytes() == data


def test_same_bytes_give_identical_games(tmp_path):
    # 20 KB is about 35,000 moves: enough to hit stalemates, bare-king draws,
    # promotions, en passant and castling many times. Identical games mean the
    # two versions agree on every legal-move list and on when a game is over.
    data = os.urandom(20 * 1024)
    (tmp_path / "in.bin").write_bytes(data)
    run_js("encode-raw", tmp_path / "in.bin", tmp_path / "js.pgn")
    games, _ = codec.encode(data, UciRanker())
    python_games = moves_per_game(codec.to_pgn(games))
    js_games = moves_per_game((tmp_path / "js.pgn").read_text(encoding="utf-8"))
    assert js_games == python_games


@pytest.mark.parametrize("name", SMALL_PAYLOADS)
def test_js_encodes_python_decodes(tmp_path, name):
    data = SMALL_PAYLOADS[name]
    (tmp_path / "in.bin").write_bytes(data)
    run_js("encode", tmp_path / "in.bin", tmp_path / "games.pgn")
    pgn_text = (tmp_path / "games.pgn").read_text(encoding="utf-8")
    assert crypto.decrypt(codec.decode(pgn_text, UciRanker()), PASSWORD) == data


@pytest.mark.parametrize("name", SMALL_PAYLOADS)
def test_python_encodes_js_decodes(tmp_path, name):
    data = SMALL_PAYLOADS[name]
    games, _ = codec.encode(crypto.encrypt(data, PASSWORD), UciRanker())
    (tmp_path / "games.pgn").write_text(codec.to_pgn(games), encoding="utf-8")
    run_js("decode", tmp_path / "games.pgn", tmp_path / "out.bin")
    assert (tmp_path / "out.bin").read_bytes() == data

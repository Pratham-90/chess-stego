"""Stage 1: encryption + all-legal-moves codec."""
import io
import os

import chess
import chess.pgn
import pytest

from chess_stego import cli, codec, crypto
from chess_stego.rankers import UciRanker
from conftest import LARGE_PAYLOADS, PASSWORD, SMALL_PAYLOADS

ALL_PAYLOADS = {**SMALL_PAYLOADS, **LARGE_PAYLOADS}


def hide(data: bytes, password: str = PASSWORD) -> str:
    games, _ = codec.encode(crypto.encrypt(data, password), UciRanker())
    return codec.to_pgn(games)


def reveal(pgn_text: str, password: str = PASSWORD) -> bytes:
    return crypto.decrypt(codec.decode(pgn_text, UciRanker()), password)


def read_games(pgn_text: str) -> list[chess.pgn.Game]:
    pgn, games = io.StringIO(pgn_text), []
    while (game := chess.pgn.read_game(pgn)) is not None:
        games.append(game)
    return games


def with_last_move_changed(game: chess.pgn.Game) -> str:
    """Return the game's PGN with its final move swapped for another legal one."""
    moves = list(game.mainline_moves())
    board = game.board()
    for move in moves[:-1]:
        board.push(move)
    board.push(next(m for m in board.legal_moves if m != moves[-1]))
    return str(chess.pgn.Game.from_board(board))


# ---------- crypto ----------

def test_encrypt_format_and_randomness():
    a, b = crypto.encrypt(b"hello", PASSWORD), crypto.encrypt(b"hello", PASSWORD)
    assert len(a) == 16 + 12 + 5 + 16  # salt + nonce + ciphertext + tag
    assert a != b  # fresh salt and nonce every time
    assert crypto.decrypt(a, PASSWORD) == b"hello"


def test_wrong_password_fails_cleanly():
    blob = crypto.encrypt(b"secret", PASSWORD)
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(blob, "wrong password")


def test_tampered_ciphertext_fails():
    blob = bytearray(crypto.encrypt(b"secret", PASSWORD))
    blob[-1] ^= 1  # flip a single bit
    with pytest.raises(crypto.DecryptionError):
        crypto.decrypt(bytes(blob), PASSWORD)


# ---------- integer conversion ----------

@pytest.mark.parametrize("data", [b"", b"\x00", b"\x00\x00\x05", b"\xff" * 40])
def test_int_conversion_keeps_leading_zeros(data):
    assert codec.int_to_bytes(codec.bytes_to_int(data)) == data


# ---------- full round trips ----------

@pytest.mark.parametrize("name", ALL_PAYLOADS)
def test_roundtrip(name):
    data = ALL_PAYLOADS[name]
    assert reveal(hide(data)) == data


def test_wrong_password_on_games():
    with pytest.raises(crypto.DecryptionError):
        reveal(hide(b"secret"), "not the password")


def test_every_game_is_legal_and_headers_are_plain():
    games = read_games(hide(LARGE_PAYLOADS["random_1kb"]))
    assert len(games) > 1
    for game in games:
        assert not game.errors  # python-chess replayed every move legally
        assert set(game.headers) == {"Event", "Site", "Date", "Round", "White", "Black", "Result"}
        assert sum(1 for _ in game.mainline_moves()) <= codec.MAX_PLIES


def test_altered_middle_move_fails_integrity_check():
    games = read_games(hide(LARGE_PAYLOADS["random_1kb"]))
    # Game 0 stopped at the ply cap, so swapping its last move keeps the PGN
    # fully legal but changes one digit in the middle of the big integer.
    tampered = "\n\n".join([with_last_move_changed(games[0])] + [str(g) for g in games[1:]])
    with pytest.raises(crypto.DecryptionError):
        reveal(tampered)


def test_altered_final_move_fails():
    games = read_games(hide(LARGE_PAYLOADS["random_1kb"]))
    tampered = "\n\n".join([str(g) for g in games[:-1]] + [with_last_move_changed(games[-1])])
    with pytest.raises((codec.DecodeError, crypto.DecryptionError)):
        reveal(tampered)


def test_not_a_pgn():
    with pytest.raises(codec.DecodeError):
        codec.decode("", UciRanker())


# ---------- CLI ----------

def test_cli_roundtrip(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("CHESS_STEGO_PASSWORD", PASSWORD)
    source, pgn, out = tmp_path / "in.bin", tmp_path / "games.pgn", tmp_path / "out.bin"
    source.write_bytes(os.urandom(300))
    assert cli.main(["encode", str(source), "-o", str(pgn)]) == 0
    assert "bits per move" in capsys.readouterr().out
    assert cli.main(["decode", str(pgn), "-o", str(out)]) == 0
    assert out.read_bytes() == source.read_bytes()

    monkeypatch.setenv("CHESS_STEGO_PASSWORD", "wrong")
    assert cli.main(["decode", str(pgn), "-o", str(out)]) == 1
    assert "wrong password" in capsys.readouterr().err

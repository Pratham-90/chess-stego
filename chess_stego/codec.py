"""bytes <-> one big integer <-> chess games.

The integer is written in a "mixed radix" number system: the base of each digit
is the number of candidate moves in that position, and the digit says which of
those moves gets played.
"""
import datetime
import io
import math
import random
from dataclasses import dataclass

import chess
import chess.pgn

SENTINEL = b"\x01"
MAX_PLIES = 200  # a ply is one move by one side; 200 plies = 100 full moves


class DecodeError(Exception):
    """The PGN could not be turned back into data."""


@dataclass
class Stats:
    games: int
    moves: int
    bits: float  # total information carried = sum of log2(radix) over all moves

    @property
    def bits_per_move(self) -> float:
        return self.bits / self.moves if self.moves else 0.0


# ---------- bytes <-> integer ----------

def bytes_to_int(data: bytes) -> int:
    # Without the leading 0x01, data starting with zero bytes (b"\x00\x05")
    # would become the same integer as b"\x05" and the zeros would be lost.
    return int.from_bytes(SENTINEL + data, "big")


def int_to_bytes(n: int) -> bytes:
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    if raw[:1] != SENTINEL:
        raise DecodeError("games do not contain a valid message (bad sentinel byte)")
    return raw[1:]


# ---------- integer -> games ----------

def encode(data: bytes, ranker, max_plies: int = MAX_PLIES) -> tuple[list[chess.Board], Stats]:
    """Turn bytes into a list of played-out boards (one per game)."""
    n = bytes_to_int(data)
    games: list[chess.Board] = []
    board = chess.Board()
    moves, bits = 0, 0.0
    while n > 0:
        options = ranker.ordered_moves(board)
        # Peel off the lowest digit of n in base len(options).
        n, digit = divmod(n, len(options))
        board.push(options[digit])
        moves += 1
        bits += math.log2(len(options))
        if board.is_game_over() or board.ply() >= max_plies:
            games.append(board)
            board = chess.Board()
    if board.move_stack:  # the last, unfinished game
        games.append(board)
    return games, Stats(len(games), moves, bits)


# ---------- games -> integer ----------

def decode(pgn_text: str, ranker) -> bytes:
    """Replay every game and rebuild the bytes."""
    digits: list[tuple[int, int]] = []  # (digit, radix) for every move, in order
    pgn = io.StringIO(pgn_text)
    while (game := chess.pgn.read_game(pgn)) is not None:
        if game.errors:
            raise DecodeError(f"PGN contains an illegal move: {game.errors[0]}")
        board = game.board()
        for move in game.mainline_moves():
            options = ranker.ordered_moves(board)
            if move not in options:
                raise DecodeError(
                    f"move {board.san(move)} is not a candidate move here "
                    "(wrong ranker settings, or not a chess-stego game)"
                )
            digits.append((options.index(move), len(options)))
            board.push(move)
    if not digits:
        raise DecodeError("no games found in the PGN")
    # The first move holds the lowest digit, so rebuild from the last move back.
    n = 0
    for digit, radix in reversed(digits):
        n = n * radix + digit
    return int_to_bytes(n)


# ---------- boards -> PGN text ----------

# Made-up player handles. Headers are pure decoration: they carry no data and
# are ignored by the decoder, so ordinary (non-secret) randomness is fine here.
_PLAYERS = [
    "knightrider42", "quiet_bishop", "e4enjoyer", "rook_and_roll", "pawnstorm",
    "silentgambit", "blitzowl", "endgame_eddie", "castlekeeper", "tal_fan_88",
    "the_fianchetto", "zugzwang_zoe", "oldmanchess", "lucky_fork", "darksquares",
]


def to_pgn(games: list[chess.Board]) -> str:
    today = datetime.date.today().strftime("%Y.%m.%d")
    out = []
    for board in games:
        game = chess.pgn.Game.from_board(board)
        white, black = random.sample(_PLAYERS, 2)
        game.headers["Event"] = "Casual game"
        game.headers["Site"] = "Online"
        game.headers["Date"] = today
        game.headers["Round"] = "-"
        game.headers["White"] = white
        game.headers["Black"] = black
        if board.is_game_over():
            game.headers["Result"] = board.result()
        elif board is games[-1]:
            game.headers["Result"] = "*"  # the final game simply stops
        else:
            game.headers["Result"] = "1/2-1/2"  # hit the ply cap: reads as a draw
        out.append(str(game))
    return "\n\n".join(out) + "\n"

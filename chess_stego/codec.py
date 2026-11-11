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


# ---------- weighted digits (stretch goal) ----------
#
# Plain mixed radix makes every candidate move equally likely. To make some
# moves more likely than others we give each option a weight, e.g. [5, 2, 1]:
# picture 5 + 2 + 1 = 8 numbered slots, where the last option owns slot 0, the
# middle one slots 1-2 and the first one slots 3-7. `n % 8` lands in one slot
# and so picks an option; options owning more slots get picked more often.
# Likely options use up less of n (they carry less information), which is the
# idea behind arithmetic coding / "asymmetric numeral systems" (rANS).
# With all weights equal to 1 this is plain mixed radix again.

def take_weighted_digit(n: int, weights: list[int]) -> tuple[int, int]:
    """Remove one weighted digit from n. Returns (what is left of n, digit)."""
    rest, slot = divmod(n, sum(weights))
    start = 0
    for digit in reversed(range(len(weights))):  # the last option owns slot 0
        if slot < start + weights[digit]:
            # Keep the position inside the option's slots: that is leftover
            # information which must not be thrown away.
            return rest * weights[digit] + (slot - start), digit
        start += weights[digit]
    raise AssertionError("unreachable: slot is always below sum(weights)")


def put_weighted_digit(n: int, digit: int, weights: list[int]) -> int:
    """Exact inverse of take_weighted_digit."""
    start = sum(weights[digit + 1:])
    rest, offset = divmod(n, weights[digit])
    return rest * sum(weights) + start + offset


# ---------- integer -> games ----------

def encode(data: bytes, ranker, max_plies=MAX_PLIES) -> tuple[list[chess.Board], Stats]:
    """Turn bytes into a list of played-out boards (one per game).

    `max_plies` is a number, or a function that returns the length limit for
    the next game (used to give games varied, human-like lengths). The decoder
    never needs it: it just replays whatever games it is given.
    """
    next_limit = max_plies if callable(max_plies) else (lambda: max_plies)
    n = bytes_to_int(data)
    games: list[chess.Board] = []
    board, limit = chess.Board(), next_limit()
    moves, bits = 0, 0.0
    while n > 0:
        options = ranker.ordered_moves(board)
        weights = ranker.weights(len(options))
        if weights is None:
            # Peel off the lowest digit of n in base len(options).
            n, digit = divmod(n, len(options))
            bits += math.log2(len(options))
        else:
            n, digit = take_weighted_digit(n, weights)
            bits += math.log2(sum(weights) / weights[digit])
        board.push(options[digit])
        moves += 1
        if board.is_game_over() or board.ply() >= limit:
            games.append(board)
            board, limit = chess.Board(), next_limit()
    if board.move_stack:  # the last, unfinished game
        games.append(board)
    return games, Stats(len(games), moves, bits)


# ---------- games -> integer ----------

def decode(pgn_text: str, ranker) -> bytes:
    """Replay every game and rebuild the bytes."""
    digits = []  # (digit, radix, weights) for every move, in order
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
            digits.append((options.index(move), len(options), ranker.weights(len(options))))
            board.push(move)
    if not digits:
        raise DecodeError("no games found in the PGN")
    # The first move holds the lowest digit, so rebuild from the last move back.
    n = 0
    for digit, radix, weights in reversed(digits):
        if weights is None:
            n = n * radix + digit
        else:
            n = put_weighted_digit(n, digit, weights)
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

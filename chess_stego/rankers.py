"""Rankers decide which moves may carry data, and in what order.

A ranker turns a position into an ordered list of candidate moves. The encoder
plays `moves[digit]`; the decoder finds the played move's index in the same
list. So the one hard rule is: the same position must ALWAYS give the same list.
"""
import chess


class UciRanker:
    """Stage 1: every legal move, sorted by its UCI text (e.g. "e2e4")."""

    def ordered_moves(self, board: chess.Board) -> list[chess.Move]:
        return sorted(board.legal_moves, key=lambda move: move.uci())

    def close(self) -> None:
        pass

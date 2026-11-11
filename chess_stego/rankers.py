"""Rankers decide which moves may carry data, and in what order.

A ranker turns a position into an ordered list of candidate moves. The encoder
plays `moves[digit]`; the decoder finds the played move's index in the same
list. So the one hard rule is: the same position must ALWAYS give the same list.

`weights(count)` says how likely each of the `count` candidates should be.
None means "all equally likely" (plain mixed radix).
"""
import os
import shutil
from pathlib import Path

import chess
import chess.engine

DEFAULT_K = 3
DEFAULT_NODES = 2000

# How much more often real players pick the engine's 1st, 2nd, ... 8th choice
# than its 8th choice (rounded). Measured on Lichess games by
# analysis/human_ranks.py with this file's own engine settings.
HUMAN_WEIGHTS = [11, 5, 4, 2, 2, 1, 1, 1]


def uci_sorted(moves) -> list[chess.Move]:
    return sorted(moves, key=lambda move: move.uci())


def find_stockfish() -> str:
    """Locate the Stockfish binary: $STOCKFISH_PATH, then PATH, then ./tools/."""
    env = os.environ.get("STOCKFISH_PATH")
    if env:
        return env
    on_path = shutil.which("stockfish")
    if on_path:
        return on_path
    tools = Path(__file__).resolve().parent.parent / "tools"
    for candidate in sorted(tools.glob("**/stockfish*")):
        if candidate.is_file() and candidate.suffix in ("", ".exe"):
            return str(candidate)
    raise FileNotFoundError(
        "Stockfish not found. Install it or set the STOCKFISH_PATH environment variable."
    )


class EngineTopKRanker:
    """Stage 2: only the engine's k best moves, best first.

    Encoder and decoder must get the *identical* list, so the search has to be
    reproducible: one thread, fixed hash size, a fixed node budget (never a time
    limit, which depends on how busy the computer is), and a clean engine state
    for every position.
    """

    def __init__(self, k: int = DEFAULT_K, nodes: int = DEFAULT_NODES, path: str | None = None):
        self.k, self.nodes = k, nodes
        self.engine = chess.engine.SimpleEngine.popen_uci(path or find_stockfish())
        self.engine.configure({"Threads": 1, "Hash": 16})

    def ordered_moves(self, board: chess.Board) -> list[chess.Move]:
        legal = uci_sorted(board.legal_moves)
        if len(legal) == 1:
            return legal  # forced move: nothing to rank
        infos = self.engine.analyse(
            board,
            chess.engine.Limit(nodes=self.nodes),
            multipv=self.k,
            # A never-seen-before `game` makes python-chess send "ucinewgame",
            # which wipes the engine's memory of earlier positions.
            game=object(),
        )
        moves = []
        for info in infos:
            if info.get("pv") and info["pv"][0] not in moves:
                moves.append(info["pv"][0])
        # Safety net: if the engine ever reports fewer lines than expected,
        # fill up deterministically so the radix is always min(k, legal moves).
        for move in legal:
            if len(moves) >= min(self.k, len(legal)):
                break
            if move not in moves:
                moves.append(move)
        return moves

    def weights(self, count: int) -> list[int] | None:
        return None

    def close(self) -> None:
        self.engine.quit()


class HumanLikeRanker(EngineTopKRanker):
    """Stretch goal: top-8 engine moves, but picked as often as humans pick them.

    Instead of treating the candidates as equally likely, the best move is
    chosen 11 times as often as the 8th-best, and so on (see HUMAN_WEIGHTS).
    """

    def __init__(self, nodes: int = DEFAULT_NODES, path: str | None = None):
        super().__init__(k=len(HUMAN_WEIGHTS), nodes=nodes, path=path)

    def weights(self, count: int) -> list[int] | None:
        return HUMAN_WEIGHTS[:count]  # fewer legal moves -> use the first few weights


class UciRanker:
    """Stage 1: every legal move, sorted by its UCI text (e.g. "e2e4")."""

    def ordered_moves(self, board: chess.Board) -> list[chess.Move]:
        return uci_sorted(board.legal_moves)

    def weights(self, count: int) -> list[int] | None:
        return None

    def close(self) -> None:
        pass

"""Stretch goal: how often do real players pick the engine's 1st, 2nd, 3rd... choice?

    python analysis/human_ranks.py     (writes analysis/human_ranks.md)

Uses exactly the ranker the encoder uses (same Stockfish settings), so the
measured frequencies can be turned directly into weights for HumanLikeRanker.
"""
import io
import sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

import chess.pgn

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chess_stego.rankers import DEFAULT_NODES, EngineTopKRanker
from features import DATA, read_games

K = 8
WORKERS = 8


def count_ranks(pgn_texts: list[str]) -> Counter:
    ranker = EngineTopKRanker(k=K)
    counts = Counter()
    try:
        for text in pgn_texts:
            game = chess.pgn.read_game(io.StringIO(text))
            board = game.board()
            for move in game.mainline_moves():
                options = ranker.ordered_moves(board)
                if len(options) == K:  # skip positions with fewer than K legal moves
                    counts[options.index(move) + 1 if move in options else 0] += 1
                board.push(move)
    finally:
        ranker.close()
    return counts


def main() -> None:
    games = read_games(DATA / "real.pgn")
    with Pool(WORKERS) as pool:
        counts = sum(pool.map(count_ranks, [games[i::WORKERS] for i in range(WORKERS)]), Counter())
    total = sum(counts.values())
    in_top = total - counts[0]
    lines = [
        "# How often humans play the engine's n-th choice",
        "",
        f"Measured on the {len(games)} sampled Lichess games ({total} moves), ranking each position",
        f"with Stockfish 19 at {DEFAULT_NODES} nodes, MultiPV {K} (the encoder's own ranker).",
        "",
        "| Engine rank | Share of all moves | Share of top-8 moves | Weight (rank 8 = 1) |",
        "|---|---|---|---|",
    ]
    for rank in range(1, K + 1):
        lines.append(f"| {rank} | {counts[rank] / total:.1%} | {counts[rank] / in_top:.1%} "
                     f"| {counts[rank] / counts[K]:.2f} |")
    lines.append(f"| not in top {K} | {counts[0] / total:.1%} | - | - |")
    text = "\n".join(lines) + "\n"
    (DATA.parent / "human_ranks.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()

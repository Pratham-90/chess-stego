"""Describe every game by a few numbers a detector could look at.

    python analysis/features.py              (all sets; writes analysis/data/features.csv)
    python analysis/features.py gen_human    (only the named sets; other rows are kept)

Every position is analysed with Stockfish at a fixed depth. From that we get,
per game: how much each move "lost" compared with the best move (centipawn
loss; 100 centipawns = one pawn), how often the move played was one of the
engine's favourites, how long the game was and how it ended.
"""
import io
import sys
from multiprocessing import Pool
from pathlib import Path

import chess
import chess.engine
import chess.pgn
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chess_stego.rankers import find_stockfish

DATA = Path(__file__).resolve().parent / "data"
SETS = ["real", "gen_uci", "gen_k2", "gen_k4", "gen_human"]
DEPTH = 10
MULTIPV = 3
SCORE_CAP = 1000   # treat anything beyond +-10 pawns (including mates) as +-10 pawns
WORKERS = 8   # each Stockfish process needs ~300 MB of memory
CHUNK = 5          # games per task


def read_games(path: Path) -> list[str]:
    games = []
    with open(path, encoding="utf-8") as handle:
        while (game := chess.pgn.read_game(handle)) is not None:
            games.append(str(game))
    return games


def analyse_position(engine, board: chess.Board) -> tuple[int, list[chess.Move]]:
    """Return (score for the side to move, the engine's top moves)."""
    if board.is_checkmate():
        return -SCORE_CAP, []
    if board.is_game_over():
        return 0, []
    infos = engine.analyse(board, chess.engine.Limit(depth=DEPTH), multipv=MULTIPV)
    score = infos[0]["score"].pov(board.turn).score(mate_score=100_000)
    return max(-SCORE_CAP, min(SCORE_CAP, score)), [info["pv"][0] for info in infos]


def game_features(engine, pgn_text: str) -> dict:
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    board = game.board()
    losses, ranks = [], []
    score, top = analyse_position(engine, board)
    for move in game.mainline_moves():
        ranks.append(top.index(move) + 1 if move in top else 99)
        board.push(move)
        next_score, top = analyse_position(engine, board)
        # `score` was from the mover's side, `next_score` is from the opponent's
        # side, so the mover's evaluation after the move is -next_score.
        losses.append(max(0, score + next_score))
        score = next_score
    n = len(losses)
    return {
        "acpl": sum(losses) / n,
        "blunder_rate": sum(loss >= 200 for loss in losses) / n,
        "mistake_rate": sum(100 <= loss < 200 for loss in losses) / n,
        "top1_rate": sum(rank <= 1 for rank in ranks) / n,
        "top2_rate": sum(rank <= 2 for rank in ranks) / n,
        "top3_rate": sum(rank <= 3 for rank in ranks) / n,
        "plies": n,
        # How the game ended, judged from the final position only.
        "ends_checkmate": int(board.is_checkmate()),
        "ends_board_draw": int(board.is_game_over() and not board.is_checkmate()),
    }


def analyse_chunk(job: tuple[str, list[str]]) -> list[dict]:
    name, pgn_texts = job
    engine = chess.engine.SimpleEngine.popen_uci(find_stockfish())
    engine.configure({"Threads": 1, "Hash": 16})
    try:
        return [{"set": name, **game_features(engine, text)} for text in pgn_texts]
    finally:
        engine.quit()


def main() -> None:
    names = sys.argv[1:] or SETS
    jobs = []
    for name in names:
        games = read_games(DATA / f"{name}.pgn")
        jobs += [(name, games[i:i + CHUNK]) for i in range(0, len(games), CHUNK)]
    rows = []
    with Pool(WORKERS) as pool:
        for done, chunk in enumerate(pool.imap(analyse_chunk, jobs), 1):
            rows += chunk
            print(f"\ranalysed {done}/{len(jobs)} chunks", end="", flush=True)
    frame = pd.DataFrame(rows)
    target = DATA / "features.csv"
    if sys.argv[1:] and target.exists():
        # Keep the rows of the sets we did not re-analyse.
        old = pd.read_csv(target)
        frame = pd.concat([old[~old["set"].isin(names)], frame])
    frame.to_csv(target, index=False)
    print("\n", frame.groupby("set").mean().round(3).T)


if __name__ == "__main__":
    main()

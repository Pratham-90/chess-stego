"""Build the sets of games the detector is tested on.

    python analysis/make_dataset.py              (all sets)
    python analysis/make_dataset.py human        (only the named sets)

Writes to analysis/data/:
    real.pgn        300 human games sampled from the Lichess 2013-01 database
    gen_uci.pgn     300 games from the Stage 1 all-legal-moves ranker
    gen_k2.pgn      300 games from the engine ranker, k = 2
    gen_k4.pgn      300 games from the engine ranker, k = 4
    gen_human.pgn   300 games from the human-like ranker, with game lengths
                    drawn from the real games (stretch goal; needs real.pgn)
"""
import io
import os
import random
import sys
import urllib.request
from multiprocessing import Pool
from pathlib import Path

import chess.pgn
import zstandard

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chess_stego import codec, crypto
from chess_stego.rankers import EngineTopKRanker, HumanLikeRanker, UciRanker

DATA = Path(__file__).resolve().parent / "data"
LICHESS_URL = "https://database.lichess.org/standard/lichess_db_standard_rated_2013-01.pgn.zst"
LICHESS_FILE = DATA / "lichess_2013-01.pgn.zst"

GAMES_PER_SET = 300
MIN_PLIES = 40          # "at least 20 moves" = 40 half-moves
KEEP_PROBABILITY = 0.006  # of ~121k games, fully parse about 700
WORKERS = 10             # one Stockfish process each (~300 MB of memory)
GAMES_PER_WORKER = GAMES_PER_SET // WORKERS


# ---------- real games ----------

def sample_real_games() -> list[chess.pgn.Game]:
    if not LICHESS_FILE.exists():
        print("downloading", LICHESS_URL)
        urllib.request.urlretrieve(LICHESS_URL, LICHESS_FILE)
    rng = random.Random(2013)  # fixed seed -> the same sample every run

    class SampledGame(chess.pgn.GameBuilder):
        """Parse the moves of only a random few games; skip the rest quickly."""

        def end_headers(self):
            wanted = (self.game.headers.get("Event", "").startswith("Rated")
                      and "Variant" not in self.game.headers  # standard chess only
                      and rng.random() < KEEP_PROBABILITY)
            return None if wanted else chess.pgn.SKIP

    games = []
    # Stream-decompress: the file is never fully loaded into memory.
    with open(LICHESS_FILE, "rb") as raw:
        text = io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(raw), encoding="utf-8")
        while (game := chess.pgn.read_game(text, Visitor=SampledGame)) is not None:
            if not game.errors and sum(1 for _ in game.mainline_moves()) >= MIN_PLIES:
                games.append(game)
    print(f"real: {len(games)} candidate games with >= {MIN_PLIES} plies")
    return rng.sample(games, GAMES_PER_SET)


# ---------- generated games ----------

def make_ranker(kind: str):
    if kind == "uci":
        return UciRanker()
    if kind == "human":
        return HumanLikeRanker()
    return EngineTopKRanker(k=int(kind[1:]))  # "k2" -> 2


def generate(job: tuple[str, int, list[int]]) -> str:
    """Encode random encrypted data until we have enough complete games.

    `lengths` is empty for the normal 200-ply cap; otherwise each game's cap is
    drawn at random from it (the lengths of real games).
    """
    kind, count, lengths = job
    max_plies = (lambda: random.choice(lengths)) if lengths else codec.MAX_PLIES
    size = 512  # a first guess; grown below if it yields too few games
    ranker = make_ranker(kind)
    try:
        while True:
            encrypted = crypto.encrypt(os.urandom(size), "dataset password")
            games, _ = codec.encode(encrypted, ranker, max_plies)
            if len(games) > count:
                # Drop the trailing unfinished game so every game is a full one.
                return codec.to_pgn(games[:count])
            # Not enough games: scale the payload up (with 30% to spare).
            size = int(size * 1.3 * (count + 1) / len(games))
    finally:
        ranker.close()


def game_lengths(path: Path) -> list[int]:
    lengths = []
    with open(path, encoding="utf-8") as handle:
        while (game := chess.pgn.read_game(handle)) is not None:
            lengths.append(game.end().ply())
    return lengths


def main() -> None:
    DATA.mkdir(exist_ok=True)
    kinds = sys.argv[1:] or ["real", "uci", "k2", "k4", "human"]
    if "real" in kinds:
        real = sample_real_games()
        (DATA / "real.pgn").write_text("\n\n".join(str(g) for g in real) + "\n", encoding="utf-8")
        print(f"real: wrote {len(real)} games")

    # Each worker hides its own independent message, as separate senders would.
    with Pool(WORKERS) as pool:
        for kind in (k for k in kinds if k != "real"):
            lengths = game_lengths(DATA / "real.pgn") if kind == "human" else []
            chunks = pool.map(generate, [(kind, GAMES_PER_WORKER, lengths)] * WORKERS)
            (DATA / f"gen_{kind}.pgn").write_text("\n".join(chunks), encoding="utf-8")
            print(f"gen_{kind}: wrote {GAMES_PER_WORKER * WORKERS} games")


if __name__ == "__main__":
    main()

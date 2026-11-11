"""Measure how much data each ranker fits into a move, and how fast it is.

    python analysis/capacity.py        (writes analysis/capacity.md, takes ~10 minutes)
"""
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chess_stego import codec
from chess_stego.rankers import DEFAULT_NODES, EngineTopKRanker, HumanLikeRanker, UciRanker

PAYLOAD_BYTES = 1024  # random bytes stand in for ciphertext (which looks random)


def measure(name: str, ranker) -> str:
    data = os.urandom(PAYLOAD_BYTES)
    start = time.perf_counter()
    games, stats = codec.encode(data, ranker)
    encode_s = time.perf_counter() - start
    pgn = codec.to_pgn(games)
    start = time.perf_counter()
    assert codec.decode(pgn, ranker) == data
    decode_s = time.perf_counter() - start
    ranker.close()
    moves_per_kb = stats.moves / (PAYLOAD_BYTES / 1024)
    row = (f"| {name} | {stats.bits_per_move:.2f} | {moves_per_kb:.0f} | {stats.games} "
           f"| {len(pgn) / 1024:.0f} KB | {encode_s:.1f} s | {decode_s:.1f} s |")
    print(row, flush=True)
    return row


def main() -> None:
    rows = [measure("all legal moves (Stage 1)", UciRanker())]
    for k in (2, 3, 4, 8):
        rows.append(measure(f"engine top-{k}", EngineTopKRanker(k=k)))
    rows.append(measure("human-like top-8 (stretch)", HumanLikeRanker()))
    table = "\n".join([
        "| Ranker | Bits per move | Moves per KB | Games per KB | PGN size per KB | Encode time per KB | Decode time per KB |",
        "|---|---|---|---|---|---|---|",
        *rows,
    ])
    text = f"""# Capacity

How much hidden data fits into a move, measured by encoding {PAYLOAD_BYTES} random
bytes (1 KB) with each ranker. Engine rankers use Stockfish 19 at {DEFAULT_NODES} nodes per move,
1 thread. Games are capped at {codec.MAX_PLIES} plies. Times are from one run on the
development machine and exclude the password step (scrypt, about 0.1 s).

{table}

**Reading the table**

- *Bits per move* is the average of log2(number of candidate moves). Top-k gives
  slightly less than log2(k) because some positions have fewer than k legal moves.
- *Moves per KB* is how many chess moves it takes to hide 1 KB of (encrypted) data.
- The engine rankers are slower because Stockfish has to search every position,
  on both the encoding and the decoding side. The time per move is almost the same for
  every k; fewer bits per move simply means more moves to search.
- The trade-off: a smaller k gives more natural games but needs more of them.
- The human-like ranker also chooses among 8 moves, but favours the better
  ones, so it carries a little less than plain top-8. (For it, a move chosen
  with probability p counts as log2(1/p) bits.)
- Timings vary by roughly 30% from run to run, depending on what else the
  computer is doing; read them as "about a minute per KB", not to the second.
"""
    Path(__file__).with_name("capacity.md").write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()

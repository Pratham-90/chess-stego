# Capacity

How much hidden data fits into a move, measured by encoding 1024 random
bytes (1 KB) with each ranker. Engine rankers use Stockfish 19 at 2000 nodes per move,
1 thread. Games are capped at 200 plies. Times are from one run on the
development machine and exclude the password step (scrypt, about 0.1 s).

| Ranker | Bits per move | Moves per KB | Games per KB | PGN size per KB | Encode time per KB | Decode time per KB |
|---|---|---|---|---|---|---|
| all legal moves (Stage 1) | 4.57 | 1795 | 12 | 12 KB | 0.1 s | 0.1 s |
| engine top-2 | 0.98 | 8332 | 66 | 58 KB | 115.8 s | 116.1 s |
| engine top-3 | 1.54 | 5315 | 48 | 38 KB | 74.2 s | 75.8 s |
| engine top-4 | 1.93 | 4243 | 37 | 30 KB | 59.6 s | 60.8 s |
| engine top-8 | 2.84 | 2881 | 21 | 20 KB | 41.8 s | 42.7 s |

**Reading the table**

- *Bits per move* is the average of log2(number of candidate moves). Top-k gives
  slightly less than log2(k) because some positions have fewer than k legal moves.
- *Moves per KB* is how many chess moves it takes to hide 1 KB of (encrypted) data.
- The engine rankers are slower because Stockfish has to search every position,
  on both the encoding and the decoding side. The time is almost the same for
  every k; fewer bits per move simply means more moves to search.
- The trade-off: a smaller k gives more natural games but needs more of them.

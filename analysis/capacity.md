# Capacity

How much hidden data fits into a move, measured by encoding 1024 random
bytes (1 KB) with each ranker. Engine rankers use Stockfish 19 at 2000 nodes per move,
1 thread. Games are capped at 200 plies. Times are from one run on the
development machine and exclude the password step (scrypt, about 0.1 s).

| Ranker | Bits per move | Moves per KB | Games per KB | PGN size per KB | Encode time per KB | Decode time per KB |
|---|---|---|---|---|---|---|
| all legal moves (Stage 1) | 4.53 | 1811 | 10 | 12 KB | 0.1 s | 0.1 s |
| engine top-2 | 0.98 | 8326 | 73 | 59 KB | 97.4 s | 72.4 s |
| engine top-3 | 1.55 | 5283 | 41 | 37 KB | 44.6 s | 64.5 s |
| engine top-4 | 1.94 | 4232 | 34 | 30 KB | 60.0 s | 60.7 s |
| engine top-8 | 2.87 | 2855 | 21 | 20 KB | 41.2 s | 42.7 s |
| human-like top-8 (stretch) | 2.35 | 3491 | 30 | 25 KB | 50.5 s | 50.4 s |

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

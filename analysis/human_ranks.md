# How often humans play the engine's n-th choice

Measured on the 300 sampled Lichess games (20756 moves), ranking each position
with Stockfish 19 at 2000 nodes, MultiPV 8 (the encoder's own ranker).

| Engine rank | Share of all moves | Share of top-8 moves | Weight (rank 8 = 1) |
|---|---|---|---|
| 1 | 31.3% | 39.0% | 10.96 |
| 2 | 15.1% | 18.8% | 5.30 |
| 3 | 10.9% | 13.6% | 3.82 |
| 4 | 7.1% | 8.8% | 2.48 |
| 5 | 5.3% | 6.6% | 1.86 |
| 6 | 4.2% | 5.2% | 1.46 |
| 7 | 3.6% | 4.4% | 1.25 |
| 8 | 2.9% | 3.6% | 1.00 |
| not in top 8 | 19.8% | - | - |

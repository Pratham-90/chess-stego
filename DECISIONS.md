# Decisions

Choices made while building, each with a one-line reason.

## Setup
- **Python 3.14 in `.venv`** — it is the default `python` on this machine and every dependency has wheels for it.
- **PyPI package `chess`** (import name `chess`) — this is python-chess; `python-chess` on PyPI is just an old alias.

## Stage 1
- **Added `chess_stego/__main__.py` and `__init__.py`** — needed so `python -m chess_stego ...` works; all logic stays in `cli.py`.
- **`CHESS_STEGO_PASSWORD` environment variable as an alternative to the prompt** — `getpass` cannot be fed from a script, and tests/automation need a way in; an env var does not end up in shell history the way an argument would.
- **`encode` asks for the password twice** — a typo would otherwise make the file unrecoverable.
- **Two error types, `DecodeError` (bad games) and `DecryptionError` (bad password / tampering)** — the CLI catches both and prints one clean line instead of a traceback.
- **Games that hit the 200-ply cap get result `1/2-1/2`; only the final game gets `*`** — a file full of unfinished `*` games would look odd; a draw is the least surprising label for a game that just stops.
- **Player names are picked with Python's ordinary `random`** — headers carry no data and the decoder ignores them, so they do not need cryptographic randomness.
- **The decoder does not need `--max-plies`** — it simply replays whatever games are in the PGN, so the game-length cap is purely an encoder-side choice.
- **Tests build their own tiny PNG** — avoids committing a binary fixture or adding an imaging dependency.

## Stage 2
- **Stockfish 19** (official `stockfish-windows-x86-64-universal.exe` from the Stockfish GitHub release `sf_19`, reports `id name Stockfish 19`), unpacked into `tools/` — downloading the official zip needs no admin rights, unlike a system install. `tools/` is git-ignored (80 MB).
- **Stockfish lookup order: `STOCKFISH_PATH`, then `PATH`, then `tools/`** — works for a system install on macOS/Linux and for the local copy on Windows.
- **Defaults `--k 3`, `--nodes 2000`, `Hash = 16 MB`, `Threads = 1`** — 2000 nodes already plays far better than a typical human and costs about 14 ms per move; more nodes only make encoding slower.
- **`--ranker` defaults to `uci`** — the quick start then works without Stockfish; engine mode is opt-in.
- **Positions with one legal move skip the engine** — the answer is forced, so there is nothing to rank (radix 1).
- **Safety net in `EngineTopKRanker`** — if Stockfish ever returned fewer than k distinct moves, the list is topped up with legal moves in UCI order, so the radix is always exactly `min(k, legal moves)`.
- **Engine tests use the small payloads plus 1 KB; the 50 KB engine round trip only runs with `RUN_SLOW=1`** — 50 KB at k = 2 is about 420,000 engine searches each way (hours). The codec is identical for every ranker and 50 KB is already covered in Stage 1.
- **Capacity is measured on 1 KB of random bytes** — ciphertext is indistinguishable from random bytes, and 1 KB keeps the engine runs to a few minutes.

## Stage 3
- **Real games: Lichess `2013-01` (17 MB, 121k games)** — the smallest monthly file; read as a stream with `zstandard`, never unpacked to disk.
- **Sampling: parse only a random 0.6% of games (fixed seed), keep those with >= 40 plies, then pick 300** — python-chess can skip a game's moves after reading its headers, so the whole file is scanned in 8 seconds.
- **Generated sets are made by 10 workers, 30 complete games each** — ten independent hidden messages per set, and ten Stockfish processes in parallel; the short final game of each message is dropped so every game is a full one.
- **Features use Stockfish at depth 10, MultiPV 3, scores capped at +-1000 cp** — one search per position gives both the top-3 moves and the evaluation; capping stops mate scores from dominating averages.
- **Centipawn loss = (best eval before the move) - (eval after the move)**, never below 0 — the standard definition, and it needs no extra searches.
- **"How the game ended" is judged from the final board position, not the Result header** — a detector cannot trust headers we write ourselves; resignations and time-outs therefore count as "neither checkmate nor forced draw".
- **8 parallel workers for analysis** — 14 Stockfish processes at once ran out of memory (each needs ~300 MB) and crashed with "engine process died".
- **Detector reported twice: all features, and move-quality features only** — game length and ending are easy tells; the second run shows what remains once those are ignored.
- **Plots: box plots and small-multiple histograms with one fixed colour per set** — four overlapping histograms in one panel were unreadable.
- **Datasets (`*.pgn`, `features.csv`) are committed; the 17 MB Lichess download is not** — the small files make the results reproducible without re-running Stockfish.

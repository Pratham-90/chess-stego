# Chess Stego — hide encrypted data inside chess games

## Read this first (instructions for Claude Code)

You are building this project **end to end, on your own**. The owner (Pratham) is a CS undergrad who is new to cryptography and steganography. He wants to be minimally involved while you work, and fully informed at the end.

**Working rules**
- **Do not ask questions** unless you are truly blocked by something only the user can do, such as a system install that needs his password or approval. For every other decision, pick the sensible option, write it down in `DECISIONS.md` with a one-line reason, and keep going.
- Work through the stages **in order**. Do not start a stage until the previous stage's "Done when" checks all pass.
- Keep a running `PROGRESS.md`: what is finished, what is in progress, and what is next. If the session is interrupted, read `PROGRESS.md` first and resume from there.
- Use git. Initialise a repo at the start and commit at the end of each stage with a clear message (e.g. `stage 1: encoder/decoder round-trips`).
- **Code style:** clean and minimal, with no over-engineering. Prefer a few small, readable modules over frameworks or abstractions. Add short comments wherever the logic is non-obvious, because the owner will read this code to learn from it.
- Install whatever you need. Use a Python virtual environment (`.venv`) for Python packages. Detect the OS (Windows / macOS / Linux) and pick install commands accordingly.
- If something fails, debug it yourself: read the error, fix it, and re-run. Only escalate after several genuine attempts, and when you do, explain clearly what is blocking you.
- At the very end, do the **Final report** step (bottom of this file). This step is mandatory.

---

## The idea in one paragraph

Any file can be turned into a sequence of chess moves. In each position there are about 20–40 legal moves, so *which* move gets played can stand for a small piece of data. Chess alone is **not** encryption: anyone who knows the method could decode it. So the data is **first encrypted properly with AES-256-GCM**, and *then* the ciphertext is encoded as chess games. Encryption hides *what* the message says; the chess layer (steganography) hides *that a message exists at all*. The project then tests how convincing the generated games are by comparing them against real human games.

---

## Tech stack

- Python 3.10+
- `python-chess`: board, legal moves, PGN reading/writing, and the Stockfish interface
- `cryptography`: AES-256-GCM and the scrypt key derivation function
- Stockfish chess engine binary (Stage 2 onward)
- `pytest` for tests
- Stage 3: `numpy`, `pandas`, `scikit-learn`, `matplotlib`, `zstandard` (to read Lichess `.pgn.zst` files)

## Target layout

```
chess-stego/
  CLAUDE.md            (this file)
  PROGRESS.md
  DECISIONS.md
  README.md
  EXPLANATION.md       (final beginner-friendly write-up)
  requirements.txt
  chess_stego/
    crypto.py          # password -> key, encrypt, decrypt
    codec.py           # bytes <-> big integer <-> chess games
    rankers.py         # move orderings (all legal moves / engine top-k)
    cli.py             # command-line interface
  analysis/            # Stage 3 scripts, results, plots
  tests/
```

---

## Stage 1: Basic chess cipher

### 1a. Encryption (`crypto.py`)
- Derive a 256-bit key from the user's password with **scrypt**, using a random 16-byte salt (n=2**15, r=8, p=1 are fine defaults).
- Encrypt with **AES-256-GCM**, using a random 12-byte nonce.
- Output format: `salt (16) || nonce (12) || ciphertext+tag`.
- Decryption with a wrong password must raise a clean error, not return garbage. GCM's authentication tag gives this for free.

### 1b. Bytes → one big integer
- Build `payload = b"\x01" + encrypted_bytes`.
- The leading `0x01` sentinel byte ensures no leading zero bytes are lost when converting to an integer.
- `N = int.from_bytes(payload, "big")`.
- Reverse: convert the integer back to bytes, check that the first byte is `0x01`, then strip it.

### 1c. Integer → chess moves (mixed-radix encoding)
This is the core trick. Do not hard-code "5 bits per move". Instead, treat the number of legal moves at each position as that position's base (radix):

```
board = new game
while N > 0:
    moves = ranker.ordered_moves(board)   # deterministic order, see below
    r = len(moves)
    digit = N % r
    N = N // r
    play moves[digit]
    if game is over (board.is_game_over()) or ply count >= MAX_PLIES (default 200):
        save game, start a new board
save final game (unfinished, result "*")
```

- Stage 1 ranker: **all legal moves sorted by their UCI string** (e.g. `"e2e4"`). This ordering is deterministic and identical on both sides.
- Positions with only 1 legal move have radix 1: the move is played but carries no data. That is fine.
- Output all games as one multi-game PGN file with normal-looking headers (Event, Date, White, Black, Result). Do **not** put any hint of the hidden data in the headers.

### 1d. Decoding
- Replay every game in the PGN. At each position, rebuild the same ordered move list, look up the index (`digit`) of the move that was played, and record `(digit, radix)`.
- Rebuild `N` from the last pair back to the first: `N = N * radix + digit`.
- Then integer → bytes → strip sentinel → decrypt.

### 1e. CLI (`cli.py`)
```
python -m chess_stego encode <input_file> -o games.pgn
python -m chess_stego decode games.pgn -o recovered_file
```
- Prompt for the password with `getpass`. Never accept it as a plain command-line argument, because it would end up in shell history.
- Print a short summary after encoding: input size, number of games, total moves, and average bits per move (`log2(radix)` summed over moves ÷ moves).

### 1f. Tests
- Round-trips byte-for-byte for: empty file, 1 byte, random 1 KB, random 50 KB, a text file, and a small image.
- Wrong password → clean failure.
- One altered move in the PGN → decryption fails (integrity check works).
- Every generated game is legal (python-chess can replay it).

**Done when:** all tests pass, the CLI works on a real file, and a README "Quick start" section exists. Commit.

---

## Stage 2: Natural-looking games (engine-guided)

**The problem:** Stage 1 picks moves from random-looking ciphertext, so the games are full of absurd blunders. Anyone glancing at them would be suspicious.

**The fix:** only encode data in the choice among the engine's **top k moves** (e.g. k = 2, 3, 4) instead of all legal moves. The games look much more like real play, at the cost of fewer bits per move (about `log2(k)`).

### Steps
1. Install Stockfish (Homebrew / apt / winget, or download the official binary). Find its path automatically, and allow overriding it with an environment variable `STOCKFISH_PATH`. Record the Stockfish version in `DECISIONS.md`.
2. Implement `EngineTopKRanker(k, nodes)` in `rankers.py`:
   - Use `engine.analyse(board, chess.engine.Limit(nodes=NODES), multipv=k, game=object())`. Passing a fresh `game` object clears the engine's state between positions.
   - Configure `Threads=1` and a fixed `Hash` size. **This is critical:** the encoder and decoder must produce the *exact same ranking*. Fixed nodes + single thread + cleared state makes Stockfish deterministic for the same binary. Time-based limits or multiple threads would break decoding.
   - Return the moves in MultiPV order. The radix is `min(k, number of legal moves)`.
3. Add CLI flags `--ranker {uci,engine}`, `--k`, `--nodes`. The decoder must be given the same settings. Do not store them in the PGN, since that would reveal the hidden message.
4. **Determinism test (most important test in this stage):** encode the same file, then decode it in a *separate process* several times, and confirm it always round-trips. Also run the full round-trip test suite from Stage 1 with the engine ranker for k = 2, 3, 4.
5. Measure and record in `analysis/capacity.md`: bits per move, moves per KB, and encode/decode time for k = 2, 3, 4, 8, and for the Stage 1 all-moves ranker.

**Fallback:** if Stockfish truly cannot be installed, implement a simple deterministic ranker yourself (material + piece-square tables, 2-ply search, ties broken by UCI string). Note this in `DECISIONS.md` and the final report.

**Done when:** engine mode round-trips reliably across separate runs, and the capacity table exists. Commit.

---

## Stage 3: Can a detector tell our games apart from real ones?

This is the evaluation that makes the project worth showing.

### Data
- Real human games: download a small monthly file from the Lichess open database (https://database.lichess.org/). The **earliest months (e.g. 2013-01) are small**. Do not download a recent multi-GB month. Read it with `zstandard` + python-chess, streaming rather than loading everything into memory.
- Filter to standard rated games with at least 20 moves. Sample around 300 games.
- Generated games: around 300 games each from (a) the Stage 1 all-moves ranker and (b) the Stage 2 engine ranker at k = 2 and k = 4, made by encoding random encrypted data.

### Features (per game)
- Analyse every move with Stockfish at a fixed modest depth (e.g. depth 10–12; keep total runtime reasonable).
- Average centipawn loss, blunder rate (moves losing ≥ 200 cp), and mistake rate (100–200 cp).
- How often the played move was engine top-1 / top-2 / top-3.
- Game length, and how games end (checkmate, draw, unfinished).

### Analysis
- Plot the distributions (real vs each generated set) and save the PNGs in `analysis/`.
- Train a simple classifier (logistic regression and a random forest) for "real vs generated". Use 5-fold cross-validation and report accuracy and ROC-AUC.
- **How to read it:** accuracy near 50% means the games are indistinguishable from real ones; near 100% means they are easy to detect.
- Expect Stage 1 games to be detected almost perfectly. Engine games may *also* be detectable, because they are too accurate (humans blunder). Report honestly whatever you find.

### Optional stretch (only if everything above is done)
Instead of choosing uniformly among the top-k moves, match how often real humans pick the engine's 1st / 2nd / 3rd… choice (measured from the Lichess sample). Use arithmetic-coding-style encoding to do this. Re-run the detector and compare the results.

**Done when:** `analysis/RESULTS.md` contains the tables, plots, and a plain-language interpretation. Commit.

---

## Final report (mandatory)

Write `EXPLANATION.md` for someone who **does not know cryptography or steganography**. Use plain language, analogies, and short sections. Cover:

1. **What we built**, in 3–4 sentences.
2. **Key concepts explained simply:** encryption vs encoding vs steganography; what AES-GCM does and why it detects tampering; what scrypt does to a password and why; what mixed-radix encoding is, with a tiny worked example (e.g. encoding the number 100 over three positions that have 20, 30, and 25 legal moves).
3. **Walkthrough of each file:** what it does and how the pieces connect, following the data from input file → games → recovered file.
4. **What happened in each stage:** what was built, problems hit, and how they were solved (pull these from `DECISIONS.md` and the git history).
5. **Results:** the capacity numbers and the detection results, with an honest explanation of what they mean.
6. **Limitations and security caveats:** e.g. both sides need the identical engine version and settings; the chess layer is not what makes it secure (AES is); detection risks.
7. **How to run it yourself:** copy-paste commands.
8. **Ideas for next steps**, and how this could be described on a resume in 2–3 lines.

Then, in your final chat message, give a short summary: what works, the headline results, and where to start reading (`EXPLANATION.md`).

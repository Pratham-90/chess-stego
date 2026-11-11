# Chess Stego

Hide a file inside ordinary-looking chess games.

The file is first encrypted with **AES-256-GCM** (key derived from your password
with **scrypt**), and the encrypted bytes are then written as a sequence of chess
moves in a PGN file. To get the file back you need the PGN and the password.

For a full beginner-friendly explanation see [EXPLANATION.md](EXPLANATION.md).

## Quick start

```bash
# 1. set up (once)
python -m venv .venv
.venv\Scripts\activate            # Windows   (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt

# 2. hide a file (asks for a password)
python -m chess_stego encode secret.txt -o games.pgn

# 3. recover it (asks for the same password)
python -m chess_stego decode games.pgn -o recovered.txt
```

`encode` prints a summary: input size, number of games, total moves and the
average number of bits each move carries.

The password is always typed at a hidden prompt, never passed as an argument.
For scripts you can set the environment variable `CHESS_STEGO_PASSWORD` instead.

## Natural-looking games (engine mode)

By default any legal move can be played, so the games look like nonsense. With
`--ranker engine` only Stockfish's `k` best moves are used, which looks far more
like real chess but needs more moves per byte:

```bash
python -m chess_stego encode secret.txt -o games.pgn --ranker engine --k 3
python -m chess_stego decode games.pgn -o recovered.txt --ranker engine --k 3
```

- **Decode must use the same `--ranker`, `--k` and `--nodes` as encode, and the
  same Stockfish version** (this project was built and tested with Stockfish 19).
  The settings are deliberately not written into the PGN.
- Stockfish is found via the `STOCKFISH_PATH` environment variable, then your
  `PATH`, then a `tools/` folder inside the project. Get it from
  <https://stockfishchess.org/download/> (or `brew install stockfish` /
  `apt install stockfish`) and unpack it into `tools/`.
- Engine mode is slow: about 14 ms per move, i.e. one to two minutes per KB in each direction.

See [analysis/capacity.md](analysis/capacity.md) for bits per move and timings.

## Tests

```bash
python -m pytest                      # everything (engine tests take 10+ minutes)
python -m pytest tests/test_stage1.py # fast: no Stockfish needed
```

## Detection experiment

`analysis/` holds the scripts that compare generated games with real human
games from Lichess and train a detector. Results and plots are in
[analysis/RESULTS.md](analysis/RESULTS.md). To re-run everything:

```bash
python analysis/make_dataset.py   # sample real games, generate stego games (~10 min)
python analysis/features.py       # analyse every move with Stockfish (~15 min)
python analysis/detect.py         # plots + classifiers (seconds)
```

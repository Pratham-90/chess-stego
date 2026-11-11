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

## Tests

```bash
python -m pytest
```

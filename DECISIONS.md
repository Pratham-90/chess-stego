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

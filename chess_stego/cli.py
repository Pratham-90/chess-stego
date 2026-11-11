"""Command-line interface.

    python -m chess_stego encode secret.txt -o games.pgn
    python -m chess_stego decode games.pgn -o recovered.txt
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

from . import codec, crypto
from .rankers import UciRanker


def read_password(confirm: bool) -> str:
    # The password is never a command-line argument (it would land in shell
    # history). CHESS_STEGO_PASSWORD exists only so scripts/tests can run
    # without a keyboard.
    env = os.environ.get("CHESS_STEGO_PASSWORD")
    if env is not None:
        return env
    password = getpass.getpass("Password: ")
    if confirm and getpass.getpass("Repeat password: ") != password:
        sys.exit("error: passwords do not match")
    return password


def make_ranker(args):
    return UciRanker()


def cmd_encode(args) -> None:
    data = Path(args.input).read_bytes()
    encrypted = crypto.encrypt(data, read_password(confirm=True))
    ranker = make_ranker(args)
    try:
        games, stats = codec.encode(encrypted, ranker, args.max_plies)
    finally:
        ranker.close()
    Path(args.output).write_text(codec.to_pgn(games), encoding="utf-8")
    print(f"input size:    {len(data)} bytes ({len(encrypted)} after encryption)")
    print(f"games:         {stats.games}")
    print(f"total moves:   {stats.moves}")
    print(f"bits per move: {stats.bits_per_move:.2f}")
    print(f"wrote {args.output}")


def cmd_decode(args) -> None:
    pgn_text = Path(args.input).read_text(encoding="utf-8")
    ranker = make_ranker(args)
    try:
        encrypted = codec.decode(pgn_text, ranker)
    finally:
        ranker.close()
    data = crypto.decrypt(encrypted, read_password(confirm=False))
    Path(args.output).write_bytes(data)
    print(f"recovered {len(data)} bytes -> {args.output}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="chess_stego", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)

    enc = sub.add_parser("encode", help="hide a file inside chess games")
    enc.add_argument("input", help="file to hide")
    enc.add_argument("-o", "--output", default="games.pgn", help="PGN file to write")
    enc.add_argument("--max-plies", type=int, default=codec.MAX_PLIES,
                     help="start a new game after this many half-moves")
    enc.set_defaults(func=cmd_encode)

    dec = sub.add_parser("decode", help="recover a file from chess games")
    dec.add_argument("input", help="PGN file produced by encode")
    dec.add_argument("-o", "--output", required=True, help="where to write the recovered file")
    dec.set_defaults(func=cmd_decode)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (codec.DecodeError, crypto.DecryptionError, OSError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0

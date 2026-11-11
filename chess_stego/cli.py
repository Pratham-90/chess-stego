"""Command-line interface.

    python -m chess_stego encode secret.txt -o games.pgn
    python -m chess_stego decode games.pgn -o recovered.txt

Add `--ranker engine --k 3` to both commands for natural-looking games.
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

from . import codec, crypto
from .rankers import DEFAULT_K, DEFAULT_NODES, EngineTopKRanker, HumanLikeRanker, UciRanker


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
    if args.ranker == "engine":
        return EngineTopKRanker(k=args.k, nodes=args.nodes)
    if args.ranker == "human":
        return HumanLikeRanker(nodes=args.nodes)
    return UciRanker()


def add_ranker_flags(parser) -> None:
    # These settings are NOT stored in the PGN (that would give the game away),
    # so decode must be given exactly the same values as encode.
    parser.add_argument("--ranker", choices=["uci", "engine", "human"], default="uci",
                        help="uci: any legal move; engine: only Stockfish's top-k moves; "
                             "human: top-8 moves picked as often as humans pick them")
    parser.add_argument("--k", type=int, default=DEFAULT_K,
                        help="engine ranker: choose among the k best moves")
    parser.add_argument("--nodes", type=int, default=DEFAULT_NODES,
                        help="engine/human ranker: positions Stockfish searches per move")


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
    add_ranker_flags(enc)
    enc.set_defaults(func=cmd_encode)

    dec = sub.add_parser("decode", help="recover a file from chess games")
    dec.add_argument("input", help="PGN file produced by encode")
    dec.add_argument("-o", "--output", required=True, help="where to write the recovered file")
    add_ranker_flags(dec)
    dec.set_defaults(func=cmd_decode)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (codec.DecodeError, crypto.DecryptionError, OSError) as err:  # incl. Stockfish not found
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0

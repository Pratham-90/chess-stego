"""Stretch goal: weighted (human-like) move choice and varied game lengths."""
import random
from collections import Counter

import pytest

from chess_stego import codec, crypto
from chess_stego.codec import put_weighted_digit, take_weighted_digit
from chess_stego.rankers import HUMAN_WEIGHTS, HumanLikeRanker, UciRanker
from conftest import PASSWORD, SMALL_PAYLOADS


def test_weighted_digit_is_reversible_and_shrinks_n():
    rng = random.Random(0)
    for _ in range(5000):
        weights = [rng.randint(1, 20) for _ in range(rng.randint(1, 8))]
        n = rng.getrandbits(rng.randint(0, 200))
        rest, digit = take_weighted_digit(n, weights)
        assert rest <= n
        assert put_weighted_digit(rest, digit, weights) == n


def test_equal_weights_are_plain_mixed_radix():
    # Same arithmetic as divmod; only the option numbering runs from the end.
    for n in range(500):
        assert take_weighted_digit(n, [1] * 7) == (n // 7, 6 - n % 7)


def test_weighted_digits_follow_the_weights():
    """Random data should pick each option in proportion to its weight."""
    weights, counts = [5, 2, 1], Counter()
    n = random.Random(1).getrandbits(200_000)
    while n > 0:
        n, digit = take_weighted_digit(n, weights)
        counts[digit] += 1
    total = sum(counts.values())
    for digit, weight in enumerate(weights):
        assert counts[digit] / total == pytest.approx(weight / 8, abs=0.01)


def test_human_weights_always_terminate():
    # The rarest option must have weight 1, otherwise a small leftover n could
    # keep picking the same option forever without getting smaller.
    assert HUMAN_WEIGHTS[-1] == 1
    for start in range(1, 2000):
        n = start
        while n > 0:
            smaller, _ = take_weighted_digit(n, HUMAN_WEIGHTS)
            assert smaller < n
            n = smaller


def test_varied_game_lengths_roundtrip():
    """The encoder may cut games at any length; the decoder does not care."""
    rng = random.Random(2)
    data = crypto.encrypt(b"x" * 300, PASSWORD)
    games, _ = codec.encode(data, UciRanker(), max_plies=lambda: rng.randint(20, 90))
    assert len({board.ply() for board in games}) > 3
    assert codec.decode(codec.to_pgn(games), UciRanker()) == data


@pytest.mark.parametrize("name", SMALL_PAYLOADS)
def test_human_like_roundtrip(name):
    data = SMALL_PAYLOADS[name]
    ranker = HumanLikeRanker()
    try:
        games, stats = codec.encode(crypto.encrypt(data, PASSWORD), ranker)
        assert 0 < stats.bits_per_move < 3
        assert crypto.decrypt(codec.decode(codec.to_pgn(games), ranker), PASSWORD) == data
    finally:
        ranker.close()

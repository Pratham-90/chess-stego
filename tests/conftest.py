"""Shared test data."""
import os
import struct
import zlib

PASSWORD = "correct horse battery staple"


def tiny_png(size: int = 16) -> bytes:
    """Build a small valid RGB PNG by hand (a colour gradient)."""
    def chunk(kind: bytes, body: bytes) -> bytes:
        return (struct.pack(">I", len(body)) + kind + body
                + struct.pack(">I", zlib.crc32(kind + body)))

    rows = b"".join(
        b"\x00" + bytes(c for x in range(size) for c in (x * 16 % 256, y * 16 % 256, 128))
        for y in range(size)
    )
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


TEXT = ("The quick brown fox jumps over the lazy dog.\n" * 20).encode()

# name -> bytes. The same payloads are used for every ranker.
SMALL_PAYLOADS = {
    "empty": b"",
    "one_byte": b"\x00",  # a zero byte also checks the sentinel logic
    "text": TEXT,
    "image": tiny_png(),
}
LARGE_PAYLOADS = {
    "random_1kb": os.urandom(1024),
    "random_50kb": os.urandom(50 * 1024),
}

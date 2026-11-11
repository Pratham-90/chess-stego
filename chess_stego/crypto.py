"""Password-based encryption: scrypt (password -> key) + AES-256-GCM.

Output layout:  salt (16 bytes) || nonce (12 bytes) || ciphertext + GCM tag (16 bytes)
"""
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

SALT_LEN = 16
NONCE_LEN = 12
TAG_LEN = 16


class DecryptionError(Exception):
    """Wrong password, or the data was changed/corrupted."""


def derive_key(password: str, salt: bytes) -> bytes:
    """Turn a password into a 256-bit key.

    scrypt is deliberately slow and memory-hungry (n=2**15 uses ~32 MB), so an
    attacker guessing passwords can only try a few per second per core.
    The random salt means the same password gives a different key every time,
    which defeats precomputed password tables.
    """
    kdf = Scrypt(salt=salt, length=32, n=2**15, r=8, p=1)
    return kdf.derive(password.encode("utf-8"))


def encrypt(plaintext: bytes, password: str) -> bytes:
    salt = os.urandom(SALT_LEN)
    nonce = os.urandom(NONCE_LEN)  # must never repeat for the same key
    key = derive_key(password, salt)
    # AESGCM.encrypt returns ciphertext with the 16-byte auth tag appended.
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, None)
    return salt + nonce + ciphertext


def decrypt(blob: bytes, password: str) -> bytes:
    if len(blob) < SALT_LEN + NONCE_LEN + TAG_LEN:
        raise DecryptionError("data is too short to be a valid encrypted message")
    salt = blob[:SALT_LEN]
    nonce = blob[SALT_LEN:SALT_LEN + NONCE_LEN]
    ciphertext = blob[SALT_LEN + NONCE_LEN:]
    key = derive_key(password, salt)
    try:
        # GCM recomputes the tag; if even one bit of the key or ciphertext is
        # wrong the tags differ and we get InvalidTag instead of garbage.
        return AESGCM(key).decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise DecryptionError("wrong password or corrupted data") from None

"""Envelope encryption primitives (CRYPT-01, CRYPT-02, D3-05).

Five functions, every one taking and returning plain `bytes`, never
exposing an `AESGCM` instance to a caller -- the same "one job, nothing
else belongs here" discipline as `money/units.py`. AES-256-GCM via
`cryptography`'s `AESGCM`, API verified against `cryptography.io`'s own
docs (03-RESEARCH.md Pattern 1): `encrypt(nonce, data, associated_data)`
returns the ciphertext with its 16-byte tag already appended -- no separate
tag column is needed -- and `decrypt` raises
`cryptography.exceptions.InvalidTag` when the ciphertext, nonce, key, or
associated data is wrong, including a ciphertext copied from a different
row (03-RESEARCH.md Pitfall 4).

A fresh 96-bit nonce (`os.urandom(12)`) is generated inside every single
call to `wrap_dek`/`encrypt_field`, never per row and never per user, and
never reused. NIST SP 800-38D Sec 8.3 caps random-nonce GCM at 2^32
invocations per key; this project's realistic volume sits roughly 13,000x
below that (03-RESEARCH.md Pitfall 2) -- counter-based nonce machinery
would solve a problem that does not exist at this scale, so none is built
here.
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_DEK_BIT_LENGTH = 256
_NONCE_LENGTH_BYTES = 12


def generate_dek() -> bytes:
    """A fresh 256-bit data-encryption key. CRYPT-01, D3-05."""
    return AESGCM.generate_key(bit_length=_DEK_BIT_LENGTH)


def wrap_dek(dek: bytes, kek: bytes) -> tuple[bytes, bytes]:
    """Wrap a DEK under the KEK. No associated data -- a wrapped DEK is not
    bound to any one row. Returns `(wrapped_dek, wrap_nonce)`."""
    nonce = os.urandom(_NONCE_LENGTH_BYTES)
    return AESGCM(kek).encrypt(nonce, dek, None), nonce


def unwrap_dek(wrapped_dek: bytes, wrap_nonce: bytes, kek: bytes) -> bytes:
    """Raises `cryptography.exceptions.InvalidTag` if `wrapped_dek`,
    `wrap_nonce` or `kek` is wrong."""
    return AESGCM(kek).decrypt(wrap_nonce, wrapped_dek, None)


def encrypt_field(
    plaintext: bytes, dek: bytes, associated_data: bytes
) -> tuple[bytes, bytes]:
    """One fresh nonce per call. Returns `(ciphertext_with_tag, nonce)`.

    `associated_data` is required, not optional -- an empty caller-chosen
    value is still a caller decision, not a default that lets a row go
    unbound by omission (03-RESEARCH.md Pitfall 4).
    """
    nonce = os.urandom(_NONCE_LENGTH_BYTES)
    return AESGCM(dek).encrypt(nonce, plaintext, associated_data), nonce


def decrypt_field(
    ciphertext: bytes, nonce: bytes, dek: bytes, associated_data: bytes
) -> bytes:
    """Raises `cryptography.exceptions.InvalidTag` if the ciphertext,
    nonce, key or associated data is wrong -- including a ciphertext
    copied from a different row."""
    return AESGCM(dek).decrypt(nonce, ciphertext, associated_data)

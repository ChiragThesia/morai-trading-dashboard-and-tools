"""Opaque bearer tokens (D2-04): one canonical implementation, shared by
sessions now (this plan) and setup tokens in plan 02-05 -- the same
"one canonical implementation per cross-cutting concern" the money kernel
follows (`L060`).
"""

from __future__ import annotations

import hashlib
import secrets


def generate_token() -> str:
    """256 bits of entropy, URL-safe. Not guessable; the hash below protects
    a stolen database row from being replayed, not against brute force --
    there is nothing to brute force here."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256, not Argon2 -- deliberately (`02-RESEARCH.md`, "Session token
    hashing before storage"). This token already carries 256 bits of entropy,
    unlike a password, so a fast hash costs an attacker nothing extra to
    search, while a slow hash would tax every legitimate request for no
    benefit. Defends against a stolen database dump/backup exposing a
    directly usable token -- `NN-34`'s bearer-equivalent discipline, applied
    to a table this project owns rather than a vendor's OAuth code."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

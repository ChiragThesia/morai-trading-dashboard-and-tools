"""Argon2id password hashing, at OWASP's higher-security band rather than
its published minimum (D2-03), because these accounts are linked to
brokerage credentials.

`time_cost=3, memory_cost=131072 (KiB, so 128 MiB), parallelism=1` measured
276 ms on an Apple M1 Pro -- inside OWASP's 250-400 ms target band, but a
**floor, not the deployed answer**. The real constraint on a Railway
container is CPU wall-clock on a shared vCPU, not memory: 128 MiB is trivial
against any Railway plan's ceiling, while a shared vCPU may be several times
slower per-core than an M1. The Railway measurement is owed --
`tools/measure_argon2.py` is the committed script, and it has not been run
there because deploys are blocked by this session's permission classifier.

**Fallback order if the measured Railway time lands meaningfully over
400 ms:** reduce `time_cost` first (3 -> 2) -- that stays inside OWASP's
documented acceptable range. Only drop `memory_cost` below OWASP's 19 MiB
floor as a genuine last resort, and treat that as a decision a human makes
with the reason written down; memory hardness is what makes GPU attacks
expensive, and it is the whole reason D2-03 asks for the higher band.

One module-level `PasswordHasher`, built once -- constructing one per call
re-pays its own parameter setup on every login for no benefit.

`type` is not passed to `PasswordHasher`: its default is already `Type.ID`
(confirmed from the installed package's own `__init__` signature this
session), and a redundant argument is one more thing to keep in agreement
with the library.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

_hasher = PasswordHasher(time_cost=3, memory_cost=131072, parallelism=1)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    """Constant-time via `argon2-cffi`'s own `verify` -- never a manual
    comparison. Catches `VerifyMismatchError` (wrong password) and
    `InvalidHashError` (a malformed stored hash) alike, both returning False
    rather than raising: a malformed hash is a rejected login, not a 500 that
    tells an attacker the row exists. `NN-34`: neither exception's message
    carries the password, so nothing here needs to inspect or suppress one to
    stay silent -- letting either propagate would already be safe, and
    catching them is only about the login outcome, not about redaction."""
    try:
        _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False
    return True


def needs_rehash(stored_hash: str) -> bool:
    """True if `stored_hash` was produced with different parameters than
    `_hasher` is currently configured with. Call after a successful verify,
    so a future parameter bump upgrades hashes lazily at next login instead
    of needing a bulk migration nobody runs."""
    return _hasher.check_needs_rehash(stored_hash)

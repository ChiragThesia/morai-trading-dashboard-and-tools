"""D2-03: Argon2id at OWASP's higher-security band. `NN-34` applies to a
password hash exactly as it applies to a token (D2-14) -- the parameter
assertion below parses the produced hash string rather than trusting the
constructor argument, and the leak-check asserts the False path logs nothing
and raises nothing that carries the secret.
"""

from __future__ import annotations

import logging
import re

import pytest
from argon2 import PasswordHasher

from morai.identity.passwords import hash_password, needs_rehash, verify_password

_PASSWORD = "correct horse battery staple"
_PARAM_PATTERN = re.compile(r"\$m=(\d+),t=(\d+),p=(\d+)\$")


def test_verify_password_accepts_own_hash() -> None:
    hashed = hash_password(_PASSWORD)
    assert verify_password(hashed, _PASSWORD) is True


def test_verify_password_rejects_wrong_password_without_raising() -> None:
    hashed = hash_password(_PASSWORD)
    assert verify_password(hashed, "wrong password") is False


def test_hash_password_uses_per_hash_salt() -> None:
    first = hash_password(_PASSWORD)
    second = hash_password(_PASSWORD)
    assert first != second


def test_hash_parameters_read_from_hash_string() -> None:
    """Parses the produced `$argon2id$v=19$m=131072,t=3,p=1$...` prefix.
    Asserting the constructor argument proves nothing; parsing the output
    proves the library used it."""
    hashed = hash_password(_PASSWORD)
    match = _PARAM_PATTERN.search(hashed)
    assert match is not None
    memory_cost, time_cost, parallelism = (int(g) for g in match.groups())
    assert memory_cost == 131072  # KiB -- 128 MiB, OWASP's higher-security band
    assert time_cost == 3
    assert parallelism == 1


def test_needs_rehash_false_for_current_params_true_for_weaker() -> None:
    current = hash_password(_PASSWORD)
    assert needs_rehash(current) is False

    weaker_hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    weaker = weaker_hasher.hash(_PASSWORD)
    assert needs_rehash(weaker) is True


def test_verify_password_rejects_malformed_hash_without_raising() -> None:
    assert verify_password("not-a-valid-argon2-hash", _PASSWORD) is False


def test_no_secret_leaks_in_repr_or_logs(caplog: pytest.LogCaptureFixture) -> None:
    """A wrong-password verification is the one path in this module that
    handles a secret and a mismatch together -- the case NN-34 is guarding.
    Neither the password nor the hash may appear in a log record, and the
    boolean return leaves nothing for a caller to accidentally repr()."""
    hashed = hash_password(_PASSWORD)

    with caplog.at_level(logging.DEBUG):
        result = verify_password(hashed, "wrong password")

    assert result is False
    assert caplog.records == []
    assert _PASSWORD not in caplog.text
    assert hashed not in caplog.text
    assert _PASSWORD not in repr(result)
    assert hashed not in repr(result)

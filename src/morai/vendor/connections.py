"""The connection table's one write path and its read path (D4-09, D4-11,
D4-12, D4-17, D4-20).

`upsert_connection` does the encryption itself -- callers hand it plaintext
and never touch AES, mirroring `ledger.fills.insert_fills`'s discipline
(D4-11). It encrypts under the connecting user's existing Phase 3 DEK
through `crypto/envelope.py`'s `encrypt_field`, with its own AAD helper
binding each ciphertext to `schwab_connections`, its column name and the
`user_id` -- the same `table:column:key` convention `fills.py`/`events.py`
already established. It looks up the current DEK with a private
`_current_dek`, duplicated from `ledger/fills.py` -- the third copy,
following the precedent `ledger/events.py`'s own docstring already records
and explains. **A fourth copy is the signal to promote this into a shared
helper, not a reason to duplicate a fourth time.**

`upsert_connection` does not commit -- the caller owns the transaction
(D4-20). This is load-bearing, not a style choice: a
`set_config(..., is_local=true)` GUC resets to the empty string, not NULL,
at the end of the transaction that set it, so an internal commit would
silently break `app.current_user_id` for whatever RLS-protected query the
caller runs next on the same session (confirmed live in Phase 3).

It serves both first connect and re-auth with one function: an
`UPDATE ... WHERE user_id = :uid` first, falling back to `INSERT` only when
`rowcount` is zero, matching `/setup`'s own explicit `rowcount` guard
(D4-09) rather than `ON CONFLICT DO UPDATE`. That is what makes the
per-user row count stay exactly one, by construction.

`derive_connection_health` is a pure function, `now` as an explicit
parameter -- the same idiom `tests/identity/test_setup_tokens.py`'s own
`ttl=timedelta(seconds=-1)` case already uses to prove expiry logic without
waiting. Health is derived at read time from `expires_at`, never a stored
status column (D4-12): a stored column is a second writer for something
derivable. The seven-day lifetime is anchored to the vendor's own
`creation_timestamp`, which `schwab-py`'s `TokenMetadata` explicitly does
not update on refresh -- anchoring to "last refresh" instead would reset
the clock on every automatic refresh and make the expiry invisible. The
seven days is a measured vendor fact (V001); the twelve-hour
`_EXPIRING_SOON_THRESHOLD` is an adaptation of v1's own operational
practice of notifying at roughly six and a half days of token age -- the
two constants do not carry equal weight, and this comment says so rather
than leaving that distinction implicit.

D4-15's honest limit: the real seven-day window has never been observed
against a live Schwab connection. This function is proven correct for
arbitrary `(token_created_at, now)` pairs; that is not the same claim.

Two permanently-null columns, by design, each with its own owner
(D4-13, D4-16): `last_synced_at` is written only after a genuinely
successful sync, and no sync exists until Phase 6, which owns real
ingest. `reauth_notified_at` records that a re-auth notification is
due; delivery belongs to a later phase, since no email vendor exists
in this system and none was added back here. A reader finding both
columns NULL should find the reason here, not have to go looking for
it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import StrEnum
from uuid import UUID

from pydantic import JsonValue, TypeAdapter
from sqlalchemy import select, text, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import decrypt_field, encrypt_field, unwrap_dek
from morai.db.models import SchwabConnection
from morai.settings import get_settings
from morai.vendor.protocol import (
    ExchangedToken,
    SchwabAuth,
    SchwabClient,
    TokenHolder,
    WrappedToken,
)

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `ledger/fills.py` already established. `TypeAdapter` narrows at
# that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)
_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
# `WrappedToken` lives in `protocol.py` -- `TokenHolder`'s closures and this
# module's own unwrap-after-refresh step share the one shape.
_WRAPPED_TOKEN: TypeAdapter[WrappedToken] = TypeAdapter(WrappedToken)


class ConnectionDataKeyMissing(RuntimeError):
    """Raised by `read_connection` when the row's `key_version` has no
    matching `user_data_keys` row -- the account's data key has been
    crypto-shredded (D3-08, AUTH-06). Mirrors `ledger.fills.DataKeyMissing`
    exactly; kept local rather than imported so this package does not
    depend on `ledger` for an unrelated table's own error type."""


@dataclass(frozen=True)
class ConnectionRecord:
    """One connection, read back and decrypted."""

    user_id: UUID
    account_hash: str
    token: JsonValue
    token_created_at: datetime
    last_synced_at: datetime | None
    reauth_notified_at: datetime | None
    key_version: int


class ConnectionHealth(StrEnum):
    HEALTHY = "healthy"
    EXPIRING_SOON = "expiring_soon"
    EXPIRED = "expired"


# V001, verified against the real 1.5.1 wheel: the vendor's own hard,
# server-side, unextendable refresh-token lifetime -- not a tunable.
_REFRESH_TOKEN_LIFETIME = timedelta(days=7)
# Not a measured constant -- an adaptation of v1's own operational practice
# of notifying at roughly six and a half days of token age (Assumptions Log
# A2, 04-RESEARCH.md).
_EXPIRING_SOON_THRESHOLD = timedelta(hours=12)


def derive_connection_health(
    token_created_at: datetime, now: datetime
) -> tuple[ConnectionHealth, datetime]:
    """`healthy`, `expiring_soon` or `expired`, plus the `expires_at` it was
    derived from. `now` is an ordinary parameter, never read from the
    system clock inside this function (D4-12) -- the exact same call
    proves this module's own boundary tests and serves
    `GET /schwab/connection`, so the route cannot drift from what the
    tests assert.

    `expires_at` is `token_created_at + _REFRESH_TOKEN_LIFETIME` (seven
    days) for every input, including ones already past it -- a past
    `expires_at` is a fact worth returning, not an absence. The seven days
    is V001, the vendor's own hard, server-side, unextendable
    refresh-token lifetime, verified against the real 1.5.1 wheel.
    `_EXPIRING_SOON_THRESHOLD` (twelve hours) carries less weight: it is
    not a measured vendor fact, only an adaptation of v1's own operational
    practice of notifying at roughly six and a half days of token age
    (Assumptions Log A2, 04-RESEARCH.md), reused here as a display
    threshold.

    D4-15's honest limit, stated here and not only in a plan: this
    function is proven correct for arbitrary `(token_created_at, now)`
    pairs -- the arithmetic is right. The real seven-day window has never
    been observed against a live Schwab connection. Those are not the
    same claim.
    """
    expires_at = token_created_at + _REFRESH_TOKEN_LIFETIME
    remaining = expires_at - now
    if remaining <= timedelta(0):
        return ConnectionHealth.EXPIRED, expires_at
    if remaining <= _EXPIRING_SOON_THRESHOLD:
        return ConnectionHealth.EXPIRING_SOON, expires_at
    return ConnectionHealth.HEALTHY, expires_at


def _connection_associated_data(column: str, *, user_id: UUID) -> bytes:
    """The one place this table's AAD row-binding format is fixed --
    changing it later costs a full re-encryption of this row, the same cost
    class as a DEK rotation. Follows `fills.py`/`events.py`'s own
    `table:column:key` convention."""
    return f"schwab_connections:{column}:{user_id}".encode("utf-8")


async def _current_dek(session: AsyncSession, user_id: UUID) -> tuple[bytes, int]:
    """The user's highest-`key_version` DEK, unwrapped in-process only.
    Duplicates `morai.ledger.fills._current_dek` -- see this module's own
    docstring for why this one is duplicated rather than imported, and why
    a fourth copy should be promoted instead of duplicated again."""
    row = (
        await session.execute(
            text(
                "SELECT key_version, wrapped_dek, wrap_nonce FROM user_data_keys "
                "WHERE user_id = :user_id ORDER BY key_version DESC LIMIT 1"
            ),
            {"user_id": user_id},
        )
    ).one()
    key_version = _INT.validate_python(row[0])
    wrapped_dek = _BYTES.validate_python(row[1])
    wrap_nonce = _BYTES.validate_python(row[2])
    dek = unwrap_dek(wrapped_dek, wrap_nonce, get_settings().master_key_bytes)
    return dek, key_version


async def _dek_for_version(
    session: AsyncSession, user_id: UUID, key_version: int
) -> bytes:
    """The DEK for one specific `key_version` -- mirrors `read_fills`'s own
    per-row lookup rather than reusing `_current_dek`'s "highest version"
    query, so a row's own stored `key_version` is always what unwraps it,
    even in a hypothetical future where a user's DEK has been rotated."""
    key_row = (
        await session.execute(
            text(
                "SELECT wrapped_dek, wrap_nonce FROM user_data_keys "
                "WHERE user_id = :user_id AND key_version = :key_version"
            ),
            {"user_id": user_id, "key_version": key_version},
        )
    ).one_or_none()
    if key_row is None:
        raise ConnectionDataKeyMissing(
            f"No user_data_keys row for user_id={user_id} "
            f"key_version={key_version} -- the account's data key has been "
            "destroyed (crypto-shred, D3-08)."
        )
    return unwrap_dek(
        _BYTES.validate_python(key_row[0]),
        _BYTES.validate_python(key_row[1]),
        get_settings().master_key_bytes,
    )


async def upsert_connection(
    session: AsyncSession,
    user_id: UUID,
    exchanged_token: ExchangedToken,
    account_hash: str,
) -> None:
    """The only write path into `schwab_connections`. Encrypts the token and
    account hash inside this function -- callers hand it plaintext and
    never touch AES (D4-11). Does not commit (D4-20) -- see this module's
    own docstring."""
    dek, key_version = await _current_dek(session, user_id)

    token_ciphertext, token_nonce = encrypt_field(
        json.dumps(exchanged_token.token).encode("utf-8"),
        dek,
        _connection_associated_data("token_ciphertext", user_id=user_id),
    )
    account_hash_ciphertext, account_hash_nonce = encrypt_field(
        account_hash.encode("utf-8"),
        dek,
        _connection_associated_data("account_hash_ciphertext", user_id=user_id),
    )

    result = await session.execute(
        update(SchwabConnection)
        .where(SchwabConnection.user_id == user_id)
        .values(
            account_hash_ciphertext=account_hash_ciphertext,
            account_hash_nonce=account_hash_nonce,
            token_ciphertext=token_ciphertext,
            token_nonce=token_nonce,
            key_version=key_version,
            token_created_at=exchanged_token.created_at,
        )
    )
    # `update(...)` with no `.returning()` types as the base `Result[Any]`,
    # which carries no `rowcount` -- that attribute is `CursorResult`'s own.
    # `isinstance` narrows without `cast`/`Any` (D-06), matching
    # `api/routes_identity.py`'s own identical guard.
    if not isinstance(result, CursorResult) or result.rowcount == 0:
        session.add(
            SchwabConnection(
                user_id=user_id,
                account_hash_ciphertext=account_hash_ciphertext,
                account_hash_nonce=account_hash_nonce,
                token_ciphertext=token_ciphertext,
                token_nonce=token_nonce,
                key_version=key_version,
                token_created_at=exchanged_token.created_at,
            )
        )
        await session.flush()


async def read_connection(
    session: AsyncSession, user_id: UUID
) -> ConnectionRecord | None:
    """Unwraps the DEK for this row's own `key_version` and returns a
    decrypted `ConnectionRecord`, or `None` if no row exists. RLS (not this
    function) is what makes a wrong `app.current_user_id` context return
    `None` regardless of `user_id`."""
    row = (
        await session.execute(
            select(SchwabConnection).where(SchwabConnection.user_id == user_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return None

    dek = await _dek_for_version(session, user_id, row.key_version)

    account_hash = decrypt_field(
        row.account_hash_ciphertext,
        row.account_hash_nonce,
        dek,
        _connection_associated_data("account_hash_ciphertext", user_id=user_id),
    ).decode("utf-8")
    # `.validate_json()`, not `json.loads()` + `.validate_python()` --
    # `json.loads` types its return as `Any` in typeshed, which would leak
    # a second, unaccounted-for `Any` into this module. `validate_json`
    # parses the raw bytes directly against the `JsonValue` schema with no
    # `Any`-typed intermediate.
    token = _JSON_VALUE.validate_json(
        decrypt_field(
            row.token_ciphertext,
            row.token_nonce,
            dek,
            _connection_associated_data("token_ciphertext", user_id=user_id),
        )
    )
    return ConnectionRecord(
        user_id=user_id,
        account_hash=account_hash,
        token=token,
        token_created_at=row.token_created_at,
        last_synced_at=row.last_synced_at,
        reauth_notified_at=row.reauth_notified_at,
        key_version=row.key_version,
    )


class ConnectionNotFound(RuntimeError):
    """Raised by `schwab_client_for_user` when the user has no
    `schwab_connections` row -- there is no token to build a client from."""


@asynccontextmanager
async def schwab_client_for_user(
    session: AsyncSession, user_id: UUID, auth: SchwabAuth
) -> AsyncGenerator[SchwabClient]:
    """Yields a live `SchwabClient` for one user, holding that user's own
    advisory lock for the whole body (CONN-06, D4-10). The order below is
    the requirement, not an implementation detail.

    First, `pg_advisory_xact_lock(hashtext(:uid))` -- the user id bound as a
    parameter, verified live against local Postgres 18 including with a
    bound parameter rather than a literal, the same primitive
    `tools/create_admin.py` already uses. Transaction-scoped, so it releases
    on the caller's own commit or on a crash, with no separate unlock to
    forget. Not `SELECT ... FOR UPDATE` on the connection row: that would
    hold a row lock across the refresh's own network call.

    Second -- and only after the lock is granted -- read and decrypt the
    stored token. Reading before locking is the bug this ordering exists to
    prevent: a waiter that loaded the token first would present the value
    the winner has already rotated away from, and Schwab answers a stale
    refresh token with `invalid_grant`.

    Third, yield a client built over a `TokenHolder` seeded with that
    token.

    Fourth, after the body returns normally, if the holder shows the
    vendor wrote a new token, re-encrypt it under the user's current DEK
    and `UPDATE` the row -- `token_ciphertext`, `token_nonce` and
    `key_version` only. `token_created_at` is left alone: it is the
    vendor's own `creation_timestamp`, which `schwab-py` explicitly does
    not update on an ordinary refresh, and moving it here would reset the
    seven-day expiry clock on every automatic refresh and make the expiry
    invisible. If the body raises, this step never runs and nothing here is
    persisted -- the caller's own transaction rollback is what undoes the
    rest.

    Does not commit -- the caller owns the transaction (D4-20). Here that
    is not a style choice twice over: the lock's lifetime and the write's
    durability are the same transaction, deliberately.

    Collision arithmetic, recorded rather than defended against: `hashtext`
    returns an int4, so for a handful of users the birthday-style collision
    probability is on the order of 10 / 2^32. A collision would cause a
    false extra serialisation between two unrelated users -- safe, briefly
    slower -- and never a false sharing of token data, since the key gates
    a critical section and is never a join key or a cache key.
    """
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"),
        {"uid": str(user_id)},
    )

    connection = await read_connection(session, user_id)
    if connection is None:
        raise ConnectionNotFound(
            f"No schwab_connections row for user_id={user_id} -- nothing to "
            "build a client from."
        )

    holder = TokenHolder(
        token={
            "creation_timestamp": int(connection.token_created_at.timestamp()),
            "token": connection.token,
        }
    )

    client = await auth.build_client(holder.read, holder.write)
    yield client

    if holder.wrote:
        wrapped = _WRAPPED_TOKEN.validate_python(holder.token)
        dek, key_version = await _current_dek(session, user_id)
        token_ciphertext, token_nonce = encrypt_field(
            json.dumps(wrapped.token).encode("utf-8"),
            dek,
            _connection_associated_data("token_ciphertext", user_id=user_id),
        )
        await session.execute(
            update(SchwabConnection)
            .where(SchwabConnection.user_id == user_id)
            .values(
                token_ciphertext=token_ciphertext,
                token_nonce=token_nonce,
                key_version=key_version,
            )
        )

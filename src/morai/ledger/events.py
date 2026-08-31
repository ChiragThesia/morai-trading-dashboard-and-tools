"""The write path into the events table (D3-04, D3-11, D3-15, D3-16, D3-17).

Mirrors `morai.ledger.fills` in shape: encryption happens inside
`insert_events()`, callers hand it `Decimal` and never touch AES.
`_encode_decimal`/`_decode_decimal` -- the `Decimal`-as-UTF-8-text encoding
-- are imported from `fills.py` rather than re-implemented here: two
independent serializations of the same `Decimal` is exactly the drift risk
that costs a ciphertext its ability to decrypt (03-RESEARCH.md Open
Question 1). `_current_dek` (the per-user current-DEK lookup) is
duplicated rather than imported, mirroring `fills.py`'s own shape exactly
-- `insert_fills` uses it for the *current* key_version on write,
`read_fills` does a separate per-row `key_version`-scoped lookup on read,
and `events.py` keeps that same split rather than reaching for a shared
"latest" helper on the read side, where it would be the wrong query the
moment a user's DEK is ever rotated to a second `key_version`.

`events` has no single-write-path type-gate (no `_write_token` sentinel on
`Event.__init__`, unlike `Fill`). 03-RESEARCH.md's Open Question 2 treats
that gate as Phase 5's concern, once Phase 5 actually derives events from
fills and a second writer becomes a real temptation; this phase lands the
table and this one write path, nothing gates a second one yet.

A ROLL's two amounts are never netted, never summed here. `read_events()`
returns `open_debit_usd`/`close_credit_usd` separately; whatever needs
their sum computes it in Python after decrypt (D3-04) -- the shape Phase 9
inherits.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID, uuid4

from pydantic import TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import decrypt_field, encrypt_field, unwrap_dek
from morai.db.models import Event
from morai.ledger.fills import (
    _decode_decimal,  # pyright: ignore[reportPrivateUsage]  # why: the same Decimal-as-UTF-8-text encoding fills.py already established (D3-17) -- a second serialization is exactly the drift risk this reuse avoids.
    _encode_decimal,  # pyright: ignore[reportPrivateUsage]  # why: see _decode_decimal above.
)
from morai.settings import get_settings

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `fills.py` already established. `TypeAdapter` narrows at that
# boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)

# NN-5, D3-16: no single insert_events() call adds more than this many rows
# before an intermediate flush.
_CHUNK_SIZE = 2000


@dataclass(frozen=True)
class EventWrite:
    """One event to insert. `open_debit_usd`/`close_credit_usd` are plain
    `Decimal | None` -- encryption happens inside `insert_events`, never at
    the call site (D3-15). A ROLL must supply both; `insert_events` raises
    before reaching the database if it doesn't, and the database `CHECK`
    (migration 0008) remains the backstop, not the only guard."""

    position_id: UUID
    event_type: str
    event_time: datetime
    fill_ids_hash: str | None
    open_debit_usd: Decimal | None
    close_credit_usd: Decimal | None


@dataclass(frozen=True)
class EventRecord:
    """One event read back, decrypted."""

    id: UUID
    user_id: UUID
    position_id: UUID
    event_type: str
    event_time: datetime
    fill_ids_hash: str | None
    open_debit_usd: Decimal | None
    close_credit_usd: Decimal | None
    key_version: int


def _event_associated_data(column: str, *, event_id: UUID) -> bytes:
    """The one place the events table's AAD row-binding format is fixed
    (documented next to migration 0008's own plaintext-column provenance --
    changing this later means re-encrypting every row). Follows the same
    `table:column:key` convention `fills.py`'s `_fill_associated_data`
    established, keyed on the row's own `id` rather than a composite key,
    since `events` has a single-column UUID primary key."""
    return f"events:{column}:{event_id}".encode("utf-8")


async def _current_dek(session: AsyncSession, user_id: UUID) -> tuple[bytes, int]:
    """The user's highest-`key_version` DEK, unwrapped in-process only.
    Duplicates `morai.ledger.fills._current_dek` -- see this module's own
    docstring for why this one is duplicated rather than imported."""
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


async def insert_events(
    session: AsyncSession, user_id: UUID, events: list[EventWrite]
) -> None:
    """The write path into the `events` table. Encrypts
    `open_debit_usd`/`close_credit_usd` inside this function -- callers
    hand it `Decimal` and never touch AES (D3-15).

    A ROLL missing either amount raises `ValueError` before any row is
    added -- the database `CHECK` constraint (migration 0008) is the
    backstop for a caller that bypasses this function, not the only guard
    for a caller that uses it.

    Does not commit -- same convention as `insert_fills`/
    `identity/audit.py::open_audited_read`: the caller's own transaction
    decides when this becomes durable, and an internal commit would reset
    the transaction-local `app.current_user_id` GUC the caller's RLS
    context depends on.
    """
    dek, key_version = await _current_dek(session, user_id)

    for chunk_start in range(0, len(events), _CHUNK_SIZE):
        chunk = events[chunk_start : chunk_start + _CHUNK_SIZE]
        for event in chunk:
            if event.event_type == "ROLL" and (
                event.open_debit_usd is None or event.close_credit_usd is None
            ):
                raise ValueError(
                    "A ROLL event requires both open_debit_usd and "
                    "close_credit_usd -- a compound event keeps its split "
                    "(LEDGER-04, D3-09)."
                )

            event_id = uuid4()

            open_debit_usd_ciphertext: bytes | None = None
            open_debit_usd_nonce: bytes | None = None
            if event.open_debit_usd is not None:
                open_debit_usd_ciphertext, open_debit_usd_nonce = encrypt_field(
                    _encode_decimal(event.open_debit_usd),
                    dek,
                    _event_associated_data("open_debit_usd", event_id=event_id),
                )
            close_credit_usd_ciphertext: bytes | None = None
            close_credit_usd_nonce: bytes | None = None
            if event.close_credit_usd is not None:
                close_credit_usd_ciphertext, close_credit_usd_nonce = encrypt_field(
                    _encode_decimal(event.close_credit_usd),
                    dek,
                    _event_associated_data("close_credit_usd", event_id=event_id),
                )
            session.add(
                Event(
                    id=event_id,
                    user_id=user_id,
                    position_id=event.position_id,
                    event_type=event.event_type,
                    event_time=event.event_time,
                    fill_ids_hash=event.fill_ids_hash,
                    open_debit_usd_ciphertext=open_debit_usd_ciphertext,
                    open_debit_usd_nonce=open_debit_usd_nonce,
                    close_credit_usd_ciphertext=close_credit_usd_ciphertext,
                    close_credit_usd_nonce=close_credit_usd_nonce,
                    key_version=key_version,
                )
            )
        await session.flush()


async def read_events(session: AsyncSession, user_id: UUID) -> list[EventRecord]:
    """Unwraps the DEK for each row's own `key_version` and returns
    decrypted `Decimal`s. RLS (not this function) is what makes a wrong
    `app.current_user_id` context return nothing regardless of `user_id`."""
    rows = (
        await session.execute(select(Event).where(Event.user_id == user_id))
    ).scalars()

    dek_cache: dict[int, bytes] = {}
    records: list[EventRecord] = []
    for row in rows:
        if row.key_version not in dek_cache:
            key_row = (
                await session.execute(
                    text(
                        "SELECT wrapped_dek, wrap_nonce FROM user_data_keys "
                        "WHERE user_id = :user_id AND key_version = :key_version"
                    ),
                    {"user_id": user_id, "key_version": row.key_version},
                )
            ).one()
            dek_cache[row.key_version] = unwrap_dek(
                _BYTES.validate_python(key_row[0]),
                _BYTES.validate_python(key_row[1]),
                get_settings().master_key_bytes,
            )
        dek = dek_cache[row.key_version]

        open_debit_usd: Decimal | None = None
        if (
            row.open_debit_usd_ciphertext is not None
            and row.open_debit_usd_nonce is not None
        ):
            open_debit_usd = _decode_decimal(
                decrypt_field(
                    row.open_debit_usd_ciphertext,
                    row.open_debit_usd_nonce,
                    dek,
                    _event_associated_data("open_debit_usd", event_id=row.id),
                )
            )
        close_credit_usd: Decimal | None = None
        if (
            row.close_credit_usd_ciphertext is not None
            and row.close_credit_usd_nonce is not None
        ):
            close_credit_usd = _decode_decimal(
                decrypt_field(
                    row.close_credit_usd_ciphertext,
                    row.close_credit_usd_nonce,
                    dek,
                    _event_associated_data("close_credit_usd", event_id=row.id),
                )
            )
        records.append(
            EventRecord(
                id=row.id,
                user_id=user_id,
                position_id=row.position_id,
                event_type=row.event_type,
                event_time=row.event_time,
                fill_ids_hash=row.fill_ids_hash,
                open_debit_usd=open_debit_usd,
                close_credit_usd=close_credit_usd,
                key_version=row.key_version,
            )
        )
    return records

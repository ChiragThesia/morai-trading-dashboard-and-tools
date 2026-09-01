"""The single write path into `broker_transactions` (D6-02).

Mirrors `morai.ledger.fills`'s own discipline exactly: the sentinel token
and its only legitimate holder (`insert_broker_transactions`) live in this
one module. Callers hand it a validated raw payload and never touch AES.

`_BROKER_TRANSACTION_WRITE_TOKEN` is imported by
`morai.db.models.BrokerTransaction.__init__` with a local (function-body)
import, not a module-level one -- `db/models.py` cannot import this module
at module scope, because this module imports `BrokerTransaction` from
`db/models.py` itself. The local import inside `__init__` breaks the
cycle: by the time `BrokerTransaction()` is actually called, both modules
have finished loading. Same convention `morai.ledger.fills` already
established for `Fill`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from pydantic import JsonValue, TypeAdapter
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import encrypt_field, unwrap_dek
from morai.db.models import BrokerTransaction
from morai.settings import get_settings

_BROKER_TRANSACTION_WRITE_TOKEN = object()

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `ledger/fills.py` already established. `TypeAdapter` narrows at
# that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)

# NN-5, OPS-05: `floor(65534 / 9) = 7281` -- `broker_transactions` has nine
# mapped columns (user_id, activity_id, transaction_type, transaction_time,
# order_id, raw_ciphertext, raw_nonce, key_version, created_at), so this
# project's existing 2,000-row chunk sits at roughly a quarter of the
# ceiling, with room to spare. See migration 0011's own docstring for the
# same derivation.
_CHUNK_SIZE = 2000


@dataclass(frozen=True)
class BrokerTransactionWrite:
    """One broker transaction to insert. `raw_payload` is the vendor's own
    element, exactly as received -- encryption happens inside
    `insert_broker_transactions`, never at the call site."""

    activity_id: str
    transaction_type: str
    transaction_time: datetime
    order_id: str | None
    raw_payload: JsonValue


def _broker_transaction_associated_data(
    column: str, *, user_id: UUID, activity_id: str
) -> bytes:
    """The one place this table's AAD row-binding format is fixed --
    changing it later costs a full re-encryption of every row, the same
    cost class as a DEK rotation. Follows `fills.py`/`connections.py`'s own
    `table:column:key` convention."""
    return f"broker_transactions:{column}:{user_id}:{activity_id}".encode("utf-8")


async def _current_dek(session: AsyncSession, user_id: UUID) -> tuple[bytes, int]:
    """The user's highest-`key_version` DEK, unwrapped in-process only.
    Duplicates `morai.ledger.fills._current_dek` -- following
    `vendor/connections.py`'s own precedent for why this is duplicated
    rather than imported, and why a fourth copy is the signal to promote
    this into a shared helper, not a reason to duplicate a fourth time."""
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


async def insert_broker_transactions(
    session: AsyncSession, user_id: UUID, rows: list[BrokerTransactionWrite]
) -> int:
    """The only write path into `broker_transactions` (D6-02). Encrypts
    each row's raw payload inside this function -- callers hand it a
    `JsonValue` and never touch AES.

    Does not commit -- same convention as `insert_fills`/
    `identity/audit.py::open_audited_read`: the caller's own transaction
    decides when this becomes durable, and a commit here would silently
    break `app.current_user_id` for whatever RLS-protected query the
    caller runs next on the same session.

    Chunks at `_CHUNK_SIZE` (NN-5, OPS-05). Each chunk goes through
    `pg_insert(...).on_conflict_do_nothing()` targeting the table's full
    composite primary key (`["user_id", "activity_id"]`) with a
    `RETURNING` clause -- safe here only because that key already carries
    every discriminating column (`NN-1`); a key missing one column plus a
    do-nothing clause is exactly the shape of the production bug that
    silently dropped real fills (WR-A3, `salvage/invariants.md`). Returns
    the landed count -- the number of rows that actually became durable,
    never the number handed in.
    """
    if not rows:
        return 0

    dek, key_version = await _current_dek(session, user_id)
    landed = 0

    for chunk_start in range(0, len(rows), _CHUNK_SIZE):
        chunk = rows[chunk_start : chunk_start + _CHUNK_SIZE]
        values: list[dict[str, object]] = []
        for row in chunk:
            raw_ciphertext, raw_nonce = encrypt_field(
                json.dumps(row.raw_payload).encode("utf-8"),
                dek,
                _broker_transaction_associated_data(
                    "raw_ciphertext", user_id=user_id, activity_id=row.activity_id
                ),
            )
            values.append(
                {
                    "user_id": user_id,
                    "activity_id": row.activity_id,
                    "transaction_type": row.transaction_type,
                    "transaction_time": row.transaction_time,
                    "order_id": row.order_id,
                    "raw_ciphertext": raw_ciphertext,
                    "raw_nonce": raw_nonce,
                    "key_version": key_version,
                }
            )

        # Because a Core insert below bypasses `BrokerTransaction.__init__`
        # entirely, construct one gated instance per chunk purely so the
        # sentinel gate is exercised on the live path and cannot silently
        # rot -- the same honest-ceiling gap `Fill`'s own docstring names.
        # This constructed object is never added to the session; only the
        # Core statement below actually writes.
        BrokerTransaction(_write_token=_BROKER_TRANSACTION_WRITE_TOKEN, **values[0])

        stmt = (
            pg_insert(BrokerTransaction)
            .values(values)
            .on_conflict_do_nothing(index_elements=["user_id", "activity_id"])
            .returning(BrokerTransaction.activity_id)
        )
        result = await session.execute(stmt)
        landed += len(result.fetchall())

    return landed

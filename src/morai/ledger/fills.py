"""The single write path into the fill table (D3-13, D3-15, D3-17).

Named for the table, not the direction: the sentinel token and its only
legitimate holder (`insert_fills`) live in this one module. Callers hand
`insert_fills()` plain `Decimal`; this module does the encryption, so no
caller can forget it.

`_FILL_WRITE_TOKEN` is imported by `morai.db.models.Fill.__init__` with a
local (function-body) import, not a module-level one -- `db/models.py`
cannot import this module at module scope, because this module imports
`Fill`/`UserDataKey` from `db/models.py` itself. The local import inside
`__init__` breaks the cycle: by the time `Fill()` is actually called, both
modules have finished loading.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import (
    decrypt_field,
    encrypt_field,
    generate_dek,
    unwrap_dek,
    wrap_dek,
)
from morai.db.models import Fill
from morai.settings import get_settings

_FILL_WRITE_TOKEN = object()


class DataKeyMissing(RuntimeError):
    """Raised by `read_fills`/`read_events` when a row's `key_version` has
    no matching `user_data_keys` row -- the account's data key has been
    crypto-shredded (D3-08, AUTH-06). A `None` or empty return here would
    make a crypto-shred indistinguishable from an empty account;
    criterion 5's proof needs that difference to be observable."""


# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `identity/rls.py` and `alembic/versions/0003_identity_and_rls.py`
# already established. `TypeAdapter` narrows at that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)

# NN-5, D3-16: no single insert_fills() call adds more than this many rows
# before an intermediate flush.
_CHUNK_SIZE = 2000


@dataclass(frozen=True)
class FillWrite:
    """One fill to insert. `quantity`/`price_usd` are plain `Decimal` --
    encryption happens inside `insert_fills`, never at the call site."""

    order_id: str
    occ_symbol: str
    leg_index: int
    execution_time: datetime
    position_effect: str
    side: str
    quantity: Decimal | None
    price_usd: Decimal | None


@dataclass(frozen=True)
class FillRecord:
    """One fill read back, decrypted."""

    user_id: UUID
    order_id: str
    occ_symbol: str
    leg_index: int
    execution_time: datetime
    position_effect: str
    side: str
    quantity: Decimal | None
    price_usd: Decimal | None
    key_version: int


def _fill_associated_data(
    column: str,
    *,
    user_id: UUID,
    order_id: str,
    occ_symbol: str,
    leg_index: int,
    execution_time: datetime,
) -> bytes:
    """The one place the AAD row-binding format is fixed (documented next to
    the plaintext-column provenance in migration 0007's own docstring --
    changing this later means re-encrypting every row). `execution_time`
    renders as its integer microsecond epoch, never an ISO string, so no
    timezone or formatting drift between write and read can silently break
    decryption.
    """
    micros = int(execution_time.timestamp() * 1_000_000)
    return (
        f"fills:{column}:{user_id}:{order_id}:{occ_symbol}:{leg_index}:{micros}"
    ).encode("utf-8")


def _encode_decimal(value: Decimal) -> bytes:
    """Never via `float` -- the exact failure class this project exists to
    prevent (D3-17)."""
    return str(value).encode("utf-8")


def _decode_decimal(value: bytes) -> Decimal:
    return Decimal(value.decode("utf-8"))


async def provision_data_key(session: AsyncSession, user_id: UUID) -> None:
    """Generate a fresh DEK, wrap it under the KEK, insert the wrapped key.
    Never returns or logs the raw DEK (T-03-07). Does not commit -- same
    convention as `identity/audit.py::open_audited_read`: the caller's own
    transaction decides when this becomes durable.
    """
    dek = generate_dek()
    wrapped_dek, wrap_nonce = wrap_dek(dek, get_settings().master_key_bytes)
    await session.execute(
        text(
            "INSERT INTO user_data_keys (user_id, key_version, wrapped_dek, "
            "wrap_nonce) VALUES (:user_id, 1, :wrapped_dek, :wrap_nonce)"
        ),
        {"user_id": user_id, "wrapped_dek": wrapped_dek, "wrap_nonce": wrap_nonce},
    )


async def _current_dek(session: AsyncSession, user_id: UUID) -> tuple[bytes, int]:
    """The user's highest-`key_version` DEK, unwrapped in-process only."""
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


async def insert_fills(
    session: AsyncSession, user_id: UUID, fills: list[FillWrite]
) -> None:
    """The only write path into the `fills` table (D3-13). Encrypts
    `quantity`/`price_usd` inside this function -- callers hand it
    `Decimal` and never touch AES (D3-15).

    Does not commit -- same convention as
    `identity/audit.py::open_audited_read`: the caller's own transaction
    decides when this becomes durable. This is load-bearing, not a style
    choice: Postgres resets a `set_config(..., is_local=true)` custom GUC
    to `''` (empty string, not `NULL`) at the end of the transaction that
    set it, so a commit issued from inside this function would silently
    break `app.current_user_id` for whatever RLS-protected query the
    caller runs next on the same session.
    """
    dek, key_version = await _current_dek(session, user_id)

    for chunk_start in range(0, len(fills), _CHUNK_SIZE):
        chunk = fills[chunk_start : chunk_start + _CHUNK_SIZE]
        for fill in chunk:
            quantity_ciphertext: bytes | None = None
            quantity_nonce: bytes | None = None
            if fill.quantity is not None:
                quantity_ciphertext, quantity_nonce = encrypt_field(
                    _encode_decimal(fill.quantity),
                    dek,
                    _fill_associated_data(
                        "quantity",
                        user_id=user_id,
                        order_id=fill.order_id,
                        occ_symbol=fill.occ_symbol,
                        leg_index=fill.leg_index,
                        execution_time=fill.execution_time,
                    ),
                )
            price_usd_ciphertext: bytes | None = None
            price_usd_nonce: bytes | None = None
            if fill.price_usd is not None:
                price_usd_ciphertext, price_usd_nonce = encrypt_field(
                    _encode_decimal(fill.price_usd),
                    dek,
                    _fill_associated_data(
                        "price_usd",
                        user_id=user_id,
                        order_id=fill.order_id,
                        occ_symbol=fill.occ_symbol,
                        leg_index=fill.leg_index,
                        execution_time=fill.execution_time,
                    ),
                )
            session.add(
                Fill(
                    _write_token=_FILL_WRITE_TOKEN,
                    user_id=user_id,
                    order_id=fill.order_id,
                    occ_symbol=fill.occ_symbol,
                    leg_index=fill.leg_index,
                    execution_time=fill.execution_time,
                    position_effect=fill.position_effect,
                    side=fill.side,
                    quantity_ciphertext=quantity_ciphertext,
                    quantity_nonce=quantity_nonce,
                    price_usd_ciphertext=price_usd_ciphertext,
                    price_usd_nonce=price_usd_nonce,
                    key_version=key_version,
                )
            )
        await session.flush()


async def read_fills(session: AsyncSession, user_id: UUID) -> list[FillRecord]:
    """Unwraps the DEK for each row's own `key_version` and returns
    decrypted `Decimal`s. RLS (not this function) is what makes a wrong
    `app.current_user_id` context return nothing regardless of `user_id`."""
    rows = (
        await session.execute(select(Fill).where(Fill.user_id == user_id))
    ).scalars()

    dek_cache: dict[int, bytes] = {}
    records: list[FillRecord] = []
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
            ).one_or_none()
            if key_row is None:
                raise DataKeyMissing(
                    f"No user_data_keys row for user_id={user_id} "
                    f"key_version={row.key_version} -- the account's data "
                    "key has been destroyed (crypto-shred, D3-08). This "
                    "user's trade rows cannot be decrypted."
                )
            dek_cache[row.key_version] = unwrap_dek(
                _BYTES.validate_python(key_row[0]),
                _BYTES.validate_python(key_row[1]),
                get_settings().master_key_bytes,
            )
        dek = dek_cache[row.key_version]

        quantity: Decimal | None = None
        if row.quantity_ciphertext is not None and row.quantity_nonce is not None:
            quantity = _decode_decimal(
                decrypt_field(
                    row.quantity_ciphertext,
                    row.quantity_nonce,
                    dek,
                    _fill_associated_data(
                        "quantity",
                        user_id=user_id,
                        order_id=row.order_id,
                        occ_symbol=row.occ_symbol,
                        leg_index=row.leg_index,
                        execution_time=row.execution_time,
                    ),
                )
            )
        price_usd: Decimal | None = None
        if row.price_usd_ciphertext is not None and row.price_usd_nonce is not None:
            price_usd = _decode_decimal(
                decrypt_field(
                    row.price_usd_ciphertext,
                    row.price_usd_nonce,
                    dek,
                    _fill_associated_data(
                        "price_usd",
                        user_id=user_id,
                        order_id=row.order_id,
                        occ_symbol=row.occ_symbol,
                        leg_index=row.leg_index,
                        execution_time=row.execution_time,
                    ),
                )
            )
        records.append(
            FillRecord(
                user_id=user_id,
                order_id=row.order_id,
                occ_symbol=row.occ_symbol,
                leg_index=row.leg_index,
                execution_time=row.execution_time,
                position_effect=row.position_effect,
                side=row.side,
                quantity=quantity,
                price_usd=price_usd,
                key_version=row.key_version,
            )
        )
    return records

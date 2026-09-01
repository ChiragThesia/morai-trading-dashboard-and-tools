"""The promoted `_current_dek`/`_dek_for_version` helper (this plan, 08-01).

Four copies of this exact query pair already existed before this phase --
`morai.ledger.fills._current_dek`, `morai.ledger.events._current_dek`
(mirroring `fills.py`'s own), `morai.vendor.connections._current_dek`/
`_dek_for_version`, and `morai.ingest.broker_transactions._current_dek`.
`broker_transactions.py`'s own docstring already named the rule: "a fourth
copy is the signal to promote this into a shared helper, not a reason to
duplicate a fourth time." Four already existed when this phase started, so
this module is that promotion, done once, here.

This phase adds a **fifth call site** into this one module --
`morai.ingest.snapshots` -- not a fifth copy. The four pre-existing copies
in `fills.py`, `events.py`, `connections.py` and `broker_transactions.py`
are deliberately left untouched: migrating them onto this module is a
drive-by refactor of four money-path modules from inside a snapshot-capture
phase, and this repo's own change-hygiene rule ("minimal impact... no
drive-by refactors mixed into other work") forbids exactly that. Out of
scope for this phase, named here so the omission reads as a decision, not
an oversight.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.crypto.envelope import unwrap_dek
from morai.settings import get_settings

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `ledger/fills.py`/`vendor/connections.py` already established.
# `TypeAdapter` narrows at that boundary (D-06).
_INT: TypeAdapter[int] = TypeAdapter(int)
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)


class DataKeyMissing(RuntimeError):
    """Raised by `dek_for_version` when the user's `user_data_keys` row for
    that `key_version` does not exist -- the account's data key has been
    crypto-shredded (D3-08, AUTH-06). Mirrors
    `vendor.connections.ConnectionDataKeyMissing`/`ledger.fills.DataKeyMissing`
    exactly; kept local rather than imported so this shared module does not
    depend on either caller's own package for an unrelated error type."""


async def current_dek(session: AsyncSession, user_id: UUID) -> tuple[bytes, int]:
    """The user's highest-`key_version` DEK, unwrapped in-process only.
    Copies `morai.ledger.fills._current_dek`'s body verbatim -- see this
    module's own docstring for why this is a promotion, not a rewrite."""
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


async def dek_for_version(
    session: AsyncSession, user_id: UUID, key_version: int
) -> bytes:
    """The DEK for one specific `key_version` -- mirrors
    `morai.vendor.connections._dek_for_version`'s body verbatim, so a row's
    own stored `key_version` is always what unwraps it, even in a
    hypothetical future where a user's DEK has been rotated."""
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
        raise DataKeyMissing(
            f"No user_data_keys row for user_id={user_id} "
            f"key_version={key_version} -- the account's data key has been "
            "destroyed (crypto-shred, D3-08)."
        )
    return unwrap_dek(
        _BYTES.validate_python(key_row[0]),
        _BYTES.validate_python(key_row[1]),
        get_settings().master_key_bytes,
    )

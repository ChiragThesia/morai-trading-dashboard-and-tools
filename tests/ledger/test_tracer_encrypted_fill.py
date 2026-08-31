"""Tracer: one encrypted fill, written and read back through the real path
(D3-13, D3-15, D3-17, CRYPT-01, CRYPT-02). Every bullet in plan 03-01's Task
1 `<behavior>` block gets its own assertion here.

`@pytest.mark.db` -- runs only where Postgres is reachable, same convention
as `tests/test_isolation.py`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import TypeAdapter
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ledger.fills import FillWrite, insert_fills, read_fills
from tests.identity.conftest import SeededUsers
from tests.ledger.conftest import (
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_users,
    superuser_db_session,
)

__all__ = [
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)

# Raw `text()` results type every column as `Any` -- same untyped-boundary
# shape `identity/rls.py` already established. `TypeAdapter` narrows it (D-06).
_BYTES: TypeAdapter[bytes] = TypeAdapter(bytes)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- Postgres's
    `SET` grammar only accepts a literal there. Mirrors
    `tests/test_isolation.py::_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


def _make_fill(
    *,
    order_id: str = "1006681717677",
    occ_symbol: str = "SPXW260618P07275000",
    leg_index: int = 0,
    execution_time: datetime = _EXECUTION_TIME,
    position_effect: str = "OPEN",
    side: str = "BUY",
    quantity: Decimal | None = Decimal("1"),
    price_usd: Decimal | None = Decimal("159.41"),
) -> FillWrite:
    return FillWrite(
        order_id=order_id,
        occ_symbol=occ_symbol,
        leg_index=leg_index,
        execution_time=execution_time,
        position_effect=position_effect,
        side=side,
        quantity=quantity,
        price_usd=price_usd,
    )


async def test_decimal_round_trips_through_insert_and_read(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(app_db_session, provisioned_users.user_a, [_make_fill()])

    records = await read_fills(app_db_session, provisioned_users.user_a)

    assert len(records) == 1
    assert records[0].price_usd == Decimal("159.41")
    assert records[0].quantity == Decimal("1")


async def test_stored_ciphertext_does_not_contain_the_plaintext_bytes(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(app_db_session, provisioned_users.user_a, [_make_fill()])

    row = (
        await app_db_session.execute(
            text("SELECT price_usd_ciphertext FROM fills WHERE user_id = :user_id"),
            {"user_id": str(provisioned_users.user_a)},
        )
    ).one()
    price_ciphertext = _BYTES.validate_python(row[0])
    assert b"159.41" not in price_ciphertext


async def test_two_encrypted_fields_on_one_row_carry_different_nonces(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(app_db_session, provisioned_users.user_a, [_make_fill()])

    row = (
        await app_db_session.execute(
            text(
                "SELECT quantity_nonce, price_usd_nonce FROM fills "
                "WHERE user_id = :user_id"
            ),
            {"user_id": str(provisioned_users.user_a)},
        )
    ).one()
    assert row[0] != row[1]


async def test_user_data_keys_holds_only_the_wrapped_dek(
    superuser_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    """No column anywhere holds the unwrapped DEK -- proved by walking the
    table's real column set, not by re-deriving a value we already trust."""
    rows = (
        await superuser_db_session.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'user_data_keys'"
            )
        )
    ).all()
    column_names = {row[0] for row in rows}
    assert column_names == {
        "user_id",
        "key_version",
        "wrapped_dek",
        "wrap_nonce",
        "created_at",
    }


async def test_duplicate_composite_key_raises_integrity_error(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(app_db_session, provisioned_users.user_a, [_make_fill()])

    with pytest.raises(IntegrityError):
        await insert_fills(app_db_session, provisioned_users.user_a, [_make_fill()])


async def test_differing_only_in_leg_index_is_a_distinct_row(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(
        app_db_session,
        provisioned_users.user_a,
        [_make_fill(leg_index=0), _make_fill(leg_index=1)],
    )

    records = await read_fills(app_db_session, provisioned_users.user_a)
    assert len(records) == 2


async def test_differing_only_in_execution_time_is_a_distinct_row(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    later = _EXECUTION_TIME.replace(minute=45)
    await insert_fills(
        app_db_session,
        provisioned_users.user_a,
        [_make_fill(), _make_fill(execution_time=later)],
    )

    records = await read_fills(app_db_session, provisioned_users.user_a)
    assert len(records) == 2


async def test_another_users_context_reads_nothing(
    app_db_session: AsyncSession, provisioned_users: SeededUsers
) -> None:
    await _set_current_user(app_db_session, provisioned_users.user_a)
    await insert_fills(app_db_session, provisioned_users.user_a, [_make_fill()])

    await _set_current_user(app_db_session, provisioned_users.user_b)
    records = await read_fills(app_db_session, provisioned_users.user_a)
    assert records == []

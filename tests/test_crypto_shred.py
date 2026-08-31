"""Direct proof of the crypto-shred: destroy the wrapped key, rows still
present, reads raise -- not merely "rows are gone" (D3-08, AUTH-06,
criterion 5). The middle state (key destroyed, rows present, reads raising)
is the load-bearing assertion 03-VALIDATION.md's own trap names: asserting
only the end state would pass against a plain row delete that never
touched the key. The end state (rows also deleted) and the `DELETE /me`
route are proven in `tests/identity/test_account_deletion.py`.

`@pytest.mark.db` -- runs only where Postgres is reachable. Lives at
`tests/` top level, so every fixture is imported from `tests.ledger.conftest`
(see `tests/test_key_rotation.py`'s own module docstring for why).
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import delete, insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import Event, Fill, Position, UserDataKey
from morai.ledger.events import EventWrite, insert_events, read_events
from morai.ledger.fills import DataKeyMissing, FillWrite, insert_fills, read_fills
from tests.ledger.conftest import (
    SeededPosition,
    SeededUsers,
    app_db_session,
    clean_identity_tables,
    clean_ledger_tables,
    provisioned_users,
    seeded_position,
    seeded_users,
    superuser_db_session,
)

__all__ = [
    "SeededPosition",
    "SeededUsers",
    "app_db_session",
    "clean_identity_tables",
    "clean_ledger_tables",
    "provisioned_users",
    "seeded_position",
    "seeded_users",
    "superuser_db_session",
]

pytestmark = pytest.mark.db

_EXECUTION_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
_EVENT_TIME = datetime(2026, 6, 18, 20, 0, tzinfo=UTC)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def test_reads_raise_with_the_key_destroyed_and_rows_still_present(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    await _set_current_user(superuser_db_session, provisioned_users.user_a)
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="shred-a-1",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("159.41"),
            )
        ],
    )
    await insert_events(
        superuser_db_session,
        provisioned_users.user_a,
        [
            EventWrite(
                position_id=seeded_position.position_id,
                event_type="ROLL",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=Decimal("125.50"),
                close_credit_usd=Decimal("110.25"),
            )
        ],
    )
    await superuser_db_session.commit()

    # Destroy only user_a's wrapped data key -- the rows stay.
    await superuser_db_session.execute(
        delete(UserDataKey).where(UserDataKey.user_id == provisioned_users.user_a)
    )
    await superuser_db_session.commit()

    fill_rows = (
        await superuser_db_session.execute(
            select(Fill).where(Fill.user_id == provisioned_users.user_a)
        )
    ).all()
    event_rows = (
        await superuser_db_session.execute(
            select(Event).where(Event.user_id == provisioned_users.user_a)
        )
    ).all()
    # The rows are still present -- this is the whole point of the test.
    assert len(fill_rows) == 1
    assert len(event_rows) == 1

    await _set_current_user(superuser_db_session, provisioned_users.user_a)
    with pytest.raises(DataKeyMissing):
        await read_fills(superuser_db_session, provisioned_users.user_a)
    with pytest.raises(DataKeyMissing):
        await read_events(superuser_db_session, provisioned_users.user_a)


async def test_a_second_users_rows_still_decrypt_after_the_first_users_key_is_gone(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    position_b = (
        await superuser_db_session.execute(
            insert(Position)
            .values(user_id=provisioned_users.user_b)
            .returning(Position.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()

    await _set_current_user(superuser_db_session, provisioned_users.user_a)
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_a,
        [
            FillWrite(
                order_id="shred-a-2",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("159.41"),
            )
        ],
    )

    await _set_current_user(superuser_db_session, provisioned_users.user_b)
    await insert_fills(
        superuser_db_session,
        provisioned_users.user_b,
        [
            FillWrite(
                order_id="shred-b-1",
                occ_symbol="SPX260717P07275000",
                leg_index=0,
                execution_time=_EXECUTION_TIME,
                position_effect="OPEN",
                side="SELL",
                quantity=Decimal("2"),
                price_usd=Decimal("42.10"),
            )
        ],
    )
    await insert_events(
        superuser_db_session,
        provisioned_users.user_b,
        [
            EventWrite(
                position_id=position_b,
                event_type="SETTLEMENT",
                event_time=_EVENT_TIME,
                fill_ids_hash=None,
                open_debit_usd=None,
                close_credit_usd=None,
            )
        ],
    )
    await superuser_db_session.commit()

    await superuser_db_session.execute(
        delete(UserDataKey).where(UserDataKey.user_id == provisioned_users.user_a)
    )
    await superuser_db_session.commit()

    await _set_current_user(superuser_db_session, provisioned_users.user_b)
    fills = await read_fills(superuser_db_session, provisioned_users.user_b)
    events = await read_events(superuser_db_session, provisioned_users.user_b)

    assert len(fills) == 1
    assert fills[0].price_usd == Decimal("42.10")
    assert len(events) == 1
    assert events[0].open_debit_usd is None
    assert events[0].close_credit_usd is None

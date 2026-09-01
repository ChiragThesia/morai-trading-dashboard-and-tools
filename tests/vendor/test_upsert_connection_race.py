"""Regression test for WR-01 (`04-REVIEW.md`): two concurrent first-time
connects for the same user must not race `upsert_connection`'s
update-then-insert into a duplicate-primary-key `IntegrityError`.

Same two-independent-engines-plus-`asyncio.Barrier` shape
`test_oauth_flow.py::test_two_overlapping_callbacks_each_land_their_own_users_row`
and `test_refresh_lock.py` already establish, for the same reason: two
sessions on one engine would not prove this, because a single connection
serialises the two statements and the race never happens. The barrier
(size 2) fences both coroutines at the same instant right before each
calls `upsert_connection`, so a serialised implementation would still pass
this test by accident -- what proves the race is closed is that neither
call raises and exactly one row survives, not merely that both eventually
succeed.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from morai.db.models import SchwabConnection
from morai.settings import get_settings
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from tests.vendor.conftest import SeededUsers

pytestmark = pytest.mark.db

_CREATED_AT = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)


async def _first_connect_over_own_engine(
    barrier: asyncio.Barrier, user_id: UUID, *, refresh_token: str
) -> None:
    """One `upsert_connection` call on its own engine/session, connected as
    `morai_app` with RLS set -- mirrors `test_refresh_lock.py`'s own
    `_refresh_over_own_engine`. Waits on `barrier` immediately before the
    call so both coroutines genuinely overlap rather than merely being
    scheduled close together."""
    engine = create_async_engine(get_settings().app_async_dsn)
    try:
        async with AsyncSession(engine) as session:
            await session.execute(
                text("SELECT set_config('app.current_user_id', :uid, true)"),
                {"uid": str(user_id)},
            )
            await asyncio.wait_for(barrier.wait(), timeout=5)
            await upsert_connection(
                session,
                user_id,
                ExchangedToken(
                    token={"refresh_token": refresh_token}, created_at=_CREATED_AT
                ),
                account_hash="fake-account-hash",
            )
            await session.commit()
    finally:
        await engine.dispose()


async def test_two_concurrent_first_time_connects_of_one_user_land_exactly_one_row(
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Two `oauth_state` tokens in flight at once for a user who has never
    connected before (e.g. two browser tabs) must not produce an
    `IntegrityError` for either -- and the table's own `user_id` primary
    key must still land exactly one row."""
    user_id = provisioned_users.user_a
    barrier = asyncio.Barrier(2)

    async with asyncio.timeout(10):
        await asyncio.gather(
            _first_connect_over_own_engine(
                barrier, user_id, refresh_token="fake-refresh-tab-1"
            ),
            _first_connect_over_own_engine(
                barrier, user_id, refresh_token="fake-refresh-tab-2"
            ),
        )

    rows = (
        (
            await superuser_db_session.execute(
                select(SchwabConnection).where(SchwabConnection.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1

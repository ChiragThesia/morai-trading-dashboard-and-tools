"""The ceiling (06-01-PLAN.md Task 3, T-06-03): 2,000-row chunks, proven at
the boundary and one past it (`OPS-05`, `NN-5`).

`@pytest.mark.db` -- counts real landed rows and real round-trips against a
live Postgres, migrated through revision 0011.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import event, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import BrokerTransaction
from morai.ingest.broker_transactions import (
    _CHUNK_SIZE,  # pyright: ignore[reportPrivateUsage]  # why: this test proves the constant's own value and its derivation against the table's real column count -- it is the thing under test.
    BrokerTransactionWrite,
    insert_broker_transactions,
)
from tests.identity.conftest import SeededUsers

pytestmark = pytest.mark.db

_BASE_TIME = datetime(2026, 6, 18, 14, 30, tzinfo=UTC)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """Mirrors `tests/test_isolation.py::_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


def _rows(count: int, *, label: str) -> list[BrokerTransactionWrite]:
    """`count` distinct broker transactions -- every row must land, because
    a chunking bug that drops the tail is exactly as bad as one that
    exceeds the bind-parameter ceiling."""
    return [
        BrokerTransactionWrite(
            activity_id=f"chunk-{label}-{i}",
            transaction_type="TRADE",
            transaction_time=_BASE_TIME + timedelta(seconds=i),
            order_id=f"order-{label}-{i}",
            raw_payload={"i": i},
        )
        for i in range(count)
    ]


@contextmanager
def _count_insert_round_trips(session: AsyncSession) -> Generator[list[int]]:
    """Counts one round-trip per real `INSERT INTO broker_transactions`
    statement sent to the database -- via `before_cursor_execute`, a
    Core-level connection event that fires for every statement regardless
    of ORM/Core shape, not `Session`'s own `before_flush`/`after_flush`
    (which never fire for a Core `session.execute(pg_insert(...))` call,
    since no object was ever added to the identity map). Filters by SQL
    text rather than counting every statement, so
    `insert_broker_transactions`'s own DEK-lookup `SELECT` is excluded --
    the round-trip this test proves the count of is the chunked insert,
    not every query the function issues.
    """
    engine = session.get_bind()
    counts = [0]

    def before_cursor_execute(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        normalized = statement.lstrip().upper()
        if normalized.startswith("INSERT INTO BROKER_TRANSACTIONS"):
            counts[0] += 1

    # `AsyncSession.get_bind()` returns the underlying sync `Engine`
    # directly (measured this session) -- the same handle SQLAlchemy's
    # Core-level event system requires for `before_cursor_execute`.
    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield counts
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


async def _row_count(session: AsyncSession, user_id: UUID) -> int:
    return (
        await session.execute(
            select(func.count())
            .select_from(BrokerTransaction)
            .where(BrokerTransaction.user_id == user_id)
        )
    ).scalar_one()


async def test_2001_rows_land_across_more_than_one_insert(
    clean_ingest_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)

    with _count_insert_round_trips(app_db_session) as counts:
        landed = await insert_broker_transactions(
            app_db_session, user_id, _rows(2001, label="over")
        )

    assert landed == 2001
    assert counts[0] > 1
    assert await _row_count(app_db_session, user_id) == 2001


async def test_exactly_2000_rows_land_in_one_insert(
    clean_ingest_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)

    with _count_insert_round_trips(app_db_session) as counts:
        landed = await insert_broker_transactions(
            app_db_session, user_id, _rows(2000, label="boundary")
        )

    assert landed == 2000
    assert counts[0] == 1
    assert await _row_count(app_db_session, user_id) == 2000


def test_chunk_constant_derivation_stays_under_the_bind_parameter_ceiling() -> None:
    """Asserts the constant and its derivation directly, not merely its
    current value -- this is what makes the test survive someone later
    adding a column: it fails when the arithmetic stops holding rather
    than when a production insert does (`salvage/measured-constants.md`'s
    own derive-don't-copy-paste discipline)."""
    assert _CHUNK_SIZE == 2000
    column_count = len(BrokerTransaction.__table__.columns)
    assert column_count * _CHUNK_SIZE < 65534

"""First connect reaches back -- the lookback window, chunked, one call
each (06-02 Task 3, INGEST-05, D6-03, Pitfall 2).

`sync_windows` is pure -- proven with no database in this file's first
half. `sync_user`'s explicit-dates-only calling convention and per-window
logging are proven in the second half against a real database and a
recording fake, mirroring `tests/test_worker_heartbeat.py`'s own
`_CollectingHandler` pattern for reading log output without `caplog`
(Alembic's `fileConfig` disables already-instantiated loggers).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from pydantic import JsonValue
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import BrokerTransaction
from morai.ingest.schwab_sync import sync_user, sync_windows
from morai.settings import get_settings
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TxFakeSchwabAuth

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)
_NOW = datetime(2026, 6, 20, 12, 0, tzinfo=UTC)


# --- Pure: no database, no clock read -----------------------------------


def test_windows_cover_the_full_lookback_with_no_gap_and_no_overlap() -> None:
    settings = get_settings()
    windows = sync_windows(None, _NOW, settings)

    assert windows
    assert windows[0][0] == _NOW - timedelta(days=settings.schwab_tx_lookback_max_days)
    assert windows[-1][1] == _NOW
    for start, end in windows:
        assert end - start <= timedelta(days=settings.schwab_tx_max_range_days)
    for (_, prev_end), (next_start, _) in zip(windows, windows[1:]):
        assert prev_end == next_start


def test_routine_sync_collapses_to_one_window() -> None:
    settings = get_settings()
    last_synced_at = _NOW - timedelta(hours=2)

    windows = sync_windows(last_synced_at, _NOW, settings)

    assert windows == [
        (
            last_synced_at - timedelta(days=settings.schwab_tx_sync_overlap_days),
            _NOW,
        )
    ]


def test_stale_last_synced_at_chunks_into_more_than_one_window() -> None:
    settings = get_settings()
    # Older than the max-range chunk width so the routine-sync single-window
    # branch cannot apply -- a worker down for a week gets chunked, not one
    # oversized range.
    last_synced_at = _NOW - timedelta(days=70)

    windows = sync_windows(last_synced_at, _NOW, settings)

    assert len(windows) > 1


def test_sync_windows_is_pure_and_reads_no_clock() -> None:
    settings = get_settings()

    first = sync_windows(None, _NOW, settings)
    second = sync_windows(None, _NOW, settings)

    assert first == second


# --- Recording fake, real database ---------------------------------------


class _CollectingHandler(logging.Handler):
    """Attached directly to `morai.ingest.schwab_sync`'s own logger, not
    root -- same reasoning `tests/test_worker_heartbeat.py`'s own
    `_CollectingHandler` documents (Alembic's `fileConfig`, run by an
    earlier fixture, disables already-instantiated loggers and silently
    zeroes `caplog.records`)."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": "fake-refresh-user-a"},
            created_at=_TOKEN_CREATED_AT,
        ),
        account_hash="fake-account-hash",
    )
    await superuser_db_session.commit()


@pytest.mark.db
async def test_first_connect_calls_are_explicitly_dated_logged_and_dedupe_overlap(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    settings = get_settings()
    expected_windows = sync_windows(None, _NOW, settings)
    assert len(expected_windows) > 1  # exercises real chunking, not a trivial case

    # One transaction present in BOTH the first and second windows' own
    # payloads -- a vendor-side overlap; insert_broker_transactions' ON
    # CONFLICT DO NOTHING is what makes it land once.
    overlap_tx: JsonValue = {
        "activityId": "overlap-1",
        "type": "TRADE",
        "time": expected_windows[0][1].isoformat(),
        "orderId": "overlap-1",
        "transferItems": [],
    }
    payload_by_window: dict[tuple[datetime, datetime], JsonValue] = {
        expected_windows[0]: [overlap_tx],
        expected_windows[1]: [overlap_tx],
    }
    auth = TxFakeSchwabAuth(
        fixed_created_at=_TOKEN_CREATED_AT,
        account_entries=[],
        payload_by_window=payload_by_window,
    )

    logger = logging.getLogger("morai.ingest.schwab_sync")
    handler = _CollectingHandler()
    logger.addHandler(handler)
    logger.disabled = False
    logger.setLevel(logging.INFO)
    try:
        outcome = await sync_user(app_db_session, user_id, auth=auth, now=_NOW)
        await app_db_session.commit()
    finally:
        logger.removeHandler(handler)

    assert auth.last_client is not None
    assert auth.last_client.windows_by_call == expected_windows
    for start, end in auth.last_client.windows_by_call:
        assert start is not None
        assert end is not None

    # One log line per window, each naming its own bounds -- the
    # measurement D6-03 asks the first live run to produce.
    assert len(handler.messages) == len(expected_windows)
    for message, (start, end) in zip(handler.messages, expected_windows):
        assert start.isoformat() in message
        assert end.isoformat() in message

    assert outcome.broker_transactions_landed == 1
    await _set_current_user(app_db_session, user_id)
    tx_rows = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).scalars()
    assert [row.activity_id for row in tx_rows] == ["overlap-1"]

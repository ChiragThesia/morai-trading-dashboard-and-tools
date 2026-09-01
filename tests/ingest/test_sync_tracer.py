"""Tracer (06-01-PLAN.md Task 1, T-06-01): one connected user, one deferred
`sync_user` job, drained by a real worker run, lands one `broker_transactions`
row and its two option legs as two `fills` rows -- proving `D6-01`'s
execution model and closing `T-06-01`'s security finding end to end.

`@pytest.mark.db` -- runs only where Postgres is reachable, same convention
as `tests/test_worker_heartbeat.py`.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from procrastinate.jobs import Status
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.crypto.envelope import decrypt_field
from morai.db.models import BrokerTransaction
from morai.ingest.broker_transactions import (
    _broker_transaction_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this test decrypts the raw copy back to prove byte-for-byte fidelity with the sent payload -- it needs the exact AAD helper insert_broker_transactions uses, the same convention test_pg_dump_confidentiality.py already uses for ledger.fills._current_dek.
    _current_dek,  # pyright: ignore[reportPrivateUsage]  # why: see _broker_transaction_associated_data above -- same cooperating-test convention.
)
from morai.ledger.fills import read_fills
from morai.vendor.connections import ConnectionNotFound, upsert_connection
from morai.vendor.protocol import ExchangedToken
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import TX_PAYLOAD, TxFakeSchwabAuth

pytestmark = pytest.mark.db

_TOKEN_CREATED_AT = datetime(2026, 1, 1, tzinfo=UTC)

# Raw `text()`/decrypted-bytes results type as `Any` -- same untyped-boundary
# shape `vendor/connections.py::read_connection` already established for its
# own JSON-token decrypt-and-parse step. `TypeAdapter` narrows at that
# boundary (D-06).
_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Seeds one connection row through `upsert_connection`, the real
    write path -- mirrors `tests/vendor/test_refresh_lock.py::_seed_connection`
    (D3-14's own discipline: never a test-only fast path). Runs on the
    superuser session so RLS's `WITH CHECK` never needs `app.current_user_id`
    set first."""
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


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- Postgres's
    `SET` grammar only accepts a literal there. Mirrors
    `tests/test_isolation.py::_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def test_sync_user_job_lands_one_broker_transaction_and_two_fills(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defers `sync_user` by name onto the real `worker.app.app`, drains it
    with a bounded `run_worker_async(wait=False)` under an outer timeout so
    a dequeue failure fails the test rather than hangs, then reads both
    tables back and asserts every bullet in Task 1's `<behavior>` block."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("sync_user").defer_async(user_id=str(user_id))
        status_before = await app.job_manager.get_job_status_async(job_id)
        assert status_before is Status.TODO

        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)

        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    # --- broker_transactions: the raw, independent copy (D6-02) ---
    await _set_current_user(app_db_session, user_id)
    tx_row = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).scalar_one()
    assert tx_row.activity_id == "1006681717677"
    assert tx_row.transaction_type == "TRADE"
    assert tx_row.transaction_time == datetime(2026, 6, 18, 14, 30, tzinfo=UTC)
    assert tx_row.order_id == "1006681717677"

    dek, _ = await _current_dek(app_db_session, user_id)
    decrypted = _JSON_VALUE.validate_json(
        decrypt_field(
            tx_row.raw_ciphertext,
            tx_row.raw_nonce,
            dek,
            _broker_transaction_associated_data(
                "raw_ciphertext", user_id=user_id, activity_id=tx_row.activity_id
            ),
        )
    )
    assert decrypted == TX_PAYLOAD[0]

    # --- fills: extracted, direction from the vendor's own signed amount ---
    records = await read_fills(app_db_session, user_id)
    assert len(records) == 2
    by_leg = {record.leg_index: record for record in records}

    # leg 0: amount=-1 -- sold to open the front leg.
    assert by_leg[0].side == "SELL"
    assert by_leg[0].quantity == Decimal("1")
    # The Decimal-precision canary (this module's own honest-limit
    # paragraph): a four-decimal price recovers exactly through Pydantic's
    # float-to-Decimal shortest round-trip repr.
    assert by_leg[0].price_usd == Decimal("44.8567")
    assert by_leg[0].position_effect == "OPENING"
    assert by_leg[0].occ_symbol == "SPXW260618P07275000"

    # leg 1: amount=1 -- bought to open the back leg.
    assert by_leg[1].side == "BUY"
    assert by_leg[1].quantity == Decimal("1")
    assert by_leg[1].price_usd == Decimal("30.1233")
    assert by_leg[1].position_effect == "OPENING"
    assert by_leg[1].occ_symbol == "SPX260717P07275000"


async def test_missing_connection_fails_the_job_and_writes_nothing(
    clean_ingest_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A user with no `schwab_connections` row: `ConnectionNotFound`
    propagates out of `sync_user`, so the job fails rather than writing a
    partial cycle -- nothing seeds a connection for `user_a` here."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a

    async with app.open_async():
        job_id = await app.configure_task("sync_user").defer_async(user_id=str(user_id))
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.FAILED

    await _set_current_user(app_db_session, user_id)
    records = await read_fills(app_db_session, user_id)
    assert records == []

    tx_rows = (
        await app_db_session.execute(
            select(BrokerTransaction).where(BrokerTransaction.user_id == user_id)
        )
    ).all()
    assert tx_rows == []


def test_missing_connection_raises_connection_not_found_directly() -> None:
    """Names the exact exception type the job's own uncaught propagation
    relies on -- a plain import-time check that the class exists and is
    the one `morai.vendor.connections` exports, no database needed."""
    assert issubclass(ConnectionNotFound, RuntimeError)

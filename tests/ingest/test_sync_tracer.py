"""Tracer (06-01-PLAN.md Task 1, T-06-01): one connected user, one deferred
`sync_user` job, drained by a real worker run, lands one `broker_transactions`
row and its two option legs as two `fills` rows -- proving `D6-01`'s
execution model and closing `T-06-01`'s security finding end to end.

`@pytest.mark.db` -- runs only where Postgres is reachable, same convention
as `tests/test_worker_heartbeat.py`.

**07-01-PLAN.md Task 1's own tracer coverage (D7-12, Pitfall 3,
07-RESEARCH.md):** the same drained job additionally proves the position/leg
creation path and the (previously unwired) `sync_events` call both run
inside `sync_user`'s transaction -- before this phase, nothing under `src/`
ever created a `positions`/`legs` row and `sync_events` had zero call sites
outside `tests/`, so `positions`/`legs`/`events` stayed production-empty.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from procrastinate.jobs import Status
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.crypto.envelope import decrypt_field
from morai.db.models import BrokerTransaction, Event, Leg, Position, ReconciliationRun
from morai.ingest.broker_transactions import (
    BrokerTransactionWrite,
    _broker_transaction_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this test decrypts the raw copy back to prove byte-for-byte fidelity with the sent payload -- it needs the exact AAD helper insert_broker_transactions uses, the same convention test_pg_dump_confidentiality.py already uses for ledger.fills._current_dek.
    _current_dek,  # pyright: ignore[reportPrivateUsage]  # why: see _broker_transaction_associated_data above -- same cooperating-test convention.
    insert_broker_transactions,
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

    # --- positions/legs: the missing creation path this phase adds
    # (D7-12) -- proving sync_user's transaction now writes them, not
    # only a test seed. `provisioned_users.position_a` is a pre-existing,
    # legless row `seeded_users` (tests/identity/conftest.py) always seeds
    # per user -- a Phase 2/3 isolation-testing artifact, unrelated to and
    # predating this plan's creation path -- so the new position this sync
    # creates is the one *other* row, not the only row. ---
    position_rows = (
        (
            await app_db_session.execute(
                select(Position).where(Position.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    new_position_ids = {row.id for row in position_rows} - {
        provisioned_users.position_a
    }
    assert len(position_rows) == 2
    assert len(new_position_ids) == 1

    leg_rows = (
        (
            await app_db_session.execute(
                select(Leg).where(Leg.user_id == user_id).order_by(Leg.leg_role)
            )
        )
        .scalars()
        .all()
    )
    assert len(leg_rows) == 2
    assert leg_rows[0].position_id in new_position_ids
    assert leg_rows[1].position_id in new_position_ids
    assert (leg_rows[0].leg_role, leg_rows[0].occ_symbol, leg_rows[0].root) == (
        "back",
        "SPX260717P07275000",
        "SPX",
    )
    assert (leg_rows[1].leg_role, leg_rows[1].occ_symbol, leg_rows[1].root) == (
        "front",
        "SPXW260618P07275000",
        "SPXW",
    )

    # --- events: derive_events wired through sync_events (Pitfall 3 --
    # sync_events had zero call sites under src/ before this phase). ---
    open_event_rows = (
        (
            await app_db_session.execute(
                select(Event).where(
                    Event.user_id == user_id, Event.event_type == "OPEN"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(open_event_rows) >= 1


async def test_sync_user_job_derives_settlement_for_an_expired_open_leg(
    clean_ingest_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CR-01 (`07-REVIEW.md`): `sync_user` must thread its own `now`
    through to `sync_events`'s `as_of`, or SETTLEMENT derivation -- fully
    implemented and unit-tested in `tests/ledger/test_settlements.py` --
    never runs from the one path a real user's data travels. A unit test
    on `derive_settlements` cannot catch this; only a test through the
    real `sync_user` call path can.

    `TX_PAYLOAD`'s two legs (front expiry 2026-06-18, back expiry
    2026-07-17) are both in the past by the time this test runs, and
    nothing in this payload closes the position they open -- a
    genuinely-expired, still-open leg, the positive case CR-02's
    closed-position gate must not suppress alongside CR-01's fix."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("sync_user").defer_async(user_id=str(user_id))
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    settlement_rows = (
        (
            await app_db_session.execute(
                select(Event).where(
                    Event.user_id == user_id, Event.event_type == "SETTLEMENT"
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(settlement_rows) == 2


async def test_sync_user_job_writes_a_reconciliation_run(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    tx_fake_auth: TxFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """CR-01, this plan's own repeat of the lesson Phase 7 already taught:
    `sync_events` shipped fully built, unit-tested, merged, and unreachable
    in production because `sync_user` never called it. `run_reconciliation`
    is the identical shape of risk, so this test proves it the identical
    way -- through the real production call path, deferred by name and
    drained by a real worker, never by calling `reconcile_window` or
    `run_reconciliation` directly. A unit test of the pure function cannot
    catch `sync_user` failing to call `run_reconciliation`, and did not, in
    Phase 7.

    `TX_PAYLOAD`'s own transaction lands at 2026-06-18T14:30:00+00:00
    (10:30 ET) -- the trading day its OPEN event belongs to. Seeds one
    extra broker transaction on a strictly later Eastern trading day,
    through `insert_broker_transactions` (the real write path, never a
    test-only fast path), so 2026-06-18 is closed (`D9-02`) and a
    reconciliation row is actually due once the job runs.
    """
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: tx_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    await _set_current_user(app_db_session, user_id)
    await insert_broker_transactions(
        app_db_session,
        user_id,
        [
            BrokerTransactionWrite(
                activity_id="close-window-marker",
                transaction_type="JOURNAL",
                transaction_time=datetime(2026, 6, 19, 14, 30, tzinfo=UTC),
                order_id=None,
                raw_payload={},
            )
        ],
    )
    await app_db_session.commit()

    async with app.open_async():
        job_id = await app.configure_task("sync_user").defer_async(user_id=str(user_id))
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    run_rows = (
        (
            await app_db_session.execute(
                select(ReconciliationRun).where(
                    ReconciliationRun.user_id == user_id,
                    ReconciliationRun.trading_day == date(2026, 6, 18),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(run_rows) == 1
    row = run_rows[0]
    assert row.verdict in {"passed", "failed", "indeterminate"}
    if row.verdict == "indeterminate":
        assert row.reason is not None
    else:
        assert row.reason is None

    # Running the same drained job twice writes no second row for an
    # unchanged window -- the second cycle is a no-op, not a duplicate.
    async with app.open_async():
        job_id_2 = await app.configure_task("sync_user").defer_async(
            user_id=str(user_id)
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status_after_2 = await app.job_manager.get_job_status_async(job_id_2)
        assert status_after_2 is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    run_rows_after_second_cycle = (
        (
            await app_db_session.execute(
                select(ReconciliationRun).where(
                    ReconciliationRun.user_id == user_id,
                    ReconciliationRun.trading_day == date(2026, 6, 18),
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(run_rows_after_second_cycle) == 1


def test_position_and_leg_reject_construction_without_the_write_token() -> None:
    """D7-12/D7-14: the sentinel gate on `Position`/`Leg`, mirroring
    `Fill.__init__`'s own gate. Constructing either with a wrong token
    raises `RuntimeError` at runtime -- the compile-time half (omitting
    `_write_token` is a missing-argument error) is proved by
    `bash tools/gate.sh`'s basedpyright/mypy steps, not by this test.
    No database needed -- construction fails before any I/O."""
    stray_token = object()
    dummy_id = UUID("00000000-0000-4000-8000-000000000000")

    with pytest.raises(RuntimeError):
        Position(_write_token=stray_token, user_id=dummy_id)

    with pytest.raises(RuntimeError):
        Leg(
            _write_token=stray_token,
            position_id=dummy_id,
            user_id=dummy_id,
            leg_role="front",
            occ_symbol="SPXW260618P07275000",
            root="SPXW",
        )


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

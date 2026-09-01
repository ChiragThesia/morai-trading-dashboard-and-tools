"""Tracer (08-01-PLAN.md Task 1, SNAP-01, SNAP-02): one connected user, one
open position with two legs, one deferred `snapshot_user` job, drained by a
real worker run, lands one encrypted `snapshot_observations` row and one
encrypted `snapshot_marks` row per leg -- proving this phase's own path end
to end through the genuine deferred Procrastinate task, not a direct
function call. Phase 7's own code review found a feature fully built,
tested, merged and unreachable because the production call site never
enabled it; this suite's own assertion travels the real path for exactly
that reason.

`@pytest.mark.db` -- runs only where Postgres is reachable, same
convention as `tests/ingest/test_sync_tracer.py`.
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
from morai.crypto.data_keys import current_dek
from morai.crypto.envelope import decrypt_field
from morai.db.models import SnapshotMark, SnapshotObservation
from morai.ingest.snapshots import (
    _snapshot_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this test decrypts the stored raw payload and mark back to prove byte-for-byte/digit-for-digit fidelity with the fake's own response -- it needs the exact AAD helper the writers use, the same cooperating-test convention test_sync_tracer.py already uses for _broker_transaction_associated_data.
)
from morai.ledger.fills import FillWrite, insert_fills
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import QUOTE_PAYLOAD, QuoteFakeSchwabAuth
from tests.ledger.conftest import SeededPosition

pytestmark = pytest.mark.db

# Monday, 10:30 ET (EDT, UTC-4) -- on the RTH grid (D8-06).
_SLOT_TIME = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)
# The same Monday, 23:00 ET the night before -- off the grid entirely.
_NON_SLOT_TIMESTAMP = int(datetime(2026, 6, 15, 3, 0, tzinfo=UTC).timestamp())

_JSON_VALUE: TypeAdapter[JsonValue] = TypeAdapter(JsonValue)
# `.scalar_one()` on a raw `text()` COUNT(*) query types as `Any` -- same
# untyped-boundary shape `identity/rls.py` already narrows with a
# TypeAdapter (D-06), not `cast`.
_INT: TypeAdapter[int] = TypeAdapter(int)


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Seeds one connection row through `upsert_connection`, the real
    write path -- mirrors `test_sync_tracer.py::_seed_connection`, with
    `token_created_at` read fresh at call time so `derive_connection_health`
    reads HEALTHY at whatever wall-clock moment this test actually runs
    (D3-14's own discipline: never a test-only fast path)."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": "fake-refresh-user-a"},
            created_at=datetime.now(UTC),
        ),
        account_hash="fake-account-hash",
    )
    await superuser_db_session.commit()


async def _open_the_seeded_position(
    superuser_db_session: AsyncSession, user_id: UUID
) -> None:
    """Inserts one real OPEN fill per leg of `seeded_position` through
    `insert_fills`, the real write path (D3-14). `seeded_position` on its
    own seeds two legs with no fills, which `derive_position_state` reads
    as closed (every leg's net quantity is zero); one real fill per leg
    gives it a genuinely non-zero net so `read_open_legs` keeps it."""
    await insert_fills(
        superuser_db_session,
        user_id,
        [
            FillWrite(
                order_id="tracer-order-front",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=datetime(2026, 1, 1, tzinfo=UTC),
                position_effect="OPENING",
                side="SELL",
                quantity=Decimal("1"),
                price_usd=Decimal("44.8567"),
            ),
            FillWrite(
                order_id="tracer-order-back",
                occ_symbol="SPX260717P07275000",
                leg_index=0,
                execution_time=datetime(2026, 1, 1, tzinfo=UTC),
                position_effect="OPENING",
                side="BUY",
                quantity=Decimal("1"),
                price_usd=Decimal("30.1233"),
            ),
        ],
    )
    await superuser_db_session.commit()


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- mirrors
    `tests/ingest/test_sync_tracer.py::_set_current_user` exactly."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def test_snapshot_user_job_reprices_both_open_legs_end_to_end(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    quote_fake_auth: QuoteFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Defers `snapshot_user` by name onto the real `worker.app.app` and
    drains it with a bounded `run_worker_async(wait=False)` under an outer
    timeout, exactly as `test_sync_tracer.py` does, then reads both
    tables back and decrypts every stored value."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: quote_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)
    await _open_the_seeded_position(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_id), slot_time=_SLOT_TIME.isoformat()
        )
        status_before = await app.job_manager.get_job_status_async(job_id)
        assert status_before is Status.TODO

        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)

        status_after = await app.job_manager.get_job_status_async(job_id)
        assert status_after is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)

    observation_rows = (
        (
            await app_db_session.execute(
                select(SnapshotObservation).where(
                    SnapshotObservation.user_id == user_id
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(observation_rows) == 2
    assert all(row.gap_reason is None for row in observation_rows)
    assert all(row.slot_time == _SLOT_TIME for row in observation_rows)

    mark_rows = (
        (
            await app_db_session.execute(
                select(SnapshotMark).where(SnapshotMark.user_id == user_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(mark_rows) == 2
    assert all(row.gap_reason is None for row in mark_rows)
    assert all(row.slot_time == _SLOT_TIME for row in mark_rows)

    dek, _key_version = await current_dek(app_db_session, user_id)

    # The Decimal-precision canary: the decrypted mark equals the fake
    # payload's own value with identical digits, matched per leg through
    # `seeded_position`'s own leg ids.
    expected_mark_by_leg_id = {
        seeded_position.front_leg_id: Decimal("44.8567"),
        seeded_position.back_leg_id: Decimal("30.1233"),
    }
    for mark_row in mark_rows:
        mark_usd_ciphertext = mark_row.mark_usd_ciphertext
        mark_usd_nonce = mark_row.mark_usd_nonce
        assert mark_usd_ciphertext is not None
        assert mark_usd_nonce is not None
        decrypted_mark = Decimal(
            decrypt_field(
                mark_usd_ciphertext,
                mark_usd_nonce,
                dek,
                _snapshot_associated_data(
                    "snapshot_marks",
                    "mark_usd_ciphertext",
                    user_id=user_id,
                    leg_id=mark_row.leg_id,
                    slot_time=mark_row.slot_time,
                ),
            ).decode("utf-8")
        )
        assert decrypted_mark == expected_mark_by_leg_id[mark_row.leg_id]

    for observation_row in observation_rows:
        raw_ciphertext = observation_row.raw_ciphertext
        raw_nonce = observation_row.raw_nonce
        assert raw_ciphertext is not None
        assert raw_nonce is not None
        decrypted_raw = _JSON_VALUE.validate_json(
            decrypt_field(
                raw_ciphertext,
                raw_nonce,
                dek,
                _snapshot_associated_data(
                    "snapshot_observations",
                    "raw_ciphertext",
                    user_id=user_id,
                    leg_id=observation_row.leg_id,
                    slot_time=observation_row.slot_time,
                ),
            )
        )
        # The whole get_quotes response is stored on every leg's row
        # (D8-04) -- byte-for-byte equal to the fake's own returned JSON.
        assert decrypted_raw == QUOTE_PAYLOAD


async def test_non_rth_tick_defers_nothing_and_writes_nothing(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    quote_fake_auth: QuoteFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`capture_all_connected_users_task` invoked for a moment that is not
    an RTH slot defers zero jobs and writes zero rows (D8-05, D8-06) --
    the trigger assigns the slot, and a non-slot was never a slot."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: quote_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)
    await _open_the_seeded_position(superuser_db_session, user_id)

    async with app.open_async():
        jobs_before = list(await app.job_manager.list_jobs_async(task="snapshot_user"))
        await worker_app.capture_all_connected_users_task(_NON_SLOT_TIMESTAMP)
        jobs_after = list(await app.job_manager.list_jobs_async(task="snapshot_user"))

    assert len(jobs_after) == len(jobs_before)

    observation_count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT count(*) FROM snapshot_observations")
            )
        ).scalar_one()
    )
    mark_count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT count(*) FROM snapshot_marks")
            )
        ).scalar_one()
    )
    assert observation_count == 0
    assert mark_count == 0

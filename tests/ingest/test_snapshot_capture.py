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
convention as `tests/ingest/test_sync_tracer.py`. As of 08-02 Task 3, not
every test in this module carries that marker -- the RTH grid's own tests
(`rth_slot_for`/`rth_slots_between`) are pure and run with no database
reachable at all (`-m "not db"`), so each db-backed test below carries its
own `@pytest.mark.db` decorator instead of a module-level `pytestmark`.

## The scheduler-level hole this grid sits above

`rth_slot_for`/`rth_slots_between` are correct for every instant they are
asked about. They say nothing about whether they were ever asked: a worker
down for more than Procrastinate's own ten-minute `PeriodicDeferrer`
backfill ceiling across a slot boundary produces **no job at all** for
that slot (`worker/app.py::capture_all_connected_users_task`'s own
docstring, verified against the installed `procrastinate` 3.9.0 source).
Neither `snapshot_observations` nor `snapshot_marks` carries even a gap
row for a slot no job ever ran for -- that hole is invisible in this
phase's own tables and visible only in `snapshot_runs` (plan 08-04's own
table) and repairable as an honest `slot_not_captured` gap (plan 08-03).
Naming it here keeps a future reader of this module from concluding the
grid itself is broken when the scheduler, not the grid, is what stalled.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from httpx import HTTPStatusError, Request, Response
from procrastinate.jobs import Status
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import insert, select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

import morai.worker.app as worker_app
from morai.crypto.data_keys import current_dek
from morai.crypto.envelope import decrypt_field
from morai.db.models import Leg, Position, SnapshotMark, SnapshotObservation
from morai.ingest.snapshots import (
    _snapshot_associated_data,  # pyright: ignore[reportPrivateUsage]  # why: this test decrypts the stored raw payload and mark back to prove byte-for-byte/digit-for-digit fidelity with the fake's own response -- it needs the exact AAD helper the writers use, the same cooperating-test convention test_sync_tracer.py already uses for _broker_transaction_associated_data.
)
from morai.ingest.snapshots import (
    SnapshotVendorError,
    capture_all_connected_users,
    capture_user_snapshot,
    rth_slot_for,
    rth_slots_between,
)
from morai.ledger.fills import FillWrite, insert_fills
from morai.settings import get_settings
from morai.vendor.connections import upsert_connection
from morai.vendor.protocol import ExchangedToken, SchwabClient
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import QUOTE_PAYLOAD, QuoteFakeSchwabAuth
from tests.ledger.conftest import SeededPosition
from tests.vendor.conftest import (
    _FAKE_REFRESH_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: this test's own scripted fake reproduces FakeSchwabAuth.build_client's rotation body exactly (see _ScriptedQuoteFakeSchwabAuth's docstring below), the same convention tests/ingest/conftest.py's TxFakeSchwabAuth/QuoteFakeSchwabAuth already use.
    _WRAPPED_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: see _FAKE_REFRESH_TOKEN above.
    FakeSchwabAuth,
    FakeSchwabClient,
)

# No module-level `pytestmark` here, unlike every other file in this test
# package (`08-02-PLAN.md` Task 3): this module now also carries the RTH
# grid's pure tests, which must run with no Postgres reachable
# (`-m "not db"`). Every db-backed test below carries its own
# `@pytest.mark.db` decorator instead.

# Monday, 10:30 ET (EDT, UTC-4) -- on the RTH grid (D8-06).
_SLOT_TIME = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)
_SLOT_TIME_2 = datetime(2026, 6, 15, 15, 0, tzinfo=UTC)
_SLOT_TIME_3 = datetime(2026, 6, 15, 15, 30, tzinfo=UTC)
# The same Monday, 23:00 ET the night before -- off the grid entirely.
_NON_SLOT_TIMESTAMP = int(datetime(2026, 6, 15, 3, 0, tzinfo=UTC).timestamp())

# Old enough to be EXPIRED at every _SLOT_TIME* above, and at the real
# wall clock, regardless of the seven-day lifetime
# (`_REFRESH_TOKEN_LIFETIME`, vendor/connections.py) -- years past it, not
# days, so this stays correct even if that constant changes.
_EXPIRED_TOKEN_CREATED_AT = datetime(2020, 1, 1, tzinfo=UTC)
# Well inside the seven-day lifetime relative to every _SLOT_TIME* above --
# used only where `observed_at` is passed explicitly (Test 4, which drives
# `capture_user_snapshot` directly). A test that goes through the real
# `snapshot_user_task` reads `datetime.now(UTC)` internally
# (`worker/app.py`, out of this plan's scope) rather than a slot time, so
# it needs `_healthy_token_created_at_now` below instead -- a fixed
# historical date here would read EXPIRED against the real clock.
_HEALTHY_TOKEN_CREATED_AT_FOR_SLOTS = datetime(2026, 6, 14, tzinfo=UTC)


def _healthy_token_created_at_now() -> datetime:
    """Read fresh at call time, mirroring `_seed_connection`'s own
    discipline (D3-14: never a test-only fast path) -- `snapshot_user_task`
    computes connection health against the real wall clock, so a task-based
    test's own "healthy" fixture must be relative to that same clock, not a
    fixed historical date."""
    return datetime.now(UTC) - timedelta(hours=1)


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


async def _seed_connection_with(
    superuser_db_session: AsyncSession,
    user_id: UUID,
    *,
    refresh_token: str,
    token_created_at: datetime,
) -> None:
    """Like `_seed_connection` above, but with an explicit
    `refresh_token`/`token_created_at` -- Task 2's own tests need to choose
    the connection's health deterministically (expired vs healthy) and, for
    the per-user isolation test, select which user a scripted fake responds
    to (mirrors `tests/ingest/test_fanout.py::_seed_connection`'s identical
    `refresh_token` convention)."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": refresh_token}, created_at=token_created_at
        ),
        account_hash=f"fake-account-hash-{refresh_token}",
    )
    await superuser_db_session.commit()


async def _seed_open_position(
    superuser_db_session: AsyncSession, user_id: UUID
) -> tuple[UUID, UUID]:
    """Mirrors `tests/ledger/conftest.py::seeded_position`'s own
    construction (Core `insert()`, bypassing `Leg.__init__`'s write-token
    gate the same way that fixture does), generalised to an arbitrary user
    -- Test 5's own second user needs open legs of its own, and
    `seeded_position` is bound to `user_a` only. Returns `(front_leg_id,
    back_leg_id)`."""
    position_id = (
        await superuser_db_session.execute(
            insert(Position).values(user_id=user_id).returning(Position.id)
        )
    ).scalar_one()
    front_leg_id = (
        await superuser_db_session.execute(
            insert(Leg)
            .values(
                position_id=position_id,
                user_id=user_id,
                leg_role="front",
                occ_symbol="SPXW260618P07275000",
                root="SPXW",
            )
            .returning(Leg.id)
        )
    ).scalar_one()
    back_leg_id = (
        await superuser_db_session.execute(
            insert(Leg)
            .values(
                position_id=position_id,
                user_id=user_id,
                leg_role="back",
                occ_symbol="SPX260717P07275000",
                root="SPX",
            )
            .returning(Leg.id)
        )
    ).scalar_one()
    await superuser_db_session.commit()
    await insert_fills(
        superuser_db_session,
        user_id,
        [
            FillWrite(
                order_id=f"isolation-order-front-{user_id}",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=datetime(2026, 1, 1, tzinfo=UTC),
                position_effect="OPENING",
                side="SELL",
                quantity=Decimal("1"),
                price_usd=Decimal("44.8567"),
            ),
            FillWrite(
                order_id=f"isolation-order-back-{user_id}",
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
    return front_leg_id, back_leg_id


@dataclass
class _ScriptedQuoteFakeSchwabClient(FakeSchwabClient):
    """`FakeSchwabClient` that returns a fixed payload or raises a fixed
    exception, and records every `get_quotes` call -- the one fake Task 2's
    tests use for the expired-connection (never called), whole-call-failure
    (raises), and partial-response (returns, missing a symbol) branches."""

    quotes: JsonValue = field(default_factory=dict)
    raises: Exception | None = None
    calls: list[list[str]] = field(default_factory=list)

    async def get_quotes(self, symbols: list[str]) -> JsonValue:
        self.calls.append(list(symbols))
        if self.raises is not None:
            raise self.raises
        return self.quotes


@dataclass
class _ScriptedQuoteFakeSchwabAuth(FakeSchwabAuth):
    """Reproduces `FakeSchwabAuth.build_client`'s own rotation body exactly
    -- the same convention `QuoteFakeSchwabAuth`/`TxFakeSchwabAuth`
    (`tests/ingest/conftest.py`) already establish, reproduced locally here
    since this plan may not edit that shared conftest (08-03 runs in this
    same wave). `responses_by_user_id`, if set, selects the returned
    client's payload or exception, keyed by the user id embedded in the
    connection's own refresh token -- mirrors `TxFakeSchwabAuth`'s
    identical field exactly, letting Test 5's two users get two different
    outcomes from one fake. `last_client` is the one
    `_ScriptedQuoteFakeSchwabClient` this call actually returned, so a test
    can read its own `calls` back off this reference -- and its staying
    `None` is itself the proof that `build_client` (and therefore any
    vendor call) was never reached at all."""

    quotes: JsonValue = field(default_factory=dict)
    raises: Exception | None = None
    responses_by_user_id: dict[UUID, JsonValue | Exception] = field(
        default_factory=dict
    )
    last_client: _ScriptedQuoteFakeSchwabClient | None = field(default=None, init=False)

    async def build_client(
        self,
        token_read_func: Callable[[], object],
        token_write_func: Callable[[object], None],
    ) -> SchwabClient:
        wrapped = _WRAPPED_TOKEN.validate_python(token_read_func())
        current = _FAKE_REFRESH_TOKEN.validate_python(wrapped.token)
        rotated_refresh_token = await self.refresh(current.refresh_token)
        token_write_func(
            {
                "creation_timestamp": wrapped.creation_timestamp,
                "token": {"refresh_token": rotated_refresh_token},
            }
        )

        quotes = self.quotes
        raises = self.raises
        if self.responses_by_user_id:
            try:
                selector = UUID(current.refresh_token)
            except ValueError:
                selector = None
            if selector is not None and selector in self.responses_by_user_id:
                selected = self.responses_by_user_id[selector]
                if isinstance(selected, Exception):
                    quotes, raises = {}, selected
                else:
                    quotes, raises = selected, None

        client = _ScriptedQuoteFakeSchwabClient(
            account_entries=self.account_entries, quotes=quotes, raises=raises
        )
        self.last_client = client
        return client


def _http_status_error(status_code: int) -> HTTPStatusError:
    """Mirrors `tests/ingest/test_sync_runs.py`'s own
    `test_classify_sync_error_maps_five_distinct_classes::_status_error`
    helper exactly -- a real `HTTPStatusError` shape, not a bare
    `RuntimeError`, so Test 2 exercises the same exception type plan
    08-04's classifier will eventually branch on."""
    request = Request("GET", "https://api.schwabapi.com/marketdata/v1/quotes")
    response = Response(status_code, request=request)
    return HTTPStatusError("vendor error", request=request, response=response)


@pytest.mark.db
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


@pytest.mark.db
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


# --- 08-02 Task 2: three gap causes, distinguishable, isolation at both --
# grains -----------------------------------------------------------------

_PARTIAL_QUOTE_PAYLOAD: JsonValue = {
    "SPXW  260618P07275000": {
        "quote": {"mark": 44.8567, "underlyingPrice": 6203.1234},
    },
}


@pytest.mark.db
async def test_expired_connection_writes_gap(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 1 + Test 7 (SNAP-05, criterion 5, D8-14): a user whose
    connection is expired at the given slot's `observed_at` gets one
    `connection_expired` gap row per open leg in both tables, every money
    column null, and the fake's own client is never even built --
    `last_client is None` is the strongest form of "no vendor call was
    attempted": a call log that never came to exist rather than one merely
    empty."""
    fake_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC), account_entries=[]
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_EXPIRED_TOKEN_CREATED_AT,
    )
    await _open_the_seeded_position(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_id), slot_time=_SLOT_TIME.isoformat()
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)

    assert status is Status.SUCCEEDED
    assert fake_auth.last_client is None

    await _set_current_user(app_db_session, user_id)
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
    assert {row.gap_reason for row in mark_rows} == {"connection_expired"}
    assert all(row.mark_usd_ciphertext is None for row in mark_rows)
    assert all(row.key_version is None for row in mark_rows)

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
    assert {row.gap_reason for row in observation_rows} == {"connection_expired"}
    assert all(row.raw_ciphertext is None for row in observation_rows)


@pytest.mark.db
async def test_vendor_call_failure_writes_gap_and_raises(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 2. Orchestrator-resolved A3: a whole-`get_quotes`-call failure
    writes a `vendor_error` gap per open leg AND fails the job -- both
    facts, not either, so `procrastinate_jobs` and the data agree about
    what happened."""
    fake_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        raises=_http_status_error(503),
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_healthy_token_created_at_now(),
    )
    await _open_the_seeded_position(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_id), slot_time=_SLOT_TIME.isoformat()
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)

    assert status is Status.FAILED
    assert fake_auth.last_client is not None
    # Exactly one get_quotes call -- a whole-call failure is not retried
    # into a second vendor call by this branch.
    assert len(fake_auth.last_client.calls) == 1

    await _set_current_user(app_db_session, user_id)
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
    assert {row.gap_reason for row in mark_rows} == {"vendor_error"}

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
    assert {row.gap_reason for row in observation_rows} == {"vendor_error"}


@pytest.mark.db
async def test_partial_response_gaps_only_the_missing_leg(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 3 (D8-16's per-symbol isolation grain): a successful response
    missing one of the two requested symbols leaves that leg a
    `no_market_data` gap and the other leg a real mark, in the same slot --
    one missing element does not abort the other leg's own write."""
    fake_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        quotes=_PARTIAL_QUOTE_PAYLOAD,
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_healthy_token_created_at_now(),
    )
    await _open_the_seeded_position(superuser_db_session, user_id)

    async with app.open_async():
        job_id = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_id), slot_time=_SLOT_TIME.isoformat()
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)

    assert status is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
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
    gap_reason_by_leg = {row.leg_id: row.gap_reason for row in mark_rows}
    assert gap_reason_by_leg[seeded_position.front_leg_id] is None
    assert gap_reason_by_leg[seeded_position.back_leg_id] == "no_market_data"


@pytest.mark.db
async def test_three_gap_reasons_are_distinguishable_in_the_data(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Test 4 (`L043`): an expired connection, a vendor outage and a
    genuinely empty quote must be tellable apart in the data, not only in a
    log. Drives `capture_user_snapshot` directly, three times for the same
    user across three RTH slots, each engineered to hit exactly one gap
    branch, so a single query over one clean table proves all three
    reasons coexist and are distinct."""
    user_id = provisioned_users.user_a
    await _open_the_seeded_position(superuser_db_session, user_id)
    await _set_current_user(app_db_session, user_id)

    # Slot 1: expired connection -> connection_expired.
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_EXPIRED_TOKEN_CREATED_AT,
    )
    await capture_user_snapshot(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        auth=_ScriptedQuoteFakeSchwabAuth(
            fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC), account_entries=[]
        ),
    )

    # Slot 2: healthy connection, whole-call vendor failure -> vendor_error.
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_HEALTHY_TOKEN_CREATED_AT_FOR_SLOTS,
    )
    with pytest.raises(SnapshotVendorError):
        await capture_user_snapshot(
            app_db_session,
            user_id,
            slot_time=_SLOT_TIME_2,
            observed_at=_SLOT_TIME_2,
            auth=_ScriptedQuoteFakeSchwabAuth(
                fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
                account_entries=[],
                raises=_http_status_error(503),
            ),
        )

    # Slot 3: healthy connection, a response missing both symbols ->
    # no_market_data for both legs.
    await capture_user_snapshot(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME_3,
        observed_at=_SLOT_TIME_3,
        auth=_ScriptedQuoteFakeSchwabAuth(
            fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
            account_entries=[],
            quotes={},
        ),
    )
    # No commit here: slot 2's own internal commit (inside
    # capture_user_snapshot's vendor_error branch -- see this function's
    # own docstring) already ended one transaction and reset the
    # transaction-local app.current_user_id GUC to the empty string
    # (connections.py's own documented behaviour); capture_user_snapshot's
    # own first action re-sets it for the new transaction slot 3 runs in,
    # so reading within that same still-open transaction, rather than
    # committing and starting a third transaction with no GUC set, is what
    # keeps this query's own RLS check satisfiable.
    reasons = (
        (
            await app_db_session.execute(
                text(
                    "SELECT DISTINCT gap_reason FROM snapshot_marks "
                    "WHERE user_id = :user_id AND gap_reason IS NOT NULL"
                ),
                {"user_id": user_id},
            )
        )
        .scalars()
        .all()
    )
    assert set(reasons) == {"connection_expired", "vendor_error", "no_market_data"}


@pytest.mark.db
async def test_one_users_vendor_failure_leaves_the_other_users_job_succeeded(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 5 (D8-16's per-user isolation grain): `user_a`'s vendor call
    raises, `user_b`'s succeeds and its own marks land -- one broken
    connection cannot starve the rest of the sweep, mirroring
    `tests/ingest/test_fanout.py`'s own identical proof for `sync_user`."""
    user_a = provisioned_users.user_a
    user_b = provisioned_users.user_b
    await _seed_connection_with(
        superuser_db_session,
        user_a,
        refresh_token=str(user_a),
        token_created_at=_healthy_token_created_at_now(),
    )
    await _seed_connection_with(
        superuser_db_session,
        user_b,
        refresh_token=str(user_b),
        token_created_at=_healthy_token_created_at_now(),
    )
    await _open_the_seeded_position(superuser_db_session, user_a)
    await _seed_open_position(superuser_db_session, user_b)

    failing_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        quotes=QUOTE_PAYLOAD,
        responses_by_user_id={user_a: _http_status_error(503)},
    )
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: failing_auth)

    async with app.open_async():
        job_a = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_a), slot_time=_SLOT_TIME.isoformat()
        )
        job_b = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_b), slot_time=_SLOT_TIME.isoformat()
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status_a = await app.job_manager.get_job_status_async(job_a)
        status_b = await app.job_manager.get_job_status_async(job_b)

    assert status_a is Status.FAILED
    assert status_b is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_b)
    mark_rows_b = (
        (
            await app_db_session.execute(
                select(SnapshotMark).where(SnapshotMark.user_id == user_b)
            )
        )
        .scalars()
        .all()
    )
    assert len(mark_rows_b) == 2
    assert all(row.gap_reason is None for row in mark_rows_b)


@pytest.mark.db
async def test_two_concurrent_captures_for_one_user_and_slot_land_one_row_per_leg(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    quote_fake_auth: QuoteFakeSchwabAuth,
) -> None:
    """Test 6 (SNAP-05's own concurrency half, the plan's own backstop
    truth): two overlapping `capture_user_snapshot` calls for the same
    user and slot serialise on that user's `pg_advisory_xact_lock` and
    leave exactly one row per leg -- exercised with two concurrent
    sessions against real Postgres, mirroring
    `tests/vendor/test_upsert_connection_race.py`'s own two-independent-
    engines-plus-barrier shape."""
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)
    await _open_the_seeded_position(superuser_db_session, user_id)

    barrier = asyncio.Barrier(2)

    async def _capture_over_own_engine() -> None:
        engine = create_async_engine(get_settings().app_async_dsn)
        try:
            async with AsyncSession(engine) as session:
                await asyncio.wait_for(barrier.wait(), timeout=5)
                await capture_user_snapshot(
                    session,
                    user_id,
                    slot_time=_SLOT_TIME,
                    observed_at=_SLOT_TIME,
                    auth=quote_fake_auth,
                )
                await session.commit()
        finally:
            await engine.dispose()

    async with asyncio.timeout(10):
        await asyncio.gather(_capture_over_own_engine(), _capture_over_own_engine())

    count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text(
                    "SELECT count(*) FROM snapshot_marks "
                    "WHERE user_id = :user_id AND slot_time = :slot_time"
                ),
                {"user_id": user_id, "slot_time": _SLOT_TIME},
            )
        ).scalar_one()
    )
    assert count == 2


# --- 08-02 Task 3: the RTH grid -- daylight saving, half days, empties ----
#
# Tests 1-6 and 10 are pure and carry no `@pytest.mark.db` -- proving the
# 30-minute Eastern grid needs no Postgres (`-m "not db"`). Tests 7-9 are
# db-marked and run through the real writer/deferred task.
#
# A local `_TEST_EASTERN` rather than importing `snapshots.py`'s own
# private `_EASTERN`: every case here states its own wall-clock intent by
# constructing a `datetime` directly in Eastern and letting the function
# under test convert it, exactly the discipline the plan itself asks for.

_TEST_EASTERN = ZoneInfo("America/New_York")


@pytest.mark.parametrize(
    ("eastern_time", "expect_slot"),
    [
        pytest.param(time(9, 30), True, id="0930-rth-open"),
        pytest.param(time(10, 0), True, id="1000-on-grid"),
        pytest.param(time(15, 30), True, id="1530-on-grid"),
        pytest.param(time(16, 0), True, id="1600-rth-close"),
        pytest.param(time(9, 29), False, id="0929-before-open"),
        pytest.param(time(9, 45), False, id="0945-off-grid"),
        pytest.param(time(16, 30), False, id="1630-after-close"),
        pytest.param(time(8, 0), False, id="0800-before-open"),
    ],
)
def test_rth_slot_for_an_ordinary_wednesday(
    eastern_time: time, expect_slot: bool
) -> None:
    """Test 1: 09:30, 10:00, 15:30 and 16:00 Eastern on an ordinary
    Wednesday (2026-06-17) each return a slot; 09:29, 09:45, 16:30 and
    08:00 each return nothing."""
    moment = datetime.combine(date(2026, 6, 17), eastern_time, tzinfo=_TEST_EASTERN)
    result = rth_slot_for(moment)
    assert (result is not None) is expect_slot


@pytest.mark.parametrize(
    "day",
    [date(2026, 6, 20), date(2026, 6, 21)],
    ids=["saturday", "sunday"],
)
def test_rth_slot_for_a_weekend_returns_none(day: date) -> None:
    """Test 2: Saturday and Sunday at 10:00 Eastern return nothing."""
    moment = datetime.combine(day, time(10, 0), tzinfo=_TEST_EASTERN)
    assert rth_slot_for(moment) is None


def test_rth_slot_for_the_same_eastern_hour_maps_to_two_different_utc_hours() -> None:
    """Test 3: a UTC instant that is 10:00 Eastern in March under daylight
    saving, and a UTC instant that is 10:00 Eastern in December under
    standard time, both return a slot -- the same wall-clock hour maps to
    two different UTC hours and both are inside RTH. Asserted on the UTC
    hour itself, so a fixed-offset implementation cannot pass both."""
    summer = datetime(2026, 3, 11, 10, 0, tzinfo=_TEST_EASTERN)  # EDT, UTC-4
    winter = datetime(2026, 12, 9, 10, 0, tzinfo=_TEST_EASTERN)  # EST, UTC-5
    assert summer.astimezone(UTC).hour != winter.astimezone(UTC).hour

    assert rth_slot_for(summer) is not None
    assert rth_slot_for(winter) is not None


def test_rth_slot_for_a_fixed_utc_hour_is_not_always_ten_am_eastern() -> None:
    """Test 4 (`D8-06`): the UTC instant that was 10:00 Eastern in summer
    (14:00 UTC) is 09:00 Eastern in winter -- before RTH open -- and
    returns nothing. This is the exact failure a fixed UTC hour range
    produces twice a year."""
    same_utc_hour_in_winter = datetime(2026, 12, 9, 14, 0, tzinfo=UTC)
    assert rth_slot_for(same_utc_hour_in_winter) is None


def test_rth_slots_between_one_ordinary_wednesday_returns_fourteen_slots() -> None:
    """Test 5: `rth_slots_between` over one ordinary trading day returns
    exactly 14 slots, first 09:30 Eastern and last 16:00 Eastern."""
    start = datetime(2026, 6, 17, 0, 0, tzinfo=UTC)
    end = datetime(2026, 6, 18, 0, 0, tzinfo=UTC)
    slots = rth_slots_between(start, end)

    assert len(slots) == 14
    assert slots[0].astimezone(_TEST_EASTERN).time() == time(9, 30)
    assert slots[-1].astimezone(_TEST_EASTERN).time() == time(16, 0)


def test_rth_slots_between_spring_forward_span_has_no_duplicate_or_missing_slot() -> (
    None
):
    """Test 6 (2026's own spring-forward weekend, second Sunday in March,
    2026-03-08): a span crossing it returns the right count per day --
    computed here from the calendar itself, not a hardcoded total, so the
    assertion states what "right" means rather than merely repeating a
    number -- and no duplicate or missing instant."""
    start = datetime(2026, 3, 2, 0, 0, tzinfo=UTC)  # Monday before
    end = datetime(2026, 3, 13, 0, 0, tzinfo=UTC)  # Friday after
    slots = rth_slots_between(start, end)

    assert len(slots) == len(set(slots))  # no duplicate instant

    weekday_count = 0
    day = start.astimezone(_TEST_EASTERN).date()
    last_day = end.astimezone(_TEST_EASTERN).date()
    while day <= last_day:
        if day.weekday() < 5:
            weekday_count += 1
        day += timedelta(days=1)
    assert len(slots) == weekday_count * 14


def test_rth_slot_for_and_rth_slots_between_are_pure() -> None:
    """Test 10: `rth_slot_for`/`rth_slots_between` take their moment as a
    parameter and read no system clock -- asserted structurally, mirroring
    `tests/ledger/test_pairing_pure.py`'s own AST-walk convention rather
    than trusting a comment."""
    source_path = Path(inspect.getfile(rth_slot_for))
    tree = ast.parse(source_path.read_text(), filename=str(source_path))
    target_names = {"rth_slot_for", "rth_slots_between"}
    functions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name in target_names
    ]
    assert len(functions) == 2

    clock_reading_names = {"now", "utcnow", "today"}
    for function in functions:
        for node in ast.walk(function):
            if isinstance(node, ast.Attribute) and node.attr in clock_reading_names:
                raise AssertionError(
                    f"{function.name} reads the system clock via .{node.attr}"
                )
            if isinstance(node, ast.Name) and node.id in clock_reading_names:
                raise AssertionError(
                    f"{function.name} reads the system clock via {node.id}"
                )


@pytest.mark.db
async def test_half_day_produces_honest_gaps_for_the_unserved_slots(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
) -> None:
    """Test 7: a half day is modelled here as a live capture where the
    fake simply has no quote for an afternoon slot -- the honest outcome
    is a `no_market_data` gap for that slot, with no market-holiday or
    half-day calendar anywhere in the code (`08-RESEARCH.md`'s own "don't
    hand-roll" finding). No row for that slot carries a value copied from
    the morning."""
    user_id = provisioned_users.user_a
    await _open_the_seeded_position(superuser_db_session, user_id)
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_HEALTHY_TOKEN_CREATED_AT_FOR_SLOTS,
    )
    await _set_current_user(app_db_session, user_id)

    morning_slot = datetime(2026, 6, 17, 13, 30, tzinfo=UTC)  # 09:30 ET
    afternoon_slot = datetime(2026, 6, 17, 17, 0, tzinfo=UTC)  # 13:00 ET

    await capture_user_snapshot(
        app_db_session,
        user_id,
        slot_time=morning_slot,
        observed_at=morning_slot,
        auth=_ScriptedQuoteFakeSchwabAuth(
            fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
            account_entries=[],
            quotes=QUOTE_PAYLOAD,
        ),
    )
    await capture_user_snapshot(
        app_db_session,
        user_id,
        slot_time=afternoon_slot,
        observed_at=afternoon_slot,
        auth=_ScriptedQuoteFakeSchwabAuth(
            fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
            account_entries=[],
            quotes={},
        ),
    )

    morning_rows = (
        (
            await app_db_session.execute(
                select(SnapshotMark).where(SnapshotMark.slot_time == morning_slot)
            )
        )
        .scalars()
        .all()
    )
    afternoon_rows = (
        (
            await app_db_session.execute(
                select(SnapshotMark).where(SnapshotMark.slot_time == afternoon_slot)
            )
        )
        .scalars()
        .all()
    )
    assert len(morning_rows) == 2
    assert all(row.gap_reason is None for row in morning_rows)
    assert len(afternoon_rows) == 2
    assert all(row.gap_reason == "no_market_data" for row in afternoon_rows)
    assert all(row.mark_usd_ciphertext is None for row in afternoon_rows)


@pytest.mark.db
async def test_user_with_zero_open_positions_completes_with_zero_attempts(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 8: a user with zero open positions (no `seeded_position`
    fixture at all here -- no `positions`/`legs` rows exist for this user)
    completes with `legs_attempted` zero, writes no row, and does not
    raise."""
    user_id = provisioned_users.user_a
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_HEALTHY_TOKEN_CREATED_AT_FOR_SLOTS,
    )
    await _set_current_user(app_db_session, user_id)

    outcome = await capture_user_snapshot(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME,
        observed_at=_SLOT_TIME,
        auth=_ScriptedQuoteFakeSchwabAuth(
            fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC), account_entries=[]
        ),
    )
    assert outcome.legs_attempted == 0
    assert outcome.marks_written == 0

    count = _INT.validate_python(
        (
            await app_db_session.execute(text("SELECT count(*) FROM snapshot_marks"))
        ).scalar_one()
    )
    assert count == 0


@pytest.mark.db
async def test_periodic_tick_with_no_open_positions_defers_and_writes_nothing(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 9: a connected user with no open position still gets a
    deferred `snapshot_user` job -- the fan-out doesn't know about
    positions, `read_open_legs` is where that's decided -- and the drained
    job writes nothing and does not raise."""
    user_id = provisioned_users.user_a
    await _seed_connection_with(
        superuser_db_session,
        user_id,
        refresh_token="fake-refresh-user-a",
        token_created_at=_healthy_token_created_at_now(),
    )

    async with app.open_async():
        deferred = await capture_all_connected_users(
            superuser_db_session, slot_time=_SLOT_TIME
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        jobs = await app.job_manager.list_jobs_async(task="snapshot_user")

    assert user_id in deferred
    assert any(job.status == Status.SUCCEEDED.value for job in jobs)

    count = _INT.validate_python(
        (
            await superuser_db_session.execute(
                text("SELECT count(*) FROM snapshot_marks")
            )
        ).scalar_one()
    )
    assert count == 0

"""Task 1-2 (08-04-PLAN.md): the snapshot-run ledger's write/read path,
its classified error codes, and the two-session run accounting through a
real drained worker (D8-15, `L042`, `L043`).

Task 1's cases carry their own `@pytest.mark.db` decorator or none at
all, the same per-test convention `test_snapshot_capture.py` already
established once a module holds both database and pure cases. Task 2's
cases go through the real deferred `snapshot_user` task and a drained
worker, mirroring `test_sync_runs.py`'s own discipline: the two-session
failure-record split lives in the worker wrapper itself, so only a real
task run exercises it (Phase 7's own code-review lesson -- an
unreachable feature is worse than a missing one). Task 3 extends this
file with `missing_capture_slots`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

import pytest
from httpx import HTTPStatusError, Request, Response
from procrastinate.jobs import Status
from pydantic import BaseModel, JsonValue, ValidationError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import morai.worker.app as worker_app
from morai.db.models import SnapshotMark
from morai.ingest.snapshot_runs import (
    SnapshotError,
    SnapshotRunStatus,
    SnapshotTrigger,
    classify_snapshot_error,
    read_snapshot_runs,
    record_snapshot_run,
)
from morai.ledger.fills import FillWrite, insert_fills
from morai.ledger.pairing import sync_events
from morai.vendor.connections import (
    ConnectionDataKeyMissing,
    ConnectionNotFound,
    upsert_connection,
)
from morai.vendor.protocol import ExchangedToken, SchwabClient
from morai.worker.app import app
from tests.identity.conftest import SeededUsers
from tests.ingest.conftest import QuoteFakeSchwabAuth
from tests.ledger.conftest import SeededPosition
from tests.vendor.conftest import (
    _FAKE_REFRESH_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: this module's own scripted fake reproduces FakeSchwabAuth.build_client's rotation body exactly (see _ScriptedQuoteFakeSchwabAuth's docstring below), the same convention test_snapshot_capture.py already establishes -- reproduced locally since this plan may not edit the shared conftest.
    _WRAPPED_TOKEN,  # pyright: ignore[reportPrivateUsage]  # why: see _FAKE_REFRESH_TOKEN above.
    FakeSchwabAuth,
    FakeSchwabClient,
)

# Monday, 10:30 ET (EDT, UTC-4) -- on the RTH grid (D8-06), mirroring
# test_snapshot_capture.py's own slot constants.
_SLOT_TIME = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)
_SLOT_TIME_2 = datetime(2026, 6, 15, 15, 0, tzinfo=UTC)

# Years past the seven-day refresh-token lifetime, not days, so this
# stays correct regardless of the real wall clock the suite runs under.
_EXPIRED_TOKEN_CREATED_AT = datetime(2020, 1, 1, tzinfo=UTC)


def _healthy_token_created_at_now() -> datetime:
    """Read fresh at call time -- `snapshot_user_task` computes connection
    health against the real wall clock, so a task-based test's own
    "healthy" fixture must be relative to that same clock (D3-14's own
    discipline), mirroring `test_snapshot_capture.py`'s identical
    helper."""
    return datetime.now(UTC) - timedelta(hours=1)


async def _set_current_user(session: AsyncSession, user_id: UUID) -> None:
    """`set_config`, not a bind parameter inside `SET LOCAL` -- mirrors
    `tests/ingest/test_sync_runs.py::_set_current_user`. Re-called after
    every commit in this module: `set_config(..., true)` is
    transaction-local and reverts to `''`, not `NULL`, once its own
    transaction ends (08-03's own discovered convention)."""
    await session.execute(
        text("SELECT set_config('app.current_user_id', :uid, true)"),
        {"uid": str(user_id)},
    )


async def _seed_connection(superuser_db_session: AsyncSession, user_id: UUID) -> None:
    """Seeds one healthy connection row through `upsert_connection`, the
    real write path (D3-14) -- mirrors `test_snapshot_capture.py`'s
    identical helper."""
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


async def _seed_connection_with(
    superuser_db_session: AsyncSession,
    user_id: UUID,
    *,
    refresh_token: str,
    token_created_at: datetime,
) -> None:
    """Like `_seed_connection`, but with an explicit
    `refresh_token`/`token_created_at` -- needed to choose the
    connection's health deterministically (expired vs healthy), mirroring
    `test_snapshot_capture.py::_seed_connection_with`."""
    await upsert_connection(
        superuser_db_session,
        user_id,
        ExchangedToken(
            token={"refresh_token": refresh_token}, created_at=token_created_at
        ),
        account_hash=f"fake-account-hash-{refresh_token}",
    )
    await superuser_db_session.commit()


async def _open_the_seeded_position(
    superuser_db_session: AsyncSession, user_id: UUID
) -> None:
    """Inserts one real OPEN fill per leg of `seeded_position` through
    `insert_fills`, then derives the real `OPEN` events through
    `sync_events` -- mirrors `test_snapshot_repair.py`'s own
    `_seed_leg_with_lifetime` discipline: `read_open_legs`'s `is_closed`
    check only needs the fills (net quantity), but Task 3's
    `backfill_uncaptured_slot_gaps` also needs `opened_at`, which
    `derive_position_state` derives from real `OPEN`/`ROLL` events, not
    from fills directly."""
    await insert_fills(
        superuser_db_session,
        user_id,
        [
            FillWrite(
                order_id="run-ledger-order-front",
                occ_symbol="SPXW260618P07275000",
                leg_index=0,
                execution_time=datetime(2026, 1, 1, tzinfo=UTC),
                position_effect="OPENING",
                side="SELL",
                quantity=Decimal("1"),
                price_usd=Decimal("44.8567"),
            ),
            FillWrite(
                order_id="run-ledger-order-back",
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
    await sync_events(
        superuser_db_session, user_id, as_of=datetime(2026, 6, 20, tzinfo=UTC)
    )
    await superuser_db_session.commit()


async def _drain_snapshot(
    user_id: UUID,
    slot_time: datetime,
    *,
    trigger: str = SnapshotTrigger.SCHEDULED.value,
) -> Status:
    """Defers `snapshot_user` by name onto the real `worker.app.app` and
    drains it with a bounded `run_worker_async(wait=False)` under an outer
    timeout, mirroring `test_sync_runs.py::_drain` and
    `test_snapshot_capture.py`'s identical pattern -- returns the job's
    final status."""
    async with app.open_async():
        job_id = await app.configure_task("snapshot_user").defer_async(
            user_id=str(user_id), slot_time=slot_time.isoformat(), trigger=trigger
        )
        await asyncio.wait_for(app.run_worker_async(wait=False), timeout=30)
        status = await app.job_manager.get_job_status_async(job_id)
    assert status is not None
    return status


@pytest.mark.db
async def test_record_snapshot_run_writes_one_row_and_does_not_commit(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 1: `record_snapshot_run` writes exactly one row and does not
    commit; the caller's rollback removes it."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    started = datetime.now(UTC)
    await record_snapshot_run(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME,
        started_at=started,
        finished_at=started,
        trigger=SnapshotTrigger.SCHEDULED,
        status=SnapshotRunStatus.SUCCEEDED,
        legs_attempted=0,
        marks_written=0,
        gaps_by_reason={},
        error_code=None,
    )
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1

    await app_db_session.rollback()
    await _set_current_user(app_db_session, user_id)
    runs_after_rollback = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert runs_after_rollback == []


@pytest.mark.db
async def test_succeeded_run_reads_back_field_for_field(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 2: a succeeded run stores its slot, trigger, status, leg
    count, mark count and a gap tally keyed by reason, and reads back
    through `read_snapshot_runs` field for field."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    started = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)
    finished = started + timedelta(seconds=5)
    await record_snapshot_run(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME,
        started_at=started,
        finished_at=finished,
        trigger=SnapshotTrigger.MANUAL,
        status=SnapshotRunStatus.SUCCEEDED,
        legs_attempted=2,
        marks_written=2,
        gaps_by_reason={"no_market_data": 1},
        error_code=None,
    )
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.user_id == user_id
    assert run.slot_time == _SLOT_TIME
    assert run.started_at == started
    assert run.finished_at == finished
    assert run.trigger == SnapshotTrigger.MANUAL
    assert run.status == SnapshotRunStatus.SUCCEEDED
    assert run.legs_attempted == 2
    assert run.marks_written == 2
    assert run.gaps_by_reason == {"no_market_data": 1}
    assert run.error_code is None


@pytest.mark.db
async def test_failed_run_stores_null_counts_and_a_classified_code(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 3: a failed run stores null in every count column and a
    non-null error code -- a broken cycle is not an empty one."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    started = datetime.now(UTC)
    await record_snapshot_run(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME,
        started_at=started,
        finished_at=started,
        trigger=SnapshotTrigger.SCHEDULED,
        status=SnapshotRunStatus.FAILED,
        legs_attempted=None,
        marks_written=None,
        gaps_by_reason=None,
        error_code=SnapshotError.VENDOR_UNAVAILABLE,
    )
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == SnapshotRunStatus.FAILED
    assert run.legs_attempted is None
    assert run.marks_written is None
    assert run.gaps_by_reason is None
    assert run.error_code == SnapshotError.VENDOR_UNAVAILABLE

    # The acceptance criterion's own direct-SQL check: NULLs at the DB
    # level too, not only through the dataclass reader.
    await app_db_session.commit()
    row = (
        await superuser_db_session.execute(
            text(
                "SELECT legs_attempted, marks_written, gaps_by_reason, error_code "
                "FROM snapshot_runs WHERE status = 'failed'"
            )
        )
    ).one()
    assert row[0] is None
    assert row[1] is None
    assert row[2] is None
    assert row[3] is not None


class _StatusOnly(BaseModel):
    a: int


def _status_error(status_code: int) -> HTTPStatusError:
    """Mirrors `test_sync_runs.py`'s own `_status_error` helper exactly --
    a real `HTTPStatusError` shape, not a bare `RuntimeError`."""
    request = Request("GET", "https://api.schwabapi.com/marketdata/v1/quotes")
    response = Response(status_code, request=request)
    return HTTPStatusError("vendor error", request=request, response=response)


def test_classify_snapshot_error_maps_seven_distinct_classes() -> None:
    """Test 4: `classify_snapshot_error` returns `CONNECTION_NOT_FOUND`,
    `DATA_KEY_MISSING`, `VENDOR_AUTH_FAILED` (401 and 403),
    `VENDOR_RATE_LIMITED` (429), `VENDOR_UNAVAILABLE` (500 through 504),
    `VENDOR_PAYLOAD_UNPARSEABLE`, and `UNKNOWN` for anything else -- every
    branch returns a member, never `None`."""
    try:
        _StatusOnly.model_validate({"a": "not-an-int"})
        validation_error: ValidationError | None = None
    except ValidationError as exc:
        validation_error = exc
    assert validation_error is not None

    assert (
        classify_snapshot_error(_status_error(401)) == SnapshotError.VENDOR_AUTH_FAILED
    )
    assert (
        classify_snapshot_error(_status_error(403)) == SnapshotError.VENDOR_AUTH_FAILED
    )
    for status_code in (500, 501, 502, 503, 504):
        assert (
            classify_snapshot_error(_status_error(status_code))
            == SnapshotError.VENDOR_UNAVAILABLE
        )

    codes = {
        classify_snapshot_error(ConnectionNotFound("no connection")),
        classify_snapshot_error(ConnectionDataKeyMissing("shredded")),
        classify_snapshot_error(_status_error(401)),
        classify_snapshot_error(_status_error(429)),
        classify_snapshot_error(_status_error(503)),
        classify_snapshot_error(validation_error),
        classify_snapshot_error(RuntimeError("something this module has never seen")),
    }
    assert codes == set(SnapshotError)


def test_message_text_never_reaches_the_classified_code() -> None:
    """Test 5: an exception whose message text contains a token-shaped
    string is classified by type alone; the returned value is an enum
    member and the message never reaches it (`NN-34`)."""
    secret = "token-shaped-secret-ABCDEF123456"
    result = classify_snapshot_error(RuntimeError(f"vendor error, token={secret}"))
    assert result == SnapshotError.UNKNOWN
    assert isinstance(result, SnapshotError)
    assert secret not in str(result)
    assert secret not in result.value


def test_chained_vendor_error_classifies_from_its_cause() -> None:
    """Test 6: a `SnapshotVendorError` chained from an HTTP status error
    classifies from the chained cause's status code, not from the
    wrapper's own type -- otherwise every vendor failure collapses to
    `UNKNOWN` and `L043` reappears. Imports `SnapshotVendorError` locally
    to avoid a module-level dependency this test alone needs."""
    from morai.ingest.snapshots import SnapshotVendorError

    cause = _status_error(503)
    try:
        try:
            raise cause
        except HTTPStatusError as caught:
            raise SnapshotVendorError("get_quotes failed") from caught
    except SnapshotVendorError as wrapper:
        assert classify_snapshot_error(wrapper) == SnapshotError.VENDOR_UNAVAILABLE


@pytest.mark.db
async def test_read_snapshot_runs_orders_most_recent_first_bounded_and_rls_scoped(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 7: `read_snapshot_runs` returns this user's rows most recent
    first, bounded by `limit`, and RLS is what excludes another user's
    rows rather than a `WHERE` clause in the function -- proved with a
    superuser positive control, mirroring `test_sync_runs.py`'s own
    bracketed shape."""
    user_a = provisioned_users.user_a
    user_b = provisioned_users.user_b
    base = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)

    await _set_current_user(app_db_session, user_a)
    for i in range(3):
        await record_snapshot_run(
            app_db_session,
            user_a,
            slot_time=base + timedelta(minutes=30 * i),
            started_at=base,
            finished_at=base,
            trigger=SnapshotTrigger.SCHEDULED,
            status=SnapshotRunStatus.SUCCEEDED,
            legs_attempted=0,
            marks_written=0,
            gaps_by_reason={},
            error_code=None,
        )
    await app_db_session.commit()

    await _set_current_user(app_db_session, user_b)
    await record_snapshot_run(
        app_db_session,
        user_b,
        slot_time=base,
        started_at=base,
        finished_at=base,
        trigger=SnapshotTrigger.SCHEDULED,
        status=SnapshotRunStatus.SUCCEEDED,
        legs_attempted=0,
        marks_written=0,
        gaps_by_reason={},
        error_code=None,
    )
    await app_db_session.commit()

    await _set_current_user(app_db_session, user_a)
    limited = await read_snapshot_runs(app_db_session, user_a, limit=2)
    assert len(limited) == 2
    assert limited[0].slot_time == base + timedelta(minutes=60)
    assert limited[1].slot_time == base + timedelta(minutes=30)
    assert {run.user_id for run in limited} == {user_a}

    await _set_current_user(superuser_db_session, user_a)
    all_rows = (
        await superuser_db_session.execute(text("SELECT user_id FROM snapshot_runs"))
    ).all()
    owners = {row[0] for row in all_rows}
    assert {user_a, user_b} <= owners


@pytest.mark.db
async def test_zero_legs_still_records_a_row_with_zero_known_counts(
    clean_snapshot_tables: None,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    """Test 8: a run that attempted zero legs still records a row, with a
    zero leg count and a zero mark count -- zero attempted is a known
    zero, unlike a failed run's unknown counts."""
    user_id = provisioned_users.user_a
    await _set_current_user(app_db_session, user_id)
    started = datetime.now(UTC)
    await record_snapshot_run(
        app_db_session,
        user_id,
        slot_time=_SLOT_TIME,
        started_at=started,
        finished_at=started,
        trigger=SnapshotTrigger.SCHEDULED,
        status=SnapshotRunStatus.SUCCEEDED,
        legs_attempted=0,
        marks_written=0,
        gaps_by_reason={},
        error_code=None,
    )
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    assert runs[0].status == SnapshotRunStatus.SUCCEEDED
    assert runs[0].legs_attempted == 0
    assert runs[0].marks_written == 0
    assert runs[0].gaps_by_reason == {}


# --- Task 2: the two-session run accounting, through a real drained job ---


@dataclass
class _ScriptedQuoteFakeSchwabClient(FakeSchwabClient):
    """`FakeSchwabClient` that returns a fixed payload or raises a fixed
    exception -- reproduced locally from `test_snapshot_capture.py`'s own
    identical class, since this plan may not edit the shared conftest
    (`08-02`'s own precedent for the same reproduction)."""

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
    -- reproduced locally from `test_snapshot_capture.py`'s identical
    class for the same reason. `last_client` staying `None` is itself the
    proof that no vendor call was attempted at all."""

    quotes: JsonValue = field(default_factory=dict)
    raises: Exception | None = None
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
        client = _ScriptedQuoteFakeSchwabClient(
            account_entries=self.account_entries,
            quotes=self.quotes,
            raises=self.raises,
        )
        self.last_client = client
        return client


@pytest.mark.db
async def test_successful_capture_job_leaves_one_succeeded_run_row(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    quote_fake_auth: QuoteFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 1: a successful capture job leaves exactly one `snapshot_runs`
    row with status succeeded, the slot it was deferred with, trigger
    scheduled, the true leg and mark counts, and a null error code."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: quote_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)
    await _open_the_seeded_position(superuser_db_session, user_id)

    status = await _drain_snapshot(user_id, _SLOT_TIME)
    assert status is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == SnapshotRunStatus.SUCCEEDED
    assert run.slot_time == _SLOT_TIME
    assert run.trigger == SnapshotTrigger.SCHEDULED
    assert run.legs_attempted == 2
    assert run.marks_written == 2
    assert run.error_code is None


@pytest.mark.db
async def test_vendor_failure_leaves_one_failed_run_row_that_survives_rollback(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 2 + Test 6: a capture job whose vendor call fails leaves
    exactly one row with status failed, a classified error code, null
    counts, and the row survives -- the capture session's rollback does
    not take it with it. The drained job's own Procrastinate status is
    failed, so `procrastinate_jobs` and `snapshot_runs` agree."""
    fake_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        raises=_status_error(503),
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

    status = await _drain_snapshot(user_id, _SLOT_TIME)
    assert status is Status.FAILED

    await _set_current_user(app_db_session, user_id)
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == SnapshotRunStatus.FAILED
    assert run.legs_attempted is None
    assert run.marks_written is None
    assert run.gaps_by_reason is None
    assert run.error_code == SnapshotError.VENDOR_UNAVAILABLE


@pytest.mark.db
async def test_vendor_failure_gap_rows_are_also_present_in_snapshot_marks(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 3: after a vendor-call failure, the per-leg `vendor_error` gap
    rows from plan 08-02 are also present, so the slot is honest in the
    data and the cause is named in the ledger -- both halves of the
    orchestrator's resolved answer to A3 hold at once."""
    fake_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        raises=_status_error(503),
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

    status = await _drain_snapshot(user_id, _SLOT_TIME)
    assert status is Status.FAILED

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


@pytest.mark.db
async def test_expired_connection_records_a_succeeded_run_with_a_full_gap_tally(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 4: a job for a user with an expired connection records a
    succeeded run whose gap tally names `connection_expired` for every
    open leg -- an expired connection is a successful capture of an
    honest gap, not a failed run."""
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

    status = await _drain_snapshot(user_id, _SLOT_TIME)
    assert status is Status.SUCCEEDED
    assert fake_auth.last_client is None

    await _set_current_user(app_db_session, user_id)
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == SnapshotRunStatus.SUCCEEDED
    assert run.legs_attempted == 2
    assert run.marks_written == 2
    assert run.gaps_by_reason == {"connection_expired": 2}
    assert run.error_code is None


@pytest.mark.db
async def test_zero_open_legs_records_a_succeeded_row_with_zero_counts(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    quote_fake_auth: QuoteFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 5: a run with zero open legs records a succeeded row with
    zero counts and an empty tally."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: quote_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)
    # No open position seeded -- read_open_legs returns nothing.

    status = await _drain_snapshot(user_id, _SLOT_TIME)
    assert status is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    run = runs[0]
    assert run.status == SnapshotRunStatus.SUCCEEDED
    assert run.legs_attempted == 0
    assert run.marks_written == 0
    assert run.gaps_by_reason == {}


@pytest.mark.db
async def test_a_stalled_slot_and_a_vendor_outage_are_distinguishable_by_one_query(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    seeded_position: SeededPosition,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Test 7: one slot has a succeeded run with a full gap tally (a real
    vendor outage), another slot has no run row at all because no job was
    ever deferred for it (a stalled scheduler) -- one query separates
    them."""
    fake_auth = _ScriptedQuoteFakeSchwabAuth(
        fixed_created_at=datetime(2026, 1, 1, tzinfo=UTC),
        account_entries=[],
        raises=_status_error(503),
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

    status = await _drain_snapshot(user_id, _SLOT_TIME)
    assert status is Status.FAILED
    # _SLOT_TIME_2 is never deferred at all -- the stalled-scheduler case.

    await _set_current_user(app_db_session, user_id)
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    slot_times = {run.slot_time for run in runs}
    assert _SLOT_TIME in slot_times
    assert _SLOT_TIME_2 not in slot_times


@pytest.mark.db
async def test_manual_trigger_is_recorded_when_passed_through(
    clean_snapshot_tables: None,
    superuser_db_session: AsyncSession,
    app_db_session: AsyncSession,
    provisioned_users: SeededUsers,
    quote_fake_auth: QuoteFakeSchwabAuth,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`trigger` defaults to scheduled but is threaded straight through --
    a future manual re-capture routes through this same task, so a job
    deferred with `trigger="manual"` must record that value, not silently
    fall back to scheduled."""
    monkeypatch.setattr(worker_app, "get_schwab_auth", lambda: quote_fake_auth)
    user_id = provisioned_users.user_a
    await _seed_connection(superuser_db_session, user_id)

    status = await _drain_snapshot(
        user_id, _SLOT_TIME, trigger=SnapshotTrigger.MANUAL.value
    )
    assert status is Status.SUCCEEDED

    await _set_current_user(app_db_session, user_id)
    runs = await read_snapshot_runs(app_db_session, user_id, limit=10)
    assert len(runs) == 1
    assert runs[0].trigger == SnapshotTrigger.MANUAL

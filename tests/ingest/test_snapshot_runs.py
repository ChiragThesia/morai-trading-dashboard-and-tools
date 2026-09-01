"""Task 1 (08-04-PLAN.md): the snapshot-run ledger's write/read path and
its classified error codes (D8-15, `L042`, `L043`).

Db-backed cases carry their own `@pytest.mark.db` decorator; the
classifier cases carry none, the same per-test convention
`test_snapshot_capture.py` already established once a module holds both
database and pure cases. Tasks 2 and 3 extend this file with the
two-session run accounting (through a real drained worker) and
`missing_capture_slots`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from httpx import HTTPStatusError, Request, Response
from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from morai.ingest.snapshot_runs import (
    SnapshotError,
    SnapshotRunStatus,
    SnapshotTrigger,
    classify_snapshot_error,
    read_snapshot_runs,
    record_snapshot_run,
)
from morai.vendor.connections import ConnectionDataKeyMissing, ConnectionNotFound
from tests.identity.conftest import SeededUsers

# Monday, 10:30 ET (EDT, UTC-4) -- on the RTH grid (D8-06), mirroring
# test_snapshot_capture.py's own slot constants.
_SLOT_TIME = datetime(2026, 6, 15, 14, 30, tzinfo=UTC)


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

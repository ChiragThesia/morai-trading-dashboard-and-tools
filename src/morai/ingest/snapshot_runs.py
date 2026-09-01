"""The snapshot-run record: what ran, what landed, what errored (Phase 8,
plan 08-04, D8-15, migration 0015).

Mirrors `morai.ingest.sync_runs` near-verbatim (`D8-15`'s own Claude's-
discretion allowance to reuse that shape) -- the same two `StrEnum`s, the
same classified-error `StrEnum`, the same frozen record dataclass, the
same no-commit write path, and the same most-recent-first read.

## Why this table exists (`L042`)

A count of empty-quote gaps cannot distinguish "the market genuinely had
nothing" from "the job silently stopped." v1's own GEX open interest read
zero for an extended period with the vendor endpoint confirmed live -- the
adapter's own scheduled job had silently stopped and never resumed, and
nothing existed to tell the two apart. A row proving the job ran at all is
the only thing that does: this table gives every capture attempt a place
to leave one.

## `classify_snapshot_error` -- type and status code only (`NN-20`, `NN-34`)

Branches on `type(exc)` and, for an HTTP status error, on the response's
status code -- never on a substring of the exception's own message. A
vendor error can carry a token, a full response body or a redirect URL,
and every one of those is bearer-equivalent (`NN-34`). Before giving up,
it follows `exc.__cause__` once and classifies that -- the one thing
`classify_sync_error` does not need -- so a `SnapshotVendorError` raised
from a chained vendor exception (`morai.ingest.snapshots`) is classified
by the cause rather than collapsing to the unknown branch. Mapping every
failure to one generic code is the other failure mode and is equally
forbidden (`NN-20`).

`DATA_KEY_MISSING` and `VENDOR_UNAVAILABLE` are the two members
`SyncError` does not carry, and both earn their place here: a
crypto-shredded account must not read as an unknown failure, and a 5xx
and a 429 call for different operator responses.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from httpx import HTTPStatusError
from pydantic import ValidationError
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SnapshotRun
from morai.vendor.connections import ConnectionDataKeyMissing, ConnectionNotFound


class SnapshotTrigger(StrEnum):
    """How a `snapshot_user` run was started -- the scheduled RTH fan-out,
    or a future manual re-capture. Mirrors `sync_runs.SyncTrigger`
    exactly."""

    SCHEDULED = "scheduled"
    MANUAL = "manual"


class SnapshotRunStatus(StrEnum):
    """Whether a `snapshot_user` run finished cleanly or raised."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"


class SnapshotError(StrEnum):
    """The classified codes `classify_snapshot_error` returns -- a fixed,
    enumerated set. Never derived from an exception's own text (`NN-20`,
    `NN-34`)."""

    CONNECTION_NOT_FOUND = "connection_not_found"
    DATA_KEY_MISSING = "data_key_missing"
    VENDOR_AUTH_FAILED = "vendor_auth_failed"
    VENDOR_RATE_LIMITED = "vendor_rate_limited"
    VENDOR_UNAVAILABLE = "vendor_unavailable"
    VENDOR_PAYLOAD_UNPARSEABLE = "vendor_payload_unparseable"
    UNKNOWN = "unknown"


def _classify_by_type_and_status(exc: BaseException) -> SnapshotError | None:
    """One layer of type/status branching, factored out so
    `classify_snapshot_error` can apply it twice -- once to the exception
    itself, once to its `__cause__` -- without a second copy of the
    branch logic. Returns `None`, not `SnapshotError.UNKNOWN`, when
    nothing matches, so the caller can tell "matched nothing" apart from
    "matched the unknown branch" and decide whether to try the cause."""
    if isinstance(exc, ConnectionNotFound):
        return SnapshotError.CONNECTION_NOT_FOUND
    if isinstance(exc, ConnectionDataKeyMissing):
        return SnapshotError.DATA_KEY_MISSING
    if isinstance(exc, ValidationError):
        return SnapshotError.VENDOR_PAYLOAD_UNPARSEABLE
    if isinstance(exc, HTTPStatusError):
        status_code = exc.response.status_code
        if status_code in (401, 403):
            return SnapshotError.VENDOR_AUTH_FAILED
        if status_code == 429:
            return SnapshotError.VENDOR_RATE_LIMITED
        if 500 <= status_code <= 504:
            return SnapshotError.VENDOR_UNAVAILABLE
    return None


def classify_snapshot_error(exc: BaseException) -> SnapshotError:
    """Branches on `type(exc)` and, for an `HTTPStatusError`, on
    `exc.response.status_code` -- never on a substring of the exception's
    own message. Follows `exc.__cause__` once before giving up, so a
    `SnapshotVendorError` chained from a vendor exception classifies from
    the cause rather than collapsing to the unknown branch. Returns a
    member of `SnapshotError` in every branch, including the unrecognised
    one, so a caller always has something to store.
    """
    direct = _classify_by_type_and_status(exc)
    if direct is not None:
        return direct
    if exc.__cause__ is not None:
        chained = _classify_by_type_and_status(exc.__cause__)
        if chained is not None:
            return chained
    return SnapshotError.UNKNOWN


@dataclass(frozen=True)
class SnapshotRunRecord:
    """One snapshot run, read back."""

    id: UUID
    user_id: UUID
    slot_time: datetime
    started_at: datetime
    finished_at: datetime
    trigger: SnapshotTrigger
    status: SnapshotRunStatus
    legs_attempted: int | None
    marks_written: int | None
    gaps_by_reason: Mapping[str, int] | None
    error_code: SnapshotError | None


async def record_snapshot_run(
    session: AsyncSession,
    user_id: UUID,
    *,
    slot_time: datetime,
    started_at: datetime,
    finished_at: datetime,
    trigger: SnapshotTrigger,
    status: SnapshotRunStatus,
    legs_attempted: int | None,
    marks_written: int | None,
    gaps_by_reason: Mapping[str, int] | None,
    error_code: SnapshotError | None,
) -> None:
    """Writes exactly one `snapshot_runs` row. Does not commit -- the
    caller owns the transaction, the same convention `record_sync_run`,
    `insert_fills` and `open_audited_read` all state. No `_write_token`
    gate: the scheduled capture and any manual re-capture route through
    the same task (`worker/app.py::snapshot_user_task`), so a second
    writer into this table never comes into existence -- the identical
    reasoning `SyncRun`'s and `Event`'s own docstrings already give.

    Does not store a zero entry in `gaps_by_reason` for a reason that did
    not occur -- an absent key and a zero are different claims, and the
    second invites a reader to conclude the cause was checked and found
    absent when it may simply not apply.
    """
    await session.execute(
        insert(SnapshotRun).values(
            user_id=user_id,
            slot_time=slot_time,
            started_at=started_at,
            finished_at=finished_at,
            trigger=trigger.value,
            status=status.value,
            legs_attempted=legs_attempted,
            marks_written=marks_written,
            gaps_by_reason=(
                dict(gaps_by_reason) if gaps_by_reason is not None else None
            ),
            error_code=error_code.value if error_code is not None else None,
        )
    )


async def read_snapshot_runs(
    session: AsyncSession, user_id: UUID, *, limit: int
) -> list[SnapshotRunRecord]:
    """This user's own runs, ordered by the slot they describe -- most
    recent slot first, then most recent start time first within a slot --
    so a late run for an earlier slot sorts by the slot it describes
    rather than by when it happened to execute. RLS (not this function) is
    what makes a wrong `app.current_user_id` context return fewer rows
    than exist -- the same convention `read_fills`/`read_connection`/
    `read_sync_runs` already state."""
    rows = (
        await session.execute(
            select(SnapshotRun)
            .where(SnapshotRun.user_id == user_id)
            .order_by(SnapshotRun.slot_time.desc(), SnapshotRun.started_at.desc())
            .limit(limit)
        )
    ).scalars()
    return [
        SnapshotRunRecord(
            id=row.id,
            user_id=row.user_id,
            slot_time=row.slot_time,
            started_at=row.started_at,
            finished_at=row.finished_at,
            trigger=SnapshotTrigger(row.trigger),
            status=SnapshotRunStatus(row.status),
            legs_attempted=row.legs_attempted,
            marks_written=row.marks_written,
            gaps_by_reason=row.gaps_by_reason,
            error_code=(
                SnapshotError(row.error_code) if row.error_code is not None else None
            ),
        )
        for row in rows
    ]

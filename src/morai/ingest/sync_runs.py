"""The sync-run record: what ran, what landed, what errored (INGEST-06,
migration 0012).

`record_sync_run`/`read_sync_runs` are this table's read and write paths.
Neither commits -- the caller owns the transaction, the same convention
every write path in this codebase already states (`insert_fills`,
`insert_broker_transactions`, `identity/audit.py::open_audited_read`).

`classify_sync_error` is the part `NN-20` and `NN-34` are both about. It
branches on exception type and, where the type alone is not enough, on a
status code read off the exception object -- never on a substring of the
exception's own message. A vendor error can carry a token, a full response
body or a redirect URL, and every one of those is bearer-equivalent
(`NN-34`, the same discipline `routes_connections.py`'s own docstring
already holds itself to for the OAuth callback). Mapping every failure to
one generic code is the other failure mode and is equally forbidden
(`NN-20`) -- the five classes below are the minimum this phase defines.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from httpx import HTTPStatusError
from pydantic import ValidationError
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from morai.db.models import SyncRun
from morai.vendor.connections import ConnectionNotFound


class SyncTrigger(StrEnum):
    """How a `sync_user` run was started -- the scheduled periodic
    fan-out, or a user's own manual re-sync (`POST /schwab/sync`, task 2).
    Mirrors `vendor.connections.ConnectionHealth`'s own `StrEnum`
    precedent."""

    SCHEDULED = "scheduled"
    MANUAL = "manual"


class SyncStatus(StrEnum):
    """Whether a `sync_user` run finished cleanly or raised."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"


class SyncError(StrEnum):
    """The classified codes `classify_sync_error` returns -- a fixed,
    enumerated set. Never derived from an exception's own text (`NN-20`,
    `NN-34`)."""

    CONNECTION_NOT_FOUND = "connection_not_found"
    VENDOR_AUTH_FAILED = "vendor_auth_failed"
    VENDOR_RATE_LIMITED = "vendor_rate_limited"
    VENDOR_PAYLOAD_UNPARSEABLE = "vendor_payload_unparseable"
    UNKNOWN = "unknown"


def classify_sync_error(exc: BaseException) -> SyncError:
    """Branches on `type(exc)` and, for an `HTTPStatusError`, on
    `exc.response.status_code` -- never on `str(exc)`. Returns a member of
    `SyncError` in every branch, including the unrecognised one, so a
    caller always has something to store.
    """
    if isinstance(exc, ConnectionNotFound):
        return SyncError.CONNECTION_NOT_FOUND
    if isinstance(exc, ValidationError):
        return SyncError.VENDOR_PAYLOAD_UNPARSEABLE
    if isinstance(exc, HTTPStatusError):
        status_code = exc.response.status_code
        if status_code in (401, 403):
            return SyncError.VENDOR_AUTH_FAILED
        if status_code == 429:
            return SyncError.VENDOR_RATE_LIMITED
    return SyncError.UNKNOWN


@dataclass(frozen=True)
class SyncRunRecord:
    """One sync run, read back."""

    id: UUID
    user_id: UUID
    started_at: datetime
    finished_at: datetime
    trigger: SyncTrigger
    status: SyncStatus
    fills_landed: int | None
    broker_transactions_landed: int | None
    error_code: SyncError | None


async def record_sync_run(
    session: AsyncSession,
    user_id: UUID,
    *,
    started_at: datetime,
    finished_at: datetime,
    trigger: SyncTrigger,
    status: SyncStatus,
    fills_landed: int | None,
    broker_transactions_landed: int | None,
    error_code: SyncError | None,
) -> None:
    """Writes exactly one `sync_runs` row. Does not commit -- the caller
    owns the transaction. No `_write_token` gate: `SyncRun`'s own docstring
    records why one is unnecessary here (`06-RESEARCH.md` Open Question 3).
    """
    await session.execute(
        insert(SyncRun).values(
            user_id=user_id,
            started_at=started_at,
            finished_at=finished_at,
            trigger=trigger.value,
            status=status.value,
            fills_landed=fills_landed,
            broker_transactions_landed=broker_transactions_landed,
            error_code=error_code.value if error_code is not None else None,
        )
    )


async def read_sync_runs(
    session: AsyncSession, user_id: UUID, *, limit: int
) -> list[SyncRunRecord]:
    """This user's own runs, most recent first. RLS (not this function) is
    what makes a wrong `app.current_user_id` context return fewer rows
    than exist -- the same convention `read_fills`/`read_connection`
    already state."""
    rows = (
        await session.execute(
            select(SyncRun)
            .where(SyncRun.user_id == user_id)
            .order_by(SyncRun.started_at.desc())
            .limit(limit)
        )
    ).scalars()
    return [
        SyncRunRecord(
            id=row.id,
            user_id=row.user_id,
            started_at=row.started_at,
            finished_at=row.finished_at,
            trigger=SyncTrigger(row.trigger),
            status=SyncStatus(row.status),
            fills_landed=row.fills_landed,
            broker_transactions_landed=row.broker_transactions_landed,
            error_code=(
                SyncError(row.error_code) if row.error_code is not None else None
            ),
        )
        for row in rows
    ]

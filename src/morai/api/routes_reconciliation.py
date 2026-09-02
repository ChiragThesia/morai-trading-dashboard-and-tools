"""The reconciliation status route (Phase 9, `RECON-03`, `RECON-04`,
`API-01`, `D9-13`..`D9-15`).

Every route here declares its contract by return type annotation, never
`response_model=` (D-11), matching `api/app.py`'s and `api/routes_identity.py`'s
own convention.

**This route reads a persisted verdict and never recomputes one.**
Recomputing would decrypt every transaction in the window on every poll,
and `API-01` requires the endpoint to be cheap enough to call before
rendering anything (`D9-15`) -- `reconciliation_standing` below makes
exactly one indexed read and touches nothing from the compute path beyond
the two verdict enums.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from morai.api.models import ApiModel, DependentNumbersModel
from morai.db.session import get_db_session
from morai.identity.sessions import AuthenticatedUser, get_current_user
from morai.ingest.reconciliation_runs import (
    ReconciliationRunRecord,
    read_window_verdicts,
)
from morai.ledger.reconciliation import IndeterminateReason, ReconciliationVerdict
from morai.money.api_types import UsdField

router = APIRouter()


class ReconciliationRunSummary(ApiModel):
    """One reconciliation run, on the wire. Every money field is
    `UsdField`, never a bare `Decimal` (R-02) -- the four are optional
    because an `indeterminate` verdict publishes no numbers (`NN-16` at
    the API boundary)."""

    trading_day: date
    window_start: datetime
    window_end: datetime
    verdict: ReconciliationVerdict
    reason: IndeterminateReason | None
    realised_pnl_usd: UsdField | None
    commissions_usd: UsdField | None
    cash_delta_usd: UsdField | None
    signed_difference_usd: UsdField | None
    is_reopening: bool
    checked_at: datetime


class ReconciliationStatusResponse(DependentNumbersModel):
    """`last_run` answers "when was the ledger last checked, and what did
    that check say" -- a client polling before it renders needs to know
    whether the answer is fresh. `unresolved_run` answers "which window is
    still wrong", and is what makes `trustworthy: false` actionable
    (`RECON-03`'s own requirement that a failure name its window). In the
    common case both are null, or `unresolved_run` alone is null and the
    client renders freely."""

    last_run: ReconciliationRunSummary | None
    unresolved_run: ReconciliationRunSummary | None


def summarise_run(record: ReconciliationRunRecord) -> ReconciliationRunSummary:
    """Composed field by field from the record, never by handing an ORM
    row or a dataclass to the serialiser -- `/schwab/sync-runs`' own
    convention, which is what keeps an optional value optional on the
    wire instead of silently defaulted."""
    return ReconciliationRunSummary(
        trading_day=record.trading_day,
        window_start=record.window_start,
        window_end=record.window_end,
        verdict=record.verdict,
        reason=record.reason,
        realised_pnl_usd=record.realised_pnl_usd,
        commissions_usd=record.commissions_usd,
        cash_delta_usd=record.cash_delta_usd,
        signed_difference_usd=record.signed_difference_usd,
        is_reopening=record.is_reopening,
        checked_at=record.checked_at,
    )


@dataclass(frozen=True)
class ReconciliationStanding:
    """The caller's whole reconciliation state, computed from one read."""

    trustworthy: bool
    latest: ReconciliationRunRecord | None
    oldest_unresolved: ReconciliationRunRecord | None


async def reconciliation_standing(
    session: AsyncSession, user_id: UUID
) -> ReconciliationStanding:
    """`trustworthy` reads every window's own latest verdict, not only the
    newest row (Test 11, `09-03-SUMMARY.md`'s recorded RED). Deriving the
    signal from the single most recent run would let an older window that
    failed and was never repaired be cleared by any later window that
    passed -- a client rendering a P&L spanning that broken older window
    would then read `trustworthy: true`, exactly the failure `RECON-04`
    forbids serving plain.

    A window is *resolved* when a later run for that same `trading_day`
    returned `passed`, and outstanding otherwise (`D9-03`): a re-check is
    a new row rather than an edit, and `read_window_verdicts`' own
    one-record-per-`trading_day` result -- each window's own latest run --
    is where that superseding already happened; this function only reads
    it. `latest` is the member with the greatest `checked_at` (by
    construction the globally newest row is the newest row for its own
    window too, so `read_window_verdicts`' single query answers both "when
    was I last checked" and "is anything still wrong"). `oldest_unresolved`
    is the member with the smallest `trading_day` whose verdict is not
    `PASSED` -- the earliest outstanding failure, so a client polling twice
    gets the same answer both times (Test 13) rather than whichever row
    Postgres happened to return first. `trustworthy` is true exactly when
    `oldest_unresolved` is `None` and `latest` is not `None`: a `failed`
    window is untrustworthy for the obvious reason; an `indeterminate`
    window is untrustworthy because a check that could not be answered has
    certified nothing (`D9-08`, Test 14); no run at all is untrustworthy
    because a ledger nobody has checked is not a ledger anyone should
    render numbers from; and an *older* unresolved window is untrustworthy
    even when the newest window passed, because a later window passing
    says nothing about an earlier one that was never repaired (Test 11).

    Costs one indexed scan on
    `ix_reconciliation_runs_user_id_trading_day_checked_at`, whose order
    `read_window_verdicts`' own `DISTINCT ON` matches -- no sort node, no
    window function, no second index, no decryption. Reading each window's
    latest verdict is not more expensive than reading the newest row; it
    was only ever a different query, never a tradeoff against `API-01`'s
    "cheap enough to poll" (`D9-15`).
    """
    windows = await read_window_verdicts(session, user_id)
    latest: ReconciliationRunRecord | None = None
    oldest_unresolved: ReconciliationRunRecord | None = None
    for record in windows:
        if latest is None or record.checked_at > latest.checked_at:
            latest = record
        if record.verdict != ReconciliationVerdict.PASSED and (
            oldest_unresolved is None
            or record.trading_day < oldest_unresolved.trading_day
        ):
            oldest_unresolved = record
    trustworthy = oldest_unresolved is None and latest is not None
    return ReconciliationStanding(
        trustworthy=trustworthy, latest=latest, oldest_unresolved=oldest_unresolved
    )


async def reconciliation_trustworthy(session: AsyncSession, user_id: UUID) -> bool:
    """One-line wrapper so `routes_identity.py` needs only the flag, not
    the dataclass -- the two callers share one implementation so they
    cannot drift."""
    return (await reconciliation_standing(session, user_id)).trustworthy


@router.get("/reconciliation/status")
async def reconciliation_status(
    user: AuthenticatedUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> ReconciliationStatusResponse:
    """No path parameter and no query parameter -- there is no input
    beyond the session cookie, so no request shape here can name another
    user's row, and `reconciliation_runs`' own `user_isolation` policy is
    the filter. A future reader's instinct will be to add a `WHERE
    user_id` clause; the absence of one is the point, the same line `/me`
    already carries.
    """
    standing = await reconciliation_standing(session, user.user_id)
    return ReconciliationStatusResponse(
        trustworthy=standing.trustworthy,
        last_run=(
            summarise_run(standing.latest) if standing.latest is not None else None
        ),
        unresolved_run=(
            summarise_run(standing.oldest_unresolved)
            if standing.oldest_unresolved is not None
            else None
        ),
    )

"""The reconciliation-run record: what verdict landed, for which window,
and why, when the check could not tell (Phase 9, `D9-13`, migration 0016).

Mirrors `morai.ingest.sync_runs`'s shape near-verbatim: the same frozen
read-model dataclass, the same "does not commit -- the caller owns the
transaction" convention, the same append-only no-`UPDATE` grant reasoning.

`read_latest_run_for_trading_day` is the reopening lookup
`run_reconciliation` (`ledger/reconciliation.py`) compares a fresh result
against to decide whether a window has been restated (`D9-03`).

`read_window_verdicts` is the function that makes `D9-03` and `RECON-04`
agree. `D9-03` makes a restated window's re-check a new row rather than an
edit, so a `failed` row can be superseded by a later `passed` row for the
same `trading_day`. Taking each window's latest run and nothing else is
what "superseded" means concretely: an old failure that was re-checked and
passed is resolved, and an old failure that was never re-checked is still
outstanding. A caller asking "is anything still wrong" reads this set; a
caller asking "when was I last checked" takes the member with the greatest
`checked_at`, which is by construction in this set, because the globally
newest row is the newest row for its own window. One query answers both
questions, which is why there is one function here and not two. Uses
Postgres's `DISTINCT ON (trading_day)` with `ORDER BY trading_day,
checked_at DESC` -- `ix_reconciliation_runs_user_id_trading_day_checked_at`'s
own order, which is why this needs no window function and no second index.
Both this and `read_latest_run_for_trading_day` add `created_at DESC` as a
final tiebreaker after `checked_at DESC`: nothing in the schema stops two
rows for the same window from sharing a `checked_at` (no unique constraint
on `(user_id, trading_day)`, `D9-03`), and without a deterministic
tiebreaker which row "most recent" means would be whatever order Postgres
happens to return a tie in.

Both read functions state, as `read_sync_runs` does, that RLS and not a
`WHERE user_id` clause is what confines the result -- the explicit bind is
the second layer, the same both-belts discipline this codebase already
uses elsewhere.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from morai.db.models import ReconciliationRun
from morai.ledger.reconciliation import (
    IndeterminateReason,
    ReconciliationResult,
    ReconciliationVerdict,
)


@dataclass(frozen=True)
class ReconciliationRunRecord:
    """One reconciliation run, read back."""

    id: UUID
    user_id: UUID
    trading_day: date
    window_start: datetime
    window_end: datetime
    realised_pnl_usd: Decimal | None
    commissions_usd: Decimal | None
    cash_delta_usd: Decimal | None
    signed_difference_usd: Decimal | None
    verdict: ReconciliationVerdict
    reason: IndeterminateReason | None
    is_reopening: bool
    checked_at: datetime
    created_at: datetime


def _to_record(row: ReconciliationRun) -> ReconciliationRunRecord:
    return ReconciliationRunRecord(
        id=row.id,
        user_id=row.user_id,
        trading_day=row.trading_day,
        window_start=row.window_start,
        window_end=row.window_end,
        realised_pnl_usd=row.realised_pnl_usd,
        commissions_usd=row.commissions_usd,
        cash_delta_usd=row.cash_delta_usd,
        signed_difference_usd=row.signed_difference_usd,
        verdict=ReconciliationVerdict(row.verdict),
        reason=IndeterminateReason(row.reason) if row.reason is not None else None,
        is_reopening=row.is_reopening,
        checked_at=row.checked_at,
        created_at=row.created_at,
    )


async def record_reconciliation_run(
    session: AsyncSession,
    user_id: UUID,
    *,
    result: ReconciliationResult,
    checked_at: datetime,
    is_reopening: bool,
) -> None:
    """Writes exactly one `reconciliation_runs` row. Does not commit -- the
    caller owns the transaction, `sync_runs.py`'s own wording."""
    await session.execute(
        insert(ReconciliationRun).values(
            user_id=user_id,
            trading_day=result.trading_day,
            window_start=result.window_start,
            window_end=result.window_end,
            realised_pnl_usd=result.realised_pnl_usd,
            commissions_usd=result.commissions_usd,
            cash_delta_usd=result.cash_delta_usd,
            signed_difference_usd=result.signed_difference_usd,
            verdict=result.verdict.value,
            reason=result.reason.value if result.reason is not None else None,
            is_reopening=is_reopening,
            checked_at=checked_at,
        )
    )


async def read_latest_run_for_trading_day(
    session: AsyncSession, user_id: UUID, trading_day: date
) -> ReconciliationRunRecord | None:
    """This window's own most recent run, or `None` if it has never been
    checked -- the row `run_reconciliation` compares a fresh result against
    to decide whether a window has been restated (`D9-03`)."""
    row = (
        await session.execute(
            select(ReconciliationRun)
            .where(
                ReconciliationRun.user_id == user_id,
                ReconciliationRun.trading_day == trading_day,
            )
            .order_by(
                ReconciliationRun.checked_at.desc(), ReconciliationRun.created_at.desc()
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return _to_record(row) if row is not None else None


async def read_window_verdicts(
    session: AsyncSession, user_id: UUID
) -> tuple[ReconciliationRunRecord, ...]:
    """One record per `trading_day` -- that window's own most recent run,
    ordered by `trading_day` descending. See this module's own docstring
    for why one `DISTINCT ON` query answers both "is anything still wrong"
    and "when was I last checked"."""
    inner = (
        select(ReconciliationRun)
        .where(ReconciliationRun.user_id == user_id)
        .distinct(ReconciliationRun.trading_day)
        .order_by(
            ReconciliationRun.trading_day,
            ReconciliationRun.checked_at.desc(),
            ReconciliationRun.created_at.desc(),
        )
        .subquery()
    )
    windowed = aliased(ReconciliationRun, inner)
    rows = (
        await session.execute(select(windowed).order_by(windowed.trading_day.desc()))
    ).scalars()
    return tuple(_to_record(row) for row in rows)

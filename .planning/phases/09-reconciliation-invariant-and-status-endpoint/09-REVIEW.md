---
phase: 09-reconciliation-invariant-and-status-endpoint
reviewed: 2026-09-02T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - alembic/versions/0016_reconciliation_runs.py
  - src/morai/api/app.py
  - src/morai/api/models.py
  - src/morai/api/routes_identity.py
  - src/morai/api/routes_reconciliation.py
  - src/morai/db/models.py
  - src/morai/ingest/reconciliation_runs.py
  - src/morai/ingest/schwab_sync.py
  - src/morai/ledger/reconciliation.py
  - src/morai/settings.py
  - tests/api/conftest.py
  - tests/api/test_reconciliation_status.py
  - tests/ingest/conftest.py
  - tests/ingest/test_reconciliation_schema.py
  - tests/ingest/test_sync_tracer.py
  - tests/ledger/test_reconciliation.py
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-09-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Most of what this phase set out to prove holds up under adversarial reading: the `Decimal`
equality comparison in `reconcile_window` has no epsilon, no `quantize`/`round`/`abs`, and the
four-point discrepancy sweep genuinely cannot be satisfied by a constant or a loose tolerance
(confirmed by tracing the algebra of `_balanced_fixture()` by hand, not just trusting the
assertions). `indeterminate` is a real third state enforced at the database layer via two CHECK
constraints, and no code path can turn a missing input into a fabricated `passed`. The corrected
`trustworthy` semantics (per-window latest verdict via `DISTINCT ON`, not merely the newest row)
are actually shipped, and `reconciliation_standing` really does make exactly one `await` (verified
both by reading the function and by the AST-based test that guards it). `sync_user` really does
call `run_reconciliation` on the production path — proven through the deferred/drained-worker test,
not a direct call — closing the CR-01 seam Phase 7 missed. `basedpyright strict`, `mypy --strict`,
and `ruff` all pass clean on the four `src/` files in scope, and the full phase 9 test file set
(72 tests) passes locally.

One correctness gap survived this pass, serious enough to be a **BLOCKER**: a trading day whose
only ledger activity is an `Event` (most importantly a `SETTLEMENT`/expiry) with **zero same-day
broker-cash transactions of any kind** is never selected for reconciliation at all — not
`indeterminate`, not deferred, permanently skipped — because `closed_trading_days` derives its
observed-day set exclusively from `broker_cash`, never from `events`. This directly undercuts the
phase's own stated purpose ("checked every ingest cycle") for exactly the class of day most likely
to have no accompanying broker transaction: an option expiring worthless with no exercise/
assignment record. Two smaller test-coverage gaps are recorded as warnings.

## Critical Issues

### CR-01: A trading day with only ledger events and no broker-cash activity is never reconciled — silently, not as `indeterminate`

**File:** `src/morai/ledger/reconciliation.py:172-187` (`closed_trading_days`), consumed at
`src/morai/ledger/reconciliation.py:546` inside `run_reconciliation`

**Issue:** `closed_trading_days` builds its set of candidate windows entirely from
`broker_cash`'s own observed transaction dates:

```python
def closed_trading_days(broker_cash: Sequence[BrokerCashRecord]) -> tuple[date, ...]:
    days = {trading_day_for(record.transaction_time) for record in broker_cash}
    if not days:
        return ()
    newest = max(days)
    return tuple(sorted(day for day in days if day < newest))
```

`run_reconciliation` then only ever calls `reconcile_window` for a `trading_day` that appears in
this set:

```python
for trading_day in closed_trading_days(broker_cash):
    result = reconcile_window(events, broker_cash, trading_day=trading_day)
    ...
```

`events` (the ledger's own OPEN/CLOSE/ROLL/SETTLEMENT stream) never contributes a single date to
the observed-day set. A trading day whose only activity is an `Event` — the leading example being
a `SETTLEMENT` on an option's expiry — is therefore only ever examined if some *unrelated* broker
transaction happens to post on that exact same calendar date. If it doesn't (an OTM expiration that
Schwab logs with no `RECEIVE_AND_DELIVER`/`TRADE` line, since nothing was exercised or assigned),
that window is not `indeterminate` and not deferred — it is never constructed, never compared,
never written, and never surfaces on `/reconciliation/status` at all. This is a distinct failure
mode from the deliberate, documented `D9-11` "SETTLEMENT_UNPRICED" case (which fires correctly
*once a window is actually examined*, per `test_indeterminate_on_an_unpriced_settlement` — but that
test calls `reconcile_window` directly, bypassing `closed_trading_days` entirely, so it cannot
observe this gap).

Confirmed directly against the shipped pure function (no mocking):

```
>>> broker_cash = [ trade on 2026-06-16, trade on 2026-06-30 ]   # June 18 has no broker_cash entry
>>> closed_trading_days(broker_cash)
(datetime.date(2026, 6, 16),)
>>> date(2026, 6, 18) in closed_trading_days(broker_cash)
False
```

June 18 never closes — even though June 30's activity is chronologically later — because
`closed_trading_days` has no visibility into the fact that June 18 has ledger events that need
checking. The core value this phase exists to enforce ("the sum of realised P&L over any window
must equal the broker's cash delta ... checked every ingest cycle") silently does not run for this
category of day, forever, unless a coincidental broker transaction later lands on that same date.

**Fix:** Union the observed-day set from both sources — a day closes when a *later* day has
activity from either `broker_cash` or `events`:

```python
def closed_trading_days(
    events: Sequence[EventRecord], broker_cash: Sequence[BrokerCashRecord]
) -> tuple[date, ...]:
    days = {trading_day_for(r.transaction_time) for r in broker_cash} | {
        trading_day_for(e.event_time) for e in events
    }
    if not days:
        return ()
    newest = max(days)
    return tuple(sorted(day for day in days if day < newest))
```

and update `run_reconciliation`'s call site to pass `events` through. This makes a
`SETTLEMENT`-only day reach `reconcile_window`, which already handles it correctly
(`SETTLEMENT_UNPRICED`, per `D9-11`) — the fix is entirely in candidate selection, not in the
comparison logic itself. Update `closed_trading_days`'s own docstring and
`tests/ledger/test_reconciliation.py`'s Task 3 cases accordingly (they currently only exercise
`broker_cash`-only inputs).

## Warnings

### WR-01: Two of migration 0016's six documented CHECK constraints have no test proving they're enforced

**File:** `tests/ingest/test_reconciliation_schema.py`

**Issue:** The migration's own docstring states "Six constraints, each implementing one decision,"
and the module docstring of `test_reconciliation_schema.py` frames itself as the thing that
"would have caught" a shape like Phase 6's superuser-bypass bug "before it shipped." Four of the
six are directly proven via a seeded `IntegrityError` and an assertion on the constraint's own name
(`reconciliation_runs_reason_iff_indeterminate_check`, `reconciliation_runs_amounts_present_check`,
`reconciliation_runs_passed_iff_zero_check`, `reconciliation_runs_verdict_check`). Two are not
exercised at all:

- `reconciliation_runs_reason_check` (restricts `reason` to the five `IndeterminateReason` values)
  — no test inserts a `reason` outside that set.
- `reconciliation_runs_window_order_check` (`window_end > window_start`) — no test inserts a row
  with `window_end <= window_start`.

Both constraints exist in `alembic/versions/0016_reconciliation_runs.py` and could regress (e.g. a
future migration editing the wrong `CHECK` list, or a hand-edit of the SQL string) with the full
gate staying green.

**Fix:** Add the two missing cases, following the existing pattern exactly:

```python
async def test_an_unrecognised_reason_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_END,
                realised_pnl_usd=None,
                commissions_usd=None,
                cash_delta_usd=None,
                signed_difference_usd=None,
                verdict="indeterminate",
                reason="not_a_real_reason",
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_reason_check" in str(exc_info.value)
    await superuser_db_session.rollback()


async def test_window_end_at_or_before_start_is_rejected(
    clean_reconciliation_tables: None,
    superuser_db_session: AsyncSession,
    provisioned_users: SeededUsers,
) -> None:
    with pytest.raises(IntegrityError) as exc_info:
        await superuser_db_session.execute(
            insert(ReconciliationRun).values(
                user_id=provisioned_users.user_a,
                trading_day=_TRADING_DAY,
                window_start=_WINDOW_START,
                window_end=_WINDOW_START,  # not strictly greater
                realised_pnl_usd=Decimal("10.0000"),
                commissions_usd=Decimal("1.0000"),
                cash_delta_usd=Decimal("9.0000"),
                signed_difference_usd=Decimal("0.0000"),
                verdict="passed",
                reason=None,
                is_reopening=False,
                checked_at=_CHECKED_AT,
            )
        )
    assert "reconciliation_runs_window_order_check" in str(exc_info.value)
    await superuser_db_session.rollback()
```

### WR-02: `read_latest_run_for_trading_day` has no tiebreaker on `checked_at`

**File:** `src/morai/ingest/reconciliation_runs.py:119-136`

**Issue:**

```python
.order_by(ReconciliationRun.checked_at.desc())
.limit(1)
```

If two rows for the same `(user_id, trading_day)` ever share an identical `checked_at` (not
observed in the current call sites, since `sync_user` threads one `now` per cycle and
`run_reconciliation` only ever writes one row per `trading_day` per call — but nothing in the
type or schema layer prevents a future caller from doing so, and the table carries no unique
constraint on `(user_id, trading_day)` by design per `D9-03`), which row `is_reopening` compares
against next cycle is whatever Postgres happens to return first for the tie — not a crash, but a
silent nondeterminism in a function whose whole job is a stable "did this window change" answer.
`read_window_verdicts`' `DISTINCT ON (trading_day) ... ORDER BY trading_day, checked_at DESC` has
the identical latent tie-break gap for the same reason.

**Fix:** Add `id` (or `created_at`) as a secondary sort key to make the "most recent" row
deterministic even under a `checked_at` collision:

```python
.order_by(ReconciliationRun.checked_at.desc(), ReconciliationRun.created_at.desc())
```

and the equivalent addition to `read_window_verdicts`' `ORDER BY`. Low likelihood given current
call sites, but cheap to close and matches the "a gap is honest, never a guess" discipline the rest
of this module already holds itself to.

---

_Reviewed: 2026-09-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

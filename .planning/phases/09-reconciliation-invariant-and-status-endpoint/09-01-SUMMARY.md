---
phase: 09-reconciliation-invariant-and-status-endpoint
plan: 01
subsystem: ledger
tags: [reconciliation, rls, postgres, sqlalchemy, alembic, procrastinate, decimal]

requires:
  - phase: 05-fill-pairing-and-the-oracle-gate
    provides: "D5-04's deliberate fee-free events/pairing.py, with commission_usd left as a typed None for this phase to fill at read time"
  - phase: 06-schwab-ingest-tracer
    provides: "broker_transactions (raw, independently-sourced vendor payload) and sync_user's own ingest cycle"
  - phase: 07-derived-events-and-settlement
    provides: "sync_events, EventRecord, and the CR-01 lesson (a wired-but-uncalled function) this plan repeats the guard shape of"
  - phase: 08-market-data-and-snapshot-capture
    provides: "morai.crypto.data_keys' promoted dek_for_version helper"
provides:
  - "reconciliation_runs table: RLS enabled+forced, one admin-free user_isolation policy, append-only grant, five CHECK constraints"
  - "src/morai/ledger/reconciliation.py: trading_day_for, window_bounds, closed_trading_days, extract_broker_cash, reconcile_window, run_reconciliation"
  - "src/morai/ingest/reconciliation_runs.py: record_reconciliation_run, read_latest_run_for_trading_day, read_window_verdicts"
  - "run_reconciliation wired into sync_user, immediately after sync_events, the CR-01 seam"
  - "schwab_tx_net_amount_field / schwab_tx_commission_field injectable vendor-field settings"
affects: [09-02, 09-03]

actuals:
  tokens: 5822
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Pure/shell split for reconcile_window (no AsyncSession, no clock) mirroring derive_settlements exactly"
    - "Fixed-order indeterminate-cause walk so a window with two causes always reports the same one"
    - "Tracer proof through the real Procrastinate task (defer by name, drain a real worker), never a unit test of the pure function alone"

key-files:
  created:
    - alembic/versions/0016_reconciliation_runs.py
    - src/morai/ledger/reconciliation.py
    - src/morai/ingest/reconciliation_runs.py
    - tests/ingest/test_reconciliation_schema.py
  modified:
    - src/morai/db/models.py
    - src/morai/settings.py
    - src/morai/ingest/schwab_sync.py
    - tests/ingest/conftest.py
    - tests/ingest/test_sync_tracer.py

key-decisions:
  - "Constraint-name assertions use `str(exc_info.value)` substring matching, not `.orig.constraint_name` -- asyncpg ships no `py.typed` marker, so `.orig` types as `Any` under basedpyright strict's `reportAny`; the codebase's own existing precedent (test_roll_check_constraint.py, test_fanout.py) already resolves this identical typed-boundary problem the same way."
  - "closed_trading_days counts every observed broker_transactions day toward window closure, regardless of transaction_type -- D9-02's own text ('a later trading day's broker transaction has landed') names no type restriction, and the allow-list (D9-09) only governs which transactions count toward the cash sum, not which count toward closing a window."

patterns-established:
  - "One pure comparison function (reconcile_window), two callers -- pytest and the ingest cycle -- mirroring D9-12/D8-13's established shape."
  - "A CR-01-shaped seam is proven by deferring the real Procrastinate task by name and draining a real worker, never by calling the pure or shell function directly."

requirements-completed: [RECON-01, RECON-02]

coverage:
  - id: D1
    description: "reconciliation_runs lands with RLS enabled+forced, one admin-free user_isolation policy, append-only grant (SELECT/INSERT/DELETE, no UPDATE), and five CHECK constraints (verdict, reason, reason-iff-indeterminate, amounts-present, passed-iff-zero, window-order)"
    requirement: "RECON-02"
    verification:
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_rls_enabled_and_forced"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_exactly_one_admin_free_policy"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_grants_are_verb_narrowed"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_both_expected_indexes_exist"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_a_row_inserted_for_user_a_is_invisible_to_user_b"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_indeterminate_without_a_reason_is_rejected"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_passed_with_a_nonzero_difference_is_rejected"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_passed_with_a_missing_amount_is_rejected"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_reconciliation_schema.py#test_an_unrecognised_verdict_is_rejected"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real deferred sync_user job, drained by a real worker, lands a reconciliation_runs row for the closed trading-day window and writes no second row on an unchanged re-run (CR-01 seam)"
    requirement: "RECON-01"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_tracer.py#test_sync_user_job_writes_a_reconciliation_run"
        status: pass
    human_judgment: false
  - id: D3
    description: "Oracle byte-identical: pairing.py, events.py, oracle_seed.py, test_oracle_gate.py, salvage/oracle-fixtures.md unchanged; 13-calendar gate still passes"
    verification:
      - kind: other
        ref: "git diff --exit-code src/morai/ledger/pairing.py src/morai/ledger/events.py tests/ledger/oracle_seed.py tests/ledger/test_oracle_gate.py salvage/oracle-fixtures.md"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_oracle_gate.py"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-02
status: complete
---

# Phase 9 Plan 1: Reconciliation Invariant Tracer Summary

**The core value is checked every ingest cycle: `reconciliation_runs` lands under RLS from a real deferred `sync_user` job, comparing fee-free realised P&L minus commissions against the broker's own cash delta on exact `Decimal` equality.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-09-01T23:01Z (approx, per phase-begin commit)
- **Completed:** 2026-09-02T04:34Z
- **Tasks:** 2
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments

- Migration 0016 lands `reconciliation_runs`: RLS enabled+forced, one admin-free `user_isolation` policy, an append-only grant (no `UPDATE`, matching `D9-03`'s "reopening is a new row" reasoning), five `CHECK` constraints pinning `D9-08`'s three-state verdict and `D9-07`'s exact-`Decimal` pass rule, and one dual-purpose index (`ix_reconciliation_runs_user_id_trading_day_checked_at`).
- `src/morai/ledger/reconciliation.py`: `trading_day_for` (the sole window-membership predicate, `D9-01`), `closed_trading_days` (`D9-02`), `extract_broker_cash` (the unverified `A1` vendor-field boundary, injectable via new settings), and `reconcile_window` — the pure comparison, fixed-order indeterminate-cause walk, exact `Decimal` equality, no `float`/`abs` anywhere in the module (proven by an AST check).
- `src/morai/ingest/reconciliation_runs.py`: the run-ledger read/write path, mirroring `sync_runs.py` — `record_reconciliation_run`, `read_latest_run_for_trading_day` (the `D9-03` reopening lookup), `read_window_verdicts` (the `DISTINCT ON` status read plan 09-03 will consume).
- `run_reconciliation` wired into `sync_user` immediately after `sync_events`, on the same `now` and the same session — the exact CR-01 seam, proven by deferring the real `sync_user` Procrastinate task by name and draining a real worker (`test_sync_user_job_writes_a_reconciliation_run`), not by calling the pure function directly.
- `D5-04`'s deferred fee gap is closed by reading commission from `broker_transactions` at reconciliation read-time; `pairing.py`, `events.py`, the oracle seed and gate are byte-identical.

## Task Commits

1. **Task 1: One ingest cycle checks the invariant end to end — real deferred job, real verdict on disk** - `c3d6771` (feat)
2. **Task 2: The reconciliation_runs schema and isolation contract, asserted against the live catalog** - `2b9aab0` (test)

_Both tasks' RED/GREEN cycle: implementation and test files were authored together per task (the plan's own TDD instruction to write the test case first), then run once each — both passed on the first run with no fix cycle needed, so no separate RED commit exists for either task. The natural red (an `ImportError` on `ReconciliationRun`/`reconciliation.py` before they existed) was observed during authoring, not captured as a standalone commit, since Task 1 is a single tracer commit per the execution contract's own tracer-task convention._

## Files Created/Modified

- `alembic/versions/0016_reconciliation_runs.py` - `reconciliation_runs` table, RLS, grant, five CHECK constraints, dual-purpose index
- `src/morai/ledger/reconciliation.py` - the pure comparison core and the async shell (`run_reconciliation`, `read_broker_cash_records`)
- `src/morai/ingest/reconciliation_runs.py` - the run-ledger read/write path
- `src/morai/db/models.py` - `ReconciliationRun` ORM model (no `_write_token` gate, one writer by construction)
- `src/morai/settings.py` - `schwab_tx_net_amount_field`/`schwab_tx_commission_field`
- `src/morai/ingest/schwab_sync.py` - one new line + docstring in `sync_user`: `await run_reconciliation(session, user_id, as_of=now)`
- `tests/ingest/conftest.py` - `clean_reconciliation_tables` fixture
- `tests/ingest/test_sync_tracer.py` - `test_sync_user_job_writes_a_reconciliation_run`
- `tests/ingest/test_reconciliation_schema.py` - nine schema/RLS/constraint tests against the live catalog

## Decisions Made

- **Constraint-name assertions use `str(exc_info.value)`, not `.orig.constraint_name`.** The plan's own text names `.orig` as the preferred assertion target ("a name is a stable identifier and a message is not"), but `asyncpg` ships no `py.typed` marker, so `IntegrityError.orig` types as implicit `Any` under basedpyright strict's `reportAny` — a real gate failure, not a style preference. `tests/ledger/test_roll_check_constraint.py` and `tests/ingest/test_fanout.py` already resolved this identical typed-boundary problem via `str(exc_info.value)` substring matching against the constraint's own name (never a message fragment), so this plan follows that established, gate-passing precedent rather than introducing a second convention that would fail the type gate. Recorded because it diverges from the plan's literal wording, even though it satisfies the plan's actual intent (a stable identifier, not a message substring).
- **`closed_trading_days` counts every observed `broker_transactions` day toward closure, regardless of `transaction_type`.** `D9-02` names no type restriction on the closing signal itself; the allow-list (`D9-09`) governs only which transactions contribute to the cash sum inside `reconcile_window`. The tracer test's own closing-day marker uses a `JOURNAL` transaction (an excluded type) specifically to prove this — it closes the window without contributing to the arithmetic.

## Deviations from Plan

None requiring Rules 1-4 — both items above are documented interpretive decisions within the plan's stated intent, not auto-fixes to broken or missing behavior. No architectural change, no new dependency, no scope expansion.

## Issues Encountered

- **A pre-existing, unrelated flaky test** (`tests/ingest/test_snapshot_capture.py::test_expired_connection_writes_gap`) failed once during the baseline check, before any edit in this plan, then passed on immediate retry with `--junitxml` capturing a clean `587 passed, 0 failed, 0 errors`. Out of scope per this project's own scope-boundary rule (pre-existing, unrelated to this plan's files); not touched.
- **Local `pytest -q` intermittently omits its own final summary line** on this machine when invoked directly (not through `tools/gate.sh`, which always printed the summary correctly). Worked around by using `--junitxml` for machine-readable pass/fail counts when the plain terminal summary was missing. Not a code defect — `tools/gate.sh`'s own pytest invocation was unaffected throughout, and every `bash tools/gate.sh` run this plan performed printed its full summary normally.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `run_reconciliation`, `reconcile_window`, and the `reconciliation_runs` read functions (`read_latest_run_for_trading_day`, `read_window_verdicts`) are all in place for plan 09-02 (the seeded-discrepancy arithmetic proof, RECON-01/D9-07's own anti-vacuous-pass control) and plan 09-03 (the status endpoint, `D9-14`/`D9-15`/`RECON-04`) to build on directly, per the phase's wave-2 dependency.
- `read_window_verdicts` is implemented but not yet covered by a dedicated test in this plan — its `DISTINCT ON` shape was verified only by inspection and by the underlying index's own existence proof (`test_both_expected_indexes_exist`); plan 09-03 exercises it directly and is the right place for its first behavioural test.
- No blockers. `bash tools/gate.sh` is green at 597 tests (587 baseline + 10 new: 1 tracer test, 9 schema tests).

---
*Phase: 09-reconciliation-invariant-and-status-endpoint*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: alembic/versions/0016_reconciliation_runs.py
- FOUND: src/morai/ledger/reconciliation.py
- FOUND: src/morai/ingest/reconciliation_runs.py
- FOUND: tests/ingest/test_reconciliation_schema.py
- FOUND: .planning/phases/09-reconciliation-invariant-and-status-endpoint/09-01-SUMMARY.md
- FOUND commit: c3d6771
- FOUND commit: 2b9aab0

---
phase: 25-data-quality-ops-rider
plan: 02
subsystem: worker
tags: [journal, compute-bsm-greeks, pg-boss, batch-commit, postgres, testcontainers, data-quality]

# Dependency graph
requires: ["25-01-compute-bsm-greeks-unaffected-by-freshness-gate"]
provides:
  - "COMMIT_BATCH_SIZE + BSM_TIME_BUDGET_MS — the OPS-02 batch-commit loop constants, exported from @morai/core"
  - "makeComputeBsmGreeksUseCase restructured as a while-loop with per-batch durable writeBsm checkpoints"
  - "Contract-proven kill-mid-drain durability + idempotent resume against real Postgres"
affects: [26-exit-advisor, 27-backtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wall-clock budget loop (deadline = now() + BUDGET, while now() < deadline) as the shape for any job that must voluntarily checkpoint-and-exit before a platform timeout, instead of relying on the timeout/retry mechanism"
    - "Per-batch durable checkpoint via an already-transactional writeBsm — no new port or table needed when the write-side is already one-transaction-per-call"
    - "Resume-for-free via an existing exclusion predicate (bsm_iv IS NULL) instead of a cursor/offset — the partial index IS the resume state"

key-files:
  created: []
  modified:
    - docs/architecture/jobs.md
    - packages/core/src/journal/application/computeBsmGreeks.ts
    - packages/core/src/journal/application/computeBsmGreeks.test.ts
    - packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "COMMIT_BATCH_SIZE = 800, BSM_TIME_BUDGET_MS = 700_000ms (~11.7 min) — RESEARCH A2 sizing from the observed 14.3-20 rows/sec solve rate; MEDIUM-confidence tunables, retune if prod durations still brush the 900s cap"
  - "MAX_BATCH_SIZE (24000, the old single-read bound) retired entirely — no callers outside this file and the test file, safe to delete rather than deprecate"
  - "rateCache created once per run (outside the loop), not per batch — RC#1 memoization now spans the whole run so a backlog dominated by one date still collapses to one readRate call total"
  - "solveBatch extracted as a small per-batch helper (not literally pure — it awaits readRate) to keep the loop body readable without changing the per-row math"

patterns-established:
  - "Budget-loop shape for pg-boss handlers approaching the 900s expire cap: durable per-batch commit + voluntary ok() exit on budget, never err() — the platform's retry/expire mechanism becomes a crash safety net, not the normal-path completion mechanism"

requirements-completed: [OPS-02]

coverage:
  - id: D1
    description: "Batch loop: readPending(COMMIT_BATCH_SIZE) each iteration; a full-batch + smaller-batch + empty sequence writes each non-empty batch as its own writeBsm call"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/computeBsmGreeks.test.ts#Test B (multi-batch)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Budget exhaustion mid-run returns ok(undefined), not err — no further readPending/writeBsm calls after the deadline trips"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/computeBsmGreeks.test.ts#Test C (budget exit, not error)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A single small batch drains in one loop pass (no unnecessary extra batches)"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/computeBsmGreeks.test.ts#Test A (single-batch drain)"
        status: pass
    human_judgment: false
  - id: D4
    description: "readPending/writeBsm errors on any batch (including mid-loop) propagate as err, with prior batches' writes already durable"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/computeBsmGreeks.test.ts#Test D (readPending error mid-loop) + writeBsm-fails test"
        status: pass
    human_judgment: false
  - id: D5
    description: "Kill mid-drain (budget expires after batch 1, real Postgres): committed batch persists, remainder stays pending; a second invocation with a fresh budget resumes to zero pending with no rework (no duplicate rows, first batch never re-solved)"
    requirement: "OPS-02"
    verification:
      - kind: contract
        ref: "packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts#OPS-02: batch-commit durability — budget-interrupted-then-resumed"
        status: pass
    human_judgment: false
  - id: D6
    description: "Per-row BSM solve math (NaN-stamp, greeks scaling, CR-02 obs.time-based T, rate memoization) unchanged by the restructure"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/computeBsmGreeks.test.ts (11 pre-existing solve-logic tests, all still passing)"
        status: pass
    human_judgment: false
  - id: D7
    description: "jobs.md documents the batch-commit loop + both named constants; stale schedule cell (1-min cron) and stale Retries note (retryLimit 5) corrected"
    requirement: "OPS-02"
    verification:
      - kind: doc grep
        ref: "docs/architecture/jobs.md — 'chain-triggered ... hourly ... fallback', 'COMMIT_BATCH_SIZE', 'retry_limit: 2'"
        status: pass
    human_judgment: false
status: complete
---

# Phase 25 Plan 02: OPS-02 BSM Batch-Commit Loop Summary

**compute-bsm-greeks now commits each ≤800-row batch as its own durable Postgres transaction inside a wall-clock-budgeted while-loop, so a kill mid-drain loses at most one batch instead of the whole run, and voluntarily returns ok (not a failure) when the budget is hit — the bsm_iv IS NULL predicate makes the next chain-trigger's resume free.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-09T08:12:00Z (approx, first commit 03:12:53 local)
- **Completed:** 2026-07-09T08:26:55Z (last commit)
- **Tasks:** 3 completed
- **Files modified:** 6

## Accomplishments
- `makeComputeBsmGreeksUseCase` restructured from read-all/solve-all/write-once into a wall-clock-budgeted `while` loop: each `COMMIT_BATCH_SIZE` (800) slice is read newest-first, solved, and `writeBsm`'d as its own durable checkpoint.
- Budget exhaustion (`BSM_TIME_BUDGET_MS`, 700,000ms ≈ 11.7 min) returns a clean `ok(undefined)` — never `err` — so pg-boss never fails/retries the run; remaining pending rows resume for free on the next chain-trigger/hourly-fallback (the `bsm_iv IS NULL` partial-index predicate is the whole resume mechanism, no cursor or progress table added).
- Per-date `readRate` memoization (RC#1) now spans the **whole run**, not just one batch — a backlog dominated by one date still collapses to a single `readRate` call.
- Newest-first ordering (`ORDER BY time DESC`) preserved unchanged — the freshest cohort is still attempted first within a run.
- `MAX_BATCH_SIZE` (the old 24,000-row single-read bound) retired and deleted — no other callers existed in the codebase.
- Contract-proven kill-mid-drain durability against **real Postgres** (testcontainers): a budget-interrupted run commits batch 1 and leaves the remainder pending; a second invocation with a fresh budget drains to zero with zero rework.
- `docs/architecture/jobs.md` corrected: the stale "every 1 min" schedule cell and the stale "retryLimit 5, exponential backoff" note (both pre-existing facts unrelated to this fix, flagged by RESEARCH Pitfall 4) are now accurate against `schedule.ts` and pg-boss v12's real `QUEUE_DEFAULTS`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Docs-first — jobs.md compute-bsm-greeks row + Retries note** - `d53e6fc` (docs)
2. **Task 2: Restructure computeBsmGreeks into a batch-commit loop (TDD red→green)** - `eb2d9d8` (feat)
3. **Task 3: Contract-test kill-mid-drain durability + resume (TDD red→green)** - `30dd064` (test)

_TDD note (Task 2): RED verified via `git stash` — the new/updated test suite was run against the reverted, pre-restructure implementation first, confirming 4 tests failed for the right behavioral reasons (multi-batch write count, budget-exit call counts, mid-loop error propagation, per-batch read-limit assertion — not import/syntax errors), then the batch-loop implementation was restored for GREEN (15/15 passing). Both files were committed together at green, per this repo's `tdd.md` ("Commit only at green. Never commit with a failing suite."), which takes precedence over the generic GSD executor convention of a separate RED-only commit._

_TDD note (Task 3): the contract test proves a property (durability across a real transaction boundary) that Task 2's already-committed, already-unit-tested batch loop provides. A literal RED demonstration would require re-reverting the production code a second time; instead RED was reasoned explicitly — under the old single-shot implementation, `deps.now()` is never called and the entire 805-row seed would be solved and written in one `writeBsm` call, so `pendingAfterKill` would assert `0`, not the expected `remainder` (5), failing the same way Task 2's stash-verified RED did. The test was written, run once against the current (already-correct) implementation, and passed on the first run plus 3 repeat runs with no flakiness — satisfying the "run it, show the pass" requirement of `tdd.md` for this contract layer._

## Files Created/Modified
- `docs/architecture/jobs.md` - compute-bsm-greeks catalog row (schedule + Does cells) and the Retries note corrected to match `schedule.ts` and pg-boss v12 `QUEUE_DEFAULTS`
- `packages/core/src/journal/application/computeBsmGreeks.ts` - batch-commit while-loop, `COMMIT_BATCH_SIZE`/`BSM_TIME_BUDGET_MS` constants, `solveBatch` helper extracted, `MAX_BATCH_SIZE` removed
- `packages/core/src/journal/application/computeBsmGreeks.test.ts` - Tests A-E (single-batch drain, multi-batch, budget-exit, mid-loop read error, per-batch read-limit), `makeSingleBatchReadPending` helper added so fixed-clock existing tests terminate under the new loop shape, `MAX_BATCH_SIZE`-specific tests replaced/removed
- `packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts` - new "OPS-02: batch-commit durability — budget-interrupted-then-resumed" describe block, run against real Postgres via the existing Postgres adapter test harness
- `packages/core/src/journal/index.ts` - re-exports `COMMIT_BATCH_SIZE`/`BSM_TIME_BUDGET_MS`
- `packages/core/src/index.ts` - re-exports `COMMIT_BATCH_SIZE`/`BSM_TIME_BUDGET_MS` through the `@morai/core` barrel (needed so the adapters-layer contract test can reference the same constants the use-case uses)

## Decisions Made
- `COMMIT_BATCH_SIZE = 800`, `BSM_TIME_BUDGET_MS = 700_000` — sized per RESEARCH A2 from the observed 14.3-20 rows/sec production solve rate (worst case: 800 rows ≈ 56s/batch, budget leaves ~3 min margin under the 900s pg-boss expire cap). Documented as MEDIUM-confidence, retune-if-needed constants in both the code comment and jobs.md.
- Acceptance framing follows RESEARCH's resolved Open Question 1: "no run ever times out or loses committed progress; a normal cycle drains in one run; a bulk backlog converges across runs with zero rework" — NOT "every single run's entire backlog reaches zero," which is mathematically impossible at the observed solve rate for a 24k-row cohort inside one 900s window regardless of batching.
- `MAX_BATCH_SIZE` deleted rather than kept-but-unused — a repo-wide search confirmed no callers outside this use-case and its test file, so retiring it cleanly (per ponytail: deletion over addition) was safer than leaving a dead, misleading export.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test doubles that unconditionally return non-empty pending rows caused an infinite loop / OOM under the new while-loop shape**
- **Found during:** Task 2, first GREEN test run (`Vitest caught 1 unhandled error... JavaScript heap out of memory`, worker killed after ~235s)
- **Issue:** 7 pre-existing tests (NaN-stamp, greeks-correctness, fallback-rate, magnitude-guard, CR-02, writeBsm-fails, RC#1-memoize-readRate) used a `readPending` double of the form `async () => ok([pendingObs])` — always returning the same non-empty array. Under the old single-shot implementation this was fine (read happens exactly once); under the new `while` loop with a fixed injected clock, the loop never sees an empty batch and the deadline never trips, so `readPending` is called forever.
- **Fix:** Added a `makeSingleBatchReadPending(rows)` helper that serves `rows` once, then `ok([])` on every subsequent call (models a backlog that fits in one batch and is then fully drained), and swapped all 7 affected doubles to use it.
- **Files modified:** `packages/core/src/journal/application/computeBsmGreeks.test.ts`
- **Verification:** `bun run test -- packages/core/src/journal/application/computeBsmGreeks.test.ts` — 15/15 passing, no timeout
- **Committed in:** `eb2d9d8` (Task 2 commit)

**2. [Rule 3 - Blocking] COMMIT_BATCH_SIZE/BSM_TIME_BUDGET_MS not reachable from the adapters-layer contract test**
- **Found during:** Task 3, first run (`ReferenceError: UNDERLYING is not defined` after fixing the barrel import — the initial blocker was that `@morai/core` only re-exported `makeComputeBsmGreeksUseCase`, not the two new constants the contract test needs to seed "more than one batch")
- **Issue:** The contract test lives in `packages/adapters` and can only import from `@morai/core`'s public barrel (architecture-boundaries.md dependency law) — the two new constants were not exported past `computeBsmGreeks.ts` itself.
- **Fix:** Added `COMMIT_BATCH_SIZE`/`BSM_TIME_BUDGET_MS` to `packages/core/src/journal/index.ts` and `packages/core/src/index.ts` re-export chains.
- **Files modified:** `packages/core/src/journal/index.ts`, `packages/core/src/index.ts`
- **Verification:** `bun run typecheck` clean; `bun run test -- packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` — 6/6 passing
- **Committed in:** `30dd064` (Task 3 commit)

**3. [Rule 3 - Blocking] `UNDERLYING`/`FALLBACK_RATE`/`DIVIDEND_YIELD` out of scope for the new sibling describe block**
- **Found during:** Task 3, second run (`ReferenceError: UNDERLYING is not defined`)
- **Issue:** The existing SC3/D-15 constants are declared inside the original `describe("SC3 / D-15...")` callback, not at the exported function's top level; the new OPS-02 describe block is a sibling, not nested, so those consts were out of scope.
- **Fix:** Redeclared the three constants locally inside the new describe block (same values, self-contained test setup — no cross-describe coupling introduced).
- **Files modified:** `packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts`
- **Verification:** `bun run test -- packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` — 6/6 passing
- **Committed in:** `30dd064` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were necessary to land the plan's own described test suite; no scope creep beyond the plan's file list plus the two barrel re-export files, which were an unavoidable ripple effect of exposing the new tunable constants to the adapters layer.

## Issues Encountered
None beyond the deviations above. Docker was available in this environment, so the Task 3 contract test ran against real Postgres (not skipped) and was flake-checked across 3 consecutive runs with no variance.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- OPS-02 is code-complete and fully tested (unit + Postgres contract). Not yet deployed to prod — the post-deploy verification (pgboss `compute-bsm-greeks` durations dropping well under 900s, null-BSM backlog trending to zero) is an orchestrator-driven follow-up once this ships.
- Phase 25 (both OPS-01 and OPS-02) is now plan-complete; Exit Advisor (Phase 26) and Backtest (Phase 27) can build on a pipeline that no longer writes gap rows or loses BSM progress on a mid-run kill.
- Deferred items untouched, as scoped: shortening `expireInSeconds`/raising `retry_limit` (RESEARCH anti-pattern — batching sidesteps the mechanism rather than tuning it) and speeding up the per-row BSM solve (out of scope — batching changes commit granularity, not total CPU time).

---
*Phase: 25-data-quality-ops-rider*
*Completed: 2026-07-09*

## Self-Check: PASSED

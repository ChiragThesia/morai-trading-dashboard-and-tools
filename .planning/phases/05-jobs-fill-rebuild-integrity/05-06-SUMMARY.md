---
phase: 05-jobs-fill-rebuild-integrity
plan: 06
subsystem: bsm-drain-verification
tags: [tdd, sc3, d-15, testcontainers, bsm, iv-inversion, idempotency, jrnl-01, job-03]
dependency_graph:
  requires:
    - phase: 05-02
      provides: leg_obs_pending_bsm_idx partial index (bsm_iv IS NULL AND mark IS NOT NULL)
    - phase: 05-04
      provides: compute-bsm-greeks job registered in schedule.ts
  provides:
    - SC3 drain-to-zero assertion proven by passing testcontainers contract
    - D-15 idempotent-rerun assertion proven by passing testcontainers contract
    - leg-observations.bsm-drain.contract.ts (BsmDrainContractRepo + runBsmDrainContractTests)
    - leg-observations.bsm-drain.contract.test.ts (testcontainers wiring)
  affects:
    - 05-07 (sync-fills: no dependency, but SC3 closes JOB-03 verification gap)
tech_stack:
  added: []
  patterns:
    - "BsmDrainContractRepo: seed helpers (seedPendingRow, seedComputedRow, seedNanStampedRow) + count assertions (countAllPendingBsm, countNanStampedRows, countAllRows, getBsmIv)"
    - "Realistic BSM fixture marks: ATM call SPX C 5500 needs mark≈200 for T=0.277y at ~15% vol; mark=25 produces NaN-stamp (below-intrinsic guard passes but residual check fails)"
    - "Raw SQL seeding of already-computed rows (bsm_iv IS NOT NULL) to bypass Drizzle insert path for precise fixture control"
    - "NaN-stamped rows seeded via raw SQL with 'NaN'::numeric for all five bsm_* columns"
key-files:
  created:
    - packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts
    - packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts
  modified: []
decisions:
  - "NaN-stamped rows (bsm_iv = 'NaN') are the correct K-row proxy — mark IS NOT NULL is enforced at DB level (NOT NULL constraint), so mark-NULL rows cannot exist; T-02-16 NaN-stamp exclusion is the real 'skip' mechanism"
  - "pendingOcc1 mark=200.0 (ATM call SPX C 5500, T=0.277y): BSM at sigma=0.15 gives call≈202, within range; mark=25 fails residual check (WR-01 in invertIv) → NaN-stamp; fixture must use realistic marks"
  - "T-02-16 RED/GREEN arc: RED used mark=25 (IV-inversion NaN-stamps the pending row, causing nanAfter==3 not 2); GREEN uses mark=200 (solvable IV, pending row becomes computed, NaN count stays at 2)"
metrics:
  duration: 22
  completed: "2026-06-21"
  tasks: 1
  files_created: 2
  files_modified: 0
---

# Phase 5 Plan 06: SC3 BSM Drain Verification Summary

**SC3 proven: after compute-bsm-greeks drain, zero leg_observations rows remain with bsm_iv IS NULL AND mark IS NOT NULL — verified by a 5-test testcontainers integration contract against real Postgres**

## Performance

- **Duration:** 22 min
- **Started:** 2026-06-21T22:42:00Z
- **Completed:** 2026-06-21T23:04:54Z
- **Tasks:** 1
- **Files created:** 2 (1 contract, 1 integration test)

## Accomplishments

- Created `leg-observations.bsm-drain.contract.ts` with `BsmDrainContractRepo` type and `runBsmDrainContractTests` function asserting 5 SC3/D-15 properties
- Created `leg-observations.bsm-drain.contract.test.ts` wiring the testcontainers harness to `makePostgresLegObservationsRepo` with raw-SQL seed helpers
- All 5 contract tests GREEN against real Postgres (testcontainers postgres:16):
  1. Pending-scan completeness: only bsm_iv IS NULL rows returned, not computed or NaN-stamped
  2. SC3: after drain, count(bsm_iv IS NULL AND mark IS NOT NULL) == 0
  3. Already-computed rows: bsm_iv preserved verbatim (not overwritten)
  4. T-02-16: NaN-stamped rows remain excluded from pending scan after drain
  5. D-15 idempotency: re-run produces still-zero pending + same total row count (no duplicates)
- JOB-03 / SC3 formally closed: compute-bsm-greeks drain is proven to reach zero pending rows

## TDD Gate Compliance

RED → GREEN followed for Task 1:

| Task | RED commit | GREEN commit |
|------|-----------|-------------|
| 1: SC3 + D-15 drain contract | 3e82ea6 (test) | 200a82b (feat) |

- RED: test files created with mark=25.0 fixture for ATM call; T-02-16 assertion fails (expected 2 NaN-stamped, got 3)
- GREEN: fixture corrected to mark=200.0 (realistic ATM call); all 5 tests pass

## Task Commits

1. **Task 1 RED: SC3 + D-15 drain-to-zero contract tests** - `3e82ea6` (test)
2. **Task 1 GREEN: fix T-02-16 fixture mark → all 5 SC3/D-15 tests GREEN** - `200a82b` (feat)

## Files Created

- `packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts`
  - `BsmDrainContractRepo` type: 8 methods (readPendingObs, writeBsmResults, countAllPendingBsm, countNanStampedRows, countAllRows, getBsmIv, seedPendingRow, seedComputedRow, seedNanStampedRow)
  - `runBsmDrainContractTests`: 5 describe/it assertions covering SC3, D-15, T-05-15, T-05-16
- `packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts`
  - testcontainers harness with `TRUNCATE TABLE leg_observations, contracts CASCADE` in beforeEach
  - raw-SQL seed helpers for precise bsm_iv fixture control

## Decisions Made

- **mark IS NOT NULL constraint**: `leg_observations.mark` has a `NOT NULL` DB constraint. The plan's "K mark-NULL rows that must be skipped" is physically impossible. The correct proxy is NaN-stamped rows (bsm_iv = 'NaN'::numeric) which are excluded from the partial index scan by the `bsm_iv IS NULL` predicate. (Auto-deviation: Rule 1 — test design corrected to match actual DB schema)

- **Realistic fixture marks**: BSM IV inversion fails for unrealistic marks. For ATM call (S=K=5500, T=0.277y, r=4.5%, q=1.3%), mark=25 produces NaN (WR-01 residual check in `invertIv` fails). Correct mark is ~$200 (sigma≈0.15). Test fixtures must match real option pricing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] mark-NULL rows impossible due to DB NOT NULL constraint**
- **Found during:** Task 1 (writing seedMarkNullRow helper — raw SQL insert fails with NOT NULL violation)
- **Issue:** Plan specified "K rows with mark NULL (must be skipped)" but `leg_observations.mark` has `NOT NULL` at the Postgres level. No mark-NULL rows can exist.
- **Fix:** Replaced K mark-NULL rows with K NaN-stamped rows (bsm_iv = 'NaN'::numeric). NaN-stamped rows are excluded from the partial index predicate `bsm_iv IS NULL AND mark IS NOT NULL` (because bsm_iv IS NOT NULL), which is the real "skip" mechanism tested by T-02-16.
- **Files modified:** `leg-observations.bsm-drain.contract.ts`, `leg-observations.bsm-drain.contract.test.ts`
- **Committed in:** 3e82ea6, 200a82b

**2. [Rule 1 - Bug] Unrealistic BSM fixture marks caused NaN-stamp instead of computed result**
- **Found during:** Task 1 RED run (T-02-16 test: expected 2 NaN-stamped, got 3)
- **Issue:** mark=25 for ATM call (S=K=5500, T=0.277y) is below the realistic option price; `invertIv` WR-01 residual check returns `err({ kind: 'below-intrinsic' })`, causing the pending row to be NaN-stamped during drain — contaminating the T-02-16 NaN-count assertion.
- **Fix:** Changed mark to 200.0 for pendingOcc1 (ATM call, ~15% vol gives BSM price ≈$202). All other test fixture marks (pendingOcc2 at 50.0 for OTM put, pendingOcc3 at 80.0 for OTM call) were already solvable.
- **Files modified:** `leg-observations.bsm-drain.contract.ts`
- **Committed in:** 200a82b (GREEN)

## Known Stubs

None — this plan produces a passing verification test, not production code with stubs.

## Threat Flags

No new network endpoints or auth paths introduced. The contract test exercises only internal data (leg_observations + contracts tables). T-05-15 and T-05-16 threat mitigations are now formally proven by the passing contract:

- **T-05-15** (duplicate-row injection): D-15 idempotency test confirms re-run yields same row count (no duplicates via composite PK upsert).
- **T-05-16** (silently-skipped rows): pending-scan completeness test confirms only bsm_iv IS NULL AND mark IS NOT NULL rows are returned; NaN-stamped rows are verifiably excluded, not silently lost.

## Self-Check

- [x] `packages/adapters/src/__contract__/leg-observations.bsm-drain.contract.ts` exists
- [x] `packages/adapters/src/postgres/repos/leg-observations.bsm-drain.contract.test.ts` exists
- [x] RED commit `3e82ea6` — test(05-06): failing T-02-16 assertion (4/5 tests pass, 1 fails)
- [x] GREEN commit `200a82b` — feat(05-06): all 5 SC3/D-15 contract tests pass
- [x] SC3 assertion present: `expect(pendingAfter).toBe(0)` after `computeBsmGreeks()` run
- [x] D-15 idempotency assertion present: re-run yields `pendingAfterSecond == 0` and `rowCountAfterSecond == rowCountAfterFirst`

## Self-Check: PASSED

Both files exist on disk. Both commits verified in git log. SC3 + D-15 + T-02-16 + T-05-15 + T-05-16 assertions confirmed GREEN in test output (5/5 passing, testcontainers real Postgres).

---
*Phase: 05-jobs-fill-rebuild-integrity*
*Completed: 2026-06-21*

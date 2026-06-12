---
phase: 02-market-data-bsm-engine
plan: "10"
subsystem: postgres-adapter
tags: [gap-closure, chunked-insert, parameter-limit, tdd, leg-observations, contracts, wave-1]
dependency_graph:
  requires:
    - 02-09: persistObservations + upsertContracts repo methods
    - Postgres 65,534 bind-parameter protocol limit (Postgres invariant)
  provides:
    - Chunked persistObservations (≤2,000 rows/INSERT, ≤28,000 params)
    - Chunked upsertContracts (≤2,000 rows/INSERT, ≤16,000 params)
    - Large-batch regression test in shared contract suite (3 new tests)
  affects:
    - fetch-cboe-chain job: SPX chain (≈12,556 rows) can now persist without Postgres error
    - compute-bsm-greeks job: leg_observations now has rows to process (unblocked by this fix)
    - /api/status: lastJobRuns fetch-cboe-chain will show success instead of failure
tech_stack:
  added: []
  patterns:
    - INSERT_CHUNK_ROWS = 2000 constant guards both write paths against protocol limit
    - Sequential for-loop chunking (no transaction wrapper — append-only + conflict-tolerant)
    - onConflictDoNothing applied per chunk to preserve idempotency across chunk boundaries
key_files:
  created: []
  modified:
    - packages/adapters/src/__contract__/leg-observations.contract.ts (3 new large-batch regression tests)
    - packages/adapters/src/postgres/repos/leg-observations.ts (INSERT_CHUNK_ROWS + chunked loops)
decisions:
  - "INSERT_CHUNK_ROWS = 2000: 2,000 × 14 = 28,000 params (observations); 2,000 × 8 = 16,000 params (contracts) — both < 65,534 with comfortable margin"
  - "Sequential awaits (no transaction): batch is append-only + conflict-tolerant; no atomicity requirement; avoids lock pressure on large SPX chains"
  - "onConflictDoNothing per chunk: preserves idempotency for partial re-runs and cross-chunk duplicate keys"
metrics:
  duration_minutes: 7
  completed_date: "2026-06-12"
  tasks: 2
  files_modified: 2
---

# Phase 02 Plan 10: UAT Gap A — Chunked Batch Insert Summary

**One-liner:** Fixed Postgres 65,534 bind-parameter limit by chunking persistObservations and upsertContracts at 2,000 rows per INSERT, unblocking the fetch-cboe-chain → leg_observations write path.

## What Was Built

### Task 1: RED — Large-Batch Regression Test

Added a `describe("large batch (parameter-limit regression)")` block inside `runLegObservationsContractTests` in the shared contract suite. The new block contains three tests:

1. **persists a large observation batch exceeding the single-INSERT parameter limit** — 5,000 rows × 14 cols = 70,000 params > 65,534 limit
2. **upserts a large contracts batch exceeding the parameter limit** — 8,200 rows × 8 cols = 65,600 params > 65,534 limit
3. **re-persisting the same large batch adds zero rows (chunk-boundary idempotency)**

Helper functions `makeLargeObservationRows(time, count)` and `makeLargeContractRows(count)` generate rows with unique OCC symbols (strike incremented per row) to guarantee unique composite PKs.

**RED output (failures on unchunked code):**
```
 FAIL  |packages/adapters| src/postgres/repos/leg-observations.contract.test.ts
         × persists a large observation batch exceeding the single-INSERT parameter limit 184ms
         × upserts a large contracts batch exceeding the parameter limit 207ms

 FAIL  > large batch (parameter-limit regression) > persists a large observation batch exceeding the single-INSERT parameter limit
AssertionError: expected false to be true // Object.is equality
 ❯ src/__contract__/leg-observations.contract.ts:252:27
    251|         const result = await repo.persistObservations(rows);
    252|         expect(result.ok).toBe(true);

 FAIL  > large batch (parameter-limit regression) > upserts a large contracts batch exceeding the parameter limit
AssertionError: expected false to be true // Object.is equality
 ❯ src/__contract__/leg-observations.contract.ts:260:27
    259|         const result = await repo.upsertContracts(rows);
    260|         expect(result.ok).toBe(true);

 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

The failures are the correct reason: `result.ok === false` because the unchunked single INSERT exceeded the Postgres parameter limit. The error was caught by the existing try/catch and returned as `err<StorageError>`, causing the `expect(result.ok).toBe(true)` assertion to fail.

### Task 2: GREEN — Chunked Implementation

Added `const INSERT_CHUNK_ROWS = 2000` as a module-scope constant. Both write methods now loop in slices:

- `persistObservations`: `for (let i = 0; i < values.length; i += INSERT_CHUNK_ROWS)` → `values.slice(i, i + INSERT_CHUNK_ROWS)` → `db.insert(legObservations).values(slice).onConflictDoNothing()`
- `upsertContracts`: same pattern on the `contracts` table

Parameter math:
- Observations: 2,000 × 14 = 28,000 params per INSERT ≤ 65,534 ✓
- Contracts: 2,000 × 8 = 16,000 params per INSERT ≤ 65,534 ✓
- Production SPX chain (12,556 rows): 7 chunks of ≤2,000 rows each ✓

**GREEN output:**
```
 RUN  v4.1.8 packages/adapters

[globalSetup] Postgres container started: postgres://test:test@localhost:55008/morai_test

 Test Files  1 passed (1)
      Tests  11 passed (11)
   Start at  09:26:38
   Duration  3.44s (transform 37ms, setup 0ms, import 327ms, tests 1.34s, environment 0ms)

[globalSetup] Postgres container stopped
EXIT_CODE=0
```

All 11 tests pass including the 3 new large-batch regression tests.

## Verification

- `bunx vitest run src/postgres/repos/leg-observations.contract.test.ts` — 11/11 passed
- `bun run typecheck` — clean
- `bun run lint` — clean (pre-existing boundary selector warnings are not violations)
- Manual reasoning: 2,000 × 14 = 28,000 ≤ 65,534 (observations); 2,000 × 8 = 16,000 ≤ 65,534 (contracts)

## Deviations from Plan

None — plan executed exactly as written.

The RED phase produced the exact expected failure pattern (result.ok=false due to Postgres parameter limit caught in try/catch). The GREEN implementation added only the chunking loop and constant, with no schema, port-signature, in-memory-twin, or idempotency changes.

## Known Stubs

None. All writes are wired to the real Postgres adapter.

## Threat Flags

None. This change affects only internal batch size — no new network endpoints, auth paths, or trust boundaries.

## TDD Gate Compliance

- RED gate: `test(02-10)` commit `08dd060` — large-batch regression tests added and confirmed failing
- GREEN gate: `fix(02-10)` commit `b4888a5` — chunked implementation passing all 11 tests

## Self-Check: PASSED

Files confirmed present:
- `packages/adapters/src/__contract__/leg-observations.contract.ts` — modified (3 new tests)
- `packages/adapters/src/postgres/repos/leg-observations.ts` — modified (INSERT_CHUNK_ROWS + chunked loops)

Commits confirmed in git log:
- `08dd060` — test(02-10): RED — large-batch regression for Postgres parameter limit
- `b4888a5` — fix(02-10): GREEN — chunk persistObservations + upsertContracts at ≤2,000 rows/INSERT

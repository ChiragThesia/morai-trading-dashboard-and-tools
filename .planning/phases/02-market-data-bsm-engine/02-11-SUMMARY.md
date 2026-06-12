---
phase: 02-market-data-bsm-engine
plan: 11
subsystem: adapters/postgres/job-runs
tags: [bug-fix, tdd, contracts, timestamps, uat-gap-closure]
dependency_graph:
  requires: []
  provides: [ISO-8601-Z-normalized job-run timestamps, pgboss-row contract test]
  affects: [GET /api/status, packages/adapters/src/postgres/repos/job-runs.ts]
tech_stack:
  added: [packages/contracts devDep in adapters, @morai/contracts vitest alias]
  patterns: [extractCompletedOn string normalization via new Date().toISOString()]
key_files:
  modified:
    - packages/adapters/src/postgres/repos/job-runs.ts
    - packages/adapters/src/postgres/repos/job-runs.contract.test.ts
    - packages/adapters/vitest.config.ts
    - packages/adapters/package.json
    - packages/contracts/src/index.ts
    - eslint.config.js
  created: []
decisions:
  - "Normalize extractCompletedOn string branch via new Date(value).toISOString() with Number.isNaN guard; contracts schema stays strict"
  - "Add @morai/contracts as devDep (test-only) in adapters; update ESLint boundary rule to allow contracts import in adapters (needed for contract test assertions)"
  - "Export jobRunRecord from @morai/contracts index (was missing; only statusResponse was exported)"
metrics:
  duration: 8m
  completed: 2026-06-12
  tasks_completed: 2
  tasks_total: 2
  files_changed: 6
---

# Phase 02 Plan 11: UAT Gap B — Job-Runs Timestamp Normalization Summary

`extractCompletedOn` now normalizes postgres.js Postgres-text timestamps to Z-anchored ISO-8601 before crossing the port boundary; a real pgboss.job contract test closes the prior test blind spot.

## What Was Built

### Task 1 — RED: contract test seeding a real pgboss.job row

Added a new `describe.skipIf(shouldSkip)` block ("postgres job-runs adapter — populated pgboss.job") in `job-runs.contract.test.ts` with:

- `beforeAll`: creates `pgboss` schema + `pgboss.job` table via raw SQL (testcontainers Postgres), inserts one `state='completed'` row for `fetch-cboe-chain` and one `state='failed'` row for `fetch-rates` with `output.message`.
- `afterAll`: `DROP SCHEMA IF EXISTS pgboss CASCADE` — leaves the shared container clean.
- Three new tests: schema parse, Z-anchor check, failed-row lastError.

**Red output (confirmed failure on current code):**

```
FAIL  postgres job-runs adapter — populated pgboss.job
  × readJobRuns returns records that parse against the contracts jobRunRecord schema
    AssertionError: jobRunRecord.safeParse failed for "fetch-cboe-chain":
    [{"origin":"string","code":"invalid_format","format":"datetime",
    "path":["lastSuccessAt"],"message":"Invalid ISO datetime"}]:
    expected false to be true

  × completed_on is emitted as Z-anchored ISO-8601
    AssertionError: fetch-cboe-chain: timestamp "2026-06-12 13:31:38.031+00"
    does not end with Z: expected '2026-06-12 13:31:38.031+00' to match /Z$/

Tests  2 failed | 3 passed (5)
```

Root cause confirmed: `extractCompletedOn` string branch returned the Postgres text form unchanged.

### Task 2 — GREEN: normalize `extractCompletedOn` string case

Fixed `extractCompletedOn` in `job-runs.ts`:

```typescript
// BEFORE (defect):
if (typeof value === "string") return value;

// AFTER (fix):
if (typeof value === "string") {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
```

**Green output:**

```
 Test Files  1 passed (1)
       Tests  5 passed (5)
    Duration  2.30s
```

All 5 tests pass: 3 existing Pitfall-6 tests + 2 new populated-row tests.

**Spot check:** `new Date("2026-06-12 13:31:38.031+00").toISOString()` → `"2026-06-12T13:31:38.031Z"` — Z-anchored, satisfies `z.string().datetime()`.

**Typecheck:** clean (`tsc --build --force` exits 0).

**Lint:** clean (existing pre-existing warnings about legacy boundary selector syntax only — not caused by this change).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Export `jobRunRecord` from contracts index**
- **Found during:** Task 1 — `@morai/contracts` only exported `statusResponse`; `jobRunRecord` was not in the index.
- **Fix:** Added `jobRunRecord` and `JobRunRecord` to `packages/contracts/src/index.ts`.
- **Files modified:** `packages/contracts/src/index.ts`
- **Commit:** 0806d39

**2. [Rule 2 - Missing Critical Functionality] Add `@morai/contracts` alias to adapters vitest config**
- **Found during:** Task 1 — vitest alias for `@morai/contracts` was absent; test imports would fail at runtime.
- **Fix:** Added `"@morai/contracts"` alias in `packages/adapters/vitest.config.ts` pointing to `../contracts/src/index.ts`; added `@morai/contracts: workspace:*` as devDependency in `packages/adapters/package.json`.
- **Files modified:** `vitest.config.ts`, `package.json`, `bun.lock`
- **Commit:** 0806d39

**3. [Rule 2 - Missing Critical Functionality] Allow contracts imports in adapters boundary rule**
- **Found during:** Task 1 — ESLint boundary rule allowed adapters to import only `["core", "shared", "adapters"]`; importing `@morai/contracts` in a contract test would fail lint.
- **Fix:** Updated `eslint.config.js` boundary rule to allow `"contracts"` in the adapters allowlist. This is correct: contract test files in adapters legitimately need to import the contracts schema to assert adapter output satisfies the published contract.
- **Files modified:** `eslint.config.js`
- **Commit:** 0806d39

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (`test(02-11)`) | 0806d39 | PASSED — 2 tests failed for right reason |
| GREEN (`fix(02-11)`) | 5f2d807 | PASSED — all 5 tests pass |

## Commits

| Task | Type | Hash | Description |
|------|------|------|-------------|
| Task 1 (RED) | test | 0806d39 | add failing contract test for pgboss.job timestamp normalization |
| Task 2 (GREEN) | fix | 5f2d807 | normalize job-runs timestamps to ISO-8601 Z before port boundary |

## Known Stubs

None.

## Threat Flags

None. This change is a normalization fix in an existing adapter read path. No new network endpoints, auth paths, or schema changes at trust boundaries.

## Self-Check

All files found. All commits found.

## Self-Check: PASSED

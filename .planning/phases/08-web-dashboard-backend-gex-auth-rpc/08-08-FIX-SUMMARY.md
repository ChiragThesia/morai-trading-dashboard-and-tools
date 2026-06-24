---
phase: 08-web-dashboard-backend-gex-auth-rpc
plan: 08-08-FIX
subsystem: gex-analytics
tags: [bug-fix, tdd, gex, correctness, cr-01, cr-02]
dependency_graph:
  requires: [08-03, 08-05]
  provides: [correct-netGammaAtSpot-scalar, computed-at-persistence]
  affects: [packages/core/analytics, packages/adapters/postgres/gex, packages/adapters/memory/gex]
tech_stack:
  added: []
  patterns: [tdd-red-green, testcontainers-postgres16, drizzle-migration]
key_files:
  modified:
    - packages/core/src/analytics/application/computeGexSnapshot.ts
    - packages/core/src/analytics/application/computeGexSnapshot.test.ts
    - packages/adapters/src/__contract__/gex-snapshot.contract.ts
    - packages/adapters/src/postgres/gex-snapshot.repo.ts
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json
  created:
    - packages/adapters/src/postgres/migrations/0009_gex_computed_at.sql
    - packages/adapters/src/postgres/migrations/meta/0009_snapshot.json
decisions:
  - "CR-01: netGammaAtSpot = buildProfile(legs,[spot])[0].gamma — profile-at-spot semantics, not per-strike argmin"
  - "CR-02: new migration 0009 adds computed_at column (NOT NULL timestamp with time zone) — NOT amending 0008"
  - "CR-01: deleted computeNetGammaAtSpot helper (wrong implementation, now unused)"
  - "CR-01: also removed dead _now assignment (IN-01 coincident cleanup)"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-24"
  commits: 2
  tests_added: 2
  tests_suite_before: "772 passed"
  tests_suite_after: "773 passed"
status: complete
---

# Phase 08 Plan 08-FIX: CR-01 and CR-02 Bug Fixes Summary

**One-liner:** Fixed netGammaAtSpot to use profile-at-spot semantics (buildProfile oracle) and added a real computed_at Postgres column with a new migration and full round-trip proof via testcontainers.

## What Was Fixed

### CR-01: netGammaAtSpot — Wrong Value (~8 Orders of Magnitude Off)

**Bug:** `computeGexSnapshot.ts` computed `netGammaAtSpot` via `computeNetGammaAtSpot(strikeEntries, spot)` — a function that found the single strike closest to spot and returned its per-strike concentrated GEX value. This is not the oracle-defined quantity.

**Oracle definition (gex.test.ts lines 9-11):** `netGammaAtSpot ≈ -47` — "the profile at s=7380 is -47.43". This is the sum of dollar-gamma re-priced at the current spot across ALL contracts: `buildProfile(legs, [spot])[0].gamma`.

**Why the suite was green:** The only assertion on `netGammaAtSpot` was `typeof row.netGammaAtSpot === "number"` — it never checked the value.

**Fix:**
- Replace `computeNetGammaAtSpot(strikeEntries, spot)` with `buildProfile(legs, [spot])[0]?.gamma ?? 0`
- Delete the now-unused `computeNetGammaAtSpot` helper (20 lines removed)
- Remove the dead `_now` assignment (IN-01, coincident cleanup)
- Add RED/GREEN regression test asserting value equality against `buildProfile` oracle with tight epsilon (6 decimal places) and a magnitude guard (`|netGammaAtSpot| < 1e6` rules out the per-strike billions magnitude)

**RED failure output:**
```
AssertionError: expected -1.015709477684 to be close to -5.912717999188536,
received difference is 4.897008521504536, but expected 5e-7
```
Value mismatch confirmed (not an import error).

### CR-02: computedAt Never Persisted — Silently Fabricated on Read

**Bug:** `GexSnapshotRow.computedAt` (wall-clock time the snapshot was computed) was set in the use-case via `deps.now()`, but the Postgres adapter had no `computed_at` column in the schema or migration 0008. On persist, the field was silently dropped. On read, the repo returned `computedAt: row.cycleTime` — substituting the data-cycle time for the compute time.

**Consequence:** The `computedAt` field on every dashboard response was a lie — it showed when the data snapshot was captured (30-min RTH slot), not when the GEX was actually computed. These are distinct concepts and can differ by several minutes.

**Why the suite was green:** The contract test's `makeSnapshotRow()` passed `computedAt: cycleTime` — the same value — so the substitution was invisible.

**Fix:**
1. Add `computedAt: timestamp("computed_at", { withTimezone: true }).notNull()` to `gexSnapshots` schema in `schema.ts`
2. Generate migration: `bunx drizzle-kit generate` → `0009_gex_computed_at.sql` (single `ALTER TABLE "gex_snapshots" ADD COLUMN "computed_at" timestamp with time zone NOT NULL`)
3. Rename file to `0009_gex_computed_at.sql` and update `_journal.json` tag to `0009_gex_computed_at`
4. Postgres repo `persistGexSnapshot`: add `computedAt: row.computedAt` to `.values({...})`
5. Postgres repo `readGexSnapshot`: change `computedAt: row.cycleTime` → `computedAt: row.computedAt`
6. Memory twin: already stores the full row faithfully — no change needed

**RED failure output (Postgres):**
```
AssertionError: expected 1782223200000 to be 1782223662000 // Object.is equality
- Expected: 1782223662000  (computedAt = 14:07:42Z)
+ Received: 1782223200000  (cycleTime  = 14:00:00Z)
```
Postgres repo returned cycleTime (14:00:00Z) instead of computedAt (14:07:42Z).

**Memory twin:** Passed immediately (stores full GexSnapshotRow without re-encoding).

## Commits

| Hash | Message |
|------|---------|
| b8f998a | fix(08): CR-01 netGammaAtSpot = profile-at-spot, not closest-strike GEX |
| 39aeaa4 | fix(08): CR-02 add computed_at column — computedAt round-trips faithfully |

## TDD Gate Compliance

Both fixes followed strict RED → GREEN:

**CR-01:**
- RED: Added test asserting `row.netGammaAtSpot` equals `buildProfile(FIXTURE_LEGS, [spot])[0].gamma` within epsilon 1e-6. Failed with value mismatch on current implementation.
- GREEN: Replaced with `buildProfile(legs, [spot])[0]?.gamma ?? 0`. All 8 tests pass.

**CR-02:**
- RED: Added contract test that persists a row with `computedAt` 7m42s after `cycleTime`, reads back, and asserts `found.computedAt.getTime() === computedAt.getTime()`. Memory twin passed; Postgres failed (returned cycleTime milliseconds).
- GREEN: Added `computed_at` column + updated persist/read. All 11 Postgres contract tests pass via testcontainers Postgres 16.

## Final Proof

- **Tests:** 81 test files, 773 tests — all passed (`packages/core` + `packages/adapters` full suite)
- **Typecheck:** `bun run typecheck` — clean (no errors)
- **Lint:** `bun run lint` — clean (no errors; pre-existing boundary warning unrelated to these changes)

## Deviations from Plan

None — plan executed exactly as specified. The coincident removal of the dead `_now` assignment (IN-01 from the review report) was a natural consequence of CR-01's cleanup and required no additional changes.

## Self-Check: PASSED

- [x] `packages/core/src/analytics/application/computeGexSnapshot.ts` — modified (verified: `computeNetGammaAtSpot` absent, `buildProfile(legs, [spot])` present)
- [x] `packages/adapters/src/postgres/migrations/0009_gex_computed_at.sql` — created
- [x] `packages/adapters/src/postgres/schema.ts` — `computedAt` column present in `gexSnapshots`
- [x] `packages/adapters/src/postgres/gex-snapshot.repo.ts` — `computedAt: row.computedAt` on both persist and read
- [x] Commits b8f998a and 39aeaa4 exist in git log
- [x] 773/773 tests pass, typecheck clean, lint clean

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

---

# Round 2: BLOCKER + 7 Warnings Fix (2026-06-24)

**One-liner:** Applied numeric relaxation for SPX fractional strikes (BLOCKER migration 0010), renamed profile axis strike→spot (WR-01), eliminated the dollarGamma duplicate (WR-02), made spot computation deterministic via average+ORDER BY (WR-03+IN-04), gated putWall on negative GEX (WR-05), Zod-parsed JSONB blobs at the read seam (WR-06), and exported the memory GEX twin (WR-07).

## Findings Fixed

### BLOCKER: Integer contract + integer column vs fractional strike/1000 producer

**Bug:** `gexWallEntry.k`, `callWall`, `putWall` were `z.number().int()`; `call_wall`/`put_wall` DB columns were `integer`. The producer computes `strike / 1000` — for any half-point SPX strike (e.g. 7412500 → 7412.5), this yields a fractional value. Two failure paths:
1. Write: integer column silently truncates 7412.5 to 7412
2. Read: `z.number().int()` throws, returning a 500 for an otherwise-valid snapshot

**Decision (user):** Relax to numeric — do NOT round. Fractional walls are intentionally valid.

**Fix:**
- `contracts/gex.ts`: `k`, `callWall`, `putWall` → `z.number()` (removed `.int()`); updated docstring
- `schema.ts`: `callWall`/`putWall` columns → `numeric("call_wall")` / `numeric("put_wall")`
- `gex-snapshot.repo.ts` persist: `String(row.callWall)` / `String(row.putWall)` (numeric column convention)
- `gex-snapshot.repo.ts` read: `parseFloat(row.callWall)` / `parseFloat(row.putWall)` guarding null
- Migration `0010_gex_wall_numeric.sql`: `ALTER COLUMN "call_wall" SET DATA TYPE numeric` + `put_wall`
- TDD: fractional round-trip test (callWall=7412.5, putWall=7387.5) RED→GREEN via testcontainers Postgres 16

**RED failure:** Postgres integer truncation produced callWall=7412 (not 7412.5); z.number().int() threw on contracts parse test.

### WR-01: Profile axis field renamed strike → spot

**Bug:** `buildProfile` returned `{ strike: number, gamma: number }[]` and `findFlip` consumed `{ strike, gamma }`. The axis is a simulated spot-price grid, not an option strike. This mislabels the dimension and invites future bugs.

**Fix:**
- `domain/gex.ts`: `buildProfile` returns `{ spot: number; gamma: number }[]`; `findFlip` takes `{ spot, gamma }` and returns `a.spot + t*(b.spot - a.spot)`
- `ports.ts`: `GexSnapshotRow.profile` field renamed `strike→spot`
- `contracts/gex.ts`: `profile` sub-schema updated to `{ spot: z.number(), gamma: z.number() }`
- `schema.ts`: `profile` JSONB `$type<>` annotation updated
- `computeGexSnapshot.ts`: `profile.map(p => ({ spot: p.spot, gamma: p.gamma }))`
- All test fixtures updated: `gex.test.ts` oracle profile, `gex.routes.test.ts`, `getGex.test.ts`, `gex-snapshot.contract.ts`, Postgres contract test

### WR-02: Duplicate dollarGamma formula deleted

**Bug:** `dollarGammaContrib` in `computeGexSnapshot.ts` was a byte-for-byte copy of domain `dollarGamma`. The byExpiry loop used the copy while profile/strike paths used the domain function. Two copies drift silently.

**Fix:** Deleted `dollarGammaContrib`; added `dollarGamma` to the import from `../domain/gex.ts`; byExpiry loop now calls `dollarGamma` directly.

### WR-03 + IN-04: Deterministic spot (average) + ORDER BY on leg JOIN

**Bug:** The use-case took `legs[0].underlyingPrice` as spot despite a comment saying "average". The JOIN had no `ORDER BY`, so legs[0] is whichever row Postgres returns first — non-deterministic.

**Fix:**
- `computeGexSnapshot.ts`: compute `spot = legs.reduce((sum, l) => sum + l.underlyingPrice, 0) / legs.length`
- `gex-snapshot.repo.ts`: `.orderBy(asc(contracts.strike), asc(contracts.contractType))` added to the leg JOIN query

### WR-05: putWall gated on negative GEX

**Bug:** `putWall` was a pure argmin (seeded at `+Infinity`). On a fully long-gamma chain, the argmin returned the least-positive strike and labeled it the put wall — contradicting the contract ("Strike with highest net NEGATIVE GEX"). The prior behavior was deterministic but semantically wrong.

**Fix:** `if (entry.gex < 0 && entry.gex < putWallGex)` — mirrors the callWall gate. `putWall` stays null when no strike has negative GEX.

**TDD RED:** `putWall is null when all strikes have positive GEX` — failed with `AssertionError: expected 7400 to be null` (all-call fixture, argmin returned 7400).

**TDD GREEN:** Gate applied; `putWall = null` for all-positive chains.

### WR-06: JSONB blobs Zod-parsed at the read seam

**Bug:** `profile`, `strikes`, and `byExpiry` came back from Postgres as untyped JSONB but were trusted via `$type<>` (compile-time only). A malformed or legacy JSONB row flowed into the domain unchecked. TypeScript rule mandates parse-don't-cast for every external input at an adapter boundary.

**Fix:** Added three Zod sub-schemas (`profileSchema`, `strikesSchema`, `byExpirySchema`) to `gex-snapshot.repo.ts`. The read path calls `.safeParse()` on each blob; on failure returns `err(StorageError)` with a diagnostic message. `$type<>` is kept for compile-time ergonomics.

### WR-07: Memory GEX twin exported from adapters package

**Bug:** `makeMemoryGexSnapshotRepo` was implemented in `memory/gex-snapshot.ts` but missing from `packages/adapters/src/index.ts`. architecture-boundaries §8 requires shipping the in-memory twin for every driven port. All other memory twins were exported; GEX was not.

**Fix:** Added two export lines to `adapters/index.ts`:
```ts
export { makeMemoryGexSnapshotRepo } from "./memory/gex-snapshot.ts";
export type { MemoryGexSnapshotRepo } from "./memory/gex-snapshot.ts";
```

## Round 2 Commits

| Hash | Message |
|------|---------|
| 7ccfb32 | fix(08): BLOCKER — relax callWall/putWall/k from integer to numeric |
| 06f4334 | fix(08): WR-01 — rename profile axis from strike to spot end-to-end |
| 75ee841 | fix(08): WR-02 WR-03 WR-05 IN-01 — use-case correctness fixes |
| f6ddef3 | fix(08): WR-07 — export makeMemoryGexSnapshotRepo from adapters package |

## Round 2 TDD Gate Compliance

- **BLOCKER**: fractional wall round-trip test RED (Postgres integer truncated 7412.5→7412; z.number().int() threw) → GREEN (numeric column + parseFloat)
- **WR-05**: `putWall is null when all-call chain` RED (returned 7400) → GREEN (null)
- **WR-06**: parse-don't-cast (behavior change at adapter boundary; implementation tested via existing contract suite + new BLOCKER round-trip that exercises the full read path including Zod parse)
- **WR-01/02/03/04/07**: structural/correctness fixes verified by existing passing test suite

## Round 2 Final Proof

- **Tests:** 115 test files, 1075 tests — all passed (5 new tests added: fractional wall round-trip x2, WR-05 putWall null, gexSnapshotResponse fractional parse, profile-entries-have-spot-field)
- **Typecheck:** `bun run typecheck` — clean (no errors)
- **Lint:** `bun run lint` — clean (pre-existing boundary warning unrelated)

## Round 2 Self-Check: PASSED

- [x] `packages/contracts/src/gex.ts` — `k`, `callWall`, `putWall` are `z.number()` (not `.int()`); profile uses `{ spot, gamma }`
- [x] `packages/adapters/src/postgres/schema.ts` — `callWall`/`putWall` are `numeric("call_wall")` / `numeric("put_wall")`; profile `$type` uses `spot`
- [x] `packages/adapters/src/postgres/migrations/0010_gex_wall_numeric.sql` — created with ALTER COLUMN ... SET DATA TYPE numeric for both walls
- [x] `packages/adapters/src/postgres/gex-snapshot.repo.ts` — Zod sub-schemas at read seam; parseFloat on callWall/putWall; ORDER BY on leg JOIN
- [x] `packages/core/src/analytics/domain/gex.ts` — `buildProfile` returns `{spot, gamma}`; `findFlip` takes `{spot, gamma}`
- [x] `packages/core/src/analytics/application/computeGexSnapshot.ts` — uses domain `dollarGamma` in byExpiry; average spot; putWall gated on `< 0`; no `dollarGammaContrib`
- [x] `packages/adapters/src/index.ts` — `makeMemoryGexSnapshotRepo` and `MemoryGexSnapshotRepo` exported
- [x] Commits 7ccfb32, 06f4334, 75ee841, f6ddef3 exist in git log
- [x] 1075/1075 tests pass, typecheck clean, lint clean

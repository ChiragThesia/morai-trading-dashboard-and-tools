---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 02
subsystem: journal
tags: [occ-symbol, root-resolution, postgres, drizzle, tdd, bug-fix]

# Dependency graph
requires:
  - phase: 40-01
    provides: "resolveRootCandidates(underlying) pure fn, exported via @morai/core"
provides:
  - "All four HIST-01 root-mismatch call sites (getOpenCalendarLegs pg+memory, getLiveGreeks, resolveLegSnapshot pg+memory) resolve each leg's OWN root via resolveRootCandidates"
  - "mapSnapshotRow (postgres) is source-inclusive — healed schwab_chain rows survive readJournal/LifecycleChart (Pitfall 1)"
affects: [40-03, 40-04, 40-05, 40-06, 40-07, 40-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Root-candidate resolution: build/query BOTH candidate OCC roots (stored root + sibling) instead of a single-root ternary — costless over-inclusion at write-side allowlists (Set dedup), first-hit-wins at read-side lookups (inArray / candidate-key try-loop)"
    - "Source-inclusive row mapping: never drop a persisted row by its source enum value — mirror readLatestSnapshotPerOpenCalendar's inclusive mapper instead of a `!== 'cboe' -> null` guard"

key-files:
  created: []
  modified:
    - packages/adapters/src/postgres/repos/calendars.ts
    - packages/adapters/src/memory/calendars.ts
    - packages/adapters/src/__contract__/calendars.contract.ts
    - packages/core/src/journal/application/getLiveGreeks.ts
    - packages/core/src/journal/application/getLiveGreeks.test.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts

key-decisions:
  - "getLiveGreeks NaN-gap leg reports occSymbol under the PRIMARY (calendar's stored) root — same value the old single-root code always reported — so a genuinely-absent leg (D-04 honest gap) stays recognizable under its historically-displayed symbol, not an arbitrary sibling root."
  - "SeedContext.seedContract gained an optional `root` param (default 'SPX', backward compatible) so the shared contract harness can seed a mixed-root contract row for the new resolveLegSnapshot regression case — the memory adapter's seedContract stays a no-op (memory resolves via seedObservation's parsed OCC root already)."

patterns-established:
  - "Any future OCC-root-dependent call site should reuse resolveRootCandidates (the ONE shared source, per 40-01) rather than reintroducing a date-of-week or ternary root guess."

requirements-completed: [HIST-01]

coverage:
  - id: D1
    description: "getOpenCalendarLegs (postgres + memory) returns BOTH candidate-root OCC symbols for each leg of a stored-SPX mixed-root calendar — the D-04 targeted-fetch allowlist no longer silently excludes the real SPXW-rooted back leg"
    requirement: "HIST-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendars.contract.ts#getOpenCalendarLegs > HIST-01: returns BOTH candidate-root symbols (SPX + SPXW) for each leg when underlying='SPX' (mixed-root calendar)"
        status: pass
    human_judgment: false
  - id: D2
    description: "get_live_greeks resolves an EOM/mixed-root back leg under its real sibling root when the calendar's stored root has no observation — NaN only for a genuine honest gap (D-04), never a wrong-root lookup"
    requirement: "HIST-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/getLiveGreeks.test.ts#HIST-01: resolves a mixed-root back leg under its sibling root (SPXW) when the calendar's stored root (SPX) has no observation"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveLegSnapshot (postgres + memory) finds a mixed-root calendar's back leg via inArray/candidate-key try-both lookup — the non-null result is what unblocks the (unchanged) OPS-01 freshness gate as a corollary"
    requirement: "HIST-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-snapshots.contract.ts#resolveLegSnapshot > HIST-01: resolves under the sibling root when the calendar's stored root has no matching contract (mixed-root back leg)"
        status: pass
    human_judgment: false
  - id: D4
    description: "mapSnapshotRow (postgres) no longer drops rows sourced schwab_chain — readJournal returns them, matching readLatestSnapshotPerOpenCalendar's existing inclusive mapping, so a healed non-cboe row reaches the LifecycleChart read path"
    requirement: "HIST-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-snapshots.contract.ts#readJournal > Pitfall-1 regression: includes a schwab_chain-sourced row (never dropped by mapSnapshotRow)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-14
status: complete
---

# Phase 40 Plan 02: HIST-01 Root-Fix at All Four Call Sites Summary

**Fixed the SPX/SPXW OCC-root mismatch at all four call sites (getOpenCalendarLegs pg+memory, getLiveGreeks, resolveLegSnapshot pg+memory) via the shared `resolveRootCandidates` function, plus made `mapSnapshotRow` source-inclusive so a healed non-cboe row is never silently hidden from the journal UI.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-14T07:41:28Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `getOpenCalendarLegs` (postgres + memory) now builds BOTH candidate-root OCC symbols per leg via `resolveRootCandidates` — a stored-SPX mixed-root calendar's D-04 targeted-fetch allowlist now contains the real SPXW-rooted back-leg symbol, not just the wrong-root one.
- `getLiveGreeks` tries each candidate root in order per leg (first non-null observation wins); a genuinely-absent leg still NaN-stamps under the primary (calendar-stored) root — the honest-gap contract (D-04) is unchanged, only the wrong-root false-negative is fixed.
- `resolveLegSnapshot` (postgres + memory) matches `contracts.root` against `resolveRootCandidates(underlying)` instead of an exact-equality filter — the non-null result this produces is what stops the OPS-01 freshness gate from skipping a mixed-root calendar's whole snapshot cycle (verified at the contract level, `snapshotCalendars.ts` itself untouched per plan 03's ownership).
- `mapSnapshotRow` (postgres) is now source-inclusive (`schwab_chain` rows are mapped, not dropped), mirroring `readLatestSnapshotPerOpenCalendar`'s existing mapper — closes RESEARCH's Pitfall 1 (a healed non-cboe row would otherwise vanish from `readJournal`/`LifecycleChart`, the exact surface this phase exists to fix).
- Every fix was proven RED (failing regression test against the pre-fix code) before implementation, per `tdd.md`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix symbol-construction sites (getOpenCalendarLegs pg+memory, getLiveGreeks)** - `c1fdea5` (fix)
2. **Task 2: Fix read/query sites (resolveLegSnapshot root filter + mapSnapshotRow source-drop)** - `2dd2c87` (fix)

## Files Created/Modified

- `packages/adapters/src/postgres/repos/calendars.ts` - `getOpenCalendarLegs` builds both candidate-root symbols per leg
- `packages/adapters/src/memory/calendars.ts` - byte-identical twin fix (architecture-boundaries rule 8)
- `packages/adapters/src/__contract__/calendars.contract.ts` - added the mixed-root `getOpenCalendarLegs` case; the pre-existing "front+back OCC symbols" test now uses an unambiguous `underlying='SPXW'` fixture
- `packages/core/src/journal/application/getLiveGreeks.ts` - per-leg candidate-root resolution via `resolveRootCandidates`, honest-gap fallback under the primary root
- `packages/core/src/journal/application/getLiveGreeks.test.ts` - added the mixed-root back-leg regression test
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` - `resolveLegSnapshot` uses `inArray(contracts.root, resolveRootCandidates(...))`; `mapSnapshotRow` source-inclusive (no longer returns `null`); `readJournal` simplified accordingly
- `packages/adapters/src/memory/calendar-snapshots.ts` - `resolveLegSnapshot` twin: tries each candidate root as a key prefix
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` - added the mixed-root `resolveLegSnapshot` case and the Pitfall-1 `readJournal`/schwab_chain-inclusion case; extended `SeedContext.seedContract` with an optional `root` param
- `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` - `seedContract`'s Postgres implementation now inserts the given `root` (was hardcoded `'SPX'`)

## Decisions Made

- getLiveGreeks's honest-gap leg reports its `occSymbol` under the calendar's PRIMARY (stored) root, not an arbitrary candidate — preserves the historically-displayed symbol for a genuinely-absent leg.
- `SeedContext.seedContract` gained an optional `root` param (default `'SPX'`, fully backward compatible with every existing caller) instead of adding a parallel seed method, since every existing contract-test call site needed zero changes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `seedContract`'s Postgres implementation hardcoded `root: 'SPX'`, blocking the new mixed-root `resolveLegSnapshot` contract case**
- **Found during:** Task 2 (writing the RED test for `resolveLegSnapshot`'s mixed-root case)
- **Issue:** The shared contract harness's `seedContract` seed helper had no way to seed a contract row under a root OTHER than `'SPX'` — the Postgres implementation's INSERT statement hardcoded `root: 'SPX'` regardless of the caller's intent, so a mixed-root test case (SPXW contract, SPX-underlying query) had no way to set up its fixture through the existing seed API.
- **Fix:** Extended `SeedContext.seedContract`'s type signature with an optional 5th param `root` (default `'SPX'` — every existing call site is unaffected) and updated the Postgres test file's implementation to insert the given root instead of the literal string. The memory adapter's `seedContract` stays a no-op (memory resolves via `seedObservation`'s parsed OCC-root, which already varies per symbol).
- **Files modified:** `packages/adapters/src/__contract__/calendar-snapshots.contract.ts`, `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts`
- **Verification:** Postgres contract runner green (33/33 including the new mixed-root case); all pre-existing `seedContract` call sites (no root arg) unaffected.
- **Committed in:** `2dd2c87` (Task 2 commit)

**2. [Rule 1 - Bug/test-pin correction] Pre-existing `getOpenCalendarLegs` contract test pinned the OLD single-root behavior**
- **Found during:** Task 1 (implementing the fix, before running the plan's specified verify command)
- **Issue:** The existing test "returns front+back OCC symbols for each open calendar" used `underlying: 'SPX'` and asserted exactly 2 returned symbols — that assertion encoded the pre-fix, buggy single-root behavior (HIST-01's own root cause) and would fail once the fix correctly returns 4 symbols (both roots × both legs) for a mixed-root-ambiguous stored root.
- **Fix:** Changed the fixture to `underlying: 'SPXW'` (the unambiguous case — `resolveRootCandidates` still returns exactly one candidate, so the "exactly 2 symbols" assertion remains semantically correct) and added a new, separate test for the `underlying: 'SPX'` mixed-root case asserting 4 symbols.
- **Files modified:** `packages/adapters/src/__contract__/calendars.contract.ts`
- **Verification:** Both tests green; the new mixed-root test was RED before the fix, confirming it exercises the real bug.
- **Committed in:** `c1fdea5` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking test-infra gap, 1 bug-fix test-pin correction). No architectural changes, no scope creep.
**Impact on plan:** Both deviations were necessary to write the RED tests the plan itself required ("write the... RED test first and show it failing before implementing" / "Extend the... contract harness with a mixed-root case"). Neither touched `snapshotCalendars.ts` (plan 03's file, confirmed unmodified).

## Issues Encountered

- TypeScript's `noUncheckedIndexedAccess` flagged `candidates[0]` in `getLiveGreeks.ts` as possibly `undefined` even though `resolveRootCandidates` never returns an empty array (a runtime invariant TS can't see). Resolved with `assertDefined` from `@morai/shared` — the codebase's established idiom for exactly this "impossible per invariant, guard for the compiler" case (used identically in `directional-attribution.ts`, `bootstrap-ci.ts`, `evaluate-exit.ts`, and others).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four HIST-01 root-mismatch call sites are fixed and contract-tested against both the Postgres (testcontainers) and in-memory adapters.
- `mapSnapshotRow`'s Pitfall-1 fix means plan 03's (and later plans') healed rows will surface correctly in `readJournal`/`LifecycleChart` regardless of source.
- `snapshotCalendars.ts` is confirmed unmodified — plan 03 (OPS-01 gate, slot-rounding) has a clean starting point.
- Full affected-scope suite (`packages/core`, `packages/adapters`, `apps/server`, `apps/worker`) green: 2284/2284 tests, 224 files. `bun run typecheck` and `bun run lint` both clean.
- No blockers for plan 03.

## Self-Check: PASSED

- `packages/adapters/src/postgres/repos/calendars.ts` — FOUND
- `packages/adapters/src/memory/calendars.ts` — FOUND
- `packages/adapters/src/__contract__/calendars.contract.ts` — FOUND
- `packages/core/src/journal/application/getLiveGreeks.ts` — FOUND
- `packages/core/src/journal/application/getLiveGreeks.test.ts` — FOUND
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — FOUND
- `packages/adapters/src/memory/calendar-snapshots.ts` — FOUND
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` — FOUND
- `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` — FOUND
- Commit `c1fdea5` — FOUND in `git log --oneline`
- Commit `2dd2c87` — FOUND in `git log --oneline`
- All plan-level `<verification>` commands re-run and passing: postgres testcontainers contract suites (53/53), `getLiveGreeks.test.ts` (26/26 incl. the new one), `bun run typecheck` clean, `bun run lint` clean, broader affected-scope suite (2284/2284) green.

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*

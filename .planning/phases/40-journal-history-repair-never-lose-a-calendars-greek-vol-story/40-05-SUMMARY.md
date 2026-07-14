---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 05
subsystem: journal
tags: [use-case, pure-fn, fast-check, tdd, honest-gap, fill-only]

# Dependency graph
requires:
  - phase: 40-01
    provides: "roundDownToRthSlot pure fn, exported via @morai/core"
  - phase: 40-04
    provides: "ForResolvingLegObservationForSlot (as-of-slot read) + ForHealingSnapshot (fill-only write) ports, Postgres + memory twins"
provides:
  - "makeRebuildCalendarHistoryUseCase(deps) — the single HIST-02 derivation engine: for a Calendar + requested window, derives calendar_snapshots rows from historical leg_observations via the live writer's EXACT pure functions (D-02), skips honest gaps (D-04), heals fill-only (D-03), never writes outside the life window (D-08), returns RebuildCoverage counts. Exported via @morai/core."
  - "enumerateRebuildSlots(calendar, window, now) — pure D-08 slot-window enumerator, fast-check proven, module-exported for its own unit test (not part of the @morai/core public surface)"
affects: [40-06, 40-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rebuild mirrors the live writer: same computeLegPairMetrics + computeSnapshotPnl imports, same row-assembly shape as buildSnapshotRow, different deps (as-of-slot read instead of latest-observation read, heal instead of persist) — proven byte-identical by a test that reconstructs the row via the SAME exported functions and asserts equality (D-02)."
    - "Clamp-then-loop enumeration: start/end derived via Math.max/Math.min against the calendar's real life window BEFORE any iteration begins, so the loop's own upper-bound check (`cursor <= end`) is a structural, not incidental, guarantee that no anchor escapes — holds for any requested from/to, including windows entirely outside the life window."

key-files:
  created: []
  modified:
    - packages/core/src/journal/application/rebuildCalendarHistory.ts
    - packages/core/src/journal/application/rebuildCalendarHistory.test.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts

key-decisions:
  - "enumerateRebuildSlots is module-exported but deliberately NOT added to the journal/core barrels — it is an internal implementation detail of the use-case (the plan's own artifact list calls it 'private... test-exported'), so only makeRebuildCalendarHistoryUseCase + its types cross the @morai/core public surface."
  - "RebuildWindow is exported alongside the use-case (not just implied by the function signature) so plans 06/07 can import the named type when they build the self-heal job's bounded-7-day window and the CLI's unbounded window, rather than re-declaring an equivalent inline object type at each call site."

patterns-established:
  - "A slot enumerator over 30-min RTH boundaries steps in fixed 30-real-minute increments from a floor-aligned start, testing isWithinRth per candidate rather than computing weekday/session boundaries directly — correct because DST transitions never occur during RTH hours (2am ET only), so fixed-interval stepping stays wall-clock-aligned across the whole trading session."

requirements-completed: [HIST-02]

coverage:
  - id: D1
    description: "enumerateRebuildSlots clamps to [max(openedAt,from), min(closedAt??now,to)], RTH-only, sorted ascending, no duplicates; fast-check proves no anchor ever escapes the life window for any requested from/to (including from before openedAt and to after closedAt)"
    requirement: "HIST-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/rebuildCalendarHistory.test.ts#enumerateRebuildSlots"
        status: pass
    human_judgment: false
  - id: D2
    description: "makeRebuildCalendarHistoryUseCase builds a row byte-identical to the live writer's buildSnapshotRow composition (same computeLegPairMetrics + computeSnapshotPnl, same inputs) for the same legs/instant — D-02 no formula drift, proven by direct equality assertion, not loose field spot-checks"
    requirement: "HIST-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/rebuildCalendarHistory.test.ts#makeRebuildCalendarHistoryUseCase (byte-identical-to-live-writer + pnlOpen fast-check property)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A slot where either leg fails to resolve produces zero healSnapshot calls (D-04 honest gap) and is counted in honestGapSlots, never rowsHealed; the use-case calls healSnapshot exclusively (never persistSnapshot, D-03) and coverage counts (slotsConsidered/rowsHealed/honestGapSlots) are exact across a mixed multi-slot window"
    requirement: "HIST-02"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/rebuildCalendarHistory.test.ts#makeRebuildCalendarHistoryUseCase (honest-gap + coverage-count + StorageError-propagation cases)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-14
status: complete
---

# Phase 40 Plan 05: Journal History Repair Rebuild Use-Case Summary

**`makeRebuildCalendarHistoryUseCase` — the single HIST-02 derivation engine, reusing the live snapshot writer's exact pure functions (D-02), skipping honest gaps (D-04), healing fill-only (D-03), and structurally unable to write outside a calendar's life window (D-08).**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-14
- **Tasks:** 2
- **Files modified:** 4 (0 created, 4 modified — `rebuildCalendarHistory.ts`/`.test.ts` were newly authored in Task 1, then extended in Task 2)

## Accomplishments

- `enumerateRebuildSlots(calendar, window, now)` derives the 30-min RTH slot anchors within `[max(openedAt, from), min(closedAt ?? now, to)]` — clamp computed once before any iteration, so the loop's own bound check is a structural D-08 guarantee, not an incidental one. Fast-check proves the bound holds for any requested `from`/`to`, including windows that fall entirely outside the calendar's real life window.
- `makeRebuildCalendarHistoryUseCase(deps)` resolves both legs per enumerated slot via `resolveLegObservationForSlot` (plan 04's as-of-slot port), and when both resolve, builds the row with `computeLegPairMetrics` + `computeSnapshotPnl` — the SAME exported functions `buildSnapshotRow` uses in the live writer, with the same inputs (slot anchor as `now`, calendar's qty/expiries). The byte-identical-to-live-writer test reconstructs a row the identical way and asserts deep equality against the use-case's captured heal call, proving D-02 by construction rather than by loose field spot-checks.
- A slot where either leg fails to resolve (as-of-slot read returns `null`) produces zero `healSnapshot` calls and is counted in `honestGapSlots` — never fabricated or interpolated (D-04). The use-case calls `healSnapshot` exclusively; it has no reference to `persistSnapshot` at all, so a live row can never be overwritten (D-03, enforced structurally by the port from plan 04 and by this use-case's dependency shape).
- `RebuildCoverage` (`slotsConsidered`, `rowsHealed`, `honestGapSlots`) is returned per call, verified exact across a two-slot mixed window (one healed, one honest gap) — the operator before/after report plans 06/07 will surface.
- `StorageError` from either port (`resolveLegObservationForSlot` or `healSnapshot`) short-circuits the loop and propagates via `err(...)` — no partial-write ambiguity.
- Exported through `@morai/core` (`makeRebuildCalendarHistoryUseCase`, `ForRunningRebuildCalendarHistory`, `RebuildCalendarHistoryDeps`, `RebuildWindow`, `RebuildCoverage`), confirmed importable via a runtime `bun -e` check against the real workspace package.

## Task Commits

Each task was committed atomically (TDD RED confirmed then GREEN for both):

1. **Task 1: Pure slot-window enumeration (clamped to the life window, D-08)** - `aba30a0` (feat)
2. **Task 2: rebuildCalendarHistory use-case — D-02 reuse, D-04 honest gaps, fill-only heal** - `8f17355` (feat)

## Files Created/Modified

- `packages/core/src/journal/application/rebuildCalendarHistory.ts` - `enumerateRebuildSlots` (pure, module-exported for its test) + `makeRebuildCalendarHistoryUseCase` (factory) + `RebuildWindow`/`RebuildCoverage`/`RebuildCalendarHistoryDeps`/`ForRunningRebuildCalendarHistory` types
- `packages/core/src/journal/application/rebuildCalendarHistory.test.ts` - Task 1: example + fast-check property tests for `enumerateRebuildSlots` (in-window, valid RTH slots, sorted/dedup, empty-when-clamped). Task 2: byte-identical-to-live-writer, honest-gap-skip, coverage-count, StorageError-propagation (both ports), and a `pnlOpen` fast-check property for `makeRebuildCalendarHistoryUseCase`
- `packages/core/src/journal/index.ts` - re-exports `makeRebuildCalendarHistoryUseCase` + its four types from `./application/rebuildCalendarHistory.ts`
- `packages/core/src/index.ts` - re-exports the same through the top-level `@morai/core` barrel

## Decisions Made

- **`enumerateRebuildSlots` stays out of both barrels.** The plan's own artifact list frames it as "Private pure slot-window enumerator (test-exported)" — it is module-exported (`export function`) so its own `.test.ts` file can import it directly, but it is an implementation detail of the use-case, not part of `@morai/core`'s public surface. Only `makeRebuildCalendarHistoryUseCase` and its four types cross into `journal/index.ts` / `core/index.ts`.
- **`RebuildWindow` is exported as a named type** (not just an inline literal on the function signature) so plans 06 (self-heal job, bounded 7-day window) and 07 (operator CLI, unbounded window) can import one shared type instead of each re-declaring an equivalent `{ from: Date; to: Date }` shape.

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed the plan's exact `deps` shape (`resolveLegObservationForSlot`, `healSnapshot`, `now`), reused `computeLegPairMetrics`/`computeSnapshotPnl` via direct import (no extraction/move needed — both were already exported from `snapshotCalendars.ts` by plan 01/prior work), and the barrel exports followed the existing two-tier convention (`domain|application/*.ts` → `journal/index.ts` → `core/index.ts`) with no new abstraction layer.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `makeRebuildCalendarHistoryUseCase` is exported through `@morai/core` and ready for plan 06 (self-heal job, bounded 7-day window) and plan 07 (operator CLI repair, unbounded window, composed with plan 04's `ForDeletingSnapshotsOutsideWindow`) to consume as the single shared derivation engine — no reimplementation, per RESEARCH Open Question 2.
- Full plan-level verification green: `bun run test -- packages/core/src/journal/application/rebuildCalendarHistory.test.ts` 11/11 pass (5 from Task 1's enumerator suite, 6 from Task 2's use-case suite, one of which is a fast-check property); whole-repo `bun run typecheck` clean; whole-repo `bun run lint` clean (only pre-existing repo-wide `boundaries` config warnings, unrelated to these files); runtime import check confirms `makeRebuildCalendarHistoryUseCase` resolves from `@morai/core`.
- No blockers. Ready for 40-06.

## Self-Check: PASSED

- `packages/core/src/journal/application/rebuildCalendarHistory.ts` — FOUND
- `packages/core/src/journal/application/rebuildCalendarHistory.test.ts` — FOUND
- Commit `aba30a0` — FOUND in `git log --oneline`
- Commit `8f17355` — FOUND in `git log --oneline`
- All plan-level `<verification>` commands re-run and passing: test suite 11/11 green, `bun run typecheck` clean, `bun run lint` clean, byte-identical-to-live-writer assertion present (D-02), honest-gap zero-heal assertion present (D-04).

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*

---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 03
subsystem: journal
tags: [snapshot-calendars, tdd, hist-05, composite-pk]

# Dependency graph
requires: ["40-01"]
provides:
  - "makeSnapshotCalendarsUseCase stamps scheduled-trigger rows with roundDownToRthSlot(now) as SnapshotRow.time, so same-slot duplicate writes collide on the (time, calendar_id) composite PK and onConflictDoNothing absorbs them"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Split clock: the freshness gate (assessLegFreshness/isLegFresh) always reads the REAL now; only the persisted SnapshotRow.time is rounded for trigger='scheduled' — a minimal two-variable split (now vs rowTime) rather than threading a rounded clock through the whole use-case"

key-files:
  created: []
  modified:
    - packages/core/src/journal/application/snapshotCalendars.ts
    - packages/core/src/journal/application/snapshotCalendars.test.ts

key-decisions:
  - "rowTime is computed once per use-case invocation (trigger='scheduled' ? roundDownToRthSlot(now) : now) and passed only to buildSnapshotRow — assessLegFreshness/isLegFresh calls are untouched, still reading deps.now() directly. This keeps the diff to 4 lines in the use-case body instead of threading a second clock through the freshness path."

requirements-completed: [HIST-05]

coverage:
  - id: D1
    description: "Two scheduled-trigger invocations whose now falls in the same 30-min RTH slot produce byte-identical SnapshotRow.time — the load-bearing HIST-05 collapse property, proven with the plan's own 10:03 ET / 10:14 ET example"
    requirement: "HIST-05"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#HIST-05 slot-rounding — scheduled row time collapses to the 30-min slot boundary"
        status: pass
    human_judgment: false
  - id: D2
    description: "event-move trigger keeps the real unrounded now as SnapshotRow.time (D-07) — regression guard, unchanged by this fix"
    requirement: "HIST-05"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#event-move trigger keeps the real unrounded now"
        status: pass
    human_judgment: false
  - id: D3
    description: "OPS-01 freshness gate still evaluates against the real now, not the rounded slot — a leg stale relative to real-now stays skipped even though it would look fresh if freshness wrongly used the rounded slot start (regression the split clock exists to prevent)"
    requirement: "HIST-05"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#OPS-01 freshness gate still evaluates against the real now"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-14
status: complete
---

# Phase 40 Plan 03: Snapshot Row Slot-Rounding Summary

**Scheduled snapshot rows now floor to their 30-min RTH slot boundary via `roundDownToRthSlot`, so the existing `(time, calendar_id)` composite PK collapses same-slot duplicate writes — zero new dedup logic, freshness gate untouched.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-14
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- `makeSnapshotCalendarsUseCase` now derives a separate `rowTime` (`roundDownToRthSlot(now)` for `trigger='scheduled'`, real `now` for `'event-move'`) and passes it to `buildSnapshotRow`, while `assessLegFreshness`/`isLegFresh` keep reading the real `deps.now()` directly — a 4-line change in the use-case body plus one new import.
- Two scheduled invocations in the same 30-min RTH slot (10:03 ET and 10:14 ET, matching the plan's own worked example) now produce a byte-identical `SnapshotRow.time`, so the existing `calendar_snapshots` composite PK + `onConflictDoNothing` collapses the fetch-schwab-chain/compute-bsm-greeks collision RESEARCH traced HIST-05's inflation to.
- Three new regression tests lock the fix's boundary: same-slot dedup (the actual bug, shown RED before the fix), event-move keeps the real instant (D-07, already true — regression guard), and the freshness gate rejecting a leg that's stale relative to real-now but would read as fresh if freshness had wrongly used the rounded slot start (the specific failure mode the split-clock design prevents).

## Task Commits

Each task was committed atomically:

1. **Task 1: Round scheduled snapshot row timestamps to the 30-min slot boundary** - `dd9c1f8` (feat, TDD red confirmed then green)

## Files Created/Modified

- `packages/core/src/journal/application/snapshotCalendars.ts` - imports `roundDownToRthSlot` from `../domain/rth-slot.ts` (plan 01); `makeSnapshotCalendarsUseCase` computes `rowTime` and passes it to `buildSnapshotRow` instead of `now`
- `packages/core/src/journal/application/snapshotCalendars.test.ts` - 3 new tests under `HIST-05 slot-rounding — scheduled row time collapses to the 30-min slot boundary`

## Decisions Made

- **Split-clock minimalism**: rather than threading a rounded clock through the whole use-case or adding a new dedup mechanism, `rowTime` is a single local variable computed once and consumed only where `buildSnapshotRow` is called. `assessLegFreshness(frontResult, now)` / `assessLegFreshness(backResult, now)` calls are byte-identical to before — the freshness gate was never touched, matching the plan's threat-model mitigation for T-40-11 (a rounded clock must never leak into the OPS-01 gate).

## Deviations from Plan

None - plan executed exactly as written.

**Note on the plan's RED expectation:** the plan's acceptance criteria state "the three regression cases ... were shown RED before the fix." In practice only the same-slot dedup case was actually RED against the pre-fix code (`AssertionError: expected 1781532180000 to be 1781532840000`) — the event-move and freshness-gate cases were already true by construction (this fix never touches those code paths), so they passed immediately as regression guards. All three were written and run before the implementation edit per TDD discipline; only one exercised new behavior.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Scheduled snapshot writes now dedup to one row per 30-min slot per calendar via the existing composite PK — HIST-05's write-side fix is live in `packages/core`.
- `roundDownToRthSlot` (plan 01) now has a second live consumer; plan 05 (rebuild use-case) can reuse the same import pattern (`import { roundDownToRthSlot } from "../domain/rth-slot.ts";`).
- No blockers. Full-suite verification deferred to the plan 08 integration gate per this plan's `<verification>` section.

## Self-Check: PASSED

- `packages/core/src/journal/application/snapshotCalendars.ts` — FOUND, contains `roundDownToRthSlot` import and `rowTime` usage
- `packages/core/src/journal/application/snapshotCalendars.test.ts` — FOUND, contains the 3 new HIST-05 tests
- Commit `dd9c1f8` — FOUND in `git log --oneline`
- `bun run test -- packages/core/src/journal/application/snapshotCalendars.test.ts` — 28/28 passing
- `bun run typecheck` — clean
- `bun run lint` — clean (pre-existing boundary-plugin selector-syntax warnings only, unrelated to this change)

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*

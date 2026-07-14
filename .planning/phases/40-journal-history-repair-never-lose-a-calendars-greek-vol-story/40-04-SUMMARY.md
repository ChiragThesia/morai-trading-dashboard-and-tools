---
phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story
plan: 04
subsystem: journal
tags: [ports, postgres, drizzle, in-memory-twin, contract-tests, tdd]

# Dependency graph
requires:
  - phase: 40-01
    provides: "resolveRootCandidates(underlying), roundDownToRthSlot pure fns, exported via @morai/core"
  - phase: 40-02
    provides: "HIST-01 root-mismatch fixes at all four call sites; mapSnapshotRow source-inclusive"
provides:
  - "ForResolvingLegObservationForSlot(query) — as-of-slot read: nearest observation at-or-before a slotAnchor, within the live freshness window, root-candidate-aware. Postgres + memory twins, exported via @morai/core / @morai/adapters."
  - "ForHealingSnapshot(row) — fill-only conditional write: INSERT when absent, UPDATE when the existing row is a gap (isGapRow), NO-OP when live. Postgres + memory twins."
  - "ForDeletingSnapshotsOutsideWindow(calendarId, openedAt, closedAt) — deletes calendar_snapshots rows outside [openedAt, closedAt], returns the exact deleted count. Postgres + memory twins."
  - "isGapRow and SNAPSHOT_LEG_STALENESS_TOLERANCE_MS now re-exported through the top-level @morai/core barrel (previously only reachable via the journal sub-barrel)."
affects: [40-05, 40-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "As-of-slot read: two-step (contracts join via resolveRootCandidates, then a time-windowed legObservations query bounded both above by slotAnchor and below by slotAnchor - TOLERANCE) — mirrors readSmile's 'latest at-or-before an anchor' shape plus resolveLegSnapshot's HIST-01 root-candidate join, composed together for the first time."
    - "Fill-only conditional write: SELECT-then-decide inside one db.transaction (mirrors recomputeSnapshotPnl's tx shape) so a concurrent live write can never be clobbered by a read-then-write race; the decision reuses the LOCKED isGapRow predicate rather than a second gap definition."
    - "Memory twin without a modeled contracts table: for leg-observations, root-candidate resolution builds each candidate's occSymbol directly via formatOccSymbol (the OCC symbol's own embedded root prefix substitutes for a contracts-table lookup) rather than replicating a Postgres-only table."

key-files:
  created: []
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/memory/leg-observations.ts
    - packages/adapters/src/__contract__/leg-observations.contract.ts
    - packages/adapters/src/postgres/repos/leg-observations.contract.test.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.ts
    - packages/adapters/src/memory/calendar-snapshots.ts
    - packages/adapters/src/__contract__/calendar-snapshots.contract.ts
    - packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts
    - packages/adapters/src/memory/calendar-snapshots.contract.test.ts

key-decisions:
  - "The memory leg-observations adapter cannot run the FULL runLegObservationsContractTests suite (it doesn't implement upsertContracts/readPendingObs/writeBsmResults — Postgres-only BSM-pipeline ports), so the as-of-slot cases live in a SEPARATE exported suite (runLegObservationForSlotContractTests) with its own minimal repo/seed-context shape, rather than trying to force the memory twin to implement ports it structurally doesn't need."
  - "isGapRow and SNAPSHOT_LEG_STALENESS_TOLERANCE_MS were re-exported through the top-level @morai/core barrel — the plan's own read_first pointed at these as reuse targets, but neither was reachable from @morai/core before this plan (only from the journal sub-barrel). This is the same class of gap plan 01 hit with resolveRootCandidates/roundDownToRthSlot, fixed the same way (add the barrel re-export, don't duplicate the logic)."
  - "ForHealingSnapshot and ForDeletingSnapshotsOutsideWindow are separate port types (not folded into ForPersistingSnapshot) per the plan's explicit instruction — ForPersistingSnapshot's onConflictDoNothing shape structurally cannot express 'replace a gap row,' so a new port was the only option, not an architectural surprise requiring a checkpoint."

patterns-established:
  - "A port whose adapter twin doesn't model every backing table (memory leg-observations has no contracts table) resolves root-candidate lookups by reconstructing the OCC symbol directly, rather than adding a parallel in-memory table just to mirror Postgres's join shape."

requirements-completed: [HIST-02]

coverage:
  - id: D1
    description: "ForResolvingLegObservationForSlot resolves the nearest observation at-or-before a slotAnchor within the live freshness window, root-candidate-aware (HIST-01 reuse); honest-gap null on miss/stale/no-contract, identical across Postgres + memory"
    requirement: "HIST-02"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/leg-observations.contract.ts#runLegObservationForSlotContractTests (hit/miss-before-anchor/stale-outside-window/root-candidate)"
        status: pass
    human_judgment: false
  - id: D2
    description: "ForHealingSnapshot is fill-only: INSERT when absent, UPDATE when the existing row is a gap (isGapRow), NO-OP when the existing row is live — a live row is never overwritten (D-03), atomic via one transaction"
    requirement: "HIST-02"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-snapshots.contract.ts#healSnapshot (insert-when-absent / update-when-gap / no-op-when-live)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ForDeletingSnapshotsOutsideWindow deletes only rows strictly outside [openedAt, closedAt] for a calendar and returns the exact deleted count; open calendars (closedAt null) trim only the pre-openedAt side; in-window rows are always preserved (D-08)"
    requirement: "HIST-02"
    verification:
      - kind: unit
        ref: "packages/adapters/src/__contract__/calendar-snapshots.contract.ts#deleteSnapshotsOutsideWindow (trims-outside-window / open-calendar-null-closedAt / keeps-in-window)"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-07-14
status: complete
---

# Phase 40 Plan 04: Journal History Repair Storage Primitives Summary

**Three new driven ports (as-of-slot read, fill-only heal-write, windowed-delete) with Postgres + in-memory twins, contract-tested against both — the storage layer HIST-02's rebuild use-case (plan 05) and the operator repair (plan 07) compose on top of.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-07-14
- **Tasks:** 2
- **Files modified:** 12 (0 created, 12 modified)

## Accomplishments

- `ForResolvingLegObservationForSlot` resolves a leg's nearest observation at-or-before an arbitrary historical slot anchor, bounded below by the live freshness window (`SNAPSHOT_LEG_STALENESS_TOLERANCE_MS`, D-07 reuse) so a slot with no usable observation stays an honest gap (D-04) instead of resolving a stale value. Root-candidate-aware (HIST-01 reuse via `resolveRootCandidates`): an EOM/mixed-root back leg resolves correctly even when the calendar's stored root differs from the real contract's root.
- `ForHealingSnapshot` is a fill-only conditional write: INSERT when no row exists for `(calendar_id, time)`, UPDATE to the healed row only when the existing row IS a gap (`isGapRow` — the LOCKED predicate from `attribution.ts`, imported, never redefined), NO-OP when the existing row is live. The read-decide-write runs inside one Postgres transaction (mirroring `recomputeSnapshotPnl`'s shape) so a concurrent live writer can never be clobbered by a race — this closes the gap `ForPersistingSnapshot`'s INSERT-ONLY `onConflictDoNothing` shape structurally could not: it can never overwrite a gap row with a healed one.
- `ForDeletingSnapshotsOutsideWindow` (D-08, operator-repair-only — plan 07) deletes `calendar_snapshots` rows strictly outside `[openedAt, closedAt]` for a calendar and returns the exact deleted count via `RETURNING`; an open calendar (`closedAt` null) trims only the pre-`openedAt` side, and every in-window row is provably preserved.
- Every fix was proven RED (the new test calling a not-yet-implemented port method) before implementation, per `tdd.md`.
- No migration added — the existing composite PK `(calendar_id, time)` on `calendar_snapshots` already supports the heal UPDATE and the windowed DELETE, exactly as RESEARCH predicted.

## Task Commits

Each task was committed atomically:

1. **Task 1: ForResolvingLegObservationForSlot — as-of-slot read port + Postgres + memory twin** - `067ddcd` (feat)
2. **Task 2: ForHealingSnapshot (fill-only) + ForDeletingSnapshotsOutsideWindow — write ports + twins** - `9fbbb01` (feat)

## Files Created/Modified

- `packages/core/src/journal/application/ports.ts` - Adds `ForResolvingLegObservationForSlot`, `ForHealingSnapshot`, `ForDeletingSnapshotsOutsideWindow` port types (both tasks' types were authored together before either task's tests ran — see Deviations)
- `packages/core/src/journal/index.ts` - Re-exports the three new port types + `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` (value) from `ports.ts` / `snapshotCalendars.ts`
- `packages/core/src/index.ts` - Re-exports the three new port types, `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS`, and `isGapRow` through the top-level `@morai/core` barrel
- `packages/adapters/src/postgres/repos/leg-observations.ts` - `resolveLegObservationForSlot`: contracts join via `resolveRootCandidates` (Step 1) + time-windowed `legObservations` query (Step 2, `lte`/`gte` on `slotAnchor`/`slotAnchor - TOLERANCE`)
- `packages/adapters/src/memory/leg-observations.ts` - Twin: builds each candidate root's occSymbol directly via `formatOccSymbol` (no contracts table modeled), scans the store for the time-windowed match
- `packages/adapters/src/__contract__/leg-observations.contract.ts` - New exported `runLegObservationForSlotContractTests` suite (hit / miss-before-anchor / stale-outside-window / root-candidate), separate from the existing full-repo suite (see Deviations)
- `packages/adapters/src/postgres/repos/leg-observations.contract.test.ts` - Wires the new suite via the Postgres repo's own `upsertContracts`/`persistObservations` (no raw SQL needed)
- `packages/adapters/src/memory/leg-observations.contract.test.ts` - **New file**: wires the new suite against the memory twin, mirroring `memory/calendar-snapshots.contract.test.ts`'s holder pattern
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` - `healSnapshot` (transactional SELECT-then-decide, reuses `isGapRow`) + `deleteSnapshotsOutsideWindow` (`DELETE ... RETURNING` for the exact count)
- `packages/adapters/src/memory/calendar-snapshots.ts` - Twins: `healSnapshot` gates the `Map.set` on `isGapRow(existing)`; `deleteSnapshotsOutsideWindow` filters + deletes matching entries
- `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` - Extends the existing shared harness with `healSnapshot` (insert/update-gap/no-op-live) and `deleteSnapshotsOutsideWindow` (trim/keep/open-null) describe blocks
- `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` - Wires `healSnapshot`/`deleteSnapshotsOutsideWindow` into the existing Postgres runner's `makeRepo` callback
- `packages/adapters/src/memory/calendar-snapshots.contract.test.ts` - Wires the same two fields into the existing memory runner's `makeRepo` callback

## Decisions Made

- **The as-of-slot suite lives in a separate exported test function, not inside the existing `runLegObservationsContractTests`.** The memory `leg-observations` adapter implements `resolveLegObservationForSlot` but not `upsertContracts`/`readPendingObs`/`writeBsmResults` (those are Postgres-only BSM-pipeline ports never needed by the memory twin), so the existing full suite cannot run against it at all. Rather than stubbing those ports on the memory adapter just to satisfy one suite's type shape, the new cases got their own minimal `LegObservationForSlotRepo`/`SlotSeedContext` types and their own `runLegObservationForSlotContractTests` export, mirroring `calendar-snapshots.contract.ts`'s `SeedContext` pattern exactly (the plan's own read_first pointed at this file as "the memory-runner shape to mirror").
- **`isGapRow` and `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` are now re-exported through the top-level `@morai/core` barrel.** Both were reachable only from the `journal` sub-barrel before this plan, but the plan explicitly requires importing them from `@morai/core` into `packages/adapters` (hexagonal law: adapters import core ports + shared, never core's internal sub-barrels). This is the identical gap-class plan 01 hit with `resolveRootCandidates`/`roundDownToRthSlot` — fixed the same way, by adding the barrel re-export rather than duplicating the constant/predicate.
- **`ForHealingSnapshot`'s memory-twin decision reads the existing `SnapshotRow` directly** (not a raw DB row needing a mapper, unlike the Postgres twin) — `isGapRow`'s structural typing accepts both without a cast.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `isGapRow` and `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` were not reachable from `@morai/core`'s top-level barrel**
- **Found during:** Task 1 (writing the Postgres/memory adapter imports) and Task 2 (implementing `healSnapshot`, which failed at runtime with `TypeError: isGapRow is not a function` — a value import resolving to `undefined` because the name simply wasn't exported from the barrel path used)
- **Issue:** Both symbols are exported from `packages/core/src/journal/index.ts` (the journal sub-barrel) but were never re-exported from `packages/core/src/index.ts` (the top-level `@morai/core` barrel), even though the plan's own `read_first`/`action` sections require importing both directly from `@morai/core` into `packages/adapters`.
- **Fix:** Added `export { SNAPSHOT_LEG_STALENESS_TOLERANCE_MS } from "./journal/index.ts";` to `journal/index.ts` and `core/index.ts`; added `export { isGapRow } from "./journal/index.ts";` to `core/index.ts`. No logic duplicated — both are single re-export lines pointing at the one existing definition.
- **Files modified:** `packages/core/src/journal/index.ts`, `packages/core/src/index.ts`
- **Verification:** `bun run test -- packages/adapters/src/memory/calendar-snapshots.contract.test.ts` went from a runtime `TypeError` to 37/37 green; `bun run typecheck`/`bun run lint` both clean.
- **Committed in:** `067ddcd` (SNAPSHOT_LEG_STALENESS_TOLERANCE_MS, part of Task 1), `9fbbb01` (isGapRow, part of Task 2)

**2. [Rule 1 - Sequencing] Task 1's commit carries all three new port types, not just `ForResolvingLegObservationForSlot`**
- **Found during:** Staging Task 1's commit
- **Issue:** All three port types (`ForResolvingLegObservationForSlot`, `ForHealingSnapshot`, `ForDeletingSnapshotsOutsideWindow`) were authored into `ports.ts` in one editing pass before either task's RED tests ran, since they're adjacent declarations in the same file read for context. Task 1's pathspec-scoped commit therefore includes `ports.ts`/`journal/index.ts` with Task 2's port type declarations already present (unused until Task 2's adapter implementations land).
- **Fix:** No functional impact — an unused exported type is inert. Documented here instead of re-splitting an already-clean, already-green commit.
- **Files affected:** `packages/core/src/journal/application/ports.ts`, `packages/core/src/journal/index.ts`
- **Committed in:** `067ddcd` (both extra type declarations), confirmed inert until `9fbbb01` implements their adapters

---

**Total deviations:** 2 auto-fixed (1 blocking barrel gap, 1 commit-sequencing note). No architectural changes, no scope creep, no migration added.
**Impact on plan:** Zero functional impact on the plan's deliverables — both fixes were prerequisites the plan's own instructions implied (reuse `isGapRow`/`SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` from `@morai/core`) but the barrel didn't yet support.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All three ports (`ForResolvingLegObservationForSlot`, `ForHealingSnapshot`, `ForDeletingSnapshotsOutsideWindow`) are exported through `@morai/core`/`@morai/adapters` with Postgres + in-memory twins, contract-tested against both.
- Plan 05 (rebuild use-case) has everything it needs: the as-of-slot read to source a historical leg value, and the fill-only write to persist it without risking a live row.
- Plan 07 (operator repair) has the windowed-delete port ready, with D-08's in-window-preservation guarantee proven at the storage boundary.
- Full plan-level verification suite green: postgres contract suites (62/62 combined), memory contract suites (41/41 combined), `bun run typecheck` clean, `bun run lint` clean, no migration added (`schema.ts` unchanged, composite PK already present).
- No blockers. Ready for 40-05.

## Self-Check: PASSED

- `packages/core/src/journal/application/ports.ts` — FOUND
- `packages/adapters/src/postgres/repos/leg-observations.ts` — FOUND
- `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — FOUND
- `packages/adapters/src/memory/leg-observations.contract.test.ts` — FOUND (new file)
- Commit `067ddcd` — FOUND in `git log --oneline`
- Commit `9fbbb01` — FOUND in `git log --oneline`
- All plan-level `<verification>` commands re-run and passing: postgres combined suite 62/62, memory combined suite 41/41, `bun run typecheck` clean, `bun run lint` clean, `schema.ts` unchanged (no migration).

---
*Phase: 40-journal-history-repair-never-lose-a-calendars-greek-vol-story*
*Completed: 2026-07-14*

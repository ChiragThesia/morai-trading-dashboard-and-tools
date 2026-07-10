---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
plan: 02
subsystem: api
tags: [picker, dry-run, preview, fast-check, hexagonal]

requires:
  - phase: 32-01
    provides: "RULE_EXPLAINERS registry + previewRuleOverridesRequest/Response contracts"
provides:
  - "packages/core/src/picker/application/previewPickerRuleOverrides.ts — makePreviewPickerRuleOverridesUseCase (B1)"
  - "toEntryGateState / toPickerGate exported from computePickerSnapshot.ts"
  - "PickerPreviewResult / PickerPreviewDeps / ForPreviewingPickerRuleOverrides port types (picker/application/ports.ts)"
  - "picker/index.ts barrel export of the preview use-case + its types"
affects:
  - "32-04 (server): wires the preview use-case behind POST /api/settings/rules/preview"

tech-stack:
  added: []
  patterns:
    - "Reconstruct a driven-port's raw input (MacroSeriesRow[]) from an already-resolved stored scalar shape (PickerGate.vix/vix3m/asOf) to reuse a pure domain function verbatim without adding a new live read — avoids both a hand-rolled second formula and an unneeded macro-observations dep"
    - "Discriminated-union {available:false} | {available:true,...} cold-start result, mirroring AdHocCalendarAnalysis's scored:false precedent"

key-files:
  created:
    - packages/core/src/picker/application/previewPickerRuleOverrides.ts
    - packages/core/src/picker/application/previewPickerRuleOverrides.test.ts
  modified:
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/application/ports.ts
    - packages/core/src/picker/index.ts

key-decisions:
  - "Gate re-resolve reconstructs synthetic MacroSeriesRow[VIXCLS,VXVCLS] from the stored PickerGate's already-resolved vix/vix3m/asOf scalars (never a fresh readMacroObservations dep) so resolveEntryGate can be reused verbatim with zero new I/O — the ONE local reconstruction the plan's 'no macro read in deps' constraint requires."
  - "An ABSENT staged picker group falls back to the STORED picker overrides (not code defaults) for the effective config — this is what makes the byte-parity property hold: the stored candidates were scored under the stored overrides, so reproducing that exact config reproduces their exact score."
  - "Single commit per task at green (project tdd.md 'commit only at green' rule) — RED run locally and confirmed failing (module-not-found), then implementation, then one feat commit per task; no separate test()/feat() commit pair (17.1-01/18-03 precedent)."

requirements-completed: [B1, B7]

coverage:
  - id: D1
    description: "Score-only knobs (9 weights + debitIdealMin/Max) re-score stored candidates with zero I/O beyond the snapshot read; debitFit alone recomputed via debitFitFraction"
    requirement: B1
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/previewPickerRuleOverrides.test.ts#byte-parity: an ABSENT staged group reproduces every stored candidate's score EXACTLY, gate/sizing after === before (fast-check)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Gate/sizing knobs re-resolve from stored gate scalars + one fresh open-calendars read for maxOpen; cooldown reused verbatim"
    requirement: B1
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/previewPickerRuleOverrides.test.ts#staging maxOpenCalendars flips gate.after.brakes.maxOpen from the fresh open-count read; cooldown reused verbatim from stored"
        status: pass
    human_judgment: false
  - id: D3
    description: "Universe knobs (delta band/DTE window) return an honest 'affects next compute cycle' note, never a fabricated candidate diff"
    requirement: B1
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/previewPickerRuleOverrides.test.ts#staging a universe knob (deltaBandMax) sets universeNote, never a fabricated candidate diff (Pitfall 1)"
        status: pass
    human_judgment: false
  - id: D4
    description: "PickerPreviewDeps structurally excludes any persist/chain/gex/events port (T-32-01)"
    requirement: B7
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/previewPickerRuleOverrides.test.ts#port hygiene: deps structurally exclude any persist/chain/gex/events port -- only these 3 fields exist"
        status: pass
    human_judgment: false
  - id: D5
    description: "Preview use-case reachable via the picker context barrel; top-level @morai/core barrel deferred to Plan 04"
    verification:
      - kind: unit
        ref: "bun run typecheck (clean, imports resolve through picker/index.ts)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-10
status: complete
---

# Phase 32 Plan 02: Picker preview use-case Summary

**Server-side dry-run that re-scores the latest stored picker snapshot against staged rule overrides — score-only knobs re-weight stored breakdown contributions byte-parity-exact, gate/sizing knobs re-resolve via the exact `resolveEntryGate`/`resolveSizingTier` formulas, universe knobs get an honest "next compute cycle" note instead of a fabricated candidate diff.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `makePreviewPickerRuleOverridesUseCase` (B1): the picker branch of the staged-change preview, mirroring `analyzeAdHocCalendar.ts`'s bounded-read/never-persist precedent exactly.
- `toEntryGateState`/`toPickerGate` exported from `computePickerSnapshot.ts` so the preview reuses the SAME gate-state projection compute-picker uses — no second copy.
- `PickerPreviewResult`/`PickerPreviewDeps`/`ForPreviewingPickerRuleOverrides` added to `picker/application/ports.ts`, re-exported through `picker/index.ts` (top-level `@morai/core` barrel deferred to Plan 04 per its own scoping note, avoiding a Wave-1 barrel-edit conflict with Plan 03).
- Fast-check byte-parity property (empty/absent staged group ⇒ every candidate's `newScore === oldScore`, `gate.after === gate.before`, `sizing.after === sizing.before`) plus 7 example tests covering cold start, universe-note branch, gate/maxOpen re-read, and StorageError propagation from both critical reads.

## Task Commits

Each task was committed atomically:

1. **Task 1: Export gate/sizing helpers + build score-only + gate/sizing + universe-note branches** - `5bd00b7` (feat)
2. **Task 2: Barrel-export the picker preview use-case + types through the context barrel** - `6adefac` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update)

_Note: Followed project `tdd.md`'s "commit only at green" rule — RED was run locally (module-not-found failure) and confirmed before implementation; each task lands as one commit at green, not a separate test()/feat() pair (17.1-01/18-03 precedent)._

## Files Created/Modified

- `packages/core/src/picker/application/previewPickerRuleOverrides.ts` - the preview use-case: `rescoreCandidate` (weight re-application + debitFit recompute), `reconstructMacroRows` (stored-gate-scalar → MacroSeriesRow[] bridge for `resolveEntryGate` reuse), and `makePreviewPickerRuleOverridesUseCase`
- `packages/core/src/picker/application/previewPickerRuleOverrides.test.ts` - fast-check byte-parity property + 7 example tests
- `packages/core/src/picker/application/computePickerSnapshot.ts` - `toEntryGateState`/`toPickerGate` now `export`ed (one-line change each)
- `packages/core/src/picker/application/ports.ts` - `PickerPreviewResult`/`PickerPreviewDeps`/`ForPreviewingPickerRuleOverrides` types + the journal/settings cross-context port imports they need
- `packages/core/src/picker/index.ts` - barrel re-export of the new use-case + its 3 types

## Decisions Made

- **Gate re-resolve without a macro read.** `resolveEntryGate` needs raw `MacroSeriesRow[]` (VIXCLS/VXVCLS), but `PickerPreviewDeps` has no `readMacroObservations` (structural exclusion, T-32-01). `reconstructMacroRows` rebuilds a 2-row synthetic array directly from the stored `PickerGate`'s own already-resolved `vix`/`vix3m`/`asOf` scalars — the ONE local reconstruction needed to reuse `resolveEntryGate` verbatim instead of hand-rolling a second ladder/hysteresis walk. Empty when the stored gate has no reading (GATE BLIND/read-error), which correctly reproduces the blind state through the same function.
- **Absent staged group falls back to STORED overrides, not code defaults.** `resolvePickerRuleConfig(staged ?? storedPickerOverrides)` — this is what makes the byte-parity property literally true: the stored candidates were already scored under the stored overrides (or defaults, if none were ever set), so re-deriving that exact same effective config reproduces the exact same score.
- **`rescoreCandidate` preserves breakdown order and formula shape** (`Σ weight*contribution/100`, clamp+round) identical to `scoreOne`'s own reduction and `computePickerSnapshot.ts`'s `zeroEventAdjustment` precedent — floating-point summation order matters for byte-exact parity, so the implementation and the test's independently-written oracle both walk `breakdown` in the same fixed order.
- **`sizingAfter` inlines `resolveSizingTier`'s wire-shape projection** (2 lines) rather than exporting the module-private `toPickerSizing` helper, since the plan's action text scoped the export list to exactly `toEntryGateState`/`toPickerGate`.

## Deviations from Plan

None — plan executed exactly as written, including the critical constraints (byte-parity fast-check, honest universe note, structural port exclusion, no persist port in deps type, Phase-27 replay suites untouched).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. `previewPickerRuleOverrides.ts` is fully wired against real domain functions (`debitFitFraction`, `resolvePickerRuleConfig`, `resolveEntryGate`, `resolveSizingTier`, `maxOpenTripped`) — no placeholder branch, no mock data path. It has no caller yet (that's 32-04's HTTP-route wiring), same "shipped but unwired" status 32-01's contracts had before this plan.

## Next Phase Readiness

- The use-case is ready for 32-04 to wire behind `POST /api/settings/rules/preview`'s picker branch: its `PickerPreviewResult` shape (`available`/`asOf`/`candidates` with `oldScore`/`gate {before,after}`/`sizing {before,after}`/`universeNote`) maps directly onto `previewRuleOverridesResponse`'s `picker` field from 32-01's contract (`previewPickerCandidate` extends `pickerCandidate` with `oldScore`; `gate`/`sizing` deltas; nullable `universeNote`).
- No blockers. Plan 03 (exits branch) and Plan 04 (server wiring) proceed independently — Plan 04 explicitly deferred the top-level `@morai/core` barrel edit to avoid conflicting with Plan 03's own Wave-1 work.

---
*Phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: packages/core/src/picker/application/previewPickerRuleOverrides.ts
- FOUND: packages/core/src/picker/application/previewPickerRuleOverrides.test.ts
- FOUND: .planning/phases/32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help/32-02-SUMMARY.md
- FOUND commit 5bd00b7 (feat: picker preview use-case)
- FOUND commit 6adefac (feat: barrel-export picker preview use-case)

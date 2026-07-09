---
phase: 24-regime-breadth-board
plan: 03
subsystem: analytics
tags: [zod, regime-board, banding, fast-check, contracts]

# Dependency graph
requires:
  - phase: 24-regime-breadth-board (plan 24-01)
    provides: regime-board.md evidence doc, HY OAS series id in MACRO_SERIES_IDS
provides:
  - regimeIndicator + regimeResponse Zod contract (single schema for the future route + MCP tool)
  - bandVixTermStructure, bandVvix, bandVix9dRatio, bandHyOas pure banding functions
  - RegimeBand type (contracts + core, both derived from the same "calm"|"warning"|"crisis" set)
affects: [24-04 (use-case wiring), 24-05 (web board UI)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Computed-on-read pure banding: plain if/else over named threshold constants, no rules-engine/DSL (mirrors gex.ts pickWalls/findFlip)"
    - "MCP-02: one Zod schema (regimeResponse) shared by the future HTTP route and MCP tool"

key-files:
  created:
    - packages/contracts/src/regime.ts
    - packages/contracts/src/regime.test.ts
    - packages/core/src/analytics/domain/regime.ts
    - packages/core/src/analytics/domain/regime.test.ts
  modified:
    - packages/contracts/src/index.ts
    - packages/core/src/analytics/index.ts

key-decisions:
  - "regimeBand extracted as its own z.enum() (not inlined) so RegimeBand can be inferred directly from the enum, matching the macroSeriesId precedent"
  - "Threshold constants named per-indicator (VIX_TERM_STRUCTURE_WARN, VVIX_CRISIS, etc.) so a post-launch tuning of the [ASSUMED] VIX9D/HY OAS cuts is a one-line change (24-RESEARCH.md Open Question 1)"

patterns-established:
  - "Regime banding functions are total + monotonic over the reals, proven by fast-check rather than asserted — future indicators added in this module should carry the same property tests"

requirements-completed: [BOARD-01, BOARD-02]

coverage:
  - id: D1
    description: "regimeResponse Zod contract: array of {id,label,value,band,asOf,source,rationale,inputs?}, band restricted to calm|warning|crisis, asOf date-only (rejects intraday timestamps)"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/regime.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "regimeResponse carries source + rationale per indicator (provenance in payload, not hardcoded UI copy) and accepts the empty-board case"
    requirement: "BOARD-02"
    verification:
      - kind: unit
        ref: "packages/contracts/src/regime.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "4 pure banding functions (bandVixTermStructure, bandVvix, bandVix9dRatio, bandHyOas) classify at the documented cuts via named constants; monotonic + total (no gap/overlap) proven by fast-check"
    requirement: "BOARD-01"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/domain/regime.test.ts"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-09
status: complete
---

# Phase 24 Plan 03: Regime contract + pure banding domain Summary

**regimeResponse Zod contract (id/label/value/band/asOf/source/rationale/inputs?) and 4 pure calm/warning/crisis banding functions with named, tunable thresholds — no wiring, no I/O, ready for 24-04's use-case.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-09
- **Tasks:** 2
- **Files modified:** 6 (4 created, 2 barrel edits)

## Accomplishments
- `regimeIndicator`/`regimeResponse` Zod schemas in `packages/contracts/src/regime.ts` — the single schema the future HTTP route and MCP tool will both parse (MCP-02); `asOf` uses `z.string().date()` so an intraday timestamp is rejected at the contract level (MACRO-03)
- 4 pure banding functions in `packages/core/src/analytics/domain/regime.ts`: `bandVixTermStructure` (0.90/0.95), `bandVvix` (100/115), `bandVix9dRatio` (1.0/1.1), `bandHyOas` (3.0/5.0) — all over named constants, no inlined magic numbers
- fast-check properties prove every banding function is total (maps to exactly one of calm/warning/crisis for any real) and monotonic non-decreasing — no gap or overlap at any cut
- Both schemas/functions re-exported from their package barrels (`packages/contracts/src/index.ts`, `packages/core/src/analytics/index.ts`)

## Task Commits

Each task was committed atomically (TDD RED→GREEN):

1. **Task 1: regimeResponse contract** - `eca1970` (feat) — RED confirmed via `Cannot find module './regime.ts'` before implementation
2. **Task 2: pure banding domain** - `21a75cc` (feat) — RED confirmed via the same missing-module failure before implementation

## Files Created/Modified
- `packages/contracts/src/regime.ts` - regimeBand/regimeIndicator/regimeResponse Zod schemas + inferred types
- `packages/contracts/src/regime.test.ts` - band-enum rejection, date-only asOf rejection, inputs record, [] empty-board acceptance
- `packages/contracts/src/index.ts` - barrel re-export beside the macro block
- `packages/core/src/analytics/domain/regime.ts` - RegimeBand type + 4 banding functions over named threshold constants
- `packages/core/src/analytics/domain/regime.test.ts` - boundary example tests (per-indicator cuts) + fast-check monotonic/total properties
- `packages/core/src/analytics/index.ts` - barrel re-export of the banding functions + RegimeBand

## Decisions Made
- Extracted `regimeBand` as its own `z.enum(["calm","warning","crisis"])` (rather than inlining the enum in `regimeIndicator`) so `RegimeBand` infers directly from the enum, matching the existing `macroSeriesId` barrel pattern in `macro.ts`.
- VIX9D/VIX and HY OAS threshold constants carry inline comments marking them `[ASSUMED]`/newly-calibrated per 24-RESEARCH.md Assumptions A1/A2 — display-only this phase, no hard-gate wiring (deferred to Phase 28).

## Deviations from Plan

None — plan executed exactly as written. Both tasks followed RED→GREEN exactly as specified in `<action>`; no Rule 1-4 auto-fixes were needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required (pure contract + pure domain, no I/O).

## Next Phase Readiness

- `regimeResponse` and the 4 banding functions are exported and ready for 24-04's `makeGetRegimeBoardUseCase` to consume directly — no scavenger-hunting for types/functions.
- `bun run typecheck` and `bun run lint` both clean at this commit.
- No blockers for 24-04 (use-case + route/MCP wiring) or 24-05 (web board UI).

---
*Phase: 24-regime-breadth-board*
*Completed: 2026-07-09*

## Self-Check: PASSED

All created files verified present on disk; both task commits (`eca1970`, `21a75cc`) verified present in git log.

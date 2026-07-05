---
phase: 22-journal-calendar-lifecycle-graph
plan: 02
subsystem: api
tags: [attribution, pnl-decomposition, fast-check, tdd, domain]

# Dependency graph
requires:
  - phase: 22-journal-calendar-lifecycle-graph
    provides: "22-01's computeForwardVol export pattern in the journal core barrel (mirrored for this plan's export)"
provides:
  - "computeAttributionSeries(rows) — per-interval, accumulated P&L decomposition (theta/vega/deltaGamma/residual) with an exact residual plug"
  - "isGapRow(row) — gap predicate (spot='0' or any greek/IV non-finite), shared gap-classification rule for the lifecycle series"
  - "AttributionPoint / AttributionRow types exported from @morai/core"
affects: [22-03-getCalendarLifecycle-use-case, 22-05-lifecycle-chart-hero-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure domain accumulation-over-array function (no exact prior in-repo analog; spec-driven from 22-RESEARCH.md Code Examples)"
    - "fast-check .chain() to generate a dependent {values, a, b} span arbitrary for a property spanning arbitrary sub-ranges of a generated array"

key-files:
  created:
    - packages/core/src/journal/domain/attribution.ts
    - packages/core/src/journal/domain/attribution.test.ts
  modified:
    - packages/core/src/journal/index.ts

key-decisions:
  - "Baseline generalizes beyond 'index 0': the FIRST non-gap row encountered (not necessarily rows[0]) becomes the zero-cumulative baseline, so a series that opens with one or more gap rows still gets a correct, non-null accumulation once real data starts."
  - "Carry-state (last known non-gap cumulative) persists across gap rows so a post-gap non-gap row's cumulative equals the pre-gap cumulative exactly — matches the acceptance criterion and the mockup's flush() semantics."

patterns-established:
  - "Pattern: gap-tolerant sequential accumulation — track a nullable CumulativeState 'carry' plus the previous row; only add a bucket when both endpoints of an interval are non-gap; skip (never bridge) otherwise."

requirements-completed: [JRNL-01]

coverage:
  - id: D1
    description: "computeAttributionSeries decomposes P&L into theta/vega/deltaGamma buckets plus an exact residual, accumulated over the trade's life, with gap rows honestly null and never bridged"
    requirement: "JRNL-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/domain/attribution.test.ts#isGapRow / index-0 baseline / Δt-from-time / gap-in-middle / pnlOpen-dollars"
        status: pass
      - kind: unit
        ref: "packages/core/src/journal/domain/attribution.test.ts#property: accumulation identity holds over any contiguous non-gap span"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-05
status: complete
---

# Phase 22 Plan 02: Attribution Decomposition Summary

**`computeAttributionSeries` — per-interval theta/vega/delta-gamma P&L attribution with an exact residual plug and honest gap handling, exported from `@morai/core`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-05T18:00:00Z (approx, per session context)
- **Completed:** 2026-07-05T18:22:23Z
- **Tasks:** 1 (TDD: RED → GREEN, no REFACTOR needed)
- **Files modified:** 3 (2 created, 1 edited)

## Accomplishments
- `computeAttributionSeries(rows)` walks a snapshot series and accumulates four buckets per point (cumTheta, cumVega, cumDeltaGamma, cumResidual) using the locked convention: interval-start greeks, Δt from raw `time` timestamps (not integer-floored dteFront/dteBack), a blended-IV vega proxy (`netVega × Δmean(frontIv,backIv) × 100`), and pnlOpen treated as dollars (never divided by 100).
- `residual[i] = ΔpnlOpen[i] − theta[i] − vega[i] − deltaGamma[i]` is the exact plug, proven by a fast-check property test: for any generated non-gap row array and any contiguous span `[a,b]`, the sum of all four bucket deltas equals `pnlOpen[b] − pnlOpen[a]` within floating-point tolerance.
- `isGapRow` classifies a row as a gap when `spot === "0"` or any of frontIv/backIv/netDelta/netGamma/netTheta/netVega parses non-finite. Gap rows get `null` cumulatives; any interval touching a gap on either side is skipped (never bridged) — the accumulation resumes from the last known non-gap cumulative once data returns.
- Re-exported `computeAttributionSeries`, `isGapRow`, and the `AttributionPoint` type from `packages/core/src/journal/index.ts`, alongside 22-01's `computeForwardVol` (added, did not clobber).

## Task Commits

Each task was committed atomically (TDD red→green cycle):

1. **Task 1 (RED):** `b10c252` test(22-02): add failing test for computeAttributionSeries
2. **Task 1 (GREEN):** `548c930` feat(22-02): implement computeAttributionSeries per-interval P&L decomposition

No REFACTOR commit — the implementation was clean on first GREEN pass (no dead code, no duplication to remove).

## Files Created/Modified
- `packages/core/src/journal/domain/attribution.ts` - `computeAttributionSeries`, `isGapRow`, `AttributionPoint`, `AttributionRow` — pure domain, no I/O
- `packages/core/src/journal/domain/attribution.test.ts` - 8 tests: 3 `isGapRow` examples, entry-baseline, Δt-from-time, gap-in-middle skip, pnlOpen-dollars residual check, and the fast-check accumulation-identity property (500 runs)
- `packages/core/src/journal/index.ts` - added `computeAttributionSeries`/`isGapRow`/`AttributionPoint` export lines directly below 22-01's `computeForwardVol` export block

## Decisions Made
- **Baseline generalization:** the plan's acceptance criteria only specify "index 0" baseline behavior for a non-gap first row. The implementation generalizes this to "the first non-gap row encountered is the baseline" (carry starts `null`, gets set to zero cumulatives the first time a non-gap row is seen, regardless of position) — this is a strict superset of the required behavior and handles a series that opens with gap rows without needing a separate code path. Not a deviation from the plan's contract (all specified acceptance criteria pass); it's the natural total-function behavior for an unspecified edge case.
- **Carry-state persists across gaps:** rather than resetting on every gap, a `carry: CumulativeState | null` plus `prevRow` tracks the last known non-gap cumulative, so a post-gap non-gap row's cumulative exactly equals the pre-gap cumulative (verified by the gap-in-middle test using `toBeCloseTo`).

## Deviations from Plan

None — plan executed exactly as written. All locked conventions (interval-start greeks, Δt-from-time, blended-IV vega, pnlOpen-as-dollars, exact residual plug, gap-skip-never-bridge) were implemented as specified in 22-RESEARCH.md Pitfalls 1-4 and 22-CONTEXT.md D-06, with no relitigating.

## Issues Encountered
None.

## Verification

```
$ bunx vitest run packages/core/src/journal/domain/attribution.test.ts
 Test Files  1 passed (1)
      Tests  8 passed (8)

$ bun run typecheck
$ tsc --build --force
(clean, no output)

$ bunx eslint packages/core/src/journal/domain/attribution.ts packages/core/src/journal/domain/attribution.test.ts packages/core/src/journal/index.ts
(clean — only harmless config warnings about legacy boundary selectors, no errors)

$ bunx vitest run packages/core/src/journal/
 Test Files  36 passed (36)
      Tests  376 passed (376)
```

## TDD Gate Compliance

- RED commit: `b10c252` (test only, confirmed failing for the right reason — "Cannot find module './attribution.ts'").
- GREEN commit: `548c930` (implementation, all 8 tests pass).
- No REFACTOR commit needed — implementation was already clean.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `computeAttributionSeries` + `AttributionPoint` are ready for Plan 22-03's `getCalendarLifecycle` use-case to map the journal's `SnapshotRow[]` through (structural typing means `SnapshotRow` already satisfies `AttributionRow`'s shape — no adapter needed).
- `isGapRow`'s `isGap` boolean is the exact signal Plan 22-05's chart needs for the visx `LinePath` `defined` gap-aware line-break accessor.
- No blockers.

---
*Phase: 22-journal-calendar-lifecycle-graph*
*Completed: 2026-07-05*

## Self-Check: PASSED
- FOUND: packages/core/src/journal/domain/attribution.ts
- FOUND: packages/core/src/journal/domain/attribution.test.ts
- FOUND: b10c252 (RED commit)
- FOUND: 548c930 (GREEN commit)

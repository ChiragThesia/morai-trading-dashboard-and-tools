---
phase: 17-overview-v2-redesign-iv-calibration-fix
plan: 03
subsystem: ui
tags: [react, visx, payoff-chart, tdd]

# Dependency graph
requires:
  - phase: 17-overview-v2-redesign-iv-calibration-fix (plan 02)
    provides: "scenario-engine leg-level IV exclusion (frontIvStatus/backIvStatus on AnalyzerPosition) — the data source Plan 04 will thread into these new props"
provides:
  - "PayoffChart optional highlightedPositionId/highlightedTodayCurve/highlightedExpirationCurve props: net-book curves dim to stroke-opacity 0.3, single-position curves render at full emphasis (D-05)"
  - "PayoffChart optional excludedFromT0Count prop: amber 'T+0 excludes {n} position(s): IV n/a' note, singular/plural (D-02)"
  - "PayoffChart.test.tsx component-test conventions (data-testid hooks on curve LinePath elements) for future chart-prop assertions"
affects: [17-overview-v2-redesign-iv-calibration-fix plan 04, Overview.tsx TOS-dock rewrite]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Chart-layer stroke-opacity as a distinct dimming mechanism from row-level opacity-40 CSS class (UI-SPEC-mandated separation)"
    - "data-testid on visx LinePath elements to make SVG curve assertions robust in @testing-library/react tests"

key-files:
  created:
    - apps/web/src/components/charts/PayoffChart.test.tsx
  modified:
    - apps/web/src/components/charts/PayoffChart.tsx

key-decisions:
  - "highlightActive derived purely from highlightedPositionId !== null (curves/count are independent optional props) — matches the plan's prop contract without adding a second boolean"
  - "Exclusion note rendered as an absolutely-positioned HTML div (not SVG text) inside PayoffChart's own wrapper, since PayoffChart does not own the page-level '.legend' row (that lives in Overview.tsx, out of this plan's scope) — Plan 04/Overview.tsx integration can reposition or restyle without touching this component again"
  - "Only the two net-book curve LinePath elements (T+0 violet, @exp gray-muted dashed) get the stroke-opacity dim — breakeven marker lines and fan curves are left untouched, matching the acceptance criteria's explicit scope ('net-book curve elements') and avoiding scope creep"

requirements-completed: [OVW-01, OVW-02]

coverage:
  - id: D1
    description: "highlightedPositionId unset renders net-book T+0/@exp curves at full stroke-opacity with no single-position overlay (regression preserved)"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#with no highlight, net-book T+0/@exp curves render at full stroke-opacity and no single-position overlay (regression preserved)"
        status: pass
    human_judgment: false
  - id: D2
    description: "highlightedPositionId set dims net-book T+0/@exp curves to stroke-opacity 0.3 (chart-layer attribute, not the opacity-40 row class) and renders the single position's curves at full emphasis with the existing VIOLET/GRAY_MUTED tokens"
    requirement: "OVW-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#dims the net-book T+0/@exp curves to stroke-opacity 0.3 when a highlight is active (chart-layer, not opacity-40)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#renders the single highlighted position's T+0/@exp curves at full emphasis with the existing violet/gray-muted stroke tokens"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#never introduces the opacity-40 row-exclusion class into the chart-layer dim"
        status: pass
    human_judgment: false
  - id: D3
    description: "excludedFromT0Count renders the amber 'T+0 excludes {n} position(s): IV n/a' note, omitted at 0/absent, singular at 1, plural at n>1"
    requirement: "OVW-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#renders no exclusion note when excludedFromT0Count is 0 or absent"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#renders the singular exclusion note at count 1"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#renders the plural exclusion note at count 3"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-03
status: complete
---

# Phase 17 Plan 03: PayoffChart Highlight Dim + T+0 Exclusion Note Summary

**Extended PayoffChart.tsx with D-05's row-highlight dual-curve dim (stroke-opacity 0.3) and D-02's amber T+0 exclusion note, both driven by new backward-compatible props — no modal, no second chart, no data wiring (Plan 04 supplies the values).**

## Performance

- **Duration:** 10 min
- **Started:** 2026-07-03T22:22:00Z
- **Completed:** 2026-07-03T22:28:53Z
- **Tasks:** 1
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `PayoffChartProps` extended with 4 optional, backward-compatible props: `highlightedPositionId`, `highlightedTodayCurve`, `highlightedExpirationCurve`, `excludedFromT0Count`
- D-05: when a highlight is active, the net-book T+0 (violet) and @exp (gray-muted dashed) `LinePath` elements carry `strokeOpacity={0.3}` — a chart-layer SVG attribute, kept explicitly distinct from `PositionsTable`'s `opacity-40` row-exclusion CSS class per the UI-SPEC's threat-register mitigation (T-17-08)
- D-05: the single highlighted position's own T+0/@exp curves render on top at full emphasis, reusing the exact same stroke tokens as the net-book curves (`VIOLET` `#a78bfa` @ 2.6px + glow filter; `GRAY_MUTED` `#7b8696` dashed @ 1.4px)
- D-02: an amber, label-size (`text-[10px] text-amber`) note reading "T+0 excludes {n} position(s): IV n/a" renders inside the chart's own wrapper div when `excludedFromT0Count > 0`, singular/plural correct, absent at 0/undefined
- New `PayoffChart.test.tsx` (7 tests) mirrors `GexBars.test.tsx`'s render/assert conventions; adds `data-testid` hooks (`net-book-t0-curve`, `net-book-exp-curve`, `highlighted-t0-curve`, `highlighted-exp-curve`, `t0-exclusion-note`) to make SVG curve assertions robust

## Task Commits

Each task was committed atomically (TDD red→green, no refactor needed):

1. **Task 1 — RED:** `21b6dbf` — `test(17-03): add PayoffChart highlight + exclusion-note tests`
2. **Task 1 — GREEN:** `dbd8a6d` — `feat(17-03): PayoffChart dual-curve highlight + T+0 exclusion note`

**Plan metadata:** (this commit, docs)

_Note: RED confirmed via full test run — 5 assertion-level failures (missing props/data-testid hooks, not import/syntax errors) against baseline PayoffChart.tsx, 2 tests passed trivially (opacity-40 absence, no-note-at-zero). Implementation was staged via `git stash` to isolate the true baseline for the RED run, then restored for GREEN._

## Files Created/Modified
- `apps/web/src/components/charts/PayoffChart.tsx` — added 4 optional props, `highlightActive`/`netBookStrokeOpacity`/`exclusionNoteText` derived variables, `strokeOpacity` + `data-testid` on the two net-book curve `LinePath` elements, two new highlighted-overlay `LinePath` elements, and the amber exclusion-note `div`
- `apps/web/src/components/charts/PayoffChart.test.tsx` — new, 7 tests across 2 `describe` blocks (D-05 dim/overlay, D-02 exclusion note)

## Decisions Made
- `highlightActive` is derived solely from `highlightedPositionId !== null` — the curve/count props are independently optional, so a highlight can be "active" (dimming applied) even if the overlay curves haven't been supplied yet, matching the plan's stated data flow (Plan 04 supplies the curve values, this plan only renders what it's given)
- The exclusion note is rendered as an HTML `div` (not SVG `text`) positioned absolutely inside `PayoffChart`'s own wrapper — the component does not currently own a "legend row" (that markup lives in `Overview.tsx`, explicitly out of this plan's file scope), so the note is self-contained and repositionable by Plan 04's `Overview.tsx` integration without another `PayoffChart.tsx` edit
- Only the two net-book curve `LinePath` elements (T+0, @exp) receive the `stroke-opacity` dim — breakeven dashed marker lines and fan curves are left untouched, matching the acceptance criteria's literal scope ("net-book curve elements") and CLAUDE.md's surgical-change discipline

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 auto-fixes were needed; the existing file already had all the stroke tokens and constants (`VIOLET`, `GRAY_MUTED`) required, so this was a pure additive extension.

## Issues Encountered

None. Pre-existing, unrelated TypeScript errors in `Analyzer.test.tsx` and `JournalContainer.test.tsx` (React Query type mismatches) were confirmed present on baseline (via `git stash`) before this plan's changes — out of scope, not introduced by this plan, not touched.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `PayoffChart.tsx` is ready to receive real highlight/curve/count data from Plan 04's `Overview.tsx` rewrite and its per-position scenario-engine helpers — the prop contract is fixed and tested.
- Full workspace test suite green (152 test files passed, 21 skipped — testcontainer-dependent Postgres suites, no Docker locally, expected).
- `bun run typecheck` and `bun run lint` clean for both files touched in this plan.

---
*Phase: 17-overview-v2-redesign-iv-calibration-fix*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: apps/web/src/components/charts/PayoffChart.tsx
- FOUND: apps/web/src/components/charts/PayoffChart.test.tsx
- FOUND commit: 21b6dbf
- FOUND commit: dbd8a6d

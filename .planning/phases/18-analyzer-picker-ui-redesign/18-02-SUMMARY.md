---
phase: 18-analyzer-picker-ui-redesign
plan: 02
subsystem: ui
tags: [react, visx, svg, payoff-chart, testing-library]

# Dependency graph
requires:
  - phase: 17.1-overview-v2-redesign
    provides: PayoffChart's existing 3-round additive-prop idiom (highlightedPositionId/todayCurveColor/expirationCurveColor) that this plan extends a 4th time
provides:
  - "PayoffChart compareCurve/compareCurveColor optional prop pair — single dashed-amber front-expiry curve layer"
  - "PayoffChart expectedMoveBand optional prop — tick/connector layer at spot±em on the zero-P&L line, rendered under all curve layers"
affects: [18-04-picker-screen, 18-05-analyzer-rewrite]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive optional-prop extension idiom (4th round on PayoffChart): interface field + destructured function-signature default, guarded `!== null && .length > 0 &&` conditional render block"
    - "Test infra re-export of internal pure helpers (buildXScale/INNER_W alongside existing computeYDomain/buildXTicks) so tests assert exact pixel positions instead of duplicating scale math"

key-files:
  created: []
  modified:
    - apps/web/src/components/charts/PayoffChart.tsx
    - apps/web/src/components/charts/PayoffChart.test.tsx

key-decisions:
  - "compareCurve rendered as its own conditional layer alongside (not inside) the retired rollCurve block — distinct amber-dashed visual, not a repurposing"
  - "expectedMoveBand placed before the Layer-1 profit-zone fill (i.e. before all curve layers) in JSX source order so it can never occlude T+0/@exp — reuses the existing Zero-line layer's zeroY value rather than recomputing it"
  - "buildXScale/INNER_W added to the existing bottom-of-file test re-export line (test infra only, no behavior change) so new tests assert exact spot±em pixel positions against the real scale function"
  - "NOT marking ANLZ-02 complete in REQUIREMENTS.md — this plan ships only the PayoffChart chart primitives (compareCurve, expectedMoveBand); the user-facing '⊕ compare overlay with EM band and scenario strip' capability ANLZ-02 describes is delivered by the picker screen in 18-04, which is the plan that actually wires these props into a rendered UI (same precedent as 18-01's SUMMARY note on ANLZ-01/02/03)"

patterns-established:
  - "4th additive-prop round on PayoffChart proves the idiom scales cleanly: 2 more optional props added with zero changes to any existing caller"

requirements-completed: []  # ANLZ-02 intentionally NOT marked complete here — see key-decisions; actual UI delivery lands in 18-04

coverage:
  - id: D1
    description: "PayoffChart renders compareCurve as a single dashed amber line when supplied, and nothing extra when null/absent"
    requirement: "ANLZ-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#PayoffChart — compareCurve overlay (ANLZ-02) > renders exactly one dashed-amber path when compareCurve is supplied (no T+0 twin)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#PayoffChart — compareCurve overlay (ANLZ-02) > renders no extra path when compareCurve is null or omitted (Overview regression guard)"
        status: pass
    human_judgment: false
  - id: D2
    description: "PayoffChart renders expectedMoveBand as two ticks + connector at spot±em on the zero-P&L line, ordered before the T+0/@exp curve layers"
    requirement: "ANLZ-02"
    verification:
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#PayoffChart — expectedMoveBand (ANLZ-02) > renders two ticks at spot±em (via xScale) and a connector at the existing zero-P&L y"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#PayoffChart — expectedMoveBand (ANLZ-02) > places the EM-band group before the T+0/@exp curve layers in SVG source order (never occludes a curve)"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/charts/PayoffChart.test.tsx#PayoffChart — expectedMoveBand (ANLZ-02) > renders no band elements when expectedMoveBand is null or omitted"
        status: pass
    human_judgment: false
  - id: D3
    description: "Overview.tsx's existing PayoffChart call site is behaviorally unchanged (no required-prop break, no visual/behavioral drift)"
    verification:
      - kind: unit
        ref: "apps/web/src/screens/Overview.test.tsx (full suite, 33/33 pass)"
        status: pass
      - kind: other
        ref: "git diff apps/web/src/screens/Overview.tsx (empty — byte-for-byte unchanged)"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-07-03
status: complete
---

# Phase 18 Plan 02: PayoffChart compareCurve + expectedMoveBand Summary

**Extended PayoffChart with two additive optional prop pairs — compareCurve/compareCurveColor (dashed-amber ⊕-compare overlay) and expectedMoveBand (±1σ tick/connector band) — a 4th round of the component's established additive-prop idiom, with Overview.tsx's existing call site left byte-for-byte unchanged.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-03T23:38:34-05:00
- **Completed:** 2026-07-03T23:44:50-05:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `compareCurve`/`compareCurveColor` optional prop pair renders a single dashed-amber front-expiry `LinePath`, guarded `!== null && .length > 0`, as its own layer distinct from the retired `rollCurve` block
- `expectedMoveBand` optional prop renders two blue tick marks at `spot ± em` plus a horizontal connector at the existing zero-P&L y (reused via the Zero-line layer's own y-value, not recomputed), placed before every curve layer in JSX source order so it can never occlude T+0/@exp
- Both new props follow the exact `?`-optional + destructured-default idiom (`compareCurve = null`, `compareCurveColor = AMBER`, `expectedMoveBand = null`) that satisfies `exactOptionalPropertyTypes` and keeps `Overview.tsx` compiling/behaving unchanged with zero edits to that file

## Task Commits

Each task was committed atomically (single commit per task at green, per this project's `.claude/rules/tdd.md` — RED run then GREEN run, no separate RED commit, matching the 17.1-01 precedent):

1. **Task 1: Add compareCurve/compareCurveColor prop pair + dashed-amber layer (RED→GREEN)** - `893da33` (feat)
2. **Task 2: Add expectedMoveBand prop + tick/connector layer at the zero line (RED→GREEN)** - `d6c35a4` (feat)

**Plan metadata:** committed separately after this SUMMARY.

_Note: RED was run and confirmed failing for the right reason (missing element/prop, not import/syntax error) before each GREEN implementation, per tdd.md — see Deviations section for the one test-infra addition (buildXScale/INNER_W re-export) included in the Task 2 RED step._

## Files Created/Modified
- `apps/web/src/components/charts/PayoffChart.tsx` - Added `compareCurve`/`compareCurveColor`/`expectedMoveBand` to `PayoffChartProps` + destructured defaults; added the compare-curve `LinePath` layer beside `rollCurve`; added the EM-band `<g>` (2 ticks + connector + label) before the profit-zone fill layer; re-exported `buildXScale`/`INNER_W` for test use
- `apps/web/src/components/charts/PayoffChart.test.tsx` - Added 2 new `describe` blocks (6 test cases total): compareCurve overlay (absent-safe, single dashed-amber path with no twin, color override) and expectedMoveBand (absent-safe, tick/connector position via `xScale` + reused zeroY, source-order-before-curves invariant)

## Decisions Made
- `compareCurve` is a separate conditional layer next to (not inside) the `rollCurve` block, per the plan's explicit prohibition against repurposing `rollCurve`
- `expectedMoveBand` reuses the Zero-line layer's own `zeroY` value (queried in tests via the `ZERO_LINE` stroke color `#46556a`) rather than recomputing the y-scale independently, keeping the band mathematically tied to the same zero-P&L reference the chart already draws
- Added `buildXScale`/`INNER_W` to the existing test-only re-export line (already used for `computeYDomain`/`buildXTicks`) — pure test infrastructure, no behavior change, needed so the new position-assertion tests use the real scale function instead of duplicating `X_MIN`/`X_MAX`/`INNER_W` magic numbers
- Did NOT mark `ANLZ-02` complete in `REQUIREMENTS.md` — this plan ships the chart primitives only; the user-facing capability (⊕ compare overlay + EM band + scenario strip on the picker screen) is delivered by 18-04, which actually renders these props in a UI a user interacts with

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<action>` specs; no bugs, missing functionality, or blocking issues were found in the existing `PayoffChart.tsx`/`Overview.tsx` code that required an out-of-plan fix.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `PayoffChart` now has all primitives 18-04's picker screen needs to render the ⊕-compare curve and ±1σ EM band — no second payoff code path was introduced
- `Overview.tsx`'s hero chart is unaffected (verified: empty `git diff`, 33/33 tests green)
- 18-03 (candidate→AnalyzerPosition adapter) and 18-04 (picker screen rewrite) can proceed independently; neither is blocked by this plan
- Pre-existing, unrelated typecheck errors remain in `Analyzer.test.tsx`/`JournalContainer.test.tsx` (21 errors, confirmed via `git stash` to predate this plan) — out of scope per the plan's own file-modification list, logged here for visibility, not fixed

---
*Phase: 18-analyzer-picker-ui-redesign*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: apps/web/src/components/charts/PayoffChart.tsx
- FOUND: apps/web/src/components/charts/PayoffChart.test.tsx
- FOUND: .planning/phases/18-analyzer-picker-ui-redesign/18-02-SUMMARY.md
- FOUND commit: 893da33 (feat(18-02): add compareCurve/compareCurveColor overlay to PayoffChart)
- FOUND commit: d6c35a4 (feat(18-02): add expectedMoveBand tick/connector layer to PayoffChart)

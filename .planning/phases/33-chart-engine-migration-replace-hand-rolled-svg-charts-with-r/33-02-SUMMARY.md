---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 02
subsystem: web
tags: [recharts, chart-migration, customized-layer, tdd, z-order]
dependency-graph:
  requires:
    - "recharts@3.9.2 pinned (33-01)"
    - "empirical A1 z-order verdict (33-01)"
  provides:
    - "apps/web/src/components/charts/PayoffChartMarks.tsx (Customized-layer component: EM band + BE bars + edge-arrow glyphs, owns EDGE_ARROW_LANE_Y)"
    - "PayoffChartMarksProps / PayoffChartMarksGex typed prop shapes for the marks layer"
  affects:
    - "plan 33-06 (PayoffChart Recharts migration) — wires this component into a <Customized> layer instead of re-deriving clamp/lane logic"
tech-stack:
  added: []
  patterns:
    - "Scale-driven Customized-layer component (RESEARCH Assumption A2 fallback): takes a plain xScale closure + innerWidth/zeroY/domain as props instead of reading Recharts' xAxisMap/yAxisMap — renders identically whether unit-tested directly in a bare <svg> or wired into a Recharts <Customized> layer later"
    - "Manual Math.max/min clamping retained ONLY inside this Customized-layer component (not covered by Recharts axis clipPath); curves/axes in 33-06 use allowDataOverflow instead"
key-files:
  created:
    - apps/web/src/components/charts/PayoffChartMarks.tsx
    - apps/web/src/components/charts/PayoffChartMarks.test.tsx
  modified: []
decisions:
  - "PayoffChartMarks does NOT render GEX wall reference lines — only the off-domain edge-arrow glyph. The dashed wall lines map to a native Recharts ReferenceLine (Pattern 3, RESEARCH) in plan 33-06; only the KISS glyph is genuinely non-native (D-08)."
  - "Show/hide gating (toggles.showWalls, toggles.showExpiration) stays the caller's (PayoffChart's) responsibility — PayoffChartMarks is a pure presentation component driven by already-filtered props (empty arrays / null gex hide a mark), not aware of PayoffChartToggles."
  - "gex prop uses a locally-defined PayoffChartMarksGex type (same shape as PayoffChart's PayoffChartGex) rather than importing the type from PayoffChart.tsx, to avoid a reverse dependency — 33-06 will have PayoffChart import FROM PayoffChartMarks (for EDGE_ARROW_LANE_Y re-export), not the other way around."
metrics:
  duration: "~35m"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 02: PayoffChartMarks custom-layer component Summary

One-line: extracted the three genuinely-custom PayoffChart marks (EM-band ticks/connector/label, BE-marker bars, off-domain KISS edge-arrow glyphs) into one standalone, scale-driven `PayoffChartMarks.tsx` component with the 2563bd6 EM-band page-bleed regression now landing as a focused, deterministic unit test.

## What shipped

**Task 1 — RED: failing unit spec.** Wrote `PayoffChartMarks.test.tsx` against a component
that didn't exist yet — ran it and confirmed it failed for the right reason (`Failed to
resolve import "./PayoffChartMarks.tsx"`, not a mistyped assertion). 12 test cases across
4 groups: EM-band positions + the extreme-band clamp regression, BE-marker bar geometry
and colors, `EDGE_ARROW_LANE_Y` lane assignment + the two example off-domain glyph cases
+ absent-safe guards, and a `fast-check` property test (50 runs) asserting zero wall-label
text or arrow glyphs for arbitrary in-domain wall/flip levels — mirroring the property-test
intent from the existing `PayoffChart.test.tsx` KISS-collision-fix suite.

Committed at RED (`7068069`).

**Task 2 — GREEN: `PayoffChartMarks.tsx`.** Implemented the component to pass all 12 tests.
It takes a plain `xScale: (value: number) => number` closure plus `innerWidth`, `zeroY`,
`domain`, and the three mark inputs (`expectedMoveBand`, `beTodayStrikes`, `beExpStrikes`,
`gex`) as typed props — no `recharts` import, no `xAxisMap`/`yAxisMap` reads (RESEARCH
Assumption A2 fallback: "the same effect is achievable by computing xScale/yScale via the
same pure `scaleLinear`-style helper this project already has"). Ports the em-band clamp
logic, the BE-marker bar geometry/colors, and `pinMarker`/`EDGE_ARROW_LANE_Y` verbatim from
`PayoffChart.tsx`, with one behavioral narrowing: it renders only the off-domain glyph, not
the wall's dashed reference line — RESEARCH Pattern 3 maps that line to a native
`ReferenceLine`, so it belongs in 33-06's PayoffChart, not this Customized-layer extraction
(D-08 scopes this component to "the ONLY elements... that don't map to a built-in Recharts
primitive").

One deviation from a literal first draft, fixed during Task 2 before running tests: an
initial implementation computed the em-band's clamped x-coordinates inside an IIFE embedded
in the JSX conditional (`{cond && (() => {...})()}`), which violates this repo's
`.claude/rules/typescript.md` "No IIFEs in JSX — compute values in variables above the
`return`" rule. Refactored to a single `emBand` object computed above the `return`
statement (null when `expectedMoveBand` is null, otherwise `{lowerX, upperX, spotX}`),
consumed by the JSX below. No behavior change — caught and fixed before the first test run,
so this never landed as a separate commit.

Committed at GREEN (`fe04790`).

## Verification

- `bun run test -- apps/web/src/components/charts/PayoffChartMarks.test.tsx` — 12/12 green.
- `bun run typecheck` — clean (`tsc --build --force`, no errors).
- `bun run lint` — clean (0 errors, 0 warnings from this change; only the same 2
  pre-existing informational config warnings noted in 33-01-SUMMARY — legacy
  boundaries-plugin selector syntax and multiple tsconfig projects).
- `bun run test` (full workspace suite) — 288 files / 3160 tests green (baseline before
  this plan, per 33-01-SUMMARY: 287 files / 3148 tests — this plan adds exactly 1 file /
  12 tests, no regressions elsewhere).
- No `any`, `as` (other than `as const`), or `!` in either new file (manual review; both
  files are short and fully read during implementation).
- `EDGE_ARROW_LANE_Y` exported from `PayoffChartMarks.tsx` and equals
  `{ flip: 8, call: 16, put: 24 }` — matches the test assertion and the existing
  `PayoffChart.tsx` constant it will replace in 33-06.

## Findings for plan 33-06

- **Component boundary:** `PayoffChartMarks` renders ONLY the em-band group, the BE-marker
  bars, and off-domain edge-arrow glyphs — it does NOT render GEX wall dashed lines. 33-06
  needs a separate native `<ReferenceLine segment={...}>` (or plain `<ReferenceLine x={...}>`)
  per wall, positioned via the same `pinMarker`-clamped x, alongside a
  `<Customized component={...}>` wrapper that adapts `PayoffChartMarks`'s plain-scale props
  from whatever Recharts exposes at wire-up time (per Assumption A2, expect
  `xAxisMap`/`yAxisMap[...].scale` to work in 3.9.2 based on the RESEARCH citation, with the
  in-repo `buildXScale`/`buildYScale` helpers as the proven fallback if the exact prop shape
  differs).
- **Re-export contract:** `PayoffChart.tsx` currently owns `EDGE_ARROW_LANE_Y` and the
  `pinMarker` logic; per this plan's `key_links`, 33-06 should re-export
  `EDGE_ARROW_LANE_Y` FROM `PayoffChartMarks.tsx` (not redeclare it) so the existing
  `PayoffChart.test.tsx` import (`import { ..., EDGE_ARROW_LANE_Y } from "./PayoffChart.tsx"`)
  keeps resolving without that test file needing changes for this symbol specifically.
  `pinMarker` in `PayoffChartMarks.tsx` is currently a private (non-exported) module-level
  function — if 33-06's `ReferenceLine` wall-line placement also needs the exact same
  min/max clamp + `clampedTo` result, either export it from here too or accept a small
  duplicate (it's an 8-line pure function; duplication may be the lazier choice depending on
  how 33-06's wall-line code ends up shaped).
- **No new z-order evidence from this plan** — this component was tested standalone (bare
  `<svg>`, no `ComposedChart`/`Customized` wrapper), so it doesn't add to 33-01's z-order
  spike findings. 33-06 will be the first plan to actually place a `<Customized>` layer
  inside a real `ComposedChart` and should re-verify where `Customized` layers land relative
  to the `recharts-zIndex-layer_<n>` bands 33-01 found (Area=100, Bar=300, Line=400) — 33-01's
  spike did not include a `Customized` component, so its z-index band (if any / whether it
  respects the same 12-band system) is still unconfirmed empirically, not just the "custom
  zIndex override" pitfall it already flagged.

## Deviations from Plan

**1. [Rule 1 - Bug] Removed an IIFE from JSX before the first test run**
- **Found during:** Task 2, immediately after drafting the em-band block, before running
  `bun run test`.
- **Issue:** first draft computed `lowerX`/`upperX`/`spotX` inline via
  `{expectedMoveBand !== null && (() => {...})()}` to avoid repeating `xScale(...)` calls —
  violates `.claude/rules/typescript.md`'s explicit "No IIFEs in JSX" MUST NOT rule.
- **Fix:** hoisted the computation to a single `emBand` object (or `null`) above the
  `return` statement; the JSX below reads `emBand.lowerX` etc.
- **Files modified:** apps/web/src/components/charts/PayoffChartMarks.tsx (pre-test-run
  edit, part of commit `fe04790`, no separate commit).

No other deviations — plan executed as written, including the wall-line/glyph scope
narrowing, which was explicit in the plan's own behavior spec (Task 1's `<behavior>`
section only asserts arrow-glyph rendering, never wall-line rendering, from this component).

## Known Stubs

None. `PayoffChartMarks.tsx` is a fully functional, independently unit-tested component;
it is unused by `PayoffChart.tsx` until plan 33-06 wires it in, which is expected sequencing
(this plan's own `<objective>` states 33-06 "wire[s] it into the migrated chart"), not a stub.

## Self-Check: PASSED

- FOUND: apps/web/src/components/charts/PayoffChartMarks.tsx
- FOUND: apps/web/src/components/charts/PayoffChartMarks.test.tsx
- FOUND commit 7068069 (test(33-02): add failing unit spec for PayoffChartMarks)
- FOUND commit fe04790 (feat(33-02): extract PayoffChartMarks custom-layer component)

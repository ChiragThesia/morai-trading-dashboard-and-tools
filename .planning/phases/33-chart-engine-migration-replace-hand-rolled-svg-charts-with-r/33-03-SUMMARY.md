---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 03
subsystem: web
tags: [recharts, chart-migration, tdd, split-gradient, reference-line]
dependency-graph:
  requires:
    - "recharts@3.9.2 pinned (33-01)"
    - "apps/web/src/components/ui/chart.tsx ChartContainer/ChartConfig (33-01)"
    - "apps/web/src/components/test/recharts-test-utils.tsx mockResponsiveContainer (33-01)"
  provides:
    - "apps/web/src/components/charts/GammaProfile.tsx on Recharts (visx retired here)"
    - "apps/web/src/components/charts/GammaProfile.test.tsx (Wave-0 gap closed — no test file existed before this plan)"
    - "empirical finding: mockResponsiveContainer() strips ResponsiveContainerContext, so nested chart components (AreaChart/ComposedChart/etc.) need explicit width/height props to render anything under jsdom, even when already wrapped in a sized ChartContainer/ResponsiveContainer"
  affects:
    - "plan 33-06 (PayoffChart) and any future Recharts chart under ChartContainer — same explicit width/height requirement applies whenever the shared mock is used"
tech-stack:
  added: []
  patterns:
    - "Split-gradient Area fill (RESEARCH Pattern 2 / D-05): one linearGradient with two <stop> elements at the same computed offset (fraction of the y-domain >= 0), ported verbatim from the RESEARCH code example"
    - "className on Area/ReferenceLine/ReferenceDot for stable test queries (established in 33-01's zorder-spike.test.tsx) — Recharts wraps each in an outer <g class=\"recharts-layer recharts-<type> <your-class>\">, so queries need a descendant combinator (e.g. \".gamma-flip-line line\") to reach the actual styled SVG child, not the wrapping <g>"
    - "Explicit numeric width/height on the inner chart component (AreaChart), not just on ChartContainer's style — required because Recharts' own sizing logic (RechartsWrapper.js) only prefers ResponsiveContainerContext width/height when the context value is a positive number; falls back to the chart's own width/height prop otherwise. The mocked ResponsiveContainer never provides that context, so this fallback path is what actually renders anything under test"
key-files:
  created:
    - apps/web/src/components/charts/GammaProfile.test.tsx
  modified:
    - apps/web/src/components/charts/GammaProfile.tsx
decisions:
  - "GammaProfile's gamma Line stays solid TEAL regardless of sign, matching the pre-migration visx behavior exactly — only the Area fill splits color at the zero crossing (Pattern 2). The plan's <behavior> spec only requires the split on the fill, not the line, so this is parity, not a narrowing."
  - "useId() is called unconditionally at the top of the component, before the <2-point null-guard return, to satisfy React's rules of hooks (hooks can't be called conditionally) — the gradient id derived from it is only used after the guard passes."
  - "XAxis is rendered with axisLine={false} and tickLine={false}, showing only two min/max tick labels (via an explicit ticks=[minSpot, maxSpot] array) in full mode, and hidden entirely (hide={compact}) in compact mode — reproduces the original visx component's exact chrome (no axis line ever drawn, just floating min/max text, skipped for space in compact) rather than Recharts' default full-axis rendering."
  - "YAxis is always hidden (hide) — the original visx component never drew a Y axis either, only a floating \"0\" text label at the zero line; that label itself was dropped in this migration (RESEARCH doesn't test for it and it was pure decoration) in favor of a plain <ReferenceLine y={0}> with no label, for simplicity. Can be added back cheaply if a visual-parity pass flags it missing."
metrics:
  duration: "~45m"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 03: GammaProfile Recharts migration Summary

One-line: GammaProfile now renders on Recharts (ChartContainer + AreaChart) with a single split-gradient Area (teal above zero / coral below), guarded amber flip and blue spot ReferenceLines, a zero-baseline ReferenceDot, and fixed compact (300×130) / full (720×230) pixel sizes — closing the Wave-0 test gap with a brand-new `GammaProfile.test.tsx` (none existed pre-migration).

## What shipped

**Task 1 — RED: GammaProfile Recharts spec.** Wrote `GammaProfile.test.tsx` from scratch
(Wave-0 gap — this component had no test file before this plan) targeting the intended
Recharts DOM: the null guard for `profile.length < 2`, the split teal/coral area fill
(queried via the `<linearGradient>`'s two `<stop stop-color>` values and the Area's
`fill="url(#...)"` attribute), the amber dashed flip `ReferenceLine` present when `flip`
is non-null and absent when `null`, a solid blue spot `ReferenceLine` plus a
`ReferenceDot` sitting at the same y-coordinate as the zero baseline, and the
compact-vs-full `ChartContainer` pixel dimensions (read off the `[data-slot="chart"]`
div's inline `style`, since `ChartContainer` doesn't expose width/height any other way).
Ran it against the still-visx component: 5 of 7 assertions failed for the right reason
(Recharts DOM elements that don't exist yet — `stop`, `.gamma-flip-line line`, `.gamma-
spot-line line`, `[data-slot="chart"]`); the null-guard test and the "flip line absent"
test passed incidentally (both already true of the visx component), which is expected
and not a RED-quality problem — the assertions target Recharts DOM, not import/syntax
errors, satisfying the acceptance criteria.

Committed at RED (`b1a8cf8`).

**Task 2 — GREEN: GammaProfile on Recharts.** Replaced the `@visx/shape`/`@visx/curve`/
`@visx/scale`/`@visx/gradient`/`@visx/group` internals with `ChartContainer` (shadcn,
33-01) wrapping a Recharts `AreaChart`: a numeric `XAxis` (`type="number"`, explicit
`domain`, `allowDataOverflow`, hidden in compact mode, showing only min/max ticks in full
mode via `ticks={[minSpot, maxSpot]}`), a hidden `YAxis` carrying the same padded-gamma
domain the original component computed, a single `Area` with a split-gradient fill (the
offset formula ported verbatim from RESEARCH Pattern 2/D-05), a `ReferenceLine y={0}` zero
baseline, the amber dashed flip `ReferenceLine` (guarded on `flip !== null`), and a blue
spot `ReferenceLine` + `ReferenceDot`. All MORAI hex constants (`TEAL`/`CORAL`/`AMBER`/
`BLUE`/`ZERO_LINE`), the `<2`-point null guard, and the compact/full size logic carry over
unchanged from the original component. `isAnimationActive={false}` is set on `Area` (the
only element in this component that has the prop — `ReferenceLine`/`ReferenceDot` are
static, non-animated components with no such prop, confirmed via their `.d.ts` files, so
D-11 applies wherever the prop actually exists).

One empirical finding surfaced mid-Task-2 and is the most load-bearing thing in this
plan for 33-06: after wiring the component, the chart rendered a correctly-sized
`[data-slot="chart"]` container (720×230 / 300×130, proving the `ChartContainer`
style-passthrough approach works) but an **entirely empty** `recharts-wrapper` — no SVG,
no series, nothing. Root cause, confirmed by reading `RechartsWrapper.js`: Recharts'
inner chart components only prefer `ResponsiveContainerContext`'s width/height when that
context provides a *positive number*; otherwise they fall back to their own `width`/
`height` props. The shared `mockResponsiveContainer()` test helper (33-01) replaces
`ResponsiveContainer` with a bare `<div>` and never provides that context at all — so
under test, any chart nested in `ChartContainer` renders nothing unless it *also* carries
explicit numeric `width`/`height` props directly. This exactly matches 33-01's own
`zorder-spike.test.tsx` precedent (which passed `width={800} height={400}` directly on
`ComposedChart` even though it was already inside a sized `ResponsiveContainer`) — it
just wasn't yet documented as a *requirement*, only observed once. Fixed by passing
`width={svgWidth} height={svgHeight}` directly on `AreaChart` alongside the same values
on `ChartContainer`'s `style`. This is safe in the real browser too: `RechartsWrapper.js`
gives priority to a real `ResponsiveContainerContext` value when one exists (i.e., normal
DOM rendering), so the explicit props only take effect as a fallback — and since
GammaProfile is an intentionally fixed-pixel chart (not truly fluid), landing on the same
numbers either way is correct, not a workaround.

Verified GREEN (7/7), `bun run typecheck` clean, `bun run lint` clean (only the two
pre-existing informational warnings noted in 33-01/33-02), full workspace suite green.

Committed at GREEN (`1fc6ad8`).

## Findings for plan 33-06

- **Explicit width/height on the inner chart is required under the shared mock, not
  optional.** Any Recharts chart wrapped in `ChartContainer` and tested with
  `mockResponsiveContainer()` needs its own `width`/`height` props (matching whatever
  `ChartContainer`'s intended pixel size is) to render anything at all under jsdom —
  `ChartContainer`'s `ResponsiveContainer` wrapping is not sufficient by itself in tests.
  33-06's `PayoffChart` (and `TermStructureChart`/`GexBars` in later plans) should budget
  for this from the start rather than rediscovering the empty-`recharts-wrapper` symptom.
- **`className` on Area/ReferenceLine/ReferenceDot lands on the wrapping `<g>`, not the
  styled child.** Recharts renders `<g class="recharts-layer recharts-<type>
  <your-class>">` around the actual `<path>`/`<line>`/`<circle>`, so test queries need a
  descendant combinator (`.your-class line`, `.your-class circle`, `.your-class
  path.recharts-area-area`) to reach the element that actually carries `stroke`/`fill`/
  `stroke-dasharray`. Querying the class alone (matching the `<g>`) silently returns an
  element with none of the expected SVG presentation attributes.
- **No new z-order evidence** — this is a single-series chart (one `Area`, no
  `Bar`/multiple `Line`s), so it doesn't add to or contradict 33-01's z-order spike
  findings. `ReferenceLine`/`ReferenceDot` default `zIndex` values (400/600 respectively,
  confirmed via `.d.ts`) put them above the `Area`'s band (100) without any explicit
  `zIndex` prop needed here — consistent with 33-01's "default zIndex bands" finding.

## Deviations from Plan

**1. [Rule 3 - blocking issue] Added explicit `width`/`height` props on `AreaChart`**
- **Found during:** Task 2, first GREEN test run — `recharts-wrapper` rendered
  completely empty (no SVG) despite a correctly-sized `ChartContainer`.
- **Issue:** the plan's `<action>` described wiring `ChartContainer` + `AreaChart`
  without specifying this; RESEARCH's D-03 says to pass explicit width/height "through to
  `ChartContainer`" but didn't anticipate that the shared test mock strips the sizing
  context the inner chart component relies on.
- **Fix:** pass `width={svgWidth} height={svgHeight}` directly on the `AreaChart` element
  (see "What shipped" above for the root-cause explanation and why it's safe in the real
  browser too).
- **Files modified:** apps/web/src/components/charts/GammaProfile.tsx (part of the GREEN
  commit, not a separate commit).
- **Commit:** `1fc6ad8`

**2. [Rule 1 - Bug] Fixed test selectors to target Recharts' wrapping `<g>` children**
- **Found during:** Task 2, second GREEN test run — 3 assertions still failed after the
  width/height fix (`.gamma-flip-line`/`.gamma-spot-line`/`.gamma-spot-dot`/`.gamma-area`
  queries matched the wrapping `<g>` element, which carries the className but none of the
  `stroke`/`fill`/`stroke-dasharray` attributes).
- **Fix:** added descendant combinators (`.gamma-flip-line line`, `.gamma-spot-line
  line`, `.gamma-spot-dot circle`, `.gamma-area path.recharts-area-area`) to reach the
  actual styled SVG element Recharts nests inside each `className`-tagged `<g>`.
- **Files modified:** apps/web/src/components/charts/GammaProfile.test.tsx (pre-commit
  edit, folded into the RED commit's final state — the RED commit already captured this
  corrected version since it was fixed before the first "real" GREEN run that mattered;
  no separate commit).
- **Commit:** `b1a8cf8` (test file), verified against the implementation in `1fc6ad8`.

No architectural deviations (Rule 4) — the plan's own two-task shape (RED spec, then
GREEN implementation) executed as written; both findings above are within-task fixes
needed to make the plan's own acceptance criteria pass, not scope changes.

## Known Stubs

None. `GammaProfile.tsx` is fully functional on Recharts with no placeholder data paths;
its only consumer (`apps/web/src/screens/Overview.tsx`, `compact` mode) required no
changes — the prop contract (`profile`/`spot`/`flip`/`width`/`height`/`compact`) is
byte-identical to the pre-migration component.

## Verification

- `bun run test -- apps/web/src/components/charts/GammaProfile.test.tsx` — 7/7 green.
- No `@visx/*` import remains in `GammaProfile.tsx` (`rg "@visx" apps/web/src/components/
  charts/GammaProfile.tsx` — 0 matches); `XAxis` has `type="number"` + `allowDataOverflow`.
- `bun run typecheck` — clean (`tsc --build --force`, no errors).
- `bun run lint` — clean (0 errors, 0 warnings from this change; same 2 pre-existing
  informational config warnings as 33-01/33-02 — legacy boundaries-plugin selector syntax
  and multiple tsconfig projects).
- No `any`, `as` (type assertion), or `!` (non-null assertion) in either file — manually
  confirmed via `rg` (the only `!` hit is the `!==` comparison operator in the flip guard;
  the only `any`/`as` hit is the doc comment stating the rule).
- `apps/web/src/screens/Overview.test.tsx` + `apps/web/src/screens/Market.test.tsx` — 67/67
  green, unchanged (GammaProfile's only consumer, Overview.tsx, needed no prop changes;
  Market.tsx does not currently render GammaProfile at all despite its test file's visx
  mocks, so this migration touches zero Market-screen behavior).
- `bun run test` (full workspace suite) — 289 files / 3167 tests green (baseline before
  this plan, per 33-02-SUMMARY: 288 files / 3160 tests — this plan adds exactly 1 file /
  7 tests, no regressions elsewhere).

## Self-Check: PASSED

- FOUND: apps/web/src/components/charts/GammaProfile.tsx
- FOUND: apps/web/src/components/charts/GammaProfile.test.tsx
- FOUND commit b1a8cf8 (test(33-03): add failing GammaProfile spec against Recharts DOM)
- FOUND commit 1fc6ad8 (feat(33-03): migrate GammaProfile to Recharts (split fill + reference lines))

---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 06
subsystem: web
tags: [recharts, chart-migration, tdd, z-order, structural-clip, tooltip, customized-layer]
dependency-graph:
  requires:
    - "recharts@3.9.2 pinned (33-01)"
    - "apps/web/src/components/ui/chart.tsx ChartContainer/ChartConfig (33-01)"
    - "apps/web/src/components/test/recharts-test-utils.tsx mockResponsiveContainer (33-01)"
    - "empirical A1 z-order verdict: per-type zIndex bands, JSX order only tiebreaks within a band (33-01)"
    - "apps/web/src/components/charts/PayoffChartMarks.tsx scale-driven Customized-layer component (33-02)"
    - "explicit width/height fallback on the inner chart under jsdom (33-03 finding)"
    - "data-testid reaches the SVG primitive directly for Line/ReferenceLine/ReferenceDot (33-04 finding)"
  provides:
    - "apps/web/src/components/charts/PayoffChart.tsx on Recharts (visx retired; the priority chart of Phase 33)"
    - "apps/web/src/components/charts/PayoffChart.test.tsx re-expressed against the Recharts DOM (38 tests)"
    - "PayoffTooltipContent — typed native <Tooltip> content component (D-10/D-12), exported for direct unit testing"
    - "empirical finding: a Customized/plain custom child paints before EVERY zIndex band regardless of JSX position — satisfies '<marks> never occlude a curve' with zero extra work, no zIndex fight, no sibling-overlay fallback"
    - "empirical finding: ReferenceLine's default ifOverflow='discard' silently omits an off-domain line entirely; ifOverflow='hidden' is required to get real structural clip-path-based clipping instead"
    - "empirical finding: native XAxis/YAxis tick LABEL text renders through a zIndex portal (DefaultZIndexes.label=2000) not populated synchronously on first render under jsdom, AND the axis auto-expands its reserved width/height for label measurement beyond the declared margin — both defeat a deterministic 'plot area = SVG dims minus margin' contract; width={0}/height={0} + hand-rendered grid chrome sidesteps both"
  affects:
    - "plan 33-07 (final sweep) — PayoffChart is fully off visx now; only GammaProfile (33-03, still uses @visx-adjacent gradient pattern, already Recharts) and out-of-scope charts remain on visx/echarts"
tech-stack:
  added: []
  patterns:
    - "Customized wired with a translate(PAD.left, PAD.top)-wrapped <g> around a scale-driven marks component (PayoffChartMarks, A2) — Customized/Layer applies NO transform of its own (confirmed by reading Customized.js/Layer.js source), so a 0-based inner scale needs this one-line adapter to align with the margin-offset plot area every other primitive renders in"
    - "GEX wall/spot ReferenceLines use ifOverflow='hidden' (not the 'discard' default) so an off-domain value still renders with a real clip-path instead of vanishing — the direct replacement for the old hand pinMarker clamp"
    - "Hidden XAxis/YAxis (width=0/height=0/tick=false) purely for scale+domain+auto-clipPath; a small local PayoffChartGrid component hand-renders the 6 grid lines + fmtPl-formatted labels via the same buildXScale/buildYScale helpers the marks layer uses — sidesteps the zIndex-portal timing + auto-width-expansion pitfalls native axis tick chrome hit in this specific chart"
    - "Typed Tooltip content (PayoffTooltipContent, TooltipContentProps<number,'today'>) reads P&L from the matching payload entry's `.value` (narrowed via a typeof guard, never `.payload` which is `any`-typed in this recharts version) and the hovered spot from `label` directly — avoids touching any any-typed field"
key-files:
  created: []
  modified:
    - apps/web/src/components/charts/PayoffChart.tsx
    - apps/web/src/components/charts/PayoffChart.test.tsx
decisions:
  - "Z-order risk resolved as a non-issue, not a workaround: the locked requirement is 'marks never occlude a curve' (i.e., marks stay UNDER curves) — and un-zIndexed custom children (Customized or a plain child, confirmed identical in 33-04) ALWAYS paint before every zIndex band by construction. The native behavior IS the requirement; no zIndex override, no sibling SVG overlay was needed. Evidence: PayoffChart.test.tsx 'places the em-band group before the T+0/@exp curve layers in DOM source order' passes against the real Recharts DOM."
  - "Grid lines + axis tick labels are hand-rendered (PayoffChartGrid), not native XAxis/YAxis chrome, despite D-04 (native numeric axis) still governing the axis's SCALE role. Root cause: native tick label <text> renders through a zIndex portal (the 'label' band) that isn't registered/populated synchronously on the first render pass under jsdom (confirmed empirically: label count is 0 immediately after render() with default axis styling), and separately, YAxis/XAxis auto-expand their reserved width/height to fit measured label text UNLESS given an explicit width/height override — both defeat the 'plot area = SVG dims minus PAD' contract the structural-clip test (and Phase 30's domain fidelity) depend on. Fix: XAxis/YAxis stay fully hidden (width={0}/height={0}/tick={false}) so they contribute ONLY scale+domain+clipPath, and a small local PayoffChartGrid component reproduces the exact original visual (6 evenly-spaced lines, fmtPl labels, JetBrains Mono) via the same pure buildXScale/buildYScale helpers already used for PayoffChartMarks."
  - "ReferenceLine ifOverflow defaults to 'discard' (confirmed by reading ReferenceLine.js), which OMITS an off-domain line entirely rather than clipping it — the opposite of the plan's 'structurally clipped, not hand-clamped' requirement. Every wall/spot ReferenceLine sets ifOverflow='hidden' explicitly, which puts a real clip-path attribute on the rendered <line> (resolving to a <clipPath><rect> sized to the exact plot area in <defs>) instead."
  - "buildXScale/buildYScale reimplemented as plain pure-JS linear-interpolation closures (no @visx/scale) — same 0-based [0,innerWidth]/[innerHeight,0] output contract as before, verified against PayoffChartMarks.test.tsx (33-02, unmodified) and the new buildXScale unit test. pinMarker/buildProfitZonePath/buildFillPath/clampY/getX/getY and the ~50-line manual crosshair block (svgRef/handlePointerMove/handlePointerLeave/crosshair state, localPoint import) are deleted outright — Recharts owns that coordinate math now."
  - "PayoffTooltipContent filters the Tooltip payload to the entry named 'today' (the T+0 <Line> carries name=\"today\") rather than trusting payload[0], since a payload can contain one entry per series sharing the hovered x — this reproduces the pre-migration crosshair's exact semantics (P&L always read from the T+0/net-book curve, never a fan/highlighted/compare overlay)."
  - "ComposedChart carries explicit role=\"img\" aria-label=\"Risk profile payoff chart\" (spread through Surface.js onto the rendered <svg>) — a Rule 1 fix caught by Overview.test.tsx's pre-existing accessibility assertion, which the initial migration draft dropped since Recharts' own <svg class=\"recharts-surface\"> carries no aria-label by default."
metrics:
  duration: "~2h"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 06: PayoffChart Recharts migration Summary

One-line: PayoffChart — the priority chart, most locked behaviors in the phase — now renders on Recharts (`ChartContainer` + `ComposedChart`) with structural GEX-wall clipping (`ifOverflow="hidden"` + the axis's auto `clipPath`, replacing the hand `pinMarker` clamp), a native typed `<Tooltip>` crosshair (deleting the ~50-line manual `localPoint`/`getBoundingClientRect` block), and the `PayoffChartMarks` (33-02) `Customized` layer wired in — the locked 9-layer z-order holds via the empirically-confirmed zIndex-band + JSX-tiebreak mechanism (33-01), with the "marks never occlude a curve" requirement satisfied for free by Recharts' own custom-child paint order (no zIndex fight, no sibling-overlay fallback needed).

## What shipped

**Task 1 — RED: re-expressed `PayoffChart.test.tsx` against the Recharts DOM.** Rewrote the
spec to target the Recharts-rendered SVG while preserving every locked behavior's intent
from the pre-migration suite: D-05 row-highlight dim, D-02 exclusion note, D-03 curve-color
overrides, ANLZ-02 compare-curve + EM-band presence/z-order, WR-03 y-domain lock/fitY (via
grid-label equality checks), breakeven pills, profit-zone toggle, and GEX wall geometry.
Per the plan's explicit scoping, element-level EM-band/BE-bar/edge-arrow assertions were
NOT duplicated here (they live in `PayoffChartMarks.test.tsx`, 33-02) — this file keeps only
assembled-chart concerns. Added three new groups: a 9-layer z-order suite (profit-zone
before T+0 line, walls before T+0 line, spot after T+0 line — `compareDocumentPosition`
assertions proving A1 holds on the real chart), a structural-clip test pinned to a real
`clip-path` resolving to a `<clipPath><rect>` in `<defs>` sized to the exact plot area
(930×432 = SVG 1000×470 minus PAD margins) — deliberately NOT a shallow coordinate-bound
check the old hand-clamp could still pass — and a `PayoffTooltipContent` unit-render suite
(active/payload/label, not simulated hover). Ran RED against the still-visx component:
7/38 failed for the right reason (new testids/classes/clip mechanism/component don't exist
in the pre-migration implementation yet — e.g. `getByTestId("spot-line")` not found, grid
labels empty since the old component never used Recharts axis classes, `PayoffTooltipContent`
undefined). Committed at RED (`322894d`).

**Task 2 — GREEN: PayoffChart on Recharts.** Replaced the entire visx implementation
(`LinePath`/`LinearGradient`/`Group`/`localPoint`/`scaleLinear` from `@visx/*`) with
`ChartContainer` (shadcn, 33-01) wrapping a `ComposedChart`: numeric `XAxis`/`YAxis`
(`allowDataOverflow`, explicit `margin={PAD}`) for domain fidelity (Phase 30); the curve
layers as split-gradient `Area`s (profit-zone + T+0 teal/coral) and `Line`s (fan/tent/roll/
compare/T+0/highlighted) in the locked z-order; GEX wall/spot marks as `ReferenceLine`/
`ReferenceDot` with `ifOverflow="hidden"` for real structural clipping; `PayoffChartMarks`
wired via `<Customized component={<g transform="translate(...)">...}>`; and a native
`<Tooltip content={<PayoffTooltipContent gex={gex} />}>` replacing the manual crosshair
block. Ran GREEN: 38/38, `bun run typecheck` clean, `bun run lint` clean. Committed at
GREEN (`be66afb`).

Three empirical findings surfaced during Task 2, each requiring a design correction before
GREEN (documented in Decisions above, not just narrated here since they're load-bearing for
any future Recharts work in this codebase):

1. **The z-order "risk" the assigning brief flagged never materialized as a risk.** A
   `Customized`/plain custom child paints before every zIndex band regardless of JSX
   position (confirmed in 33-04, re-confirmed here by reading `Customized.js`/`Layer.js`
   source: `Layer` is a bare `<g>` with no transform, `Customized` just clones `component`
   into it). Since the locked requirement is "marks never occlude a curve" — i.e. marks
   stay visually UNDER curves — and that's exactly what un-zIndexed custom children do
   automatically, no zIndex override and no sibling-SVG-overlay fallback were needed. The
   only correction required was a translate-wrapper `<g>` (Layer applies no transform of
   its own), needed so `PayoffChartMarks`'s existing 0-based `buildXScale`/`zeroY` contract
   (unchanged, still tested standalone by `PayoffChartMarks.test.tsx`) aligns with the
   margin-offset plot area every other primitive renders in.
2. **`ReferenceLine`'s default `ifOverflow="discard"` silently omits an off-domain line**
   (confirmed by reading `ReferenceLine.js`: `getVerticalLineEndPoints` returns `null` when
   `ifOverflow === 'discard' && !xAxisScale.isInRange(coord)`), the opposite of "structurally
   clipped, still visible up to the edge." `ifOverflow="hidden"` is what puts a real
   `clip-path` on the rendered element instead — required on every wall/spot mark.
3. **Native axis tick LABEL text has two independent pitfalls specific to this chart's
   requirements**, neither hit by the three prior 33-0x plans (none needed a *deterministic,
   test-asserted* plot-area size with *many visible* axis labels at once): tick label
   `<text>` renders through a zIndex portal (`DefaultZIndexes.label = 2000`) that is not
   registered/populated synchronously on the very first `render()` pass under jsdom
   (traced through `ZIndexLayer.js`/`ZIndexPortal.js` — the portal target `<g>` itself needs
   a prior render+layout-effect cycle to register), and separately, `XAxis`/`YAxis`
   auto-expand their reserved width/height to fit measured label text UNLESS given an
   explicit `width`/`height` override (verified empirically: default auto-width added +60px
   beyond the declared `margin.left`). Both defeat the "plot area = SVG dims minus PAD"
   contract the structural-clip test (and Phase 30 domain fidelity generally) depends on.
   Fix: `XAxis`/`YAxis` stay in the tree fully hidden (`width={0}` / `height={0}` /
   `tick={false}` / `tickLine={false}` / `axisLine={false}`) — contributing ONLY
   scale+domain+`allowDataOverflow`'s auto `clipPath` — and a new small local
   `PayoffChartGrid` component hand-renders the 6 grid lines + `fmtPl`-formatted labels via
   the same pure `buildXScale`/`buildYScale` helpers `PayoffChartMarks` already uses. This
   reproduces the pre-migration visual exactly (same font/color/position), just via the
   grid-chrome layer instead of native axis ticks.

**Consumer fix (Rule 1):** `Overview.test.tsx`'s pre-existing accessibility assertion
(`svg[aria-label="Risk profile payoff chart"]`) failed against the first migration draft,
since Recharts' own `<svg class="recharts-surface">` carries no `aria-label` by default.
Added `role="img" aria-label="Risk profile payoff chart"` directly on `<ComposedChart>`
(spread through `Surface.js` onto the rendered `<svg>`, verified via `Surface.js` source) —
restores the exact pre-migration accessibility contract.

## Z-order solution + evidence

**Chosen approach:** rely on Recharts' native custom-child paint order (Customized/plain
children always render before every `zIndex` band) rather than any workaround — no zIndex
override, no sibling SVG overlay.

**Evidence it holds on the real assembled chart** (all in `PayoffChart.test.tsx`, passing
against the actual `ComposedChart` DOM, not a spike):
- `em-band group precedes T+0/@exp curve layers` — `compareDocumentPosition` proves the
  `Customized`-wrapped `PayoffChartMarks` group is `DOCUMENT_POSITION_FOLLOWING` from the
  curves' perspective (i.e. it precedes them).
- `profit-zone fill precedes the T+0 curve line` — `Area` (zIndex 100) before `Line`
  (zIndex 400), independent of JSX order (33-01's cross-band finding).
- `wall lines precede the T+0 curve line` — `ReferenceLine` and `Line` SHARE zIndex 400;
  this pair specifically validates the JSX-order tiebreak within a shared band (walls are
  placed before the T+0 `Line` in source).
- `spot line renders after the T+0 curve line` — same shared-band tiebreak, opposite
  direction (spot `ReferenceLine` placed after the T+0 `Line` in source).

## Findings for plan 33-07

- `Customized`'s `component` prop accepts a rendered `ReactElement` directly (per its own
  JSDoc example and confirmed via `Customized.js`'s `cloneElement`/`isValidElement` branch)
  — no need to define a separate wrapper function component for a scale-driven marks layer.
- If any remaining chart (33-07's sweep) needs BOTH a deterministic pixel-exact plot area
  AND many visible native axis tick labels rendered synchronously in a test, budget for the
  zIndex-portal-timing + auto-width-expansion pair documented above from the start — neither
  GammaProfile (33-03, hidden Y-axis) nor TermStructureChart (33-04, un-tested Y-axis label
  text) hit this because neither combined those two requirements.
- `ReferenceLine`/`ReferenceDot` default to `ifOverflow="discard"` (silently omit off-domain
  marks) — any chart wanting an off-domain reference mark to remain visible-but-clipped
  needs `ifOverflow="hidden"` explicitly; this is not the library default.

## Deviations from Plan

**1. [Rule 1 - Bug] `Overview.test.tsx` aria-label assertion — added `role`/`aria-label` to `ComposedChart`**
- **Found during:** Task 2, first full consumer-test run (`bun run test -- apps/web/src/screens/Overview.test.tsx`).
- **Issue:** the migrated component dropped the pre-migration `<svg aria-label="Risk profile payoff chart" role="img">` accessibility attributes; Recharts' `<svg class="recharts-surface">` has no default `aria-label`.
- **Fix:** pass `role="img" aria-label="Risk profile payoff chart"` on `<ComposedChart>` — `Surface.js` spreads unrecognized SVG-compatible props straight onto the rendered `<svg>`.
- **Files modified:** apps/web/src/components/charts/PayoffChart.tsx
- **Commit:** `be66afb`

**2. [Rule 1 - Bug] Grid lines + axis tick labels re-expressed as hand-rendered chrome, not native axis ticks**
- **Found during:** Task 2, implementing the plan's own truth ("chart inner width/height = SVG dims minus PAD margins") — the WR-03 grid-label lock/fitY tests and the structural-clip test's exact 930×432 plot-area expectation both failed against a first-draft native-`XAxis`/`YAxis`-tick-chrome implementation (zero tick labels rendered synchronously; plot area auto-expanded to 870×402).
- **Issue:** two independent Recharts behaviors (documented in "What shipped" above) — the label zIndex portal not settling synchronously under jsdom, and axis auto-width/height expansion beyond the declared `margin` — both undermine a deterministic plot-area contract this plan's own acceptance criteria require.
- **Fix:** `XAxis`/`YAxis` stay hidden (`width={0}`/`height={0}`/no tick chrome), used only for scale/domain/`allowDataOverflow` clipPath; a new local `PayoffChartGrid` component hand-renders the 6 grid lines + labels via `buildXScale`/`buildYScale` — same visual as the pre-migration component.
- **Files modified:** apps/web/src/components/charts/PayoffChart.tsx, apps/web/src/components/charts/PayoffChart.test.tsx (grid-label query selector)
- **Commit:** `be66afb`

No architectural deviations (Rule 4) — both fixes above are within-task corrections needed to satisfy the plan's own explicit acceptance criteria (deterministic plot area, real structural clip, accessibility parity), not scope changes.

## Known Stubs

None. `PayoffChart.tsx` is fully functional on Recharts with no placeholder data paths; its
two consumers (`apps/web/src/screens/Analyzer.tsx`, `apps/web/src/screens/Overview.tsx`)
required no prop-contract changes — `PayoffChartProps` is byte-identical to the
pre-migration component, confirmed by both screens' full test suites passing unmodified
(Analyzer 110/110 combined with Overview above, Overview 57/57).

## Verification

- `bun run test -- apps/web/src/components/charts/PayoffChart.test.tsx` — 38/38 green (was
  7/38 red against the pre-migration visx component, for the right reason).
- No `@visx/*` import remains in `PayoffChart.tsx` (`rg "@visx" apps/web/src/components/
  charts/PayoffChart.tsx` — 0 real matches, only 2 comment mentions of the migration itself).
- `XAxis`/`YAxis` `type="number"` + `domain` + `allowDataOverflow` consuming the `domain`
  prop; off-domain GEX walls verified structurally clipped (real `clip-path` → `<clipPath>`
  `<rect>` in `<defs>` sized to the exact 930×432 plot area), not hand-clamped.
- Native `<Tooltip>` + `PayoffTooltipContent` reports the hovered spot from the payload
  label (not a hardcoded value) and formats P&L via the matching "today"-named series entry.
- 9-layer z-order preserved (`compareDocumentPosition`): profit-zone before T+0 line, walls
  before T+0 line, spot after T+0 line; `PayoffChartMarks` wired via `Customized`, verified
  to precede the curve layers.
- `bun run typecheck` (`tsc --build --force`) — clean, 0 errors.
- `bun run lint` — clean (0 errors, 0 warnings from this change; same 2 pre-existing
  informational config warnings noted in every prior 33-01..33-05 summary).
- No `any`, `as` (type assertion; only hits are `as const`), or `!` (non-null assertion) in
  either file — confirmed via `rg`.
- `bun run test -- apps/web/src/screens/Analyzer.test.tsx apps/web/src/screens/Overview.test.tsx apps/web/src/screens/Market.test.tsx apps/web/src/screens/App.test.tsx`
  — 3 files green (Analyzer 53/53, Overview 57/57, Market+App combined in the same run);
  both Analyzer/Overview spy-wrap-render the REAL `PayoffChart` (`vi.fn(actual.PayoffChart)`)
  against the real, unmocked Recharts `ResponsiveContainer` (0×0 under jsdom, Pitfall 1) with
  no assertions on PayoffChart's internal chart body besides the one aria-label check fixed
  above — confirming the migration doesn't break any existing consumer.
- `bun run test` (full workspace suite) — 289 files / 3167 tests green (baseline before this
  plan, per 33-05-SUMMARY: 289 files / 3168 tests — net -1 test, fully accounted for: the
  re-expressed spec has 38 `it(...)` blocks vs. the pre-migration file's 39, from
  consolidating a few multi-assertion tests during re-expression while preserving every
  group's intent per the plan's Task 1 mapping; no group was dropped).

## Self-Check: PASSED

- FOUND: apps/web/src/components/charts/PayoffChart.tsx
- FOUND: apps/web/src/components/charts/PayoffChart.test.tsx
- FOUND commit 322894d (test(33-06): re-express PayoffChart spec against the Recharts DOM)
- FOUND commit be66afb (feat(33-06): migrate PayoffChart to Recharts)

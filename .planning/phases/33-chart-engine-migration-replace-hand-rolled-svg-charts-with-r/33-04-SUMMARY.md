---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 04
subsystem: web
tags: [recharts, chart-migration, tdd, segment-reference-line, guard-case, z-order]
dependency-graph:
  requires:
    - "recharts@3.9.2 pinned (33-01)"
    - "apps/web/src/components/ui/chart.tsx ChartContainer/ChartConfig (33-01)"
    - "apps/web/src/components/test/recharts-test-utils.tsx mockResponsiveContainer (33-01)"
    - "explicit width/height fallback on the inner chart under jsdom (33-03 finding)"
  provides:
    - "apps/web/src/components/picker/TermStructureChart.tsx on Recharts (hand-rolled SVG retired)"
    - "apps/web/src/components/picker/TermStructureChart.test.tsx re-expressed against the Recharts DOM"
    - "empirical finding: data-testid on Line/ReferenceLine/ReferenceDot lands directly on the rendered SVG primitive in recharts 3.9.2 (no wrapper-<g> indirection needed, unlike className)"
    - "empirical finding: un-zIndexed custom child components (the Customized-wrapper replacement) render at a fixed DOM position before the zIndex-100 layer, regardless of JSX order — they paint underneath every zIndex-banded primitive"
  affects:
    - "plan 33-06 (PayoffChart) — both findings above are directly relevant: PayoffChart is the most testid-heavy remaining chart, and its 9-layer z-order design needs to budget for any custom hook-based mark painting under the layered primitives"
tech-stack:
  added: []
  patterns:
    - "Forward-IV bracket as a native ReferenceLine `segment` prop (RESEARCH Pattern 3) — direct replacement for the hand-drawn `M${frontX} ${yScale(fwdIv)}H${backX}` SVG path string"
    - "Guard tag (T-18-10/WR-02) reads the chart's own axis scales via recharts 3.8+ hooks (useXAxisScale/useYAxisScale/usePlotArea) instead of hand-rolled linear-interpolation pixel math — the one genuinely non-standard mark on this chart (D-08), rendered as a plain child component per recharts 3.x's 'render your components directly' replacement for the deprecated Customized wrapper"
    - "data-testid passed straight through to Line/ReferenceLine/ReferenceDot lands on the actual rendered SVG primitive (path/line/circle), not a wrapping <g> — contrast with 33-03's className finding (className lands on the wrapping <g>); verified empirically via a throwaway probe test before committing to the design"
    - "Line's default per-point dot rendering (dot!=false) duplicates any data-testid/className onto both the curve path and each data-point's dot circle — dot={false} keeps a Line's testid singular for getByTestId"
key-files:
  created: []
  modified:
    - apps/web/src/components/picker/TermStructureChart.tsx
    - apps/web/src/components/picker/TermStructureChart.test.tsx
decisions:
  - "Leg dots use native ReferenceDot (not a Customized layer) — a first-class primitive fits directly, per the plan's own 'ReferenceDot or a small Customized layer' latitude and D-08's determination that only 3 elements across all 4 charts (none in TermStructureChart) genuinely need a Customized layer."
  - "Guard tag uses a plain function component calling recharts 3.8's useXAxisScale/useYAxisScale/usePlotArea hooks, not the deprecated <Customized component={...}/> wrapper — recharts 3.x's own deprecation note for Customized says to render custom components directly, and the hooks are the modern, non-deprecated way to reach the chart's axis scales from inside one."
  - "Dropped the exported xScale/yScale hand-rolled scale functions from the component (task 2's acceptance criteria: 'no hand-rolled inline scale/path SVG remains for the chart marks') — the re-expressed test no longer imports them, computing relative-position intent (front left of back, back higher than front) from the rendered DOM's own cx/cy attributes instead."
  - "Dropped the small decorative amber circle that used to sit atop each event's vertical dashed line — the plan's own task 2 action text describes event markers as dashed ReferenceLines only ('the amber dashed event markers (ReferenceLine per event...)'), no dot; no test covered the circle either, and the dashed line alone still conveys the marker."
  - "Chart width stays responsive: ChartContainer gets `className=\"aspect-[760/230] w-full\"` (tailwind-merge overrides the shadcn default `aspect-video`), so a real browser's ResponsiveContainer measures a fluid width matching the original CSS-scaled SVG. The inner LineChart also carries explicit width={760} height={230} as the jsdom/test fallback (33-03 finding) — RechartsWrapper.js prefers a real ResponsiveContainerContext value when one exists, so the fixed props are inert in the browser and only take effect under test."
metrics:
  duration: "~50m"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 04: TermStructureChart Recharts migration Summary

One-line: TermStructureChart now renders on Recharts (ChartContainer + LineChart) with the forward-IV bracket as a native `ReferenceLine` `segment`, front/back leg `ReferenceDot`s, amber dashed event `ReferenceLine`s, and a hook-driven guard-tag badge (`useXAxisScale`/`useYAxisScale`/`usePlotArea`) that preserves the WR-02 on-canvas clamp without hand-rolled pixel math — re-expressed test suite passes 10/10, and the 3 testids the Analyzer screen's own tests depend on (`term-structure-leg-dot-front`, `term-structure-fwd-bracket`, `term-structure-guard-tag`) kept working unmodified.

## What shipped

**Task 1 — RED: re-expressed TermStructureChart spec against the Recharts DOM.** Rewrote
`TermStructureChart.test.tsx` to target the Recharts-rendered SVG rather than the hand-rolled
one: kept the load-bearing guards exact (forward-IV bracket present for the normal candidate,
absent for the guard candidate; guard tag present with no `NaN` in the DOM; WR-02's on-canvas
clamp; WR-03's asOf-driven event x-placement), and downgraded the two coordinate-exact leg-dot
tests (formerly asserting `cx`/`cy` against the hand-rolled `xScale`/`yScale` helpers) to color
+ relative-position intent — front dot is coral and sits left of the back dot (smaller DTE),
back dot is teal and sits higher than the front dot (higher IV). Ran against the
still-hand-rolled component: 3 of 10 tests failed for the right reason (missing
Recharts-specific DOM — `x1` on the event marker's own element, `stroke` on the bracket's own
element, a missing `.recharts-surface` node), the other 7 passed incidentally (the old
component happens to also set `fill`/testids directly, same as the 33-03 precedent). No
import/syntax crash. Committed at RED (`c7add72`).

**Task 2 — GREEN: TermStructureChart on Recharts.** Replaced the hand-rolled inline SVG
(polyline path, event `<line>`s, leg `<circle>`s, hand-drawn bracket path, guard
`<rect>`/`<text>`) with `ChartContainer` (shadcn, 33-01) wrapping a Recharts `LineChart`: a
numeric `XAxis` (`dataKey="dte"`, domain `[0, 82]`, `allowDataOverflow`, custom `0d`/`20d`/...
tick labels) and numeric `YAxis` (domain `[0.08, 0.155]`, `allowDataOverflow`, custom `9`/`12`/
`15` tick labels matching the original's 3 gridlines), a `CartesianGrid` (horizontal-only,
matching the original's thin horizontal gridlines), the ATM-IV term-structure `Line`
(`type="linear"`, `dot={false}`, matching the original's straight-segment polyline, no per-point
dots), amber dashed event `ReferenceLine`s placed by `eventDte(asOf)` (unchanged date-arithmetic
helpers), front (coral) / back (teal) leg `ReferenceDot`s, and the forward-IV bracket as a native
`ReferenceLine` `segment={[{x: frontDte, y: fwdIv}, {x: backDte, y: fwdIv}]}` (RESEARCH Pattern
3) — the direct replacement for the old `M${frontX} ${yScale(fwdIv)}H${backX}` path string. All
MORAI hex constants, the fixed DTE/IV domains, and the dated legend + caption plain-HTML rows
carry over unchanged. `isAnimationActive={false}` on the `Line` (the only element here with the
prop). No `any`/`as` (besides `as const`)/`!` (besides `!==`).

The guard tag (fwdIv null, T-18-10/WR-02) is the one genuinely non-standard mark on this chart
(D-08) — no native Recharts primitive draws a rounded-rect background behind text at a
pixel-clamped position. It's a plain function component (`GuardTag`) rendered directly as a
`LineChart` child (recharts 3.x's documented replacement for the deprecated `<Customized/>`
wrapper — "all charts are able to render arbitrary elements anywhere"), reading the chart's own
axis scales via the recharts-3.8 hooks `useXAxisScale()`/`useYAxisScale()`/`usePlotArea()` to
convert the front/back leg's DTE/IV into pixel coordinates, then applying the exact same clamp
logic as the original (`Math.max(plotArea.y, Math.min(frontY, backY) - 22)`) so the tag never
paints above the plot area when the higher leg sits at `IV_MAX` — verified against the fixture's
actual guard candidate (front IV 0.155, exactly `IV_MAX`), which clamps the tag to the plot's top
edge.

Ran GREEN on the first implementation attempt (10/10), `bun run typecheck` introduces zero new
errors (see Deviations — 15 pre-existing, unrelated errors are baseline), `bun run lint` clean.
Committed at GREEN (`830fe5c`).

## Empirical validation before committing to the design

Before writing the RED test, ran a series of throwaway probe tests (not committed) to settle two
open questions empirically rather than guess:

1. **Does `data-testid` typecheck and render correctly on `Line`/`ReferenceLine`/`ReferenceDot`?**
   Yes to both — `tsc` accepts it with zero errors (these components' Props types extend
   `SVGProps<SVGLineElement>`/similar, which TypeScript's JSX checking doesn't flag as excess),
   and at runtime it lands **directly on the rendered SVG primitive** (`<path
   class="recharts-curve recharts-line-curve" data-testid="...">`, `<line ... data-testid="...">`,
   `<circle ... data-testid="...">`) — not on a wrapping `<g>`. This is the opposite of 33-03's
   `className` finding (`className` lands on the wrapping `<g>`, requiring a descendant
   combinator like `.foo-line line`). Because of this, `screen.getByTestId(...)` on this chart's
   marks returns the actual styled element directly — no `.querySelector("line")` needed, and the
   re-expressed WR-03 test could read `x1` straight off the returned element.
2. **Do `useXAxisScale`/`useYAxisScale`/`usePlotArea` return real values inside a custom child
   component under the shared jsdom mock?** Yes — probed with the fixture's actual guard-case
   leg values (front IV 0.155 = `IV_MAX`) and got real pixel numbers back (`frontY: 5` = the
   plot's top edge), confirming the clamp math would engage exactly as intended before writing a
   single line of the real component.

## Findings for plan 33-06

- **`data-testid` reaches the actual SVG primitive for `Line`/`ReferenceLine`/`ReferenceDot`, no
  wrapper indirection.** This directly benefits PayoffChart (33-06), which is the most
  testid-heavy remaining chart — any of its marks built from these three primitives can carry
  `data-testid` straight through without the `.foo-line line`-style descendant queries 33-03's
  `className` finding required.
- **Un-zIndexed custom child components render at a fixed DOM position, underneath every
  zIndex-banded primitive.** A plain function component rendered directly inside a chart (the
  `Customized`-wrapper replacement) shows up in the DOM right after the chart's `<defs>`/clipPath
  and *before* the `recharts-zIndex-layer_100` group — regardless of where it sits in JSX among
  the chart's other children. Every recognized primitive (`Line` at zIndex 400, `ReferenceDot` at
  zIndex 600, axes at 500, etc.) paints in a *later* DOM position and therefore renders *on top*
  of it. For this chart's guard tag that's cosmetically low-stakes (a small badge offset above
  the leg dots, unlikely to visually overlap the axis/gridlines in practice) and was accepted
  as-is rather than chased further, consistent with 33-01's own "flag, don't over-solve"
  precedent for the z-order spike's open follow-up. **33-06 should budget for this explicitly**
  if PayoffChart's locked 9-layer z-order needs any custom hook-based mark to render above its
  `Area`/`Bar`/`Line` layers — a plain custom child component will not do that automatically, and
  neither does `<Customized/>` (confirmed by reading its source: it's a bare `<Layer>` wrapper
  with no zIndex handling at all).
- **`Line`'s default dot rendering duplicates `data-testid`/`className` onto every data point's
  dot circle in addition to the curve path.** `dot={false}` is required to keep a `Line`'s testid
  singular (`getByTestId` fails with "multiple elements" otherwise) — worth checking for any
  `Line` in PayoffChart that also needs a stable single testid.

## Deviations from Plan

None — plan executed exactly as written, GREEN on the first implementation attempt with no
auto-fix cycles needed. The judgment calls the plan left open (ReferenceDot vs. Customized layer
for leg dots; how to build the guard tag) are documented as Decisions above, not deviations —
each resolves within the plan's own stated latitude ("ReferenceDot or a small Customized layer")
and D-08's "everything else resolves to a native Recharts idiom" determination.

## Known Stubs

None. `TermStructureChart.tsx` is fully functional on Recharts with no placeholder data paths;
its consumer (`apps/web/src/screens/Analyzer.tsx`) required no changes — the prop contract
(`termStructure`/`events`/`asOf`/`candidate`) is byte-identical to the pre-migration component,
confirmed by `Analyzer.test.tsx`'s 53/53 tests passing unmodified.

## Verification

- `bun run test -- apps/web/src/components/picker/TermStructureChart.test.tsx` — 10/10 green
  (was 3/10 red against the pre-migration component, for the right reason).
- Forward-IV bracket present (native `ReferenceLine` `segment`) for the normal candidate
  (`7500-260723-260814`), omitted (guard tag shown, no `NaN` in the DOM) for the guard candidate
  (`7450-guard-inverted`, front IV 0.155 / back IV 0.105 — inverted term structure).
- WR-03 preserved: the same absolute event date renders at a smaller x for a later `asOf`.
- WR-02 preserved: the guard tag's `rect`/`text` `y` stay within `[0, chartHeight]` — verified
  against the fixture's actual guard candidate, whose front IV (0.155) sits exactly at `IV_MAX`
  (the scenario that trips the clamp), reading `chartHeight` off the rendered
  `.recharts-surface`'s own `height` attribute rather than a hardcoded constant (the old test
  hardcoded `H = 150`, stale against the component's actual 230px height).
- `bun run typecheck` — introduces 0 new errors; 15 pre-existing errors remain, all unrelated to
  this plan's two files (`ErrorBoundary.tsx`, `Button.tsx`, `useMacro.test.ts`,
  `candidate-to-position.test.ts`, `parsed-calendar-to-candidate.ts`/`.test.ts`, `tos-order.test.ts`,
  `Analyzer.test.tsx`, `JournalContainer.test.tsx`, `Overview.test.tsx` — confirmed via
  `git status --short apps/web` showing a clean tree before this plan started, and `git log` on
  each file showing its last change was Phase 30, well before Phase 33). Out of scope per the
  workflow rule's scope boundary; not fixed, not touched.
- `bun run lint` — clean (0 errors, 0 warnings from this change; the same 2 pre-existing
  informational config warnings noted in every prior 33-01/33-03 summary).
- No `any`, `as` (type assertion; only hit is `as const`), or `!` (non-null assertion; only hit
  is the `!==` comparison operator) in either file — confirmed via `rg`.
- `bun run test -- apps/web/src/screens/Analyzer.test.tsx` — 53/53 green, unmodified. This
  screen-level test never mocks recharts' `ResponsiveContainer` at all, and still finds
  `term-structure-leg-dot-front`/`term-structure-fwd-bracket`/`term-structure-guard-tag` by
  their exact testids — proving the explicit `width={760} height={230}` fallback on the inner
  `LineChart` (not `mockResponsiveContainer()`) is what makes this work under jsdom, matching the
  33-03 finding this plan was told to budget for from the start.
- `bun run test` (full workspace suite) — 289 files / 3167 tests green, unchanged from the
  33-03 baseline (this plan replaces content in an existing test file rather than adding a new
  one, and keeps the same 10-test count as before).

## Self-Check: PASSED

- FOUND: apps/web/src/components/picker/TermStructureChart.tsx
- FOUND: apps/web/src/components/picker/TermStructureChart.test.tsx
- FOUND commit c7add72 (test(33-04): re-express TermStructureChart spec against the Recharts DOM)
- FOUND commit 830fe5c (feat(33-04): migrate TermStructureChart to Recharts (segment bracket + guard case))

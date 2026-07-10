---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 05
subsystem: web
tags: [recharts, chart-migration, tdd, horizontal-bars, cell-coloring, category-axis]
dependency-graph:
  requires:
    - "recharts@3.9.2 pinned (33-01)"
    - "apps/web/src/components/ui/chart.tsx ChartContainer/ChartConfig (33-01)"
    - "apps/web/src/components/test/recharts-test-utils.tsx mockResponsiveContainer (33-01)"
    - "explicit width/height fallback on the inner chart under jsdom (33-03 finding)"
  provides:
    - "apps/web/src/components/charts/GexBars.tsx on Recharts (echarts-for-react retired here)"
    - "apps/web/src/components/charts/GexBars.test.tsx re-expressed against the Recharts DOM"
    - "empirical finding: Cell's fill lands directly on the rendered <path class=\"recharts-rectangle\"> bar shape, no wrapping <g> indirection — the opposite of className on ReferenceLine/Area (33-03 finding), and a third distinct data-attachment behavior alongside 33-04's data-testid-reaches-the-primitive finding"
    - "empirical finding: a category-axis (type=\"category\") ReferenceLine only renders when its y value exactly matches one of the axis's category values — a non-matching numeric value (e.g. a continuous spot price against discrete strike categories) silently renders nothing, no console warning"
  affects:
    - "any future Recharts chart using a category axis with continuous-valued reference marks — the exact-match requirement is a real gap the marker/reference-mark author must handle explicitly (snap-to-nearest or a numeric axis), not something to discover after committing to a design"
tech-stack:
  added: []
  patterns:
    - "Category-axis (type=\"category\") YAxis for horizontal bars — BarChart layout=\"vertical\" pairs a numeric value XAxis with a category strike YAxis (RESEARCH D-14/Pitfall 8's naming trap: layout=\"vertical\" means bars grow horizontally)"
    - "Per-bar conditional coloring via Cell (RESEARCH D-07/Don't-Hand-Roll) — Cell's fill overrides land straight on the shape Recharts renders, so tests query the shape directly (no descendant combinator needed, unlike className)"
    - "Snap-to-nearest-category for a continuous reference value on a category axis — verified empirically (throwaway probe test, not committed) that ReferenceLine y=<non-matching-value> on a category YAxis renders nothing; the fix reuses the same nearest-strike technique windowStrikes already uses for its ATM lookup, applied to the currently visible (windowed) strike set"
key-files:
  created: []
  modified:
    - apps/web/src/components/charts/GexBars.tsx
    - apps/web/src/components/charts/GexBars.test.tsx
decisions:
  - "Spot's reference line is placed at the nearest VISIBLE strike (nearestStrikeK over the windowed set), not the literal spot price, because a category-axis ReferenceLine only renders at an exact category match (verified empirically before writing the RED test) and spot is a continuous price that essentially never equals a strike exactly. This is a Rule 1 bug fix, not a new feature: the pre-migration echarts markLine placed spot/wall lines at xAxis: <price> on a VALUE axis whose domain is the $Bn gamma-exposure scale (roughly -6..+2), so the price-scale marker was placed off-chart and never actually visible in production — the migration is the first point these lines become genuinely visible, and doing so faithfully requires resolving the axis-type mismatch rather than porting the invisible original literally."
  - "Call-wall/put-wall reference lines use the wall price directly (y={callWall}/y={putWall}) with no snapping, because a 'wall' is by definition one of the already-present strikes with maximum OI — it is either an exact category match (renders) or outside the currently windowed strike range (correctly absent, matching Recharts' own ifOverflow=\"discard\" default rather than a bug)."
  - "OI mode keeps two separate stacked Bar series (dataKey=\"coi\" teal, dataKey=\"negPoi\" coral, shared stackId) rather than a per-bar Cell — this directly mirrors the pre-migration echarts two-series stacked design (call OI stacked with negated put OI) and needs no per-bar sign branching since each series is a fixed color."
  - "svgWidth (the jsdom/browser-fallback numeric width passed to the inner BarChart) falls back to a fixed 720px constant only when the width prop is the responsive default \"100%\" string; a caller-supplied numeric width is used directly. ChartContainer itself keeps style={{width: \"100%\", height}} so the real ResponsiveContainer still measures and fills its parent in the browser — the fallback is inert there, matching TermStructureChart's (33-04) and GammaProfile's (33-03) precedent for a chart that stays genuinely responsive rather than fixed-pixel."
metrics:
  duration: "~40m"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 05: GexBars Recharts migration Summary

One-line: GexBars now renders on Recharts (`ChartContainer` + `BarChart layout="vertical"`) with per-bar `Cell` sign coloring in GEX mode, stacked call/put `Bar`s in OI mode, a plain amber `Bar` in Volume mode, and spot/call-wall/put-wall `ReferenceLine`s — spot snapped to the nearest visible strike since a category-axis reference line only renders on an exact match, a real bug fix since the pre-migration echarts markLines were placed on the wrong axis and were never actually visible.

## What shipped

**Task 1 — RED: re-expressed GexBars spec against the Recharts DOM.** Before writing the
test, ran a throwaway probe (not committed) rendering a minimal `BarChart layout="vertical"`
with `Cell` and two `ReferenceLine`s — one at an exact category match, one at a
non-matching continuous value — to settle two open questions empirically rather than guess:

1. **Does `Cell`'s `fill` land on the shape directly, or on a wrapping `<g>`?** Directly on
   the shape: `<path class="recharts-rectangle" fill="#ef5350" ...>`. This is the opposite
   of 33-03's `className`-on-`Area`/`ReferenceLine` finding (which lands on a wrapping
   `<g>`, requiring a descendant combinator) — `Cell`'s fill override merges straight into
   the shape's own props, so the RED test queries `path.recharts-rectangle` directly with
   no indirection.
2. **Does a category-axis `ReferenceLine` interpolate for a value that isn't in the
   category domain?** No. `y={7500}` (an exact strike in the probe's 3-row fixture)
   rendered a full-width `<line>`; `y={7381.12}` (not a strike) rendered nothing at all —
   no error, no console warning, just silently absent. This directly matters for GexBars'
   spot line, since spot is a continuous price that essentially never equals a strike
   exactly.

With that settled, rewrote `GexBars.test.tsx`: dropped the `vi.mock("echarts-for-react",
...)` stub, added `mockResponsiveContainer()` (called before importing `GexBars`, per the
33-03 precedent), and replaced the two echarts-stub assertions with two Recharts-DOM
assertions — per-bar `Cell` fill colors matching each fixture strike's GEX sign, and the
presence + stroke color of the spot/call-wall/put-wall `ReferenceLine`s (plus a companion
test that the wall lines are absent when `callWall`/`putWall` are `null`, mirroring
33-03's flip-line precedent). The tab-picker test, the "GEX initially active" test, all
3 `windowStrikes` tests, and the `fmtBn` units-regression test are byte-identical to the
pre-migration file. Ran RED against the still-echarts component: 2 of 9 tests failed for
the right reason (`path.recharts-rectangle` and `.gex-*-line line` don't exist against
echarts' canvas output), the other 7 passed incidentally (tabs are plain shadcn DOM,
`windowStrikes`/`fmtBn` are pure functions untouched by the chart library). Committed at
RED (`cfdce27`).

**Task 2 — GREEN: GexBars on Recharts.** Replaced `ReactECharts` + `buildOption` with
`ChartContainer` (shadcn, 33-01) wrapping a Recharts `BarChart layout="vertical"`
(RESEARCH D-14/Pitfall 8's naming trap — `layout="vertical"` is Recharts' name for
horizontal bars): a numeric `XAxis` (`domain` computed per mode, `allowDataOverflow`,
`fmtBn` tick formatter only in GEX mode) and a category `YAxis` (`dataKey="k"`, the
strikes). A single `useMemo` computes a discriminated-union `{kind, data, domain,
windowed}` per mode (reusing the untouched `windowStrikes` helper), which the JSX narrows
without any `as`:

- **GEX mode:** one `Bar dataKey="gex"` with a `Cell` per row, `fill` teal when
  `gex >= 0` else coral — the direct `Cell` port of echarts' `itemStyle.color`
  (RESEARCH D-07/Don't-Hand-Roll).
- **OI mode:** two stacked `Bar`s (`dataKey="coi"` teal, `dataKey="negPoi"` coral, shared
  `stackId`) — mirrors echarts' two-series stacked call/put design; put OI is negated so
  it stacks to the left of zero.
- **Volume mode:** one plain amber `Bar dataKey="vol"`.

The three `ReferenceLine`s: `putWall`/`callWall` use the wall price directly as `y`
(renders when the wall's strike is inside the currently windowed set, silently absent
otherwise — Recharts' own default `ifOverflow="discard"` behavior, not a workaround).
`spot` uses a new `nearestStrikeK()` helper — the same nearest-match technique
`windowStrikes` already uses to find its ATM index, applied to the windowed strike set —
because the raw spot price essentially never exactly matches a category value. All three
MORAI hex constants, the tab picker, `handleModeChange`, mode-lock (`modeProp`/
`showTabs`), `windowStrikes`, and `fmtBn` carry over unchanged. `isAnimationActive={false}`
on every `Bar`. `BarChart` gets an explicit numeric `width`/`height` fallback (falling
back to a fixed 720px only when the responsive `"100%"` default is in effect; a
caller-supplied numeric width passes through directly) — inert in the browser where
`ChartContainer`'s real `ResponsiveContainer` measures and overrides it, required under
the jsdom mock per the 33-03 finding.

Ran GREEN on the first implementation attempt (9/9), `bun run typecheck` clean, `bun run
lint` clean. Committed at GREEN (`498e698`).

## A pre-existing bug this migration surfaces (and fixes)

The pre-migration echarts config placed the spot/call-wall/put-wall `markLine`s at
`xAxis: <price>` — but GexBars' x-axis is the VALUE axis (gamma exposure, roughly a
-6..+2 $Bn range for the current fixtures), not a price axis. A `markLine` at
`xAxis: 7381` (a real SPX-range spot price) would render far outside that domain — off
the visible chart, effectively invisible in production, with no error. This was very
likely a dormant, unnoticed bug in the pre-migration component: the "spot/wall dashed
lines drawn over bars" behavior documented in the component's own header comment and in
UI-SPEC was probably never actually visible on screen.

Migrating onto Recharts' category-axis `ReferenceLine` (`y={wallPrice}`/`y={spot}`)
puts the lines on the correct axis (the strike axis), making them visible for the first
time — but exposed the second issue (exact-match-only category positioning) described
above, which the `nearestStrikeK()` snap resolves. This is documented as a Rule 1 (auto-
fix bug) deviation below, not a scope change: the plan's own truth requires these lines
to be "present ... over the bars," and a literal port of the original axis assignment
would leave them structurally present in the JSX but functionally invisible, same as
before.

## Findings

- **`Cell`'s `fill` lands directly on the rendered shape** (`path.recharts-rectangle`),
  unlike `className` on `Area`/`ReferenceLine`/`ReferenceDot` (33-03), which lands on a
  wrapping `<g>`. Any future per-datum-colored `Bar`/`Area`/`Pie` using `Cell` can query
  the shape directly with no descendant combinator.
- **A category-axis `ReferenceLine` requires an exact domain match** — `yAxisScale.map()`
  for a band/category scale performs a lookup, not an interpolation; a non-matching value
  silently renders nothing (confirmed by reading `CartesianScaleHelper.js`/
  `ReferenceLine.js` and verifying empirically). Any future chart mixing a category axis
  with a continuous-valued reference mark needs an explicit snap-to-nearest or a numeric
  axis — this is not obvious from the Recharts docs and doesn't warn at runtime.

## Deviations from Plan

**1. [Rule 1 - Bug] Spot reference line snapped to the nearest visible strike, not the raw spot price**
- **Found during:** Task 1's pre-write probe (empirical validation before committing to
  the RED test's design, per the 33-04 precedent).
- **Issue:** a category-axis `ReferenceLine` only renders at an exact match; the raw
  continuous spot price essentially never equals a strike exactly, so a literal
  `ReferenceLine y={spot}` would silently never render — failing the plan's own truth
  ("spot ... render as reference lines over the bars").
- **Fix:** added `nearestStrikeK()`, reusing `windowStrikes`' existing nearest-match
  technique against the currently windowed strike set; the `ReferenceLine`'s `y` is the
  snapped strike, its label text still shows the true spot price (`spot 7381`).
- **Files modified:** apps/web/src/components/charts/GexBars.tsx (part of the GREEN
  commit), apps/web/src/components/charts/GexBars.test.tsx (RED commit — the "spot line
  present" assertion targets the snapped behavior from the start).
- **Commit:** `498e698` (implementation), `cfdce27` (test)

No architectural deviations (Rule 4) — both tasks executed within the plan's own stated
shape (RED spec, then GREEN implementation); the finding above is a within-task
correctness fix needed to make the plan's own truth ("present over the bars") actually
hold, not a scope change.

## Known Stubs

None. `GexBars.tsx` is fully functional on Recharts with no placeholder data paths; its
consumers (`apps/web/src/screens/Market.tsx`, `apps/web/src/screens/Overview.tsx`)
required no changes — the prop contract (`strikes`/`spot`/`callWall`/`putWall`/`width`/
`height`/`mode`/`range`) is byte-identical to the pre-migration component.

## Verification

- `bun run test -- apps/web/src/components/charts/GexBars.test.tsx` — 9/9 green (was
  2/9 red against the pre-migration echarts component, for the right reason).
- No `echarts-for-react` import remains in `GexBars.tsx` (`rg "echarts-for-react"
  apps/web/src/components/charts/GexBars.tsx` — 0 matches); `BarChart layout="vertical"`
  with a numeric value `XAxis` and category strike `YAxis` (D-14).
- Per-bar `Cell` sign colors (GEX mode) + spot/call-wall/put-wall `ReferenceLine`s
  verified present; tab picker + mode-lock preserved unchanged.
- `bun run typecheck` (`tsc --build --force`) — clean, 0 errors.
- `bun run lint` — clean (0 errors, 0 warnings from this change; the same 2 pre-existing
  informational config warnings noted in every prior 33-01/33-03/33-04 summary: legacy
  boundaries-plugin selector syntax and multiple tsconfig projects).
- No `any`, `as` (type assertion; only hits are `as const`), or `!` (non-null assertion;
  only hits are the `!==` comparison operator) in either file — confirmed via `rg`.
- `bun run test -- apps/web/src/screens/Market.test.tsx apps/web/src/screens/Overview.test.tsx apps/web/src/App.test.tsx`
  — 70/70 green, unmodified. These three consumers/global-shell tests keep their own
  `vi.mock("echarts-for-react", ...)` stubs (still load-bearing for `GexByExpiry.tsx`,
  which stays on echarts, out of scope) and render `GexBars` against the real,
  unmocked Recharts `ResponsiveContainer` (0×0 under jsdom, per Pitfall 1) with no
  assertions on GexBars' internal chart body — confirming the migration doesn't break
  any existing consumer.
- `bun run test` (full workspace suite) — 289 files / 3168 tests green (baseline before
  this plan, per 33-04-SUMMARY: 289 files / 3167 tests — this plan nets +1 test: from 8
  pre-migration GexBars tests to 9 re-expressed ones).

## Self-Check: PASSED

- FOUND: apps/web/src/components/charts/GexBars.tsx
- FOUND: apps/web/src/components/charts/GexBars.test.tsx
- FOUND commit cfdce27 (test(33-05): re-express GexBars spec against the Recharts DOM)
- FOUND commit 498e698 (feat(33-05): migrate GexBars to Recharts (horizontal bars + Cell coloring + reference lines))

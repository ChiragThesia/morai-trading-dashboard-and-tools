---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
reviewed: 2026-07-11T00:29:04Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - apps/web/src/components/charts/PayoffChart.tsx
  - apps/web/src/components/charts/PayoffChart.test.tsx
  - apps/web/src/components/charts/PayoffChartMarks.tsx
  - apps/web/src/components/charts/PayoffChartMarks.test.tsx
  - apps/web/src/components/charts/GammaProfile.tsx
  - apps/web/src/components/charts/GammaProfile.test.tsx
  - apps/web/src/components/charts/GexBars.tsx
  - apps/web/src/components/charts/GexBars.test.tsx
  - apps/web/src/components/picker/TermStructureChart.tsx
  - apps/web/src/components/picker/TermStructureChart.test.tsx
  - apps/web/src/components/test/recharts-test-utils.tsx
  - apps/web/src/components/charts/zorder-spike.test.tsx
  - apps/web/src/components/ui/chart.tsx
  - apps/web/src/components/ui/toggle-group.tsx
  - eslint.config.js
  - apps/web/package.json
  - docs/architecture/stack-decisions.md
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
fixed_at: 2026-07-10T19:52:00Z
fix_status: all_fixed
fixes:
  CR-01: { status: fixed, commit: 3ed089c }
  WR-01: { status: fixed, commit: bdda9ca }
  WR-02: { status: fixed, commit: f51e724 }
  WR-03: { status: fixed, commit: b7ecd18 }
  IN-01: { status: no_action_required }
---

# Phase 33: Code Review Report

**Reviewed:** 2026-07-11T00:29:04Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Reviewed the Recharts migration of all four in-scope charts (PayoffChart, PayoffChartMarks,
GammaProfile, GexBars, TermStructureChart) against their pre-migration originals (`git show
9750257:...`), plus the shared test scaffolding, the shadcn `ui/chart.tsx` primitive, the
scoped ESLint carve-out, and the dependency/docs bookkeeping. The engineering is careful and
mostly self-aware: the GexBars wall/spot-line axis fix is a real, verifiable correctness
improvement (the old echarts `markLine`s used a nonsensical `coord` shape *and* the wrong
axis — they were provably invisible in production, not a working baseline the migration
regressed from); the structural-clip test genuinely resolves a real `<clipPath><rect>` sized
to the plot area rather than asserting a coordinate bound; the ESLint carve-out is scoped to
exactly the two rules the shadcn-generated file trips and nothing wider; and `PayoffChartMarks`
correctly reproduces the EM-band's pre-migration position (already under every curve layer in
the old code too).

One BLOCKER survived this discipline: the phase's own highest-risk claim — "marks-under-curves
via native custom-child paint order satisfies the locked z-order requirement, no workaround
needed" — is verified in the 33-06 SUMMARY and test suite only for the EM band. Reading the
pre-migration component's actual render order shows the BE-marker bars and KISS edge-arrow
glyphs (the other two things `PayoffChartMarks` draws) had the **opposite** relationship in the
old code: they painted on top of the profit-zone fill, both T+0 fills, the fan/tent/roll/compare
curves, and the GEX wall lines — only ever under the final T+0 stroke. Wiring all three marks
through one `<Customized>` layer moved the BE bars and edge arrows under all of those layers too,
inverting a relationship the old code deliberately built the other way.

Three WARNING-level findings round this out: `GammaProfile`'s flip/spot `ReferenceLine`s don't
carry the `ifOverflow="hidden"` treatment `PayoffChart` explicitly added for the identical
off-domain risk (and the old visx version's `overflow: visible` at least kept an out-of-range
line partially visible, where the new default silently drops it); `TermStructureChart`'s
forward-IV bracket label flips from sitting 16px below the bracket line to ~5px above it
(traced through Recharts' own `getCartesianPosition.js` — a zero-height `segment`'s
`insideBottom` position computes `y - offset`, not `y + offset`); and the pre-migration
`PayoffChart.test.tsx` regression test asserting an in-domain GEX wall's actual pixel
x-coordinate was dropped without replacement — the new suite only checks stroke color for
in-domain walls. One INFO item notes a disclosed, cosmetic-only drop (the small amber dot
`TermStructureChart` used to draw at each event marker's top).

## Critical Issues

### CR-01: `PayoffChartMarks`' BE-marker bars and edge-arrow glyphs now paint *under* layers they used to paint *on top of* — the phase's own highest-risk z-order claim doesn't hold for two of the three marks it covers

**Status:** fixed (commit `3ed089c`) — `PayoffChartMarks` split into two renders: the EM band
stays in the existing `<Customized>` layer (correct, under-everything); BE-marker bars and
edge-arrow glyphs moved into a `<ZIndexLayer zIndex={DefaultZIndexes.line}>` placed after the
wall lines in JSX, sharing the `Line`/`ReferenceLine` zIndex-400 band so the JSX-order
tiebreak (33-01) lands them above walls/fills/curves and below only the final T+0 stroke.
`ZIndexLayer` is a documented public recharts export (since 3.4) using a preset
`DefaultZIndexes` value, not an arbitrary custom zIndex (33-01 found those silently fail to
render) — verified empirically with a throwaway probe before committing to the design.
`compareDocumentPosition` tests added for `be-marker-t0`, `be-marker-exp`, and the off-domain
edge-arrow glyph against `profit-zone`, `wall-line-call`, and `net-book-exp-curve`.

**File:** `apps/web/src/components/charts/PayoffChart.tsx:618-633` (Customized wiring),
`apps/web/src/components/charts/PayoffChartMarks.tsx:147-197` (BE bars + edge arrows)

**Issue:** 33-06's own SUMMARY states the z-order risk is "resolved as a non-issue, not a
workaround," citing one passing test: `em-band group precedes T+0/@exp curve layers`
(`PayoffChart.test.tsx:248-262`). That test is true and the em-band's position is genuinely
unchanged from the pre-migration component — but `PayoffChartMarks` renders three different
marks under one `<g>` (`PayoffChartMarks.tsx:102-198`: EM band, BE-marker bars, edge-arrow
glyphs), and `<Customized>` paints the *entire* wrapped tree before every `zIndex` band
(confirmed by 33-01/33-04's own empirical findings and reused here). The SUMMARY generalizes
the one tested fact (EM band) to all three marks without checking the other two against the
old component's actual render order.

Reading the pre-migration file (`git show 9750257:apps/web/src/components/charts/PayoffChart.tsx`)
line by line:

- **EM band** (old lines 564-612): rendered immediately after the zero line, *before* the
  profit-zone fill (old Layer 1, line 614), T+0 fills (Layer 2, line 626), fan/tent/roll/compare
  curves, and wall lines. Already under every curve layer — the new `Customized` placement
  reproduces this correctly. Not a regression.
- **BE-marker bars** (old lines 747-775, "Breakeven markers" — both `be-marker-exp` and
  `be-marker-t0`): rendered *after* the profit-zone fill, both T+0 fills, fan curves, expiration
  tent, roll overlay, compare overlay, **and** the GEX wall lines (old Layer 6, lines 698-745) —
  i.e. visually on top of all of them. Only the final T+0 stroke (old lines 777-790, "Layer 2 (on
  top)") painted after the BE markers.
- **Edge-arrow glyphs** (old lines 729-740, inside the wall-line `<g>`): rendered at the same
  point as the wall lines themselves — same "on top of fills/fan/tent/roll/compare" position as
  the BE markers.

In the new code, all three marks are wired through one `<Customized>` (`PayoffChart.tsx:618-633`)
placed structurally before the profit-zone `Area` (line 639), both T+0 `Area` fills (line 652),
the fan `Line`s (line 677), the expiration tent `Line` (line 693), the roll `Line` (line 709),
the compare `Line` (line 723), and the wall `ReferenceLine`s (line 742) — regardless of that JSX
position, because a `Customized`/plain custom child always paints before every `zIndex` band
(the exact mechanism 33-04 and 33-06 both document). So the BE-marker bars and edge-arrow
glyphs, which used to render *on top of* the profit-zone fill, both T+0 fills, the
fan/tent/roll/compare curves, and the wall lines, now render *underneath* all of them.

This is not merely a DOM-order technicality: a BE-exp marker sits, by definition, exactly where
the expiration tent curve crosses zero (`findZeroCrossings(expirationCurve)`,
`PayoffChart.tsx:438`). In the old code the solid 2px coral bar painted over the dashed tent
line at that crossing; in the new code the dashed tent `Line` (zIndex 400) now paints over the
BE marker, so the marker's visibility at its own crossing point depends on gaps in the tent's
dash pattern rather than being reliably on top. The same inversion applies to the wall lines
(opacity 0.6, fully covering the marker where they cross) and the roll/compare overlay curves
(solid strokes, no fading). The Area-fill layers (profit-zone, T+0 teal/coral) are less affected
in practice — their gradients fade to ~0 opacity right at the zero baseline where the BE markers
sit — but the line-based layers are not attenuated at all.

This directly contradicts CONTEXT.md's hard requirement ("Visual parity gate: same data → same
story") and the phase's own explicitly-flagged highest-risk claim, for exactly the two marks the
test suite doesn't independently verify against the old ordering.

**Fix:** Split `PayoffChartMarks` into two `Customized` calls at different JSX positions — the
EM band (correctly under-everything already) and the BE-marker bars/edge-arrow glyphs (need to
sit where the old wall-line/BE-marker block sat: after the profit-zone/T+0 fills and
fan/tent/roll/compare curves, but still before or interleaved with the wall `ReferenceLine`s and
before the final T+0 `Line`). Since a bare custom child always paints before every zIndex band
regardless of its JSX position, achieving "BE markers on top of the Area/Line layers, under only
the final T+0 curve" requires either: (a) an explicit `zIndex` prop on the second `Customized`
matching the shared 400 band used by `Line`/`ReferenceLine` (33-01 found arbitrary non-preset
`zIndex` values silently fail to render — verify a same-value override first), or (b) moving the
BE-bar/edge-arrow rendering out of the scale-driven `Customized` layer entirely and into
sibling-SVG elements placed at the correct JSX position relative to the wall `ReferenceLine`s and
final T+0 `Line`. Add a `compareDocumentPosition` test analogous to the existing em-band one, but
for `be-marker-t0`/`be-marker-exp` vs. `profit-zone`/`net-book-exp-curve`/`wall-line-*`, so this
class of regression fails a test instead of only surfacing in a rendered screenshot.

## Warnings

### WR-01: `GammaProfile`'s flip/spot `ReferenceLine`s default to `ifOverflow="discard"` — the exact off-domain risk PayoffChart explicitly fixed, left unaddressed here

**Status:** fixed (commit `bdda9ca`) — added `ifOverflow="hidden"` to both the `flip` and
`spot` `ReferenceLine`s, matching `PayoffChart`'s treatment. Tests added asserting an
off-domain flip/spot value still renders a `.gamma-flip-line`/`.gamma-spot-line` element
(structurally clipped) instead of vanishing.

**File:** `apps/web/src/components/charts/GammaProfile.tsx:139-148`

**Issue:** `PayoffChart.tsx` explicitly sets `ifOverflow="hidden"` on every wall/spot
`ReferenceLine` (lines 757, 813, 818) specifically so an off-domain level still renders,
structurally clipped, instead of vanishing (33-06's own documented finding: "`ReferenceLine`'s
default `ifOverflow="discard"` silently omits an off-domain line entirely"). `GammaProfile`'s
`flip` (line 139-146) and `spot` (line 148) `ReferenceLine`s carry no `ifOverflow` prop at all,
so they use the library default (`"discard"`).

The x-domain here is `[minSpot, maxSpot]` — the min/max of the `profile` data array itself
(`GammaProfile.tsx:85-86`), not necessarily inclusive of the live `spot`/`flip` values, which are
separate props. The pre-migration visx version's `<svg>` set `style={{ overflow: "visible" }}`
(old file, `overflow: "visible"` on the root `<svg>`), so an out-of-domain spot/flip line still
drew, just extending past the nominal plot bounds — a visible (if imperfect) signal. The migrated
version's default-discard behavior means the same scenario now renders nothing: no line, no
error, no visual cue that spot or flip fell outside the profile's own strike window (e.g. if the
gamma-profile computation lags a fast intraday move, or windows to a narrower strike range than
the live spot).

**Fix:** Add `ifOverflow="hidden"` to both the `flip` and `spot` `ReferenceLine`s, matching
`PayoffChart`'s treatment of the identical risk pattern:
```tsx
<ReferenceLine x={flip} ifOverflow="hidden" className="gamma-flip-line" stroke={AMBER} strokeDasharray={dashedStroke} />
...
<ReferenceLine x={spot} ifOverflow="hidden" className="gamma-spot-line" stroke={BLUE} strokeWidth={lineStroke} />
```

### WR-02: TermStructureChart's forward-IV bracket label flips from below the line to above it, and now sits ~5px away instead of 16px

**Status:** fixed (commit `f51e724`) — switched the label from `position="insideBottom"` to
`position="bottom"` with an explicit `offset={16}`. Verified against `recharts@3.9.2`'s own
`getCartesianPosition.js`: for a zero-height segment, `"bottom"` computes `y + height +
offset` (`= y + offset`, below the line), the opposite of `"insideBottom"`'s `y - offset`.
Test added asserting the label's `y` is greater than the bracket line's `y1`.

**File:** `apps/web/src/components/picker/TermStructureChart.tsx:211-227`

**Issue:** The old component drew the "fwd XX.X%" label at `y={yScale(fwdIv) + 16}` — 16px
*below* the bracket path (`/tmp` reference: old file lines 207-216). The new `ReferenceLine`
`segment` uses `label={{ value: ..., position: "insideBottom", ... }}` (lines 220-226). Traced
through the installed `recharts@3.9.2` source
(`node_modules/.bun/recharts@3.9.2.../es6/cartesian/ReferenceLine.js:193-198` +
`getCartesianPosition.js:136-142`): a `segment` with both points at the same `y` (`fwdIv`)
produces a zero-height bounding rect, and `insideBottom` computes `y: y + height - verticalOffset`
= `y - offset` (height is 0) with `verticalAnchor: "end"` — i.e. the label's *bottom* edge
anchors at that point, so the text extends *upward* from ~5px above the line (Label's default
`offset` is 5, confirmed at `Label.js:211`). This is the opposite direction from the
pre-migration layout, and at roughly a third of the previous clearance, putting the label right
up against the dashed bracket line instead of clearly separated below it.

**Fix:** Use an explicit vertical nudge instead of relying on `insideBottom`'s zero-height
behavior — e.g. `position="bottom"` (outside the line, not the zero-height-aware "inside" family)
with a larger explicit `offset`, or drop the native `label` prop and render the "fwd XX%" text as
a small sibling `<text>` positioned via the same `useYAxisScale()` hook `GuardTag` already uses
in this file, matching the old `yScale(fwdIv) + 16` offset exactly.

### WR-03: Dropped regression test for in-domain GEX wall pixel placement — no test asserts a wall `ReferenceLine`'s actual x-coordinate anymore

**Status:** fixed (commit `b7ecd18`) — restored a numeric x1 assertion. Adapted from the
REVIEW's suggested snippet: the rendered `x1` is margin-offset (`PAD.left + xScale(value)`,
confirmed empirically), not the raw 0-based `xScale(value)` the suggested code compared
against — `PAD.left` is read off the chart's own structural clip-path rect rather than
hardcoded. Test-only change; passes immediately (the underlying positioning was never broken,
only its regression coverage was missing).

**File:** `apps/web/src/components/charts/PayoffChart.test.tsx:536-549`

**Issue:** The pre-migration suite had a named regression test, `"real-repro 2026-07-10: flip
7488 / putWall 7500 / spot 7544 / callWall 7550 on 7100–8050 — zero wall-label text, lines at
true x"` (old file lines 651-673), which rendered the chart with real production-shaped values
and asserted each wall line's `x1` attribute matched `xScale(trueValue)` — i.e. it proved
in-domain walls render at their correct numeric position, not just "somewhere with the right
color." The re-expressed suite's closest equivalent, `"in-domain walls render with the correct
stroke color and no label text"` (`PayoffChart.test.tsx:536-549`), checks `stroke` color and the
absence of label text, but never reads `x1`/`cx` or compares against an expected scale value.
Nothing else in the current file asserts an in-domain `ReferenceLine`'s pixel position (the
structural-clip test at lines 551-597 only covers the *off*-domain case). The underlying
positioning is now delegated to Recharts' own axis scale rather than the hand-rolled
`pinMarker`, which is lower-risk than before — but the specific regression this test was named
for (a real production incident) no longer has any coverage proving the fix holds.

**Fix:** Add back a numeric assertion for the in-domain case, e.g.:
```tsx
it("in-domain walls render at their true x position (not a coordinate drift)", () => {
  const domain = { min: 7100, max: 8050 };
  const xScale = buildXScale(INNER_W, domain);
  render(
    <PayoffChart {...baseProps()} domain={domain} toggles={WALL_TOGGLES}
      gex={{ callWall: 7550, putWall: 7500, flip: 7488 }} />,
  );
  expect(Number(screen.getByTestId("wall-line-put").getAttribute("x1"))).toBeCloseTo(xScale(7500), 5);
  expect(Number(screen.getByTestId("wall-line-call").getAttribute("x1"))).toBeCloseTo(xScale(7550), 5);
  expect(Number(screen.getByTestId("wall-line-flip").getAttribute("x1"))).toBeCloseTo(xScale(7488), 5);
});
```

## Info

### IN-01: Decorative event-marker dot dropped from TermStructureChart (disclosed, cosmetic-only)

**Status:** no action required (per REVIEW's own "Fix: None required; re-add only if a
visual-parity pass calls it out").

**File:** `apps/web/src/components/picker/TermStructureChart.tsx:186-199` (event `ReferenceLine`
block)

**Issue:** The old component drew a small amber circle (`<circle cx={x} cy={PAD.top} r={2.4}
fill={AMBER} opacity={0.7} />`) at the top of each event's dashed vertical marker (old file line
167). The migration drops this — 33-04-SUMMARY explicitly documents the decision ("no test
covered the circle either... the dashed line alone still conveys the marker"). This is a
disclosed, intentional, cosmetic-only simplification with no data or interaction impact, but it
is a small departure from CONTEXT.md's "same data → same story" parity gate worth a one-line
note in case a future visual QA pass flags the missing dot as unexpected.

**Fix:** None required; re-add only if a visual-parity pass calls it out.

---

_Reviewed: 2026-07-11T00:29:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
fixed_at: 2026-07-10T19:52:00Z
review_path: .planning/phases/33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r/33-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 33: Code Review Fix Report

**Fixed at:** 2026-07-10T19:52:00Z
**Source review:** .planning/phases/33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r/33-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (CR-01 critical, WR-01/WR-02/WR-03 warnings — IN-01 info excluded per its own "no action required")
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: `PayoffChartMarks`' BE-marker bars and edge-arrow glyphs painted under layers they used to paint on top of

**Files modified:** `apps/web/src/components/charts/PayoffChart.tsx`, `apps/web/src/components/charts/PayoffChart.test.tsx`
**Commit:** `3ed089c`
**Applied fix:** Split `PayoffChartMarks` into two renders. The EM band stays wired through
the existing `<Customized>` layer (paints before every zIndex band by construction — this was
already correct pre-migration parity). The BE-marker bars and edge-arrow glyphs move into a
new `<ZIndexLayer zIndex={DefaultZIndexes.line}>` (recharts' public, documented zIndex-portal
component, exported since 3.4) placed in JSX right after the GEX wall `ReferenceLine`s and
before the final on-top T+0 `Line`. Since `ZIndexLayer` content shares the same zIndex-400
band as `Line`/`ReferenceLine`, the JSX-order tiebreak (empirically established in 33-01) puts
the marks above the profit-zone/T+0 fills (a lower, always-earlier zIndex-100 band), above the
fan/tent/roll/compare curves and wall lines (earlier in JSX, same band), and below only the
final T+0 stroke — reproducing the pre-migration paint order exactly.

Mechanism chosen and evidence: option 1 from the assigning brief (a native recharts mechanism
proven to render above the banded primitives) was validated empirically with a throwaway probe
test before touching production code — `ZIndexLayer` with a **preset** `DefaultZIndexes` value
(`.line = 400`) portals its children synchronously under a single `render()` call in jsdom and
respects JSX-order tiebreaking within the shared band, unlike the *arbitrary* custom zIndex
values 33-01 found silently fail to render. This is a cleaner mechanism than the CONTEXT's
fallback (sibling absolutely-positioned SVG overlay) since it needs no separate coordinate
system or pointer-events wiring — it reuses the exact same `translate(PAD.left, PAD.top)` +
`PayoffChartMarks` scale-driven rendering the EM band already uses.

Three new `compareDocumentPosition` tests added, mirroring the existing z-order describe
block: `be-marker-t0`, `be-marker-exp`, and the off-domain edge-arrow glyph (`‹`), each
asserted to render after `profit-zone`, `wall-line-call`, and `net-book-exp-curve` in DOM
order. All three failed for the right reason against the pre-fix code (RED), passed after the
fix (GREEN).

### WR-01: `GammaProfile`'s flip/spot `ReferenceLine`s default to `ifOverflow="discard"`

**Files modified:** `apps/web/src/components/charts/GammaProfile.tsx`, `apps/web/src/components/charts/GammaProfile.test.tsx`
**Commit:** `bdda9ca`
**Applied fix:** Added `ifOverflow="hidden"` to both the `flip` and `spot` `ReferenceLine`s,
matching the treatment `PayoffChart` already applies to the identical off-domain risk. Two
tests added asserting an off-domain flip/spot value (outside `MIXED_PROFILE`'s own
`[minSpot, maxSpot]` domain) still renders a `.gamma-flip-line`/`.gamma-spot-line` element
(structurally clipped) instead of silently vanishing under the library's `"discard"` default.

### WR-02: TermStructureChart's forward-IV bracket label flips from below the line to above it

**Files modified:** `apps/web/src/components/picker/TermStructureChart.tsx`, `apps/web/src/components/picker/TermStructureChart.test.tsx`
**Commit:** `f51e724`
**Applied fix:** Changed the label `position` from `"insideBottom"` to `"bottom"` with an
explicit `offset={16}`. Traced through the installed `recharts@3.9.2` source
(`getCartesianPosition.js`): for a zero-height `ReferenceLine` `segment`, `"insideBottom"`
computes `y - offset` (label sits above the line), while `"bottom"` computes
`y + height + offset` — for `height = 0`, that's `y + offset` — restoring the pre-migration
`yScale(fwdIv) + 16` below-the-line placement and clearance. Test added asserting the label's
`y` (read off its parent `<text>` element, since `getByText` resolves to the child `<tspan>`)
is greater than the bracket line's `y1`.

### WR-03: Dropped regression test for in-domain GEX wall pixel placement

**Files modified:** `apps/web/src/components/charts/PayoffChart.test.tsx`
**Commit:** `b7ecd18`
**Applied fix:** Test-only change (no production bug — the review itself notes the underlying
positioning is "lower-risk than before," delegated to Recharts' own axis scale). Restored a
numeric `x1` assertion for in-domain walls, adapted from the REVIEW's suggested snippet: the
suggestion compared against the raw 0-based `buildXScale` output, but the rendered `x1` is
actually margin-offset (`PAD.left + xScale(value)`, confirmed empirically with a throwaway
probe before writing the test). `PAD.left` is read off the chart's own structural clip-path
`<rect>` in the test rather than hardcoded or newly exported, so the assertion stays correct
if `PAD` ever changes. Passes immediately — restores coverage for a regression class, doesn't
fix a live bug.

## Skipped Issues

None — all four in-scope findings were fixed.

---

_Fixed: 2026-07-10T19:52:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

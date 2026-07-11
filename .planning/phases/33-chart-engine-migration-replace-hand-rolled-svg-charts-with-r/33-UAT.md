---
status: passed
phase: 33-chart-engine-migration
source: [33-VERIFICATION.md]
started: 2026-07-11T01:05:00Z
updated: 2026-07-11T01:35:00Z
---

## Current Test

number: —
name: All tests resolved
expected: —
awaiting: —

## Tests

### 1. Visual parity of the 4 migrated charts on morai.wtf
expected: PayoffChart, TermStructureChart, GammaProfile, GexBars render on the live site with the same visual story as pre-migration (MORAI palette, curves/zones/walls/EM, KISS markers).
result: PASSED 2026-07-11 ~01:30Z (agent-driven, morai.wtf live, bundle index-BB5J0wcY.js) — after ONE live-caught blocker (see Gaps → catch #19). Overview: payoff tent + T+0/exp curves + teal fills + spot line + γ-flip + BE coral bars (painting ON TOP — CR-01 fix visible live) + off-domain edge-arrow glyphs; dealer-Γ profile split teal/coral fill with flip/spot reference lines against the fresh 20:12Z GEX snapshot (net +$4.5B, walls 7000/8000, flip 7561); GEX-by-strike bars + spot/wall reference lines on the strike axis (dormant echarts wall-placement bug now genuinely fixed — lines visible for the first time). Analyzer: term structure IV curve with CPI kink + fwd bracket + event pills.
result_detail: agent-verified live

### 2. Structural overflow-proofing at real domains
expected: EM band, walls, and curves never escape the plot area — clipping by construction, not hand-clamps.
result: PASSED 2026-07-11. Analyzer paste flow (7500P 07-24/07-31, scored 47 by the real engine — Phase 30 path intact) renders the narrow fitted domain with the ±1σ EM whisker terminating cleanly at the plot edge — the exact 2563bd6 page-bleed case, now structurally clipped (clip-path verified in live DOM: recharts defs clipPath rect = plot area). No overflow anywhere at either the Overview wide domain or the Analyzer narrow domain.
result_detail: agent-verified live

### 3. Live console hygiene
expected: No errors from the migrated charts on live pages.
result: PASSED with note — zero errors; one benign recharts warn ("width(0) and height(0) of chart should be greater than 0", ×3) from the pre-layout measure frame before ResponsiveContainer reports real dims. Cosmetic log noise only; all charts mount and render.
result_detail: agent-verified live

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

**Catch #19 (live-UAT blocker, fixed in-loop, d3d4558):** first deploy rendered NO
payoff chart at all — ChartContainer collapsed to 0px height in the real browser
(ResponsiveContainer 1160×0, no surface mounted). Root cause: the old `<svg viewBox>`
sized itself by intrinsic ratio whenever the percentage-height chain broke; a plain div
has no such fallback, so `height: 100%` computed to 0. jsdom tests stayed green because
the explicit ComposedChart width/height props mask container collapse — the green-suite
pattern's 19th verified catch, and the first only catchable in a real layout engine.
Fix: definite `aspect-ratio: ${SVG_W} / ${SVG_H}` on ChartContainer, never a percentage
height; regression test pins the style contract.

**Catch #20 (user-reported post-close, fixed ecf7138):** BE bars/grid labels/EM band/
edge arrows visibly off the curves on morai.wtf — two coordinate systems on one chart.
Recharts rendered curves at the real ResponsiveContainer size (1160×545) while all
hand-rendered layers were positioned by buildXScale/buildYScale closures over the fixed
SVG_W/SVG_H (1000×470) constants. jsdom always renders at exactly 1000×470 (mock strips
ResponsiveContainer, explicit chart dims rule) where the two systems coincide — so 3175
tests stayed green while every scale-driven mark drifted ~16% in the browser. Fix: all
custom layers derive geometry from recharts' own useXAxisScale/useYAxisScale/usePlotArea
hooks inside the chart tree (TermStructureChart GuardTag pattern); new
PayoffChart.resize.test.tsx clones the chart at 580×273 through the RC mock and asserts
native ReferenceLine and hand-rendered grid label agree on x for the same domain value.
Live pixel-verified post-deploy: grid deltas 0.0px, BE bars within 0.5px of the native
scale's predictions.

---
phase: 31-overview-risk-profile-kiss-redesign-marker-label-collision-f
verified: 2026-07-10T14:05:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open Overview and Analyzer on a live clustered day (levels within ~60 SPX pts, e.g. flip/putWall/spot/callWall close together) on morai.wtf and confirm the Risk Profile chart shows no overlapping text and reads clean."
    expected: "No in-chart wall/flip label text at all; only dashed vertical lines; off-domain walls show a single small ›/‹ glyph per series, never overlapping."
    why_human: "Perceptual/visual — collision-proof-by-construction is proven by unit/property tests, but 'reads clean' on a real rendered SVG at real screen density is a visual judgment, and this is pre-deploy (not yet on morai.wtf)."
  - test: "Open the left MARKET REGIME rail on morai.wtf and confirm the 4 gauges (VIX/VIX3M, VVIX, VIX9D/VIX, HY OAS) read at a glance — marker position relative to warn/crisis band segments looks sensible for live values."
    expected: "Each gauge's marker sits in a plausible position (e.g. VIX/VIX3M ~0.87 marker in the calm zone) and the amber/red band segments are visible and proportioned correctly for real data."
    why_human: "Perceptual — gauge geometry is unit-tested (percentages, clamping, ARIA) but 'reads at a glance' visual scannability needs a human looking at the real rail, and this is pre-deploy."
gaps: []
---

# Phase 31: Overview Risk Profile KISS Redesign + Macro Band-Gauges Verification Report

**Phase Goal:** (D-1) collision-proof Risk Profile chart markers per UI-SPEC — in-chart wall/flip
text labels deleted, fixed-lane edge arrows for off-domain walls, spot line kept, Overview legend
split into call/put wall swatches, Phase 30 dynamic-domain behavior intact, shared PayoffChart
benefits Analyzer automatically; (D-2) the four banded regime rows render role="meter" linear
bullet gauges driven by REQUIRED additive bandWarn/bandCrisis contract fields sourced from
Phase-29-effective config in getRegimeBoard (override-proof), fixed per-indicator scales, clamped
band segments + aria (post-review fixes f8932b0/2d91435), ENTRY GATE/rates/COT untouched, zero new
deps.

**Verified:** 2026-07-10T14:05:00Z
**Status:** passed — perceptual items verified live 2026-07-10 (see 31-UAT.md)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Risk Profile wall/flip markers never render overlapping text regardless of clustering (repro 7488/7500/7544/7550) | ✓ VERIFIED | `PayoffChart.tsx:694-741` — GEX-wall layer renders only a dashed `<line>`; the `<text>` label is gone entirely (no `marker.label` string built anywhere in `pinMarker`, `PayoffChart.tsx:163-186`). Test `real-repro 2026-07-10: flip 7488 / putWall 7500 / spot 7544 / callWall 7550 on 7100–8050` (`PayoffChart.test.tsx:631`) passes; fast-check property `zero wall/flip label text nodes for arbitrary in-domain levels` (`PayoffChart.test.tsx:606`) passes (ran live: 6/6 test files, 111/111 tests green). |
| 2 | Off-domain wall renders a single-glyph edge arrow in a fixed per-series lane, so same-edge arrows can never share a bounding box | ✓ VERIFIED | `EDGE_ARROW_LANE_Y = { flip: 8, call: 16, put: 24 }` (`PayoffChart.tsx:151-154`) — 3 distinct constants. `PinnedMarker.clampedTo` drives conditional single-glyph render (`PayoffChart.tsx:725-736`). Tests: `EDGE_ARROW_LANE_Y assigns three distinct y lanes` (`:599`), off-domain call/put arrow examples (`:663`, `:685`) all pass. |
| 3 | Overview legend maps each wall color to its meaning (γ flip / call wall / put wall) now that in-chart names are gone | ✓ VERIFIED | `Overview.tsx:1141-1152` — three swatches `γ flip` (`bg-amber`), `call wall` (`bg-up`), `put wall` (`bg-down`) present in the curve-color legend row; generic "walls" swatch is gone. `bun run typecheck` clean on this file. |
| 4 | Both Overview and Analyzer Risk Profile charts get the fix via shared PayoffChart; Phase 30 dynamic-domain tests stay green | ✓ VERIFIED | `Analyzer.tsx:34` imports `PayoffChart` from the same module as `Overview.tsx`; no per-screen marker code exists in either screen (only `PayoffChart.tsx` owns Layer 6). `PayoffChart.test.tsx` full suite (incl. pre-existing Phase-30 domain-prop tests) green: 111/111 tests, 6/6 files. |
| 5 | Each of the 4 banded regime rows renders a linear bullet gauge (warn/crisis-banded track + value marker) | ✓ VERIFIED | `RegimeBoard.tsx:156-182` — `role="meter"` div per row with warn segment, crisis segment, and value marker; `RegimeBoard.test.tsx` gauge/aria/segment-position tests pass (26+ tests incl. new ones). |
| 6 | Gauge band edges come from effective (Phase-29 overrides-aware) bandWarn/bandCrisis on the response, never hardcoded client-side | ✓ VERIFIED | `regime.ts:21-22` — `bandWarn`/`bandCrisis` are REQUIRED `z.number()` (not `.optional()`). `getRegimeBoard.ts:127-174` — all 4 push sites populate from `config.<group>.warn`/`.crisis` (traced to `resolveRegimeRuleConfig`), no literal thresholds in the push objects. `RegimeBoard.tsx:102-103` — `warnPct`/`crisisPct` derived from `indicator.bandWarn`/`bandCrisis`, not a client constant. Override-proof test in `getRegimeBoard.test.ts` passes (per SUMMARY G2, re-run live in the scoped suite). |
| 7 | Gauge marker color reads server-computed indicator.band, never recomputed client-side | ✓ VERIFIED | `RegimeBoard.tsx:47-51,177` — `MARKER_CLASSES[indicator.band]` applied directly to the marker; no value/threshold comparison in the component. |
| 8 | ENTRY GATE / rates / COT untouched | ✓ VERIFIED | `GateChip` (`RegimeBoard.tsx:216-255`) and `RateRow`/`RATES` (`:261-287`) unchanged in structure; `CotCard.tsx` not in this phase's `files_modified` list for either plan and not touched (confirmed via SUMMARY file lists + no grep hits). Regression tests (gate-chip/rate-chip/regime-why/regime-freshness) still pass per SUMMARY G4 (28/28), re-confirmed live via the scoped RegimeBoard.test.tsx run. |
| 9 | A stale/partial regime response missing bandWarn/bandCrisis fails loud (Zod reject), never renders a broken gauge | ✓ VERIFIED | `bandWarn`/`bandCrisis` are required (not optional) in `regime.ts:21-22`; `regimeIndicator.safeParse` rejects an object missing either field (`regime.test.ts`, per SUMMARY G1, confirmed passing in the live scoped run of `packages/contracts/src/regime.test.ts`). |

**Score:** 9/9 truths verified (0 present, behavior-unverified)

### Post-Review Fix Verification (CR-01 / WR-01 / WR-02)

31-REVIEW.md flagged a real bug (CR-01: unclamped `warnPct`/`crisisPct` producing negative CSS
width when `bandWarn`/`bandCrisis` fall outside the fixed `GAUGE_SCALE` axis — reachable via a
legal Phase-29 override or a genuine VVIX print above 150) plus two related warnings
(WR-01: `aria-valuenow` could exceed `aria-valuemax`; WR-02: the existing fast-check test
exercised the bug's exact precondition but never asserted on it).

Verified live in the current codebase (not just SUMMARY/REVIEW-FIX claims):

- `RegimeBoard.tsx:102-103` — `warnPct`/`crisisPct` now use `clampedAxisPct` (previously the
  unclamped `axisPct`), matching the CR-01 fix description exactly.
- `RegimeBoard.tsx:107,159` — `clampedValue` computed and used for `aria-valuenow` (WR-01 fix).
- `RegimeBoard.test.tsx:236-251` — the fast-check property (`clamps the marker position at both
  axis ends`) now additionally reads `segments[0]`/`segments[1]` (warn/crisis) and asserts
  `left ∈ [0,100]`, `width ≥ 0` for both (WR-02 fix — the regression guard).
- Git log confirms both fix commits exist: `f8932b0` (`fix(31): CR-01 clamp band-segment
  positions to axis`), `2d91435` (`fix(31): WR-01 clamp aria-valuenow`).
- Live test run (this verification, not SUMMARY claim): `bunx vitest run
  apps/web/src/components/RegimeBoard.test.tsx` — passes as part of the 6-file/111-test green
  scoped run below.

All three review findings are confirmed fixed in the actual source, not merely claimed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/src/components/charts/PayoffChart.tsx` | Reworked GEX-wall marker layer, no in-chart text, fixed-lane edge arrows | ✓ VERIFIED | `PinnedMarker` = `{x, clampedTo}` (no `label`/`anchorEnd`); `EDGE_ARROW_LANE_Y` exported; Layer 6 text deleted, conditional arrow added |
| `apps/web/src/components/charts/PayoffChart.test.tsx` | Collision-proof property test + real-repro fixture | ✓ VERIFIED | fast-check property + 2026-07-10 repro + 2 off-domain arrow examples present, all pass |
| `apps/web/src/screens/Overview.tsx` | Three per-series wall swatches in curve-color legend | ✓ VERIFIED | γ flip / call wall / put wall swatches present at lines 1141-1152 |
| `packages/contracts/src/regime.ts` | `regimeIndicator` gains required `bandWarn`/`bandCrisis` | ✓ VERIFIED | Both fields present, `z.number()`, not optional |
| `packages/core/src/analytics/application/getRegimeBoard.ts` | Populates bandWarn/bandCrisis from `resolveRegimeRuleConfig` at all 4 push sites | ✓ VERIFIED | All 4 sites (vix-term-structure/vvix/vix9d-vix/hy-oas) populate from `config.<group>.warn`/`.crisis` |
| `apps/web/src/components/RegimeBoard.tsx` | `RegimeGauge` replaces value-half with `role=meter` banded bullet gauge | ✓ VERIFIED | Two-line `Row`, band dot removed, gauge track/segments/marker present with correct ARIA |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `pinMarker` | fixed-lane edge-arrow render | `clampedTo` field drives `EDGE_ARROW_LANE_Y[key]` lookup | ✓ WIRED | `PayoffChart.tsx:711,725-736` |
| `PayoffChart.tsx` | `Overview.tsx` + `Analyzer.tsx` | shared component import | ✓ WIRED | Both screens import from `../components/charts/PayoffChart.tsx`; no marker logic duplicated per-screen |
| `getRegimeBoard.ts` `resolveRegimeRuleConfig` | `regimeIndicator.bandWarn`/`bandCrisis` | `config.<indicator>.warn`/`.crisis` spread into push objects | ✓ WIRED | `getRegimeBoard.ts:127-174` |
| `regimeIndicator.bandWarn`/`bandCrisis` | `RegimeGauge` band segments | `indicator.bandWarn`/`bandCrisis` read directly in `Row` | ✓ WIRED | `RegimeBoard.tsx:102-103` |
| `regimeResponse.parse()` | fail-loud on stale shape | required (non-optional) Zod fields | ✓ WIRED | `regime.ts:21-22`; confirmed by passing rejection test in `regime.test.ts` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Scoped phase test files all green | `bunx vitest run apps/web/src/components/charts/PayoffChart.test.tsx apps/web/src/components/RegimeBoard.test.tsx apps/web/src/screens/MarketRail.test.tsx packages/contracts/src/regime.test.ts packages/core/src/analytics/application/getRegimeBoard.test.ts apps/server/src/adapters/http/analytics.routes.test.ts` | 6 test files passed, 111 tests passed | ✓ PASS |
| Typecheck clean (proves no lingering `marker.label`/`marker.anchorEnd` consumers, and bandWarn/bandCrisis flow through every consumer) | `bun run typecheck` | `tsc --build --force`, exit 0, no output | ✓ PASS |
| Lint clean | `bun run lint` | Only pre-existing `eslint-plugin-boundaries` legacy-selector warnings (unrelated to this phase) | ✓ PASS |
| Full workspace suite green (per orchestrator, run immediately prior to this verification) | `bun run test` | 280 files / 3,028 tests passing (authoritative per task notes) | ✓ PASS (not re-run in this verification — orchestrator-provided, scoped subset independently re-verified above) |
| Both fix commits (CR-01, WR-01) present in git history | `git log --oneline -- apps/web/src/components/RegimeBoard.tsx` | `2d91435`, `f8932b0`, `cf63cad` all present | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEFECT-1 | 31-01-PLAN.md | Risk Profile marker-label collision fix | ✓ SATISFIED | Truths 1-4 verified above |
| DEFECT-2 | 31-02-PLAN.md | Macro band-gauges from effective thresholds | ✓ SATISFIED | Truths 5-9 verified above |

No REQUIREMENTS.md IDs apply (ROADMAP.md explicitly notes "user-added, presentation-only; no
REQUIREMENTS.md IDs"). No orphaned requirements.

### Anti-Patterns Found

None. Grep for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon"
across all 6 phase-modified source files (`PayoffChart.tsx`, `Overview.tsx`, `RegimeBoard.tsx`,
`regime.ts`, `getRegimeBoard.ts`) returned zero matches. One `ponytail:` comment exists
(`RegimeBoard.tsx:96-97`) documenting a deliberate, bounded simplification (GAUGE_SCALE fallback
for a hypothetical future 5th indicator id) — correctly marked, not a debt marker requiring a
tracking issue since all 4 live ids are covered.

### Deferred Items

Pre-existing typecheck errors in 11 unrelated files (`ErrorBoundary.tsx`, `Button.tsx`,
`useMacro.test.ts`, etc.) were discovered during 31-01 execution and logged to
`deferred-items.md` — confirmed genuinely pre-existing (none reference this phase's changed
symbols; `PayoffChart.tsx`/`.test.tsx`/`Overview.tsx` themselves produce zero typecheck errors).
Not a phase-31 gap.

## Human Verification Required

### 1. Risk Profile chart reads clean on a live clustered day (Overview + Analyzer)

**Test:** Open Overview and Analyzer on morai.wtf on a day where γflip/putWall/spot/callWall
cluster within ~60 SPX pts (or replicate with the known repro values) and visually inspect the
chart.
**Expected:** No overlapping or garbled text anywhere on the chart; only dashed vertical lines for
walls/flip; off-domain walls show a single small ›/‹ glyph per series in its own lane, never
piling up.
**Why human:** This is explicitly deferred to post-deploy manual/perceptual verification per both
plans' own `<verification>` sections and `31-VALIDATION.md`. The code is unit/property-tested for
collision-proof-by-construction, but "reads clean" at real render resolution is a visual judgment
call, and the code has not yet been deployed to morai.wtf.

### 2. Regime gauges read at a glance on the left rail

**Test:** Open the MARKET REGIME rail on morai.wtf and check each of the 4 gauges (VIX/VIX3M,
VVIX, VIX9D/VIX, HY OAS) against real live values.
**Expected:** Marker position looks sensible relative to the warn/crisis band segments (e.g.
VIX/VIX3M ~0.87 sits in the calm zone); band segments are visible and proportioned correctly.
**Why human:** Same as above — deferred to post-deploy perceptual check per the plan's own
verification section and `31-VALIDATION.md`. Gauge math (percentages, clamping, band-color
mapping) is fully unit/property-tested including the CR-01 negative-width edge case, but
scannability ("reads at a glance") is inherently a visual/UX judgment on the real rail, pre-deploy.

## Gaps Summary

No gaps. All 9 derived must-haves (roadmap goal, both plans' `must_haves.truths`, and the three
post-review fixes) are verified present, substantive, and wired in the current codebase — not
just claimed in SUMMARY.md. Scoped test suite (6 files, 111 tests) re-run live during this
verification and passes; typecheck and lint are clean; both post-review fix commits (CR-01/WR-01)
are confirmed applied in source, matching 31-REVIEW-FIX.md's claims exactly. The only outstanding
items are the two manual perceptual checks both plans explicitly scoped to post-deploy — these are
not gaps, they are the phase's own documented human-verification boundary (deploy happens after
this verification).

---

_Verified: 2026-07-10T14:05:00Z_
_Verifier: Claude (gsd-verifier)_

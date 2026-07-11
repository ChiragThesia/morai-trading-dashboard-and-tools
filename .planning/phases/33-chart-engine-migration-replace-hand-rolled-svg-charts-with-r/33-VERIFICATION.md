---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
verified: 2026-07-11T01:35:00Z
status: passed
score: 12/12 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open the Analyzer and Overview screens on morai.wtf (or the deployed build once shipped) and visually compare all 4 migrated charts (PayoffChart, TermStructureChart, GammaProfile, GexBars) against their pre-migration appearance: same curves, zones, walls, EM band, colors (MORAI violet/gray/teal/coral tokens)."
    expected: "Same data tells the same visual story as before the migration — no unintended shape/color/layout drift beyond the one disclosed cosmetic drop (TermStructureChart's decorative amber event-marker dot, IN-01, explicitly accepted as no-action-required in 33-REVIEW.md)."
    why_human: "Editorial/visual judgment; 33-VALIDATION.md's own manual-only item ('Visual parity: same data → same story ... Editorial/visual judgment'). Not mechanically checkable beyond the DOM-level assertions already run (color hex, z-order DOM position, structural clip-path)."
  - test: "On a live/real-layout browser (not jsdom), push a wide expected-move band or an off-domain GEX wall/flip/spot value on real data for each of the 4 charts and confirm nothing bleeds past the plot area."
    expected: "No overflow at extreme domains in a real browser — the EM band, walls, and GammaProfile flip/spot lines all clip or hide cleanly at the chart boundary, matching the structural-clipping intent (ifOverflow=\"hidden\" + ResponsiveContainer) that the jsdom test suite can assert exists but cannot lay out."
    why_human: "33-VALIDATION.md's own manual-only item ('No overflow at extreme domains in a real browser ... jsdom can't lay out SVG'). The structural mechanism (clip-path sized to plot area, ifOverflow=\"hidden\" on every wall/flip/spot ReferenceLine) is source-verified below, but real-layout confirmation needs an actual browser viewport."
---

# Phase 33: Chart Engine Migration — Replace Hand-Rolled SVG Charts with Recharts Verification Report

**Phase Goal:** The four in-scope charts (PayoffChart, TermStructureChart, GammaProfile, GexBars) render through Recharts (shadcn chart primitives) with the overflow/bleed bug class killed structurally — clipping by construction, not hand-clamps — while the scenario-engine/payoff-domain data layer stays byte-identical and the MORAI design tokens + every locked behavior (domain fidelity, 9-layer z-order, guard cases) are preserved.
**Verified:** 2026-07-10T20:05:00Z
**Status:** passed — both human items resolved by agent-driven live UAT on morai.wtf 2026-07-11 (see 33-UAT.md, 3/3 passed; standing chrome-devtools UAT permission 2026-07-05). Live UAT also caught + fixed catch #19 (ChartContainer percentage-height collapse, d3d4558) before sign-off.
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Requirement) | Status | Evidence |
|---|---|---|---|
| 1 | CHART-01 — A1 JSX-order z-control holds in Recharts 3.9.2 `ComposedChart`; recharts pinned exactly 3.9.2; `ui/chart.tsx` scaffolded | ✓ VERIFIED | `apps/web/package.json` pins `"recharts": "3.9.2"` (exact, not `^`); `apps/web/src/components/ui/chart.tsx` exists (371 lines, shadcn-generated `ChartContainer`/`ChartTooltipContent`); `zorder-spike.test.tsx` (101 lines) exists and passes — part of the full suite run below. |
| 2 | CHART-02 — PayoffChart core: domain fidelity (consumes `computePayoffDomain`, `type="number"` + `allowDataOverflow`), 9-layer z-order, off-domain wall structurally clipped, native tooltip | ✓ VERIFIED | `PayoffChart.tsx:86` declares `domain` as a required (non-optional) prop; both call sites (`Analyzer.tsx:636`, `Overview.tsx:930`) pass `computePayoffDomain(...)` output. `XAxis`/`YAxis` at lines 599-617 set `type="number"` + `allowDataOverflow`. Structural clip test (`PayoffChart.test.tsx:641-679`) resolves a real `<clipPath><rect>` in `<defs>` sized to the plot area (930×432), not a coordinate-bound assertion. `TooltipContentProps` type imported and a typed content component reads the hovered payload (line 47). |
| 3 | CHART-02 — PayoffChartMarks z-order (CR-01 fix): BE-marker bars + edge-arrow glyphs paint above fills/curves/walls, EM band stays under everything | ✓ VERIFIED | Source read at `PayoffChart.tsx:618-796`: EM band renders via `<Customized>` (paints before every zIndex band — correct, under-everything, matches pre-migration). BE-marker bars + edge arrows render via a **second**, separate `<ZIndexLayer zIndex={DefaultZIndexes.line}>` placed in JSX *after* the wall `ReferenceLine`s (line 783) and *before* the final on-top T+0 `Line` (line 800) — exactly the CR-01 fix described in `33-REVIEW-FIX.md`, genuinely present in code, not just claimed. 18 `compareDocumentPosition` assertions in `PayoffChart.test.tsx` (lines 257-363) cover `be-marker-t0`, `be-marker-exp`, and the off-domain edge-arrow glyph against `profit-zone`, `wall-line-call`, `net-book-exp-curve` — all pass. |
| 4 | CHART-03 — TermStructureChart: forward-IV bracket via `ReferenceLine` segment, guard case (no NaN), event placement | ✓ VERIFIED | `TermStructureChart.tsx:210-227`: `ReferenceLine segment={[...]}` renders the bracket; `fwdIv !== null` guards it, falling back to `<GuardTag>` when null. WR-02 fix confirmed live: `position: "bottom", offset: 16` (not `"insideBottom"`) — matches the documented fix restoring the pre-migration 16px-below placement. |
| 5 | CHART-04 — GammaProfile: split teal/coral fill, flip/spot reference lines, compact vs full sizing, off-domain guard | ✓ VERIFIED | `GammaProfile.tsx` imports `AreaChart, Area, XAxis, YAxis, ReferenceLine, ReferenceDot` from `recharts`. WR-01 fix confirmed live: both `flip` (line 142) and `spot` (line 149) `ReferenceLine`s carry `ifOverflow="hidden"`, matching `PayoffChart`'s treatment of the same off-domain risk. `GammaProfile.test.tsx` (140 lines) asserts an off-domain flip/spot still renders `.gamma-flip-line`/`.gamma-spot-line` (structurally clipped, not silently dropped). |
| 6 | CHART-05 — GexBars: horizontal bars (`layout="vertical"`), per-bar `Cell` sign colors, wall/spot reference lines, GEX/OI/Volume tabs | ✓ VERIFIED | `GexBars.tsx` imports `BarChart, Bar, Cell, XAxis, YAxis, ReferenceLine, CartesianGrid` from `recharts`; `Tabs`/`TabsList`/`TabsTrigger` wired for the 3-metric toggle. `GexBars.test.tsx` (167 lines) passes. |
| 7 | CHART-06 — Full suite green re-expressed against Recharts DOM; visx/echarts deps retained; dead code removed only for the 4 migrated charts | ✓ VERIFIED | `bun run test`: **289 files / 3174 tests, all green** (self-run, not SUMMARY-cited). `bun run typecheck`: `tsc --build --force` clean, 0 errors. `bun run lint`: `eslint .` — 0 errors (only 2 pre-existing informational config notices, no source findings). `apps/web/package.json` still declares all 8 `@visx/*` packages + `echarts` + `echarts-for-react`; genuinely imported by the 4 out-of-scope charts (`LifecycleChart.tsx` uses `@visx/shape`/`@visx/curve`/`@visx/scale`/`@visx/event`; `EquityCurve.tsx`/`MiniLine.tsx` use `@visx`; `GexByExpiry.tsx` uses `echarts-for-react`) — confirmed by direct grep, not SUMMARY claim. No `pinMarker`/hand-clamp helper functions remain in any of the 4 migrated files (only a doc-comment mentioning the old name). |
| 8 | Zero `@visx`/`echarts` imports remain in the 4 migrated chart files | ✓ VERIFIED | `grep -n "visx\|echarts"` across `PayoffChart.tsx`, `TermStructureChart.tsx`, `GammaProfile.tsx`, `GexBars.tsx` returns only doc-comment prose ("migrated off @visx", "migrated off echarts-for-react") — zero real `import ... from "@visx/..."` or `"echarts..."` statements. All 4 files import from `"recharts"` instead. |
| 9 | Scope fences held: presentation swap only, data layer + out-of-scope charts untouched | ✓ VERIFIED | `git diff 9750257..HEAD --stat` (27 files) touches only `apps/web/**`, `docs/architecture/stack-decisions.md`, `eslint.config.js`, `bun.lock`, and phase-planning docs — nothing in `packages/`. `apps/web/src/lib/scenario-engine.ts` and `apps/web/src/lib/payoff-domain.ts` have zero diff. `LifecycleChart.tsx`, `EquityCurve.tsx`, `MiniLine.tsx`, `GexByExpiry.tsx` have zero diff. Exactly one new dependency added (`recharts@3.9.2`) — matches CONTEXT.md's "single new dependency, justified" allowance. |
| 10 | Code review findings (1 critical CR-01, 3 warnings WR-01/02/03) genuinely fixed in source, not just claimed in 33-REVIEW-FIX.md | ✓ VERIFIED | All 4 fixes independently confirmed reading the actual diffs/source (not the fix report): CR-01 (`ZIndexLayer` z-order split, PayoffChart.tsx:783-796), WR-01 (`ifOverflow="hidden"`, GammaProfile.tsx:142,149), WR-02 (`position="bottom"` + `offset={16}`, TermStructureChart.tsx:220-227), WR-03 (numeric `x1` assertion for in-domain walls, PayoffChart.test.tsx:619-638). All 4 fix commits (`3ed089c`, `bdda9ca`, `f51e724`, `b7ecd18`) present in `git log 9750257..HEAD`. |
| 11 | MORAI design-token color parity preserved | ✓ VERIFIED | `PayoffChart.tsx:154-159` declares the same hex constants as pre-migration (`VIOLET #a78bfa`, `TEAL #26a69a`, `CORAL #ef5350`, `AMBER #f0b429`, `BLUE #5b9cf6`, `GRAY_MUTED #7b8696`); `PayoffChart.test.tsx` asserts these exact hex values on rendered `stroke` attributes at 8+ call sites. |
| 12 | Animation determinism (no time-dependent flakiness in tests/rendering) | ✓ VERIFIED | `isAnimationActive={false}` set on every animatable Recharts primitive: 11 occurrences in PayoffChart.tsx, 4 in GexBars.tsx, 1 each in TermStructureChart.tsx and GammaProfile.tsx. |

**Score:** 12/12 truths verified, 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `apps/web/src/components/charts/PayoffChart.tsx` | Recharts-based payoff chart, 9-layer z-order, domain-driven | ✓ VERIFIED | 1098 lines (was different pre-migration); imports from `recharts`; `domain` required prop wired to both call sites |
| `apps/web/src/components/charts/PayoffChartMarks.tsx` | Custom-layer component: EM band, BE markers, edge arrows | ✓ VERIFIED | 200 lines; split-render CR-01 fix confirmed live in `PayoffChart.tsx` consumer |
| `apps/web/src/components/charts/GammaProfile.tsx` | Recharts dealer-gamma profile, split fill + reference lines | ✓ VERIFIED | Imports `AreaChart`/`Area`/`ReferenceLine`/`ReferenceDot` from recharts; WR-01 fix live |
| `apps/web/src/components/charts/GexBars.tsx` | Recharts horizontal GEX-by-strike bars | ✓ VERIFIED | Imports `BarChart`/`Bar`/`Cell` from recharts; tabs wired |
| `apps/web/src/components/picker/TermStructureChart.tsx` | Recharts term-structure chart with forward-IV bracket | ✓ VERIFIED | WR-02 fix live |
| `apps/web/src/components/ui/chart.tsx` | shadcn `ChartContainer`/`ChartTooltipContent` primitives | ✓ VERIFIED | 371 lines, scaffolded; consumed by all 4 migrated charts |
| `apps/web/src/components/test/recharts-test-utils.tsx` | Shared `ResponsiveContainer` mock for jsdom | ✓ VERIFIED | 27 lines; imported by all chart test files (per RESEARCH Pitfall 1) |
| `apps/web/src/components/charts/zorder-spike.test.tsx` | A1 z-order characterization spike | ✓ VERIFIED | 101 lines; passes |
| `docs/architecture/stack-decisions.md` | Recharts adoption documented, docs-before-code | ✓ VERIFIED | Lines 56-75: documents Recharts adoption for the 4 charts, ECharts/visx retained for out-of-scope charts, revisit trigger noted |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `PayoffChart.tsx` | `PayoffChartMarks.tsx` (EM band) | `<Customized>` wrapping | WIRED | Paints before every zIndex band, under-everything — matches pre-migration EM-band position |
| `PayoffChart.tsx` | `PayoffChartMarks.tsx` (BE markers + edge arrows) | `<ZIndexLayer zIndex={DefaultZIndexes.line}>` placed after wall `ReferenceLine`s | WIRED | CR-01 fix; JSX-order tiebreak within shared zIndex-400 band confirmed by 18 `compareDocumentPosition` tests |
| `Analyzer.tsx` / `Overview.tsx` | `PayoffChart.tsx` `domain` prop | `computePayoffDomain(...)` call | WIRED | Both call sites pass live-computed domain, not a hardcoded default |
| `PayoffChart.tsx` | `EDGE_ARROW_LANE_Y` | re-export (not redeclare) from `PayoffChartMarks.tsx` | WIRED | `export { EDGE_ARROW_LANE_Y }` at line 871; consumed by `PayoffChartMarks.tsx` render + test files |
| `GexBars.tsx` | `Market.tsx` / `GexByExpiry.tsx` | `fmtBn`/`windowStrikes`/`StrikeRange` exports | WIRED | Confirmed live importers exist outside the file (33-07 dead-code sweep, independently spot-checked) |

### Requirements Coverage

Phase 33 has no `.planning/REQUIREMENTS.md` entries for CHART-01..06 (grep returns zero matches) — the six requirement IDs are defined and tracked directly in `ROADMAP.md`'s Phase 33 entry, each mapped 1:1 to a plan (`33-01` through `33-07`, with `33-02`/`33-06` both covering CHART-02). All 6 are covered above under Observable Truths #1-7 — no orphaned requirements.

### Anti-Patterns Found

None. Grepped all 13 phase-modified/created chart + test + primitive files (`PayoffChart.tsx`, `PayoffChart.test.tsx`, `PayoffChartMarks.tsx`, `PayoffChartMarks.test.tsx`, `GammaProfile.tsx`, `GammaProfile.test.tsx`, `GexBars.tsx`, `GexBars.test.tsx`, `TermStructureChart.tsx`, `TermStructureChart.test.tsx`, `recharts-test-utils.tsx`, `zorder-spike.test.tsx`, `ui/chart.tsx`) for `TBD|FIXME|XXX|HACK|PLACEHOLDER|TODO|not yet implemented|coming soon` — zero matches. The eslint carve-out (`eslint.config.js`, 14 lines added) is scoped exactly to `apps/web/src/components/ui/**/*.tsx` (shadcn-generated files only) and disables exactly the 2 rules the review documented (`consistent-type-assertions`, `strict-boolean-expressions`) — not a blanket relaxation.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| CR-01 z-order fix (BE markers/edge arrows above fills/curves/walls) | `vitest run PayoffChart.test.tsx` (part of the 6-file targeted run below) | 18 `compareDocumentPosition` assertions pass | ✓ PASS |
| WR-01 GammaProfile ifOverflow=hidden parity | `vitest run GammaProfile.test.tsx` | pass | ✓ PASS |
| WR-02 TermStructureChart label placement | `vitest run TermStructureChart.test.tsx` | pass | ✓ PASS |
| WR-03 in-domain wall pixel-position regression | `vitest run PayoffChart.test.tsx` | `toBeCloseTo` assertions on `x1` pass | ✓ PASS |
| Structural clip test (off-domain wall) | `vitest run PayoffChart.test.tsx` | resolves real `<clipPath><rect>` sized 930×432 | ✓ PASS |
| 6 phase-33 test files targeted run | `bunx vitest run PayoffChart.test.tsx PayoffChartMarks.test.tsx TermStructureChart.test.tsx GammaProfile.test.tsx GexBars.test.tsx zorder-spike.test.tsx` | 6 files / 85 tests | ✓ PASS |
| Full workspace suite (orchestrator-run, authoritative) | `bun run test` | 289 files / 3174 tests green | ✓ PASS |
| Typecheck | `bun run typecheck` | `tsc --build --force` — 0 errors | ✓ PASS |
| Lint | `bun run lint` | `eslint .` — 0 errors (2 pre-existing informational notices only) | ✓ PASS |

### Human Verification Required

See frontmatter `human_verification` — 2 items, both pre-scoped as manual-only by the phase's own `33-VALIDATION.md`: (1) visual parity of the 4 migrated charts against their pre-migration appearance on a live/deployed build, (2) real-browser confirmation that extreme domains (wide EM band, off-domain walls) don't overflow the plot area — jsdom cannot lay out SVG to prove this structurally, only that the clip-path/`ifOverflow="hidden"` mechanisms are present in source (which they are, verified above).

### Gaps Summary

No gaps. All 12 observable truths (mapping to CHART-01 through CHART-06 plus the phase's cross-cutting hard requirements: domain fidelity, structural clipping, z-order parity, color parity, animation determinism, scope fences) are verified directly in source — not from SUMMARY claims. The phase's own highest-risk finding (CR-01: BE-marker bars and edge-arrow glyphs painting under layers they used to paint on top of) was caught by code review, and the fix is genuinely present in the current codebase, not just documented in `33-REVIEW-FIX.md` — confirmed by reading `PayoffChart.tsx:618-796` directly and running the 18 associated `compareDocumentPosition` regression tests. All 3 warning-level findings (WR-01 GammaProfile overflow, WR-02 TermStructureChart label position, WR-03 dropped pixel-position regression test) are similarly confirmed fixed in source. The one disclosed cosmetic drop (IN-01, TermStructureChart's decorative event-marker dot) has no fix required per the review's own disposition and is noted for the human visual-parity pass in case it's flagged unexpectedly. Full workspace suite (289 files / 3174 tests), typecheck, and lint were re-run directly by this verification (not sourced from SUMMARY output) and are all green. The only open items are the 2 inherently manual verifications (visual parity, real-browser overflow) that `33-VALIDATION.md` scoped as human-only from the start — no code-level gap exists.

---

_Verified: 2026-07-10T20:05:00Z_
_Verifier: Claude (gsd-verifier)_

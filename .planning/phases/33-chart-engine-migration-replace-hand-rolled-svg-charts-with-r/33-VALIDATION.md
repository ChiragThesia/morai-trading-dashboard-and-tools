---
phase: 33
slug: chart-engine-migration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-10
---

# Phase 33 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (workspace, `test.projects`) + @testing-library/react + jsdom + fast-check |
| **Quick run command** | `bun run test -- <path>` (or `cd apps/web && bunx vitest run <path>`) |
| **Full suite command** | `bun run test` |
| **jsdom caveat** | recharts `ResponsiveContainer` renders 0x0 under jsdom → every chart test imports the shared `mockResponsiveContainer()` from `apps/web/src/components/test/recharts-test-utils.tsx` (RESEARCH Pitfall 1) |
| **Note** | web-only presentation swap; no new tables, no contract/data-layer change |

## Sampling Rate

- After every task commit: the single chart's scoped test command
- After every wave: `bun run test` (full web workspace)
- Before verify: full suite + typecheck + lint green

## Per-Task Verification Map

| Requirement | Concern | Test file / command | Test Type |
|-------------|---------|---------------------|-----------|
| CHART-01 | A1 JSX-order z-control holds in recharts 3.9.2 ComposedChart; recharts pinned 3.9.2; ui/chart.tsx scaffolded | `apps/web/src/components/charts/zorder-spike.test.tsx`; `bun run typecheck` | unit (characterization spike) |
| CHART-02 | PayoffChart custom marks: EM-band clamp (2563bd6 no page-bleed), BE-marker bars, edge-arrow lanes | `apps/web/src/components/charts/PayoffChartMarks.test.tsx` | unit + fast-check |
| CHART-02 | PayoffChart core: domain fidelity (consumes computePayoffDomain, type=number + allowDataOverflow), 9-layer z-order, off-domain wall structurally clipped, native tooltip reports hovered spot, D-05/D-02/D-03/ANLZ-02/WR-03 preserved | `apps/web/src/components/charts/PayoffChart.test.tsx` | unit + fast-check |
| CHART-03 | TermStructureChart: forward-IV bracket via ReferenceLine segment present/omitted, guard case (no NaN, WR-02 on-canvas), asOf-driven event placement (WR-03) | `apps/web/src/components/picker/TermStructureChart.test.tsx` | unit |
| CHART-04 | GammaProfile: split teal/coral fill, flip/spot reference lines, compact vs full sizing, <2-point null guard | `apps/web/src/components/charts/GammaProfile.test.tsx` (new) | unit |
| CHART-05 | GexBars: horizontal bars (layout=vertical), per-bar Cell sign colors, wall/spot reference lines, GEX/OI/Volume tabs, windowStrikes/fmtBn | `apps/web/src/components/charts/GexBars.test.tsx` | unit |
| CHART-06 | Full suite green re-expressed against recharts DOM; visx/echarts deps retained; dead code removed only for the 4 migrated charts | `bun run test` + `bun run typecheck` + `bun run lint` | full suite + gate |

## Wave 0 Requirements

Three infrastructure gaps (RESEARCH "Wave 0 Gaps") do NOT exist yet and are delivered by the plans
before the charts that depend on them run:

| Wave 0 item | Closed by |
|-------------|-----------|
| `recharts-test-utils.tsx` shared ResponsiveContainer mock (all 4 chart tests need it) | 33-01 |
| PayoffChart z-order regression / A1 verification (`zorder-spike.test.tsx`) | 33-01 |
| `GammaProfile.test.tsx` — no existing test file for this chart | 33-03 |

`TermStructureChart.test.tsx` and `GexBars.test.tsx` already exist (re-expressed, not created).

## Manual-Only Verifications

| Behavior | Why Manual | Instructions |
|----------|------------|--------------|
| Visual parity: same data → same story (curves, zones, walls, EM) with MORAI tokens | Editorial/visual judgment | Compare the 4 charts on morai.wtf (Analyzer / Overview / Market) before vs after — no overflow/bleed, colors match |
| No overflow at extreme domains in a real browser | Real-layout judgment (jsdom can't lay out SVG) | Push a wide EM / off-domain wall on live data; confirm nothing bleeds past the plot area |

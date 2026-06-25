---
phase: "09"
plan: "10"
subsystem: apps/web
tags: [analyzer, scenario-engine, bsm, payoff-chart, pnl-heatmap, roll-simulator, tdd]
dependency_graph:
  requires:
    - 09-09 (parseTosOrder, impliedFlatIv)
    - 09-08 (GammaProfile, GexBars, GexByExpiry)
    - 09-06 (GreekStrips, AttributionWaterfall, LevelBar)
    - 09-02 (@morai/quant bsmPrice/bsmGreeks)
  provides:
    - Analyzer screen (3-column cockpit)
    - scenario-engine.ts (client-side repriceScenario, rollScenario, buildHeatmapCells)
    - PayoffChart (visx 9-layer SVG)
    - PnlHeatmap (ECharts spot×date grid)
    - RollSimulator (amber overlay controls)
  affects:
    - apps/web/src/App.tsx (Analyzer wired in, COMING_SOON replaced)
    - apps/web/src/App.test.tsx (uplot/echarts mocks added for shell render)
tech_stack:
  added:
    - "@visx/shape LinePath" (payoff curves SVG)
    - "@visx/gradient LinearGradient" (area fill)
    - "@visx/event localPoint" (crosshair tooltip)
    - "echarts-for-react ReactECharts" (PnlHeatmap)
  patterns:
    - TOS-stable y-axis: computed once per positionSetSignature, re-triggered by Fit Y
    - Client-side re-pricing: repriceScenario runs in useMemo, zero network on slider drag
    - OCC strike without shared dep: sym.slice(13,21)/1000
    - AnalyzerPosition: live (broker, protected) vs non-live (pasted, removable)
    - base-ui ToggleGroup array API (value=string[], onValueChange=string[])
key_files:
  created:
    - apps/web/src/lib/scenario-engine.ts
    - apps/web/src/lib/scenario-engine.test.ts
    - apps/web/src/components/charts/PayoffChart.tsx
    - apps/web/src/components/charts/PnlHeatmap.tsx
    - apps/web/src/components/RollSimulator.tsx
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Analyzer.test.tsx
  modified:
    - apps/web/src/App.tsx (Analyzer import + wired)
    - apps/web/src/App.test.tsx (uplot/echarts/visx/hook mocks added)
decisions:
  - "D-01 enforced: @morai/quant bsmPrice/bsmGreeks used in scenario-engine — same kernel as server, cross-screen P&L consistent"
  - "D-04 enforced: no seed/demo positions — live data from usePositions() only on mount"
  - "OCC strike extraction inline (slice 13-21/1000) to avoid circular @morai/shared import in scenario-engine"
  - "TOS-stable y-axis via positionSetSignature useMemo: recomputes on position set change, Fit Y button forces manual recompute"
  - "ReadonlyArray<PayoffPoint> spread to mutable for visx LinePath data prop (TS4104 fix)"
  - "App.test.tsx: mocked uplot-react, echarts-for-react, visx — matchMedia not in jsdom"
metrics:
  duration: "~75 min (resumed from previous session context)"
  completed: "2026-06-24"
  tasks_completed: 3
  files_created: 7
  files_modified: 2
status: complete
---

# Phase 09 Plan 10: Analyzer Screen Summary

Client-side scenario cockpit — PayoffChart + PnlHeatmap + RollSimulator + Analyzer 3-column assembly with live BSM re-pricing at slider speed.

## Tasks

### Task 1: Scenario Engine (scenario-engine.ts) — TDD GREEN

**Commit:** `fa925e3`

Implemented `repriceScenario`, `rollScenario`, `buildHeatmapCells` over `@morai/quant`:

- Spot grid 6900–7900 (170 steps) for payoff, fan (HEATMAP_DAYS=[0,5,10,15,20,30]), expiration, greek strips
- `calendarNetPrice = bsmPrice(back) - bsmPrice(front)` — entry computed at liveSpot/0days/0ivShift
- `bookPL = (net - entry) * 100 * qty`; ivShift applied as `/100` (slider in vol points)
- Roll overlay: front DTE extended + strike offset applied to front leg only
- Types: `AnalyzerPosition`, `ScenarioParams`, `RollConfig`, `PayoffPoint`, `HeatmapCell`, `ScenarioResult`
- Tests: kernel-parity, payoff-peak-near-strike, fast-check heatmap (1000 runs), roll overlay

### Task 2: Chart Components (PayoffChart, PnlHeatmap, RollSimulator) — TDD GREEN

**Commit:** `dfd0e7f`

- **PayoffChart** (visx, 1000×470): 9-layer z-order (GEX walls → zero line → fan → expiry → roll → today → crosshair → walls labels → spot line). TOS-stable y-axis via `baseExpirationCurve` + `positionSetSignature`. Crosshair uses `localPoint`, HTML tooltip with P&L/SPX/wall distances.
- **PnlHeatmap** (ECharts): spot×date grid, step toggle 10/25/50/100 (default 50), diverging teal↔coral from `buildHeatmapCells`, compact cell labels ($47, $1.2k, −$3.2k).
- **RollSimulator**: front-out (none/+7/+14/+21) + roll-strike (−100/same/+100) segment toggles, amber status copy, badge "on {name}".

### Task 3: Analyzer Screen Assembly — TDD RED + GREEN

**Commits:** `bc545ac` (RED), `d9ecf57` (GREEN)

Assembled the 3-column cockpit:
- Left: PositionsPanel (live=●live protected, non-live=× removable, paste/blank add) + ScenarioPanel (3 sliders + Reset) + RollSimulator
- Center: PayoffChart + PlReadout (today/expiry/roll) + GreekStrips + PnlHeatmap
- Right: GammaProfile(compact) + LevelBar + GexBars + BookGreeksTable + AttributionWaterfall(analyzer variant)

App.tsx wired: `COMING_SOON_SCREEN("Analyzer")` → `<Analyzer />`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ReadonlyArray incompatible with visx LinePath data prop**
- Found during: Task 2 (PayoffChart)
- Issue: `data={curve}` where curve is `ReadonlyArray<PayoffPoint>` — visx LinePath requires mutable `T[]`
- Fix: spread `data={[...curve]}` on all 4 LinePath usages
- Files: `apps/web/src/components/charts/PayoffChart.tsx`
- Commit: dfd0e7f

**2. [Rule 1 - Bug] `as` assertion in PnlHeatmap days.indexOf**
- Found during: Task 2 (lint)
- Issue: `days.indexOf(c.daysForward as typeof COLUMNS[number])` triggered `consistent-type-assertions: never`
- Fix: `days.findIndex((d) => d === c.daysForward)` — no cast needed
- Files: `apps/web/src/components/charts/PnlHeatmap.tsx`
- Commit: dfd0e7f

**3. [Rule 1 - Bug] `as ReadonlyArray<PayoffPoint>` in scenario-engine fanCurves**
- Found during: Task 1 (lint)
- Issue: `fanCurves: HEATMAP_DAYS.map(...) as ReadonlyArray<...>` — `consistent-type-assertions: never`
- Fix: explicit TypeScript type annotation on variable declaration
- Files: `apps/web/src/lib/scenario-engine.ts`
- Commit: fa925e3

**4. [Rule 1 - Bug] App.test.tsx broken by Analyzer import of uPlot CJS**
- Found during: Task 3 (full test run)
- Issue: `App.test.tsx` rendered `<Analyzer />` via `App.tsx` which now imports uPlot, but `matchMedia` is not available in jsdom
- Fix: added `vi.mock("uplot-react", ...)`, `vi.mock("echarts-for-react", ...)`, `vi.mock("@visx/shape", ...)`, and data hook mocks to `App.test.tsx`
- Files: `apps/web/src/App.test.tsx`
- Commit: d9ecf57

**5. [Rule 2 - Missing critical functionality] Test file `as` assertions on mock return values**
- Found during: Task 3 (lint)
- Issue: `vi.mocked(usePositions).mockReturnValue({...} as ReturnType<typeof usePositions>)` — 10 `as` assertions, all blocked by `consistent-type-assertions: never`
- Fix: replaced with typed builder functions `makePositionsResult()` and `makeGexResult()` using full `UseQueryResult<T, Error>` structure
- Files: `apps/web/src/screens/Analyzer.test.tsx`
- Commit: bc545ac → resolved before bc545ac final push

## Known Stubs

None — all data flows wired. Live positions from `usePositions()`, GEX from `useGex()`. No hardcoded or demo data (D-04 enforced).

## Threat Flags

None — Analyzer is a client-side read-only screen. No new network endpoints, no auth paths, no file access, no schema changes.

## Self-Check: PASSED

- `apps/web/src/lib/scenario-engine.ts` — exists
- `apps/web/src/lib/scenario-engine.test.ts` — exists
- `apps/web/src/components/charts/PayoffChart.tsx` — exists
- `apps/web/src/components/charts/PnlHeatmap.tsx` — exists
- `apps/web/src/components/RollSimulator.tsx` — exists
- `apps/web/src/screens/Analyzer.tsx` — exists
- `apps/web/src/screens/Analyzer.test.tsx` — exists
- Commits: fa925e3, dfd0e7f, bc545ac, d9ecf57 — all confirmed in git log
- Full test suite: 133 files, 1233 tests — all green
- Typecheck: clean (`tsc --build --force` exits 0)
- Lint: clean (no errors)

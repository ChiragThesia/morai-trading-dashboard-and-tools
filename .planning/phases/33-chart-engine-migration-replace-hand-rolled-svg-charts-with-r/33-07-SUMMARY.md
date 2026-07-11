---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 07
subsystem: web
tags: [recharts, chart-migration, dead-code-verification, phase-gate]
dependency-graph:
  requires:
    - "PayoffChart on Recharts, crosshair/path-builder dead code already removed (33-06)"
    - "GammaProfile on Recharts (33-03)"
    - "GexBars on Recharts (33-05)"
    - "TermStructureChart on Recharts (33-04)"
  provides:
    - "Verified dependency floor: @visx/*, echarts, echarts-for-react remain declared in apps/web/package.json and genuinely imported by the four out-of-scope charts (LifecycleChart, EquityCurve, MiniLine on @visx; GexByExpiry on echarts-for-react)"
    - "Verified zero-dead-code state across the four migrated charts (PayoffChart, GammaProfile, GexBars, TermStructureChart) — every exported symbol has a real importer"
    - "Full green phase gate: 289 files / 3167 tests, typecheck clean, lint clean (0 errors)"
  affects: []
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - .planning/phases/33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r/33-07-SUMMARY.md
  modified: []
decisions:
  - "No deletions made. 33-06's own SUMMARY documented that the manual crosshair block, pinMarker, buildProfitZonePath, buildFillPath, and clampY/getX/getY were already deleted in that plan (PayoffChart). Re-reading all four migrated chart files in this plan confirmed each remaining helper/export is live: PayoffChart's buildXScale/buildYScale/buildXTicks/computeYDomain/findZeroCrossings/INNER_W are imported by scenario-engine.ts, payoff-domain.ts, PayoffChartMarks.tsx, and their respective test files; EDGE_ARROW_LANE_Y and PayoffTooltipContent are used by PayoffChart.test.tsx/PayoffChartMarks.test.tsx; GexBars' fmtBn/windowStrikes/StrikeRange are imported by Market.tsx and GexByExpiry.tsx. GammaProfile and TermStructureChart carry no orphaned helpers at all. Task 1 was therefore a verification pass with nothing to remove, not a no-op skip of the task."
  - "Grepping for a bare 'echarts' substring produces false positives against every file that says 'Recharts' in a doc comment (recharts contains echarts) — the real-import check used 'from \"echarts\"'/'from \"echarts-for-react\"' patterns instead, confirming GexByExpiry.tsx is the only remaining real echarts-for-react importer and none of the four migrated files import either @visx or echarts anywhere outside prose."
metrics:
  duration: "~20m"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 07: Integration sweep (dead-code verification + phase gate) Summary

One-line: verified the four migrated charts (PayoffChart, GammaProfile, GexBars, TermStructureChart) carry zero orphaned SVG/scale helpers, confirmed @visx/echarts/echarts-for-react remain genuinely imported by the four out-of-scope charts, and ran the full green phase gate (289 files / 3167 tests, typecheck clean, lint clean) — no code changes were needed.

## What shipped

**Task 1 — Dead-code sweep (verify-before-delete).** Read all four migrated chart files
end to end and grepped every candidate export/helper for real importers before considering
deletion:

- `PayoffChart.tsx` re-exports `findZeroCrossings`, `computeYDomain`, `buildXTicks`,
  `buildXScale`, `INNER_W` — all four have live importers outside the file:
  `apps/web/src/lib/scenario-engine.ts`, `apps/web/src/lib/payoff-domain.ts`,
  `apps/web/src/components/charts/PayoffChartMarks.tsx`, plus
  `PayoffChart.test.tsx`/`PayoffChartMarks.test.tsx`. `EDGE_ARROW_LANE_Y` (re-exported,
  not redeclared) is consumed by `PayoffChartMarks.tsx`/`PayoffChartMarks.test.tsx`.
  `PayoffTooltipContent` is unit-tested directly by `PayoffChart.test.tsx`. 33-06's own
  SUMMARY already documented that the actual dead code from the visx→Recharts swap
  (`pinMarker`, `buildProfitZonePath`, `buildFillPath`, `clampY`/`getX`/`getY`, the ~50-line
  manual crosshair block) was deleted in that plan — nothing further to remove here.
- `GammaProfile.tsx` — no leftover scale/path helpers; every constant and function in the
  file is used in the single render path.
- `GexBars.tsx` — exported `fmtBn`, `windowStrikes`, `StrikeRange` all have live importers:
  `apps/web/src/screens/Market.tsx`, `apps/web/src/components/charts/GexByExpiry.tsx`,
  and `GexBars.test.tsx`.
- `TermStructureChart.tsx` — `GuardTag` (the one non-standard mark using Recharts 3.x
  `useXAxisScale`/`useYAxisScale`/`usePlotArea` hooks) is wired into the render tree; no
  orphaned helpers.

No deletions were made — the sweep found nothing dead to remove. This is a genuine
verification result, not a skipped step: each candidate was checked individually against
the codebase before being ruled live.

**Dependency floor verification.** `apps/web/package.json` still declares `@visx/axis`,
`@visx/curve`, `@visx/event`, `@visx/gradient`, `@visx/group`, `@visx/scale`,
`@visx/shape`, `@visx/tooltip`, `echarts`, and `echarts-for-react`. Real (non-prose)
imports confirmed by grepping for `@visx` and `from "echarts`/`from "echarts-for-react"`
literals (a bare `echarts` substring search produces false positives against every file
whose doc comment says "Recharts"):
- `@visx/*` — genuinely imported by `LifecycleChart.tsx`, `EquityCurve.tsx`, `MiniLine.tsx`
  (plus their test files). The two hits inside `PayoffChart.tsx`/`GammaProfile.tsx` are
  doc-comment prose ("migrated off @visx") — zero real `@visx` imports remain in any of
  the four migrated chart files.
- `echarts-for-react` — genuinely imported by `GexByExpiry.tsx`
  (`import ReactECharts from "echarts-for-react"`). No real `echarts`/`echarts-for-react`
  import exists in any of the four migrated files.

**Task 2 — Full phase green gate.** No cross-file fallout was found (the migration was
already fully consumer-clean per 33-01..33-06's own summaries), so no fixes were needed.
Ran the full gate as-is:
- `bun run test` (full workspace) — 289 files / 3167 tests, all green (matches the 33-06
  baseline exactly — 0 regressions from this plan, since this plan changed no source).
- `bun run typecheck` (`tsc --build --force`) — clean, 0 errors.
- `bun run lint` (`eslint .`) — 0 errors, 0 warnings from any source file; the only output
  is the same 2 pre-existing informational config warnings (multi-tsconfig-project notice
  + boundaries-plugin legacy-selector-syntax notice) noted in every prior 33-0x summary —
  not new, not actionable, not from this plan's scope.

## Deviations from Plan

None — plan executed exactly as written. The plan anticipated dead code might remain
after 33-01..33-06; verification found none did (33-06 had already removed all of it from
PayoffChart, and the other three charts never had leftover helpers to begin with). No
Rule 1/2/3 auto-fixes were needed since the full gate was green with zero changes.

## Known Stubs

None.

## Verification

- `rg -q '"@visx/shape"' apps/web/package.json && rg -q '"echarts"' apps/web/package.json && rg -q '"echarts-for-react"' apps/web/package.json` — all three present.
- `bun run test -- apps/web/src/components/charts apps/web/src/components/picker/TermStructureChart.test.tsx` — 7 test files / 84 tests green.
- `bun run typecheck` — clean, 0 errors.
- `bun run test` (full workspace) — 289 files / 3167 tests green.
- `bun run lint` — 0 errors, 0 warnings from source (2 pre-existing informational config notices only).
- Grep evidence (see Decisions/What-shipped above) that every export from the four migrated
  charts has a live importer, and that @visx/echarts/echarts-for-react remain genuinely
  imported by the four out-of-scope charts.

## Self-Check: PASSED

- FOUND: .planning/phases/33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r/33-07-SUMMARY.md

---
phase: 33-chart-engine-migration-replace-hand-rolled-svg-charts-with-r
plan: 01
subsystem: web
tags: [recharts, shadcn, chart-migration, test-harness, z-order]
dependency-graph:
  requires: []
  provides:
    - "recharts@3.9.2 pinned in apps/web/package.json"
    - "apps/web/src/components/ui/chart.tsx (ChartContainer, ChartConfig, ChartTooltip*, ChartLegend*)"
    - "apps/web/src/components/test/recharts-test-utils.tsx (mockResponsiveContainer)"
    - "empirical A1 z-order verdict (recharts-zIndex bands, not bare JSX order)"
  affects:
    - "apps/web plans 33-02..33-07 (PayoffChart, TermStructureChart, GammaProfile, GexBars migrations)"
tech-stack:
  added:
    - "recharts@3.9.2 (apps/web only)"
  patterns:
    - "shadcn-generated ui/ primitives committed unmodified; scoped eslint.config.js carve-out (not inline disables) relaxes only the two rules the generator's own code trips"
    - "vi.mock delegated through an imported helper function (mockResponsiveContainer()) — Vitest 4.1.8 hoists and executes it correctly despite a 'move to top level' deprecation warning; documented with a ponytail comment + upgrade path"
key-files:
  created:
    - apps/web/src/components/ui/chart.tsx
    - apps/web/src/components/test/recharts-test-utils.tsx
    - apps/web/src/components/charts/zorder-spike.test.tsx
  modified:
    - apps/web/package.json
    - bun.lock
    - docs/architecture/stack-decisions.md
    - eslint.config.js
    - apps/web/src/components/ui/toggle-group.tsx
decisions:
  - "Assumption A1 (RESEARCH Pitfall 4/D-16) is FALSE as literally stated: bare JSX source order does not control ComposedChart cross-type z-order in recharts 3.9.2. Empirically, every series component carries a fixed default zIndex (Area=100, Bar=300, Line=400 — confirmed via each component's .d.ts), and recharts renders fixed recharts-zIndex-layer_<n> DOM bands sorted by that value, independent of JSX position."
  - "Within a SHARED zIndex band (same component type, no override), JSX order DOES control relative stacking — confirmed empirically with three same-type Area siblings in non-alphabetical JSX order."
  - "Arbitrary custom zIndex override values (e.g. 10/20/30, or 350) were observed to silently fail to render the element at all in this spike, with no console error/warning. Root cause not investigated (out of scope for 33-01) — flagged for plan 33-06 to re-verify before assigning non-default zIndex values to any of PayoffChart's 9 layers."
  - "shadcn CLI's own 'bunx shadcn@latest add chart' dependency-install step silently downgraded recharts from the just-installed 3.9.2 to 3.8.0 (its registry item's own pinned dependency) — re-ran 'bun add recharts@3.9.2' after scaffolding to restore the exact required pin."
metrics:
  duration: "~1.5h"
  completed: 2026-07-10
status: complete
---

# Phase 33 Plan 01: Recharts install + shadcn scaffold + A1 z-order spike Summary

One-line: recharts@3.9.2 pinned + shadcn `ui/chart.tsx` scaffolded + docs-before-code stack-decisions reconciliation, plus an empirical spike that disproves the RESEARCH's "bare JSX order controls z-order" assumption and identifies the real mechanism (per-type `zIndex` bands) that plan 33-06 must design around.

## What shipped

**Task 1 — recharts install + shadcn scaffold + docs reconciliation.**
`docs/architecture/stack-decisions.md` D3 was updated FIRST (docs before code, per
`.claude/rules/workflow.md`): the flat "Recharts: superseded. Not used." line is replaced
with a reversal note recording Recharts adopted for the 4 in-scope Phase 33 charts
(PayoffChart, TermStructureChart, GammaProfile, GexBars) while visx/uPlot/ECharts stay
recorded as retained for the out-of-scope charts (LifecycleChart, EquityCurve, MiniLine,
GexByExpiry). The D3 summary row in the decision table was updated to match.

`bun add recharts@3.9.2` (run from `apps/web`) installed the exact pinned version with no
caret. `bunx shadcn@latest add chart` then scaffolded `apps/web/src/components/ui/chart.tsx`
(committed unmodified — exports `ChartContainer`, `ChartConfig`, `ChartTooltip`,
`ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`) and skipped
`card.tsx` (already present, byte-identical).

**Deviation caught and fixed:** the shadcn CLI's own dependency-install step for the `chart`
registry item silently rewrote `apps/web/package.json`'s `recharts` entry from `3.9.2` down
to `3.8.0` (the registry item's own pinned dependency version) as a side effect of scaffolding
the component. Re-ran `bun add recharts@3.9.2` after the scaffold step to restore the exact
required pin — verified via `git diff apps/web/package.json` showing only the intended `+
"recharts": "3.9.2"` line, and via the plan's own `rg` verification command.

`@visx/*`, `echarts`, `echarts-for-react` remain untouched in `package.json` (D-13).

**Task 2 — shared ResponsiveContainer mock + A1 z-order spike.**
`apps/web/src/components/test/recharts-test-utils.tsx` exports `mockResponsiveContainer()`,
which `vi.mock`s recharts' `ResponsiveContainer` to a fixed 800x400 `<div>` wrapper so charts
produce real SVG under jsdom (Pitfall 1 — jsdom has no `ResizeObserver`/layout engine, so the
real component resolves to 0x0). Verified empirically that Vitest 4.1.8 correctly hoists and
executes a `vi.mock` call delegated through an imported function (it emits a "move to top
level" deprecation warning but the mock takes effect before any imports of the mocked module
resolve) — documented with a `ponytail:` comment naming the upgrade path (a bare
`import "./recharts-test-utils"` side-effect import + top-level `vi.mock`) if a future Vitest
version turns this into a hard error.

`apps/web/src/components/charts/zorder-spike.test.tsx` renders a minimal `ComposedChart` and
empirically settles Assumption A1 (RESEARCH Pitfall 4 / Decision D-16 — "JSX order SHOULD
directly control the 9-layer stack" in recharts 3.x):

- **Test 1** renders `Bar`, `Area`, `Line` in that JSX order with no explicit `zIndex` prop.
  DOM order came out `Area → Bar → Line` — NOT the JSX order. Inspecting each component's
  `.d.ts` confirmed why: `Area` has `readonly zIndex: 100`, `Bar` has `readonly zIndex: 300`,
  `Line` has `readonly zIndex: 400`. recharts 3.9.2 renders the SVG as fixed
  `<g class="recharts-zIndex-layer_<n>">` bands (`-100, -50, 100, 200, 300, 400, 500, 600,
  1000, 1100, 1200, 2000` observed), sorted by each item's zIndex value, and JSX position does
  not affect which band an item lands in.
- **Test 2** renders three `Area` siblings (same default zIndex, 100) in a deliberately
  non-alphabetical JSX order. DOM order matched JSX order exactly — confirming JSX position
  IS the tiebreaker for elements that land in the SAME zIndex band.

**Verdict recorded per the plan's explicit instruction ("if it FAILS, STOP and record in the
SUMMARY that A1 is false"): A1, taken literally as "bare JSX order alone controls z-order,"
is FALSE.** The real, empirically confirmed mechanism: cross-type order follows each
component's `zIndex` (default per type, override-able via an explicit `zIndex` prop per each
component's `.d.ts`); JSX order only breaks ties within a shared zIndex band. A follow-up
probe (not part of the committed test, run and reverted during the spike) found that
assigning arbitrary custom `zIndex` values outside the standard preset bands (e.g. `10`,
`20`, `30`, or `350`) caused the element to silently fail to render at all, with no console
error — this is flagged for plan 33-06 to re-verify before relying on non-default `zIndex`
values for any of PayoffChart's 9 locked layers.

**Action for plan 33-06:** design the 9-layer z-order around each layer's Recharts component
TYPE (which pins its default zIndex band: Area=100, Bar=300, Line=400, others TBD) plus JSX
order for same-type layers, rather than assuming raw JSX position alone governs the full
stack. Where the locked z-order genuinely needs a layer to sit outside its type's default
band, re-verify the `zIndex` override behavior first (this spike found it unreliable for
non-preset values) rather than assuming it works.

## Deviations from Plan

**1. [Rule 1 - Bug] shadcn CLI scaffold step silently downgraded recharts to 3.8.0**
- **Found during:** Task 1, immediately after `bunx shadcn@latest add chart`.
- **Issue:** the CLI's own dependency-install step for the `chart` registry item rewrote
  `apps/web/package.json`'s `recharts` entry to `3.8.0`, undoing the exact `3.9.2` pin from
  the prior `bun add recharts@3.9.2` step.
- **Fix:** re-ran `bun add recharts@3.9.2` after scaffolding; verified via `git diff` and the
  plan's own `rg '"recharts": "3.9.2"'` check.
- **Files modified:** apps/web/package.json, bun.lock
- **Commit:** bcc95b9

**2. [Rule 2 - missing critical functionality] Added a scoped ESLint carve-out for shadcn-generated `ui/` primitives**
- **Found during:** Task 2, `bun run lint` (not part of either task's literal `<verify>`
  command, but required by CLAUDE.md's "no `any`/`as`/`!`" hard rule and this repo's
  `.claude/rules/typescript.md`).
- **Issue:** the freshly scaffolded `ui/chart.tsx` — which the plan explicitly requires to be
  committed unmodified (D-02, "Do NOT hand-edit chart.tsx internals") — trips 17
  `@typescript-eslint/consistent-type-assertions` and `@typescript-eslint/strict-boolean-
  expressions` errors from its own shadcn-generated code (payload-narrowing casts, nullable
  conditional checks in third-party-templated logic). Hand-editing the file to satisfy lint
  would violate the plan's explicit instruction; leaving it unlinted would leave `bun run
  lint` red.
- **Fix:** added a scoped `eslint.config.js` override for `apps/web/src/components/ui/**/*.tsx`
  that disables only the two tripped rules (`consistent-type-assertions`,
  `strict-boolean-expressions`) — `no-explicit-any` and `no-non-null-assertion` stay enforced
  for that directory. This also made one pre-existing inline `eslint-disable` comment in
  `toggle-group.tsx` redundant; removed it (1 line) to keep `bun run lint` at zero warnings.
- **Files modified:** eslint.config.js, apps/web/src/components/ui/toggle-group.tsx
- **Commit:** 591c1b6

## Known Stubs

None. Both artifacts (`ui/chart.tsx`, `recharts-test-utils.tsx`) are fully functional —
`ui/chart.tsx` is unused by any chart component yet (that's plans 33-02+), which is expected
scaffolding, not a stub.

## Verification

- `rg '"recharts": "3.9.2"' apps/web/package.json` — matches, exact pin.
- `apps/web/src/components/ui/chart.tsx` exists, exports `ChartContainer` + `ChartConfig`.
- `bun run test -- apps/web/src/components/charts/zorder-spike.test.tsx` — 2/2 tests green.
- `bun run typecheck` — clean.
- `bun run lint` — clean (0 errors, 0 warnings from this change; 2 unrelated pre-existing
  informational config warnings about legacy boundaries-plugin selector syntax and multiple
  tsconfig projects).
- `bun run test` (full workspace suite) — 287 files / 3148 tests green (baseline before this
  plan: 286 files / 3146 tests).
- `docs/architecture/stack-decisions.md` D3 no longer says Recharts is "superseded / not
  used"; records the reversal + retention of visx/uPlot/ECharts.

## Self-Check: PASSED

- FOUND: apps/web/src/components/ui/chart.tsx
- FOUND: apps/web/src/components/test/recharts-test-utils.tsx
- FOUND: apps/web/src/components/charts/zorder-spike.test.tsx
- FOUND commit bcc95b9 (feat: install recharts@3.9.2 + scaffold shadcn chart primitive)
- FOUND commit 591c1b6 (test: shared ResponsiveContainer mock + A1 z-order characterization spike)

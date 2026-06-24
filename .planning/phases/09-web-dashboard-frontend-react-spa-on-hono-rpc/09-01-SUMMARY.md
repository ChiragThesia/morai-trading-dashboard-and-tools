---
phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc
plan: "01"
subsystem: docs-and-config
tags: [docs-before-code, eslint, architecture, charting, quant]
status: complete

dependency_graph:
  requires: []
  provides:
    - docs/architecture/stack-decisions.md (D3 charting reconciled + D21 quant-leaf recorded)
    - docs/architecture/monorepo-layout.md (quant leaf + apps/web in dependency graph)
    - eslint.config.js (quant boundary element + apps/web tsconfig wiring)
    - packages/quant/tsconfig.json (stub — filled in Plan 02)
    - packages/quant/src/index.ts (placeholder — replaced in Plan 02)
    - apps/web/tsconfig.json (stub — filled in Plan 03)
  affects:
    - Plan 02 (quant leaf extraction — ESLint boundary ready, tsconfig stub exists)
    - Plan 03 (apps/web scaffold — tsconfig stub and boundary wiring ready)
    - All chart plans (D3 reconciled before chart code lands)

tech_stack:
  added: []
  patterns:
    - docs-before-code (architecture + boundary changes documented before code)
    - ESLint boundaries/elements quant pattern for new pure leaf

key_files:
  modified:
    - docs/architecture/stack-decisions.md
    - docs/architecture/monorepo-layout.md
    - eslint.config.js
  created:
    - packages/quant/tsconfig.json
    - packages/quant/src/index.ts
    - apps/web/tsconfig.json

decisions:
  - "D21 added to stack-decisions.md: packages/quant pure-leaf BSM kernel, imported by both core and web"
  - "D3 charting entry reconciled: visx + uPlot + ECharts active; Recharts superseded"
  - "quant boundary element added to eslint.config.js with self-allow + core/apps allow rules"
  - "Stub tsconfigs created for quant + apps/web so lint stays green before Plans 02/03"

metrics:
  duration: "~5 minutes"
  completed: "2026-06-24"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 3
---

# Phase 09 Plan 01: Docs-Before-Code — Charting Reconciliation + Quant Leaf + ESLint Boundary

Reconciled the D3 charting decision (visx/uPlot/ECharts replacing Recharts per D-05), recorded the new `packages/quant` pure-leaf BSM kernel extraction as D21 (per D-01), and wired the ESLint boundary config with a `quant` element and `apps/web` tsconfig paths.

## What Was Built

**Task 1 — `docs/architecture/stack-decisions.md`**

Updated the D3 entry: visx (`@visx/shape`/`gradient`/`event`/`scale`/`axis`/`group`/`tooltip`) for payoff/profile/equity/minis, uPlot (`uplot` + `uplot-react`) for greek strips, Apache ECharts (`echarts` + `echarts-for-react`) for GEX bars/heatmap/by-expiry. Recharts marked superseded with the swap reason. Added D21 section: the `packages/quant` pure-leaf BSM extraction with rationale (cross-screen P&L consistency, hexagon law compliance, swap cost, and references to D-01).

**Task 2 — `docs/architecture/monorepo-layout.md`**

Added `packages/quant/` to the top-level layout and the workspace dependency graph with edges `core → quant` and `web → quant`. Added a `packages/quant` layout section describing its role (pure math leaf). Added an `apps/web` section describing its allowed imports. Preserved the "web never imports core" rule in two forms.

**Task 3 — `eslint.config.js`**

Added boundary element `{ type: "quant", pattern: "**/packages/quant/src/**", mode: "full" }`. Added `quant` to the allow lists for `core` and `apps` elements. Added self-allow rule `{ from: "quant", allow: ["quant"] }`. Added `packages/quant/tsconfig.json` and `apps/web/tsconfig.json` to both resolver `project` arrays. Extended typed-lint `files` globs to include `.tsx` patterns. No `eslint-disable` added for any boundary rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Created stub tsconfigs and placeholder source file to keep lint green**

- **Found during:** Task 3 lint verification
- **Issue:** Adding `packages/quant/tsconfig.json` and `apps/web/tsconfig.json` to the ESLint `parserOptions.project` arrays causes `typescript-eslint` to immediately read those files. Without the files existing, lint fails with `ENOENT`. Without at least one `.ts` file in `packages/quant/src/`, TypeScript reports `TS18003: No inputs were found`.
- **Fix:** Created `packages/quant/tsconfig.json` (canonical pure-leaf shape, matches `packages/shared/tsconfig.json`), `packages/quant/src/index.ts` (placeholder export stub, replaced in Plan 02), and `apps/web/tsconfig.json` (stub with correct references, filled in Plan 03). All three are intentional docs/config-before-code artifacts.
- **Files created:** `packages/quant/tsconfig.json`, `packages/quant/src/index.ts`, `apps/web/tsconfig.json`
- **Impact:** None — Plan 02 replaces the placeholder content and Plan 03 fills the `apps/web` structure. The boundary wiring is now live and lint is green.

## Verification Results

```
grep -c 'visx' docs/architecture/stack-decisions.md        → 3
grep -c 'uPlot' docs/architecture/stack-decisions.md       → 3
grep -c 'ECharts' docs/architecture/stack-decisions.md     → 3
grep -c 'quant' docs/architecture/stack-decisions.md       → present (D21 section)
grep 'Recharts' stack-decisions.md                         → superseded only
grep -c 'quant' docs/architecture/monorepo-layout.md       → 11
grep -c 'apps/web' docs/architecture/monorepo-layout.md    → 4
grep -c 'type: "quant"' eslint.config.js                  → 1
grep -c '"quant"' eslint.config.js                        → 4
grep -c 'apps/web/tsconfig.json' eslint.config.js         → 2
grep -c 'packages/quant/tsconfig.json' eslint.config.js   → 2
grep -c '\.tsx' eslint.config.js                          → 3
bun run lint                                               → exit 0
```

## Known Stubs

- `packages/quant/src/index.ts` — placeholder `export {}`. Plan 02 replaces with the actual BSM kernel exports (`bsmPrice`, `bsmGreeks`, `bsmVega`, `BsmGreeks`).
- `apps/web/tsconfig.json` — stub with references block. Plan 03 adds `compilerOptions.types`, JSX settings, and Vite-specific paths.

These stubs are intentional and tracked. They do not block this plan's goal (docs-before-code gate). The gate is satisfied: boundary law, dependency graph, and charting decision are all documented before any code lands.

## Self-Check: PASSED

- `docs/architecture/stack-decisions.md` — exists, contains visx/uPlot/ECharts and D21 section
- `docs/architecture/monorepo-layout.md` — exists, contains quant + apps/web sections
- `eslint.config.js` — exists, quant element present, lint exits 0
- `packages/quant/tsconfig.json` — exists
- `packages/quant/src/index.ts` — exists
- `apps/web/tsconfig.json` — exists
- Commit `cb7b690` — verified in git log

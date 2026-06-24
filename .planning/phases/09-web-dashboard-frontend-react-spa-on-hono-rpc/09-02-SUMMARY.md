---
phase: 09-web-dashboard-frontend-react-spa-on-hono-rpc
plan: "02"
subsystem: quant-leaf
tags: [tdd, bsm, quant, packages, kernel-extraction]
status: complete

dependency_graph:
  requires:
    - 09-01 (ESLint boundary for quant element, tsconfig stub created)
  provides:
    - packages/quant/package.json (@morai/quant pure leaf, no runtime deps)
    - packages/quant/vitest.config.ts (vitest config for standalone run)
    - packages/quant/src/bsm.ts (relocated BSM kernel — verbatim copy, zero imports)
    - packages/quant/src/bsm.test.ts (parity + fast-check suite, 34 tests)
    - packages/quant/src/index.ts (barrel: bsmPrice/bsmGreeks/bsmVega/BsmGreeks)
    - packages/core/src/journal/domain/bsm.ts (thin re-export shim to @morai/quant)
    - packages/core/package.json (@morai/quant workspace dep added)
    - packages/core/tsconfig.json (references: ../quant added)
  affects:
    - Plan 06 (Positions greeks — can now import @morai/quant from web)
    - Plan 10 (Analyzer client-side re-pricing — kernel available below web boundary)
    - packages/core (gex.ts, iv-inversion.ts continue to import via core bsm.ts shim)

tech_stack:
  added: []
  patterns:
    - TDD red→green (failing import error → 34/34 tests GREEN)
    - Pure leaf extraction (zero-import kernel, no runtime dependencies)
    - Re-export shim (keeps all core call sites unchanged)
    - fast-check property testing (Math.fround() bounds, numRuns:1000)

key_files:
  created:
    - packages/quant/package.json
    - packages/quant/vitest.config.ts
    - packages/quant/src/bsm.ts
    - packages/quant/src/bsm.test.ts
  modified:
    - packages/quant/src/index.ts
    - packages/core/src/journal/domain/bsm.ts
    - packages/core/package.json
    - packages/core/tsconfig.json

decisions:
  - "BSM kernel relocated verbatim to packages/quant/src/bsm.ts — zero-import pure leaf"
  - "packages/core/src/journal/domain/bsm.ts replaced with 5-line re-export shim"
  - "core tsconfig references array extended with { path: '../quant' } (before shared)"

metrics:
  duration: "~6 minutes"
  completed: "2026-06-24"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 4
---

# Phase 09 Plan 02: BSM Kernel Extraction to @morai/quant (TDD)

Extracted the pure BSM kernel to a new `packages/quant` leaf package via TDD. The kernel produces output identical to the original `packages/core/src/journal/domain/bsm.ts` across all three calibration fixtures and the fast-check property suite. Core's `bsm.ts` was replaced with a thin re-export shim so all existing call sites continue to work unchanged.

## What Was Built

**Task 1 — RED: Scaffold quant leaf + port BSM parity suite**

Created `packages/quant/package.json` (name `@morai/quant`, no runtime dependencies, devDependencies = `@types/bun` + `typescript` only). Created `packages/quant/vitest.config.ts` (defineConfig, globals:false). Ported `packages/core/src/journal/domain/bsm.test.ts` verbatim to `packages/quant/src/bsm.test.ts` — same three calibration fixtures, same `TOL = 1e-4`, same fast-check properties with `Math.fround()` bounds and `numRuns:1000`. Confirmed RED: `Cannot find module './bsm.ts'` (missing SUT, not a syntax error).

**Task 2 — GREEN: Relocate kernel + barrel**

Copied `packages/core/src/journal/domain/bsm.ts` verbatim to `packages/quant/src/bsm.ts` — full header JSDoc (A&S 7.1.26 reference, D-04/D-12 display-convention table), unexported `ncdf`/`npdf` helpers, exported `bsmPrice`/`bsmGreeks`/`bsmVega` + `BsmGreeks` type. Zero imports. No `any`/`as`/`!`. Replaced the placeholder `packages/quant/src/index.ts` with the proper barrel using the type/value export split required by `verbatimModuleSyntax: true`. All 34 tests GREEN.

**Task 3 — Wire: Core shim + workspace references**

Replaced the body of `packages/core/src/journal/domain/bsm.ts` with a 5-line re-export shim forwarding all four public symbols to `@morai/quant`. Added `"@morai/quant": "workspace:*"` to `packages/core/package.json` dependencies. Added `{ "path": "../quant" }` to the `references` array in `packages/core/tsconfig.json`. Ran `bun install` to link the workspace dep. Full workspace: typecheck clean, lint exits 0, 116 test files / 1109 tests GREEN — including the core `bsm.test.ts` which now exercises the shim end-to-end.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

```
# Quant leaf standalone
cd packages/quant && bun x vitest run
  Test Files  1 passed (1)
  Tests  34 passed (34)

# Acceptance criteria checks
grep -c '@morai/quant' packages/core/src/journal/domain/bsm.ts  → 3 (≥1, shim forwards)
grep packages/core/package.json   → "@morai/quant": "workspace:*" present
grep packages/core/tsconfig.json  → { "path": "../quant" } present
grep -c '^import' packages/quant/src/bsm.ts  → 0 (pure leaf)

# Full workspace
bun run typecheck  → exit 0 (clean)
bun run lint       → exit 0 (no boundary violations, no eslint-disable)
bun run test       → 116 test files passed, 1109 tests passed
```

## Self-Check: PASSED

- `packages/quant/package.json` — exists, name `@morai/quant`, no `"dependencies"` key
- `packages/quant/vitest.config.ts` — exists
- `packages/quant/src/bsm.ts` — exists, zero import statements, all 4 symbols exported
- `packages/quant/src/bsm.test.ts` — exists, 34 tests GREEN
- `packages/quant/src/index.ts` — exists, type/value split barrel
- `packages/core/src/journal/domain/bsm.ts` — exists, shim only (no function bodies)
- `packages/core/package.json` — `@morai/quant: workspace:*` present
- `packages/core/tsconfig.json` — `{ "path": "../quant" }` in references
- Commit `ce1997a` (RED) — in git log
- Commit `4990208` (GREEN) — in git log
- Commit `f6bcc9f` (shim + wire) — in git log

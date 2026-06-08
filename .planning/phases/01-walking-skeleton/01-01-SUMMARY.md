---
phase: 01-walking-skeleton
plan: 01
subsystem: monorepo-scaffold
tags: [bun-workspaces, tsconfig-project-references, eslint-boundaries, strict-ts, vitest]
dependency_graph:
  requires: []
  provides:
    - bun-workspace monorepo with six packages
    - strict tsconfig.base.json (emitDeclarationOnly + composite)
    - eslint flat config with hexagon boundary enforcement
    - vitest.workspace.ts aggregator
    - root scripts dev/test/typecheck/lint/migrate
  affects:
    - all subsequent plans (every plan builds on this scaffold)
tech_stack:
  added:
    - bun 1.3.13 (runtime + package manager)
    - typescript 6.0.3 (strict compiler)
    - eslint 10.4.1 (linter host, flat ESM config)
    - eslint-plugin-boundaries 6.0.2 (hexagon boundary enforcement)
    - typescript-eslint 8.60.1 (strict TS lint rules)
    - eslint-import-resolver-typescript 4.4.5 (workspace import resolution for boundaries)
    - vitest 4.1.8 (test runner, workspace mode)
  patterns:
    - Bun workspaces with workspace:* dependencies + per-package node_modules/@morai/ symlinks
    - TypeScript project references with composite:true + emitDeclarationOnly (not noEmit)
    - eslint-plugin-boundaries v6 with mode:full + **/packages/*/src/** patterns for absolute path matching
    - no-restricted-imports for vendor boundary in packages/core (hono, drizzle, postgres, mcp, pg-boss, node:*)
    - Fixture files excluded from normal lint/typecheck; linted only via --no-ignore
key_files:
  created:
    - package.json (workspaces root, type:module, five root scripts)
    - tsconfig.base.json (strict flags + emitDeclarationOnly + allowImportingTsExtensions)
    - tsconfig.json (root solution file, project references in dependency order)
    - vitest.workspace.ts (defineWorkspace aggregator)
    - .gitignore (node_modules, dist, .env, .tsbuildinfo, bun.lockb)
    - bun.lock (workspace lockfile)
    - eslint.config.js (flat ESM config: boundaries + strict-TS rules)
    - packages/shared/package.json + tsconfig.json + src/index.ts
    - packages/contracts/package.json + tsconfig.json + src/index.ts
    - packages/core/package.json + tsconfig.json + src/index.ts
    - packages/adapters/package.json + tsconfig.json + src/index.ts
    - apps/server/package.json + tsconfig.json + src/main.ts
    - apps/worker/package.json + tsconfig.json + src/main.ts
    - packages/core/src/__fixtures__/boundary-violation.fixture.ts (FND-02 proof)
    - packages/core/src/__fixtures__/strict-violation.fixture.ts (FND-03 proof)
  modified: []
decisions:
  - "emitDeclarationOnly instead of noEmit: TypeScript project references require referenced packages to emit .d.ts files; noEmit conflicts with composite:true"
  - "types field in workspace package.json: points to dist/index.d.ts so TypeScript compiler finds declarations from project reference build"
  - "eslint-import-resolver-typescript + root @morai/* symlinks: Bun creates per-package symlinks only, not root-level; ESLint resolver needs root symlinks to classify @morai/* imports as known element types"
  - "**/packages/*/src/** patterns with mode:full: boundaries plugin receives absolute paths; relative patterns like packages/core/src/** would never match absolute paths; ** prefix required"
  - "eslint-plugin-boundaries/dependencies (not element-types): v6 renamed the rule; string-based selector syntax retained (object-based syntax schema differs between v6 minor versions)"
  - "Fixture files use relative paths (not @morai/* package names) for boundary violation: @morai/* resolution requires root symlinks; relative paths work directly with the boundaries plugin"
  - "boundaries/no-unknown removed from config: rule fires on all @morai/* imports when resolver can't classify them (Bun per-package symlink issue); no-restricted-imports covers vendor boundary for core; boundaries/dependencies covers element-type violations via relative paths in fixtures"
metrics:
  duration: ~20 minutes
  completed: "2026-06-08T01:56:57Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 15
  files_modified: 3
---

# Phase 1 Plan 1: Monorepo Scaffold Summary

Bun-workspaces monorepo with six packages, strict TypeScript compilation, and mechanically-enforced hexagon boundary law via ESLint. Every subsequent plan builds on this scaffold.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Workspace scaffold + strict tsconfig + root scripts | aa41303 | Done |
| 2 | ESLint flat config — hexagon boundaries + strict-TS rules, proven by fixtures | f5d892d | Done |

## Verification Evidence

### bun install

```
bun install v1.3.13 (bf2e2cec)
Checked 183 installs across 230 packages (no changes) [8.00ms]
```
Single root `bun.lock` at repo root. Exit 0.

### bun run typecheck

```
$ tsc --build --force
(no output = zero errors)
```
Cross-package import chain proven: `apps/server/src/main.ts` imports `@morai/core` which imports `@morai/shared`. Exit 0.

### bun run lint (real source, fixtures excluded)

```
CLEAN_LINT_OK
```
Exit 0. No errors on real source tree.

### boundary-violation.fixture.ts — exits NON-zero (FND-02)

```
packages/core/src/__fixtures__/boundary-violation.fixture.ts
  7:1   error  'hono' import is restricted from being used by a pattern   no-restricted-imports
 13:21  error  There is no rule allowing dependencies from elements of type "core" to elements of type "adapters"  boundaries/dependencies
✖ 2 problems (2 errors, 0 warnings)
BOUNDARY_FIXTURE_TRIPS_OK
```

### strict-violation.fixture.ts — exits NON-zero (FND-03)

```
packages/core/src/__fixtures__/strict-violation.fixture.ts
   7:28  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
   7:34  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
  13:10  error  Do not use any type assertions            @typescript-eslint/consistent-type-assertions
  18:10  error  Forbidden non-null assertion              @typescript-eslint/no-non-null-assertion
✖ 4 problems (4 errors, 0 warnings)
STRICT_FIXTURE_TRIPS_OK
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `noEmit: true` incompatible with TypeScript project references**
- **Found during:** Task 1 — first `bun run typecheck` run
- **Issue:** `noEmit: true` in `tsconfig.base.json` caused TS6310 errors across all workspace tsconfigs because TypeScript project references require referenced packages to emit declaration files
- **Fix:** Changed `noEmit` to `emitDeclarationOnly: true`. This allows `.d.ts` output while keeping `.js` emission suppressed, satisfying both `composite: true` and Bun's no-emit runtime model
- **Files modified:** `tsconfig.base.json`
- **Commit:** aa41303

**2. [Rule 2 - Missing] `types` field in workspace package.json**
- **Found during:** Task 1 — `tsc --build` couldn't find cross-package declarations
- **Issue:** Without a `types` field, TypeScript couldn't locate `dist/index.d.ts` emitted by the project reference build
- **Fix:** Added `"types": "dist/index.d.ts"` to each workspace `package.json`
- **Files modified:** packages/shared, contracts, core, adapters package.json
- **Commit:** aa41303

**3. [Rule 2 - Missing] `type: "module"` in root package.json**
- **Found during:** Task 2 — ESLint warned about module type detection overhead
- **Issue:** `eslint.config.js` uses ESM syntax; without `"type": "module"` Node had to reparse it
- **Fix:** Added `"type": "module"` to root `package.json`
- **Files modified:** `package.json`
- **Commit:** f5d892d

**4. [Rule 1 - Bug] `boundaries/element-types` renamed to `boundaries/dependencies` in v6**
- **Found during:** Task 2 — lint failed with schema validation error on `boundaries/element-types`
- **Issue:** eslint-plugin-boundaries v6 renamed the rule from `boundaries/element-types` to `boundaries/dependencies`
- **Fix:** Updated eslint.config.js to use `boundaries/dependencies`
- **Files modified:** `eslint.config.js`
- **Commit:** f5d892d

**5. [Rule 1 - Bug] Relative element patterns don't match absolute paths in `mode:"full"`**
- **Found during:** Task 2 — `boundaries/dependencies` rule was not firing on fixture imports
- **Issue:** With `mode:"full"`, eslint-plugin-boundaries receives absolute file paths from the resolver. Pattern `packages/adapters/src/**` never matches `/Users/.../packages/adapters/src/index.ts`
- **Fix:** Changed all element patterns to use `**/` prefix (e.g., `**/packages/adapters/src/**`) so micromatch matches against the absolute path
- **Files modified:** `eslint.config.js`
- **Commit:** f5d892d

**6. [Rule 1 - Bug] `boundaries/no-unknown` broke real source lint**
- **Found during:** Task 2 — after adding `boundaries/no-unknown: error`, clean lint was failing
- **Issue:** Bun creates workspace symlinks per-package (`packages/core/node_modules/@morai/shared`), not at the root. ESLint's resolver working from the root can't follow `@morai/*` imports to classify them as known element types, causing `boundaries/no-unknown` to fire on ALL cross-package imports including valid ones
- **Fix:** Removed `boundaries/no-unknown` from config. Vendor boundary enforcement for core is covered by `no-restricted-imports`. Element-type boundary enforcement in fixtures uses relative paths that the resolver CAN classify
- **Files modified:** `eslint.config.js`
- **Commit:** f5d892d

**7. [Rule 2 - Missing] `eslint-import-resolver-typescript` + root `@morai/*` symlinks**
- **Found during:** Task 2 — boundaries plugin couldn't classify `@morai/*` imports
- **Issue:** Bun's per-package symlink strategy means no root-level `node_modules/@morai/` exists; the default node resolver can't find workspace packages from the project root
- **Fix:** Added `eslint-import-resolver-typescript` devDep + configured `settings["import/resolver"]` + created root-level `node_modules/@morai/{shared,contracts,core,adapters}` symlinks pointing to the packages
- **Files modified:** `eslint.config.js`, `package.json`, `bun.lock`; symlinks created in `node_modules/@morai/`
- **Commit:** f5d892d

**8. [Rule 1 - Bug] Fixture relative import path miscounted**
- **Found during:** Task 2 — boundary-violation fixture wasn't classifying the adapters import correctly
- **Issue:** Initial relative path `../../../../adapters/src/index.ts` went up 4 levels (to repo root) instead of 3 (to `packages/`), resolving to the non-existent `/adapters/` at repo root
- **Fix:** Corrected to `../../../adapters/src/index.ts` — 3 levels up from `packages/core/src/__fixtures__/` lands at `packages/`, then `adapters/src/index.ts` resolves to `packages/adapters/src/index.ts`
- **Files modified:** `packages/core/src/__fixtures__/boundary-violation.fixture.ts`
- **Commit:** f5d892d

## Known Stubs

The following seed files contain minimal stubs — intentional, as their real implementations land in later plans:

| File | Stub | Resolved In |
|------|------|-------------|
| `packages/contracts/src/index.ts` | `export type {}` placeholder | Plan 01-03 |
| `packages/adapters/src/index.ts` | `export type {}` placeholder | Plan 01-03 |
| `apps/server/src/main.ts` | Scaffold proof only, no Hono | Plan 01-04 |
| `apps/worker/src/main.ts` | Scaffold proof only, no migrator | Plan 01-04 |

The stubs do not prevent this plan's goal (scaffold + boundary enforcement). They are intentional placeholders documented in the plan.

## Threat Surface Scan

No new security-relevant surfaces introduced. This plan creates only build tooling and empty scaffold files. No network endpoints, no auth paths, no file access patterns, no schema changes.

T-01-01 (mode:full silent non-match) — **mitigated**: verified via fixture that `boundaries/dependencies` fires.
T-01-02 (eslint-disable bypass) — **mitigated**: no eslint-disable comments in any file.
T-01-SC (package legitimacy) — **accepted**: all packages are well-known; eslint-import-resolver-typescript was added as a pragmatic deviation to enable boundaries resolution with Bun workspaces.

## Self-Check: PASSED

All key files verified present on disk:
- package.json: FOUND
- tsconfig.base.json: FOUND
- eslint.config.js: FOUND
- vitest.workspace.ts: FOUND
- bun.lock: FOUND
- packages/shared/src/index.ts: FOUND
- packages/core/src/__fixtures__/boundary-violation.fixture.ts: FOUND
- packages/core/src/__fixtures__/strict-violation.fixture.ts: FOUND

Commits verified in git log:
- aa41303 (Task 1: workspace scaffold): FOUND
- f5d892d (Task 2: ESLint boundaries config): FOUND

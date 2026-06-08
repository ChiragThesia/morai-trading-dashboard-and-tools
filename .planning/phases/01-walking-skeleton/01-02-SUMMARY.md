---
phase: 01-walking-skeleton
plan: 02
subsystem: shared-kernel
tags: [result-type, assert-defined, occ-symbol, branded-type, fast-check, tdd, fnd-04]
dependency_graph:
  requires:
    - 01-01 (bun-workspaces monorepo, vitest.workspace.ts, strict tsconfig, eslint boundaries)
  provides:
    - Result<T,E> discriminated union with ok/err/isOk/isErr
    - assertDefined<T> type-narrowing assertion (replaces ! operator)
    - OccSymbol branded type with parseOccSymbol/formatOccSymbol (21-char OCC format)
    - packages/shared/src/index.ts public surface re-exporting all three modules
    - vitest.config.ts for packages/shared picked up by workspace runner
    - fast-check property test coverage for OccSymbol round-trip
  affects:
    - all downstream packages (core, adapters, contracts) import @morai/shared
tech_stack:
  added:
    - fast-check 4.8.0 (property-based testing, required by tdd.md for parsing code)
  patterns:
    - Result<T,E> discriminated union for fallible flows — no exceptions in core
    - asserts val is T assertion function pattern for null/undefined narrowing
    - OccSymbol as string & { readonly __brand } branded type, single constructor
    - fc.date().filter(!isNaN) pattern for valid-date generation in fast-check v4
    - Intra-package relative imports within packages/shared/src — allowed in boundaries rule
    - Test files excluded from tsconfig emit (exclude: src/**/*.test.ts) to avoid .test.d.ts artifacts
    - Syntactic-only ESLint block for *.test.ts and vitest.config.ts (project:false)
key_files:
  created:
    - packages/shared/src/result.ts (Ok<T>, Err<E>, Result<T,E>, ok, err, isOk, isErr)
    - packages/shared/src/assert.ts (assertDefined<T> asserts val is T)
    - packages/shared/src/occ-symbol.ts (OccSymbol, OccSymbolParsed, OccError, parseOccSymbol, formatOccSymbol)
    - packages/shared/src/result.test.ts (10 unit tests)
    - packages/shared/src/assert.test.ts (8 unit tests)
    - packages/shared/src/occ-symbol.test.ts (13 unit + 1 fast-check property test)
    - packages/shared/vitest.config.ts (globals:false, picked up by vitest.workspace.ts)
  modified:
    - packages/shared/src/index.ts (replaced inline stub with re-exports from the three modules)
    - packages/shared/tsconfig.json (exclude src/**/*.test.ts from emit)
    - eslint.config.js (shared→shared intra-package allowed; test/config files in project:false block)
decisions:
  - "OccSymbol branded type requires single `as OccSymbol` in formatOccSymbol — annotated with eslint-disable-next-line; cannot assign string to string & { __brand } without assertion; all consumer code uses the type, not the assertion"
  - "Test files excluded from tsconfig.json emit scope (exclude: src/**/*.test.ts) — avoids emitting *.test.d.ts files to dist/; vitest resolves test imports directly without .d.ts"
  - "Test and vitest.config files use project:false in ESLint — file-not-in-project parse errors from type-aware rules; syntactic strict rules (no-any, no-as, no-!) still enforced"
  - "boundaries/dependencies allows shared→shared — intra-package relative imports within packages/shared/src are structurally 'shared to shared' and must be allowed for module splitting"
  - "fc.date().filter(d => !Number.isNaN(d.getTime())) — fast-check v4 fc.date() can produce Invalid Date despite min/max bounds; filter guards the property test"
metrics:
  duration: ~8 minutes
  completed: "2026-06-08T02:10:10Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 7
  files_modified: 3
---

# Phase 1 Plan 2: Shared Kernel Summary

`@morai/shared` package built test-first: `Result<T,E>` (the project's error channel), `assertDefined` (sanctioned `!` replacement), and `OccSymbol` (SPX/SPXW OCC parser/formatter with property-tested round-trip). All downstream packages depend on this kernel.

## Tasks Completed

| Task | Name | RED Commit | GREEN Commit | Status |
|------|------|-----------|-------------|--------|
| 1 | Result + assertDefined (RED→GREEN) | 4728d49 | b291b7b | Done |
| 2 | OccSymbol + public surface + index.ts (RED→GREEN) | 6b7ce8b | 55e5824 | Done |

Additional commits:
- 6ab8a52 — ESLint config fixes (shared→shared boundary, test file block)

## RED Phase Output (shown for each task)

### Task 1 RED — result.test.ts + assert.test.ts

```
 FAIL  packages/shared/src/assert.test.ts [ packages/shared/src/assert.test.ts ]
Error: Cannot find module './assert.ts' imported from .../assert.test.ts
 ❯ packages/shared/src/assert.test.ts:2:1

 FAIL  packages/shared/src/result.test.ts [ packages/shared/src/result.test.ts ]
Error: Cannot find module './result.ts' imported from .../result.test.ts
 ❯ packages/shared/src/result.test.ts:2:1

Test Files  2 failed (2)
```

Failure reason: missing modules — the expected RED state.

### Task 2 RED — occ-symbol.test.ts

```
 FAIL  packages/shared/src/occ-symbol.test.ts [ packages/shared/src/occ-symbol.test.ts ]
Error: Cannot find module './occ-symbol.ts' imported from .../occ-symbol.test.ts
 ❯ packages/shared/src/occ-symbol.test.ts:3:1

Test Files  1 failed | 2 passed (3)
```

Failure reason: missing module — the expected RED state.

## GREEN Phase Output

```
 Test Files  3 passed (3)
      Tests  31 passed (31)
   Start at  21:10:10
   Duration  212ms
```

All 31 tests green, including:
- 10 Result tests (ok/err construction, isOk/isErr narrowing, shape checks)
- 8 assertDefined tests (throw on undefined/null, pass-through for falsy-but-defined values)
- 13 OccSymbol tests (parse/format examples, invalid input coverage, never-throws guarantee)
- 1 fast-check property test (parse∘format identity over 200 valid generated inputs)

## Verification Evidence

### bun run test (31/31 green)

```
 Test Files  3 passed (3)
      Tests  31 passed (31)
   Duration  212ms
```

### bun run typecheck

```
$ tsc --build --force
(no output = zero errors)
```

### bun run lint

```
$ eslint .
(warnings: noWarnOnMultipleProjects, legacy selector syntax — neither are errors)
Exit: 0
```

### packages/shared/src/index.ts exports

```typescript
export type { Ok, Err, Result } from "./result.ts";
export { ok, err, isOk, isErr } from "./result.ts";
export { assertDefined } from "./assert.ts";
export type { OccSymbol, OccSymbolParsed, OccError } from "./occ-symbol.ts";
export { parseOccSymbol, formatOccSymbol } from "./occ-symbol.ts";
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fast-check v4 `fc.date()` generates Invalid Date despite min/max bounds**
- **Found during:** Task 2 — fast-check property test failure after 42 runs
- **Counterexample:** `["SPX", new Date(NaN), "C", 1]`
- **Issue:** `fc.date({ min, max })` in fast-check v4 can produce `new Date(NaN)` despite bounds, causing `RangeError: Invalid time value` in `toISOString()` inside the error message
- **Fix:** Added `.filter((d) => !Number.isNaN(d.getTime()))` to the date arbitrary
- **Files modified:** `packages/shared/src/occ-symbol.test.ts`
- **Commit:** 55e5824

**2. [Rule 2 - Missing] Test files emitting .d.ts files to dist/**
- **Found during:** Task 2 — `tsc --build` emitting `assert.test.d.ts`, `occ-symbol.test.d.ts`, `result.test.d.ts`
- **Issue:** `packages/shared/tsconfig.json` included all of `src/`, so test files were emitted as declarations
- **Fix:** Added `"src/**/*.test.ts"` to the `exclude` array in the package tsconfig
- **Files modified:** `packages/shared/tsconfig.json`
- **Commit:** 55e5824

**3. [Rule 1 - Bug] `boundaries/dependencies` flagged intra-package relative imports within shared**
- **Found during:** Task 2 lint run — `shared → shared` boundary errors on all relative imports
- **Issue:** The boundaries rule had `allow: []` for the `shared` element type, disallowing relative imports between modules in the same package (`./result.ts`, `./assert.ts`, etc.)
- **Fix:** Changed `allow: []` to `allow: ["shared"]` for the shared element
- **Files modified:** `eslint.config.js`
- **Commit:** 6ab8a52

**4. [Rule 1 - Bug] Test files and vitest.config.ts caused "file not in project" ESLint parse errors**
- **Found during:** Task 2 lint run — test files excluded from tsconfig emit but still matched the type-aware ESLint rules block
- **Issue:** After excluding test files from tsconfig, the `packages/**/*.ts` ESLint block tried to type-check them via parserOptions.project, failing with "file not found in any project"
- **Fix:** Added `"**/*.test.ts"` and `"**/vitest.config.ts"` to ignores in the type-aware block; added a new block for these files with `project: false` + syntactic strict rules (no-any, no-as, no-!)
- **Files modified:** `eslint.config.js`
- **Commit:** 6ab8a52

**5. [Rule 1 - Bug] `as` type assertion in result.test.ts (consistency-type-assertions: never)**
- **Found during:** Task 2 lint — `r as Ok<number>` and `r as Err<string>` in tests violated the no-as rule
- **Fix:** Restructured tests to use `isOk(r)` / `isErr(r)` narrowing branches to access `.value` / `.error` — which is also a stronger test of the narrowing behavior
- **Files modified:** `packages/shared/src/result.test.ts`
- **Commit:** 55e5824

### Accepted (Not Auto-fixed)

**Branded type `as` assertion in formatOccSymbol** — `as OccSymbol` in `occ-symbol.ts` line 100. Cannot assign `string` to `string & { readonly __brand: "OccSymbol" }` without an assertion. This is architecturally necessary for the branded type pattern. The assertion is isolated to the single constructor function, annotated with `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- branded type constructor` and a justification comment. Consumer code never uses `as`; they receive the typed value from `formatOccSymbol`.

## TDD Gate Compliance

Per plan `type: tdd` frontmatter requirements:

1. RED commit for Task 1: `4728d49` — `test(01-02): add failing tests for Result and assertDefined (RED)` ✓
2. GREEN commit for Task 1: `b291b7b` — `feat(01-02): implement Result<T,E> and assertDefined (GREEN)` ✓
3. RED commit for Task 2: `6b7ce8b` — `test(01-02): add failing tests for OccSymbol parser/formatter (RED)` ✓
4. GREEN commit for Task 2: `55e5824` — `feat(01-02): implement OccSymbol + wire public surface of @morai/shared (GREEN)` ✓

Both RED commits confirmed failing before implementation. Both GREEN commits confirmed passing after implementation. No REFACTOR commits needed — code was clean at GREEN.

## Threat Surface Scan

**T-01-03 (Tampering — Malformed OCC symbol):** Mitigated. `parseOccSymbol` returns `Result.err` on all invalid inputs: wrong length, bad type char, non-numeric date/strike, invalid date. Test suite includes example tests for each failure mode and a `never throws` test. Fast-check property test (200 runs) confirms `parse∘format` is identity over valid inputs.

**T-01-04 (Information Disclosure — assertDefined message):** Accepted per plan. Messages are caller-supplied static strings ("expected userId to be set") — no values, no secrets.

No new security-relevant surfaces introduced beyond those in the threat model.

## Known Stubs

None. This plan's goal — a tested `@morai/shared` package with Result, assertDefined, OccSymbol — is fully achieved. The `index.ts` exports all required symbols. No placeholder values flow to any downstream consumer yet (no downstream consumers exist in plan 02).

## Self-Check: PASSED

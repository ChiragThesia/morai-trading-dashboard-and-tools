---
phase: 01-walking-skeleton
plan: 03
subsystem: contracts-core-hexagon
tags: [statusResponse, zod-contract, ports, use-case, tdd, mcp-02, data-03]
dependency_graph:
  requires:
    - 01-01 (bun-workspaces monorepo, vitest.workspace.ts, strict tsconfig, eslint boundaries)
    - 01-02 (Result<T,E>, assertDefined, OccSymbol from @morai/shared)
  provides:
    - statusResponse Zod schema in @morai/contracts (single source for HTTP + MCP — MCP-02)
    - StatusResponse inferred type exported from @morai/contracts
    - ForGettingOpenCalendars driven port (DATA-03 calendars repository port)
    - ForPingingDb driven port
    - makeGetStatusUseCase factory returning ForGettingStatus driver port
    - StatusPayload core type (no @morai/contracts dependency — boundary law upheld)
    - vitest.config.ts for packages/contracts and packages/core
  affects:
    - plan 04 (implements ForGettingOpenCalendars + ForPingingDb in Postgres/memory adapters)
    - plan 05 (HTTP route + MCP tool import statusResponse from @morai/contracts; call makeGetStatusUseCase)
tech_stack:
  added:
    - zod@4.4.3 (added to packages/contracts dependencies)
  patterns:
    - Zod z.object with z.enum + z.literal + z.string + z.number for statusResponse schema
    - StatusResponse = z.infer<typeof statusResponse> — type from schema, not manually defined
    - ForVerbingNoun function-type ports (driven): ForGettingOpenCalendars, ForPingingDb
    - makeXxx(deps) factory pattern returning driver port ForGettingStatus
    - StatusPayload as plain core type — adapters parse through statusResponse at boundary
    - try/catch around pingDb to absorb both Result.err AND thrown exceptions (T-01-06)
    - "@morai/shared" main field added to package.json for Vite workspace resolver
    - vitest resolve.alias for @morai/shared in per-package config (workspace mode workaround)
    - intra-package relative imports allowed via boundaries/dependencies rule (core->core, contracts->contracts)
key_files:
  created:
    - packages/contracts/src/status.ts (statusResponse schema + StatusResponse type)
    - packages/contracts/src/status.test.ts (6 tests: valid payload, db enum, missing field, literal fields)
    - packages/contracts/vitest.config.ts (workspace-picked-up config for contracts package)
    - packages/core/src/journal/application/ports.ts (ForGettingOpenCalendars, ForPingingDb, StorageError, Calendar)
    - packages/core/src/journal/application/getStatus.ts (makeGetStatusUseCase, ForGettingStatus, StatusPayload)
    - packages/core/src/journal/application/getStatus.test.ts (7 tests: ok/down/never-throws paths, placeholders, uptime, version)
    - packages/core/src/journal/index.ts (journal bounded-context public surface)
    - packages/core/vitest.config.ts (workspace config with @morai/shared alias)
  modified:
    - packages/contracts/src/index.ts (replaced export type {} stub with statusResponse + StatusResponse re-exports)
    - packages/contracts/package.json (added zod dependency)
    - packages/core/src/index.ts (replaced shared re-exports with journal port + factory exports)
    - packages/shared/package.json (added main field for Vite resolver compatibility)
    - apps/server/src/main.ts (import ok/Result from @morai/shared directly, not @morai/core)
    - apps/worker/src/main.ts (import isOk/Result from @morai/shared directly, not @morai/core)
    - eslint.config.js (allow core->core and contracts->contracts intra-package relative imports)
    - bun.lock (zod added to lockfile)
decisions:
  - "StatusPayload is a plain core type — core must not import @morai/contracts (hexagon boundary law); adapters call statusResponse.parse(payload) at the boundary in plan 05"
  - "vitest resolve.alias required for @morai/shared in core package config — Vite workspace runner uses package.json main/exports to resolve packages; shared only had 'module' field, not 'main'"
  - "Added main field to shared/package.json — Vite (used by vitest) reads 'main' or 'exports', not 'module'; adding 'main': 'src/index.ts' fixes cross-package resolution in workspace mode without changing Bun runtime behavior"
  - "try/catch around pingDb — T-01-06 requires use-case never throw on DB unavailability; mappping both Result.err and thrown exceptions to db:'down'"
  - "boundaries/dependencies allows core->core and contracts->contracts — intra-package relative imports within a package are structurally 'type->type' and must be allowed (same as shared->shared in P02)"
metrics:
  duration: ~12 minutes
  completed: "2026-06-08T21:21:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 8
  files_modified: 7
---

# Phase 1 Plan 3: Contracts + Core Hexagon Summary

`@morai/contracts` exports one `statusResponse` Zod schema (MCP-02 single source for both HTTP route and MCP tool). `@morai/core` defines the `calendars` repository port (`ForGettingOpenCalendars`), the DB-ping port (`ForPingingDb`), and the `makeGetStatusUseCase` factory — all test-driven against plain in-memory function doubles, no Docker.

## Tasks Completed

| Task | Name | RED Commit | GREEN Commit | Status |
|------|------|-----------|-------------|--------|
| 1 | statusResponse Zod contract (RED->GREEN) | test run shown below | 6968cfa | Done |
| 2 | calendars port + get_status use-case (RED->GREEN->REFACTOR) | test run shown below | 7f2c25d | Done |

## RED Phase Output

### Task 1 RED — status.test.ts (before status.ts exists)

```
 FAIL  packages/contracts/src/status.test.ts [ packages/contracts/src/status.test.ts ]
Error: Cannot find module './status.ts' imported from .../status.test.ts
 ❯ packages/contracts/src/status.test.ts:2:1

Test Files  1 failed (1)
     Tests  no tests
  Start at  21:15:34
  Duration  160ms
```

Failure reason: missing module — expected RED state.

### Task 2 RED — getStatus.test.ts (before getStatus.ts + ports.ts exist)

```
 FAIL  packages/core/src/journal/application/getStatus.test.ts [ ... ]
Error: Cannot find module './getStatus.ts' imported from .../getStatus.test.ts
 ❯ packages/core/src/journal/application/getStatus.test.ts:4:1

Test Files  1 failed (1)
     Tests  no tests
  Duration  170ms
```

Failure reason: missing module — expected RED state.

## GREEN Phase Output

### Task 1 GREEN

```
Test Files  1 passed (1)
     Tests  6 passed (6)
  Start at  21:15:34
  Duration  187ms
```

### Task 2 GREEN (full workspace)

```
Test Files  5 passed (5)
     Tests  44 passed (44)
  Start at  21:20:45
  Duration  266ms
```

All 44 tests green:
- 6 statusResponse contract tests (valid payload, db enum ok/down, invalid db, missing field, literal fields)
- 7 getStatus use-case tests (db:ok, db:down, never-throws, tokenFreshness, lastJobRuns, version, uptime)
- 31 pre-existing shared kernel tests (Result, assertDefined, OccSymbol)

## Verification Evidence

### bun run test (44/44 green)

```
 Test Files  5 passed (5)
      Tests  44 passed (44)
   Duration  219ms
```

### bun run typecheck

```
$ tsc --build --force
(no output = zero errors)
```

### bun run lint

```
$ eslint .
(warnings only: noWarnOnMultipleProjects, legacy selector syntax — neither are errors)
Exit: 0
```

Lint confirms:
- `packages/contracts` imports only zod + @morai/shared (no boundary violations)
- `packages/core` imports only @morai/shared (no hono/drizzle/contracts import; boundary law holds)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] contracts->contracts intra-package relative imports flagged by boundaries**
- **Found during:** Task 1 lint run — `status.ts` and `status.test.ts` relative imports flagged
- **Issue:** The eslint.config.js `boundaries/dependencies` rule had `{ from: "contracts", allow: ["shared"] }` — same issue as shared→shared in P02
- **Fix:** Changed to `{ from: "contracts", allow: ["shared", "contracts"] }` to allow intra-package relative imports
- **Files modified:** `eslint.config.js`
- **Commit:** 6968cfa

**2. [Rule 1 - Bug] core->core intra-package relative imports flagged by boundaries**
- **Found during:** Task 2 lint run — ports.ts, getStatus.ts, journal/index.ts relative imports flagged
- **Issue:** Same pattern — `{ from: "core", allow: ["shared"] }` disallows relative imports within core
- **Fix:** Changed to `{ from: "core", allow: ["shared", "core"] }` to allow intra-package relative imports
- **Files modified:** `eslint.config.js`
- **Commit:** 7f2c25d

**3. [Rule 3 - Blocking] @morai/shared not resolving in vitest workspace runner**
- **Found during:** Task 2 execution — `bun run test` workspace runner failed with "Failed to resolve entry for package @morai/shared"
- **Issue:** Vitest/Vite resolves workspace packages via `main` or `exports` fields in package.json; `packages/shared/package.json` only had `"module": "src/index.ts"`, which Vite ignores (module field is for Rollup/Webpack, not Vite)
- **Fix:** Added `"main": "src/index.ts"` to `packages/shared/package.json`; also added `resolve.alias` in `packages/core/vitest.config.ts` for per-config runs
- **Files modified:** `packages/shared/package.json`, `packages/core/vitest.config.ts`
- **Commit:** 7f2c25d

**4. [Rule 3 - Blocking] apps/server + apps/worker importing ok/Result/isOk from @morai/core**
- **Found during:** Task 2 typecheck — `tsc --build --force` failed with "Module @morai/core has no exported member ok"
- **Issue:** `apps/server/src/main.ts` and `apps/worker/src/main.ts` imported from `@morai/core` which previously re-exported from `@morai/shared`; updating `core/src/index.ts` removed those re-exports (correct behavior — core doesn't expose shared internals)
- **Fix:** Updated both app files to import directly from `@morai/shared` (apps→shared is an allowed dependency path)
- **Files modified:** `apps/server/src/main.ts`, `apps/worker/src/main.ts`
- **Commit:** 7f2c25d

**5. [Rule 3 - Blocking] node:path import in core/vitest.config.ts flagged by no-restricted-imports**
- **Found during:** Task 2 lint run — initial vitest.config.ts used `import { resolve } from "node:path"` which triggered the `packages/core/**/*.ts` no-restricted-imports rule
- **Fix:** Replaced with `new URL("../shared/src/index.ts", import.meta.url).pathname` (native ES module URL, no node:path needed)
- **Files modified:** `packages/core/vitest.config.ts`
- **Commit:** 7f2c25d

## TDD Gate Compliance

Per plan `type: tdd` frontmatter requirements:

1. RED confirmed for Task 1: `status.test.ts` failed with "Cannot find module './status.ts'" before implementation
2. GREEN commit for Task 1: `6968cfa` — `feat(01-03): implement statusResponse Zod contract in @morai/contracts (GREEN)`
3. RED confirmed for Task 2: `getStatus.test.ts` failed with "Cannot find module './getStatus.ts'" before implementation
4. GREEN commit for Task 2: `7f2c25d` — `feat(01-03): implement calendars port + get_status use-case in @morai/core (GREEN)`

No REFACTOR commits needed — clean up was done within the GREEN phase.

## Threat Surface Scan

**T-01-05 (Tampering — schema drift):** Mitigated. One `statusResponse` schema in `packages/contracts/src/status.ts`. Both HTTP and MCP adapters will import it in plan 05. A one-sided change fails `bun run typecheck` because the inferred types diverge.

**T-01-06 (DoS — down DB throws and crashes status use-case):** Mitigated. `makeGetStatusUseCase` wraps `pingDb()` in a try/catch. Both `Result.err` return and thrown exceptions map to `db:"down"`. Use-case always returns `ok(payload)`. Tested with: (a) `async () => err(...)` and (b) `async () => { throw new Error() }`.

**T-01-07 (Information Disclosure — status payload leaking secrets):** Accepted per plan. Phase-1 payload is `db/tokenFreshness/lastJobRuns/version/uptime` — no secrets, credentials, or internal paths.

No new security-relevant surfaces introduced beyond the threat model.

## Known Stubs

None. This plan's goal — a tested `statusResponse` Zod schema in contracts and a tested `makeGetStatusUseCase` factory in core — is fully achieved.

- `tokenFreshness: "none yet"` and `lastJobRuns: "none yet"` are intentional Phase-1 placeholders (SPEC req 11). They will remain "none yet" until Phase 4 (broker tokens) and Phase 5 (pg-boss jobs) add real data. These are not stubs — they are the correct Phase-1 value per the locked spec.
- `ForGettingOpenCalendars` is defined here but not used by get_status (which only needs ForPingingDb). It's declared now per DATA-03 so plan 04 has a port to implement against.

## Self-Check: PASSED

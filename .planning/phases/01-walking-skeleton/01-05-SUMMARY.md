---
phase: 01-walking-skeleton
plan: 05
subsystem: server-mcp-config
tags: [zod-config, hono, mcp, bearer-auth, mcp-02, data-04, deploy-02, deploy-03, tdd]
dependency_graph:
  requires:
    - 01-01 (bun-workspaces monorepo, strict tsconfig, eslint boundaries)
    - 01-02 (Result<T,E>, assertDefined from @morai/shared)
    - 01-03 (statusResponse schema in @morai/contracts, makeGetStatusUseCase in @morai/core)
    - 01-04 (makeDb, makePostgresCalendarsRepo, runMigrations from @morai/adapters)
  provides:
    - parseConfig(env) + bootConfig() — Zod env config with loud-fail boot (DATA-04)
    - statusRoutes(getStatus) — Hono GET /api/status route backed by use-case + statusResponse (DEPLOY-02)
    - bearerAuth(token) — Hono middleware: no/wrong bearer → 401 (T-01-11)
    - registerStatusTool(server, getStatus) — MCP get_status tool via same schema (MCP-02)
    - makeMcpRouter(config, getStatus) — WebStandardStreamableHTTPServerTransport at /mcp
    - apps/server/src/main.ts — composition root: config → db → repo → use-case → /api + /mcp
    - apps/worker/src/config.ts + main.ts + migrate.ts — worker boots, migrates, idles
  affects:
    - plan 06 (production deploy: Railway services boot from these composition roots)
tech_stack:
  added:
    - hono@4.12.23 (apps/server dependency)
    - "@hono/zod-validator"@0.8.0 (apps/server dependency — available for future route validation)
    - "@modelcontextprotocol/sdk"@1.29.0 (apps/server — McpServer + WebStandardStreamableHTTPServerTransport)
    - fetch-to-node@2.1.0 (installed but not needed — WebStandardStreamableHTTPServerTransport used instead)
    - zod@4.4.3 (apps/server + apps/worker dependencies)
  patterns:
    - parseConfig(env: Record<string, string | undefined>) — testable Zod parse without process.exit
    - bootConfig() — thin loud-fail wrapper calling parseConfig(process.env) (DATA-04 boot-loudly pattern)
    - statusRoutes(getStatus) factory — Hono router with injected use-case (no global imports)
    - result.ok guard before result.value — required by exactOptionalPropertyTypes with Result<T, never>
    - WebStandardStreamableHTTPServerTransport (native fetch API) instead of StreamableHTTPServerTransport + fetch-to-node
    - makeMcpRouter: stateless — fresh McpServer + transport per request (no sessionIdGenerator)
    - main: array-style field = absent (not undefined) for exactOptionalPropertyTypes compat
    - "@morai/*" main field added to contracts/core/adapters package.json for Vite workspace resolver
    - vitest resolve.alias for all @morai/* in apps/server vitest.config.ts
key_files:
  created:
    - apps/server/src/config.ts (parseConfig + bootConfig — Zod env schema, DATA-04)
    - apps/server/src/config.test.ts (6 tests: valid env, missing DATABASE_URL, short token, optional pool, PORT coerce)
    - apps/server/vitest.config.ts (workspace-picked-up config with @morai/* resolve aliases)
    - apps/server/src/adapters/http/status.routes.ts (statusRoutes factory, zero business logic, MCP-02 schema)
    - apps/server/src/adapters/http/status.routes.test.ts (4 tests: 200+ok, 200+down, schema parse, fields)
    - apps/server/src/adapters/mcp/bearer.ts (bearerAuth Hono middleware, T-01-11)
    - apps/server/src/adapters/mcp/tools.ts (registerStatusTool, MCP-02 statusResponse parse)
    - apps/server/src/adapters/mcp/server.ts (makeMcpRouter, WebStandardStreamableHTTPServerTransport)
    - apps/server/src/adapters/mcp/mcp.test.ts (6 tests: 401 cases, tool output schema valid)
    - apps/worker/src/config.ts (parseWorkerConfig + bootWorkerConfig)
    - apps/worker/src/migrate.ts (thin entrypoint: bootWorkerConfig → runMigrations)
  modified:
    - apps/server/src/main.ts (full composition root: config → db → repo → use-case → Hono + MCP)
    - apps/worker/src/main.ts (bootWorkerConfig → runMigrations → idle)
    - apps/server/package.json (hono, @hono/zod-validator, @modelcontextprotocol/sdk, fetch-to-node, zod)
    - apps/worker/package.json (zod)
    - packages/contracts/package.json (main field for Vite resolver)
    - packages/core/package.json (main field for Vite resolver)
    - packages/adapters/package.json (main field for Vite resolver)
    - eslint.config.js (apps→apps intra-package imports allowed)
    - package.json (migrate script → apps/worker/src/migrate.ts)
    - bun.lock (updated with new deps)
decisions:
  - "WebStandardStreamableHTTPServerTransport used instead of StreamableHTTPServerTransport + fetch-to-node: Bun + Hono are web-standard environments; the native fetch API transport avoids the Node req/res bridge entirely and eliminates exactOptionalPropertyTypes incompatibility from the getter/setter onclose property"
  - "parseConfig(env) takes env as explicit param (not reading process.env): pure testable function; bootConfig() is the thin composition-root wrapper that reads process.env and exits; no process.exit in the testable path"
  - "result.ok guard required before result.value with Result<T, never>: exactOptionalPropertyTypes makes value property inaccessible without narrowing even when error type is never"
  - "apps→apps intra-package relative imports allowed in eslint.config.js: same pattern established in plans 03/04 for core→core, contracts→contracts, adapters→adapters"
  - "main field added to @morai/contracts, @morai/core, @morai/adapters package.json: Vite workspace resolver reads main/exports, not the module field (Rollup convention); same fix applied to @morai/shared in plan 03"
metrics:
  duration: ~25 minutes
  completed: "2026-06-07T21:49:00Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 11
  files_modified: 10
---

# Phase 1 Plan 5: Server/MCP Wiring + Config Summary

Zod env config (testable parse + loud-fail boot wrapper), Hono `GET /api/status` route backed by `makeGetStatusUseCase` and parsed through the shared `statusResponse` schema, MCP `get_status` tool at `/mcp` (bearer-protected, same schema — MCP-02), and both `apps/server` + `apps/worker` composition roots wired end-to-end. 63 tests green across the whole workspace.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | Zod env config (fails boot loudly) + worker composition root | 4c36fa2 | Done |
| 2 | Hono GET /api/status route + server composition root (RED→GREEN) | bbb830b | Done |
| 3 | MCP /mcp endpoint + get_status tool (bearer-protected, same schema) (RED→GREEN) | bbb830b | Done |

## RED Phase Output

### Task 1 RED — config.test.ts (before config.ts exists)

```
 FAIL  apps/server/src/config.test.ts [ apps/server/src/config.test.ts ]
Error: Cannot find module './config.ts' imported from .../apps/server/src/config.test.ts
 ❯ apps/server/src/config.test.ts:2:1

Test Files  1 failed (1)
     Tests  no tests
  Duration  158ms
```

Failure reason: missing module — expected RED state.

### Task 2 RED — status.routes.test.ts (before status.routes.ts exists)

```
 FAIL  apps/server/src/adapters/http/status.routes.test.ts
Error: Cannot find module './status.routes.ts' imported from .../status.routes.test.ts
 ❯ apps/server/src/adapters/http/status.routes.test.ts:6:1

Test Files  1 failed (1)
     Tests  no tests
  Duration  203ms
```

Failure reason: missing module — expected RED state.

### Task 3 RED — mcp.test.ts (before bearer.ts + server.ts exist)

```
 FAIL  apps/server/src/adapters/mcp/mcp.test.ts
Error: Cannot find module './bearer.ts' imported from .../mcp.test.ts
 ❯ apps/server/src/adapters/mcp/mcp.test.ts:6:1

Test Files  1 failed (1)
     Tests  no tests
  Duration  213ms
```

Failure reason: missing module — expected RED state.

## GREEN Phase Output

### Task 1 GREEN — config tests (6/6)

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  21:40:49
   Duration  196ms
```

6 config tests: valid env parses, missing DATABASE_URL names var, short MCP_BEARER_TOKEN rejected, optional DATABASE_POOL_URL, PORT coercion from string.

### Task 2 GREEN — status route tests (4/4)

```
 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  21:43:22
   Duration  232ms
```

4 route tests: 200+db:ok, 200+db:down, body passes statusResponse.parse, all required fields present.

### Task 3 GREEN — MCP tests (6/6)

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  21:45:39
   Duration  308ms
```

6 MCP tests: no-auth 401, wrong-auth 401, correct-auth passes (not 401), bearer middleware pass-through, tool output parses against statusResponse, db:ok + tokenFreshness fields present.

## Full Suite GREEN

```
 Test Files  9 passed | 2 skipped (11)
      Tests  63 passed | 4 skipped (67)
   Start at  21:49:18
   Duration  668ms
```

63 tests pass. 4 skipped = Postgres testcontainers tests (require per-package run with Docker; in-memory equivalents always run).

## Verification Evidence

### bun run typecheck

```
$ tsc --build --force
(no output = zero errors)
```

### bun run lint

```
$ eslint .
(warnings only: noWarnOnMultipleProjects, legacy selector syntax — pre-existing, not errors)
Exit: 0
```

### Config boot-loudly proof (DATA-04)

```
parseConfig({}) throws ZodError naming DATABASE_URL:
[{ "code": "invalid_type", "path": ["DATABASE_URL"], "message": "Invalid input..." }, ...]
```

### MCP-02 schema drift proof

Both `apps/server/src/adapters/http/status.routes.ts` and `apps/server/src/adapters/mcp/tools.ts` import the same `statusResponse` from `@morai/contracts`. A one-sided field rename would cause `StatusResponse` type to diverge and fail `bun run typecheck` in both files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] @morai/contracts, @morai/core, @morai/adapters missing main field**
- **Found during:** Task 2 route test run — Vite workspace resolver could not find @morai/contracts
- **Issue:** Same pattern as @morai/shared in plan 03: Vite reads `main` or `exports`, not the `module` field; packages/contracts, core, adapters only had `module`
- **Fix:** Added `"main": "src/index.ts"` to each package.json; also added resolve.alias for all @morai/* in apps/server vitest.config.ts
- **Files modified:** `packages/contracts/package.json`, `packages/core/package.json`, `packages/adapters/package.json`, `apps/server/vitest.config.ts`
- **Commit:** bbb830b

**2. [Rule 3 - Blocking] apps→apps intra-package imports flagged by boundaries rule**
- **Found during:** Task 1 lint — worker/src/main.ts importing ./config.ts flagged
- **Issue:** Same pattern as core→core (plan 03) and adapters→adapters (plan 04): the boundaries rule had no apps→apps entry for intra-package relative imports
- **Fix:** Added `"apps"` to the allow list for the apps element type in eslint.config.js
- **Files modified:** `eslint.config.js`
- **Commit:** 4c36fa2

**3. [Rule 1 - Bug] StreamableHTTPServerTransport incompatible with exactOptionalPropertyTypes**
- **Found during:** Task 3 typecheck — `server.connect(transport)` fails: Transport.onclose getter/setter type incompatible
- **Issue:** `StreamableHTTPServerTransport.onclose` is implemented as a getter/setter returning `(() => void) | undefined` which conflicts with `exactOptionalPropertyTypes`. Also `sessionIdGenerator: undefined` is explicitly disallowed.
- **Fix:** Switched to `WebStandardStreamableHTTPServerTransport` (native fetch API transport for Bun/Hono environments) which has `onclose?: () => void` as a plain optional property, structurally compatible with the Transport interface. Eliminates the fetch-to-node bridge entirely.
- **Files modified:** `apps/server/src/adapters/mcp/server.ts`
- **Commit:** bbb830b

**4. [Rule 1 - Bug] result.value inaccessible without result.ok narrowing**
- **Found during:** Task 3 typecheck — `result.value` on `Result<StatusPayload, never>` fails because Err<never>.value doesn't exist
- **Issue:** With `exactOptionalPropertyTypes`, even a `Result<T, never>` requires an `.ok` guard before accessing `.value`
- **Fix:** Added `if (!result.ok) { return ... }` guard before accessing `result.value` in both status.routes.ts and tools.ts
- **Files modified:** `apps/server/src/adapters/http/status.routes.ts`, `apps/server/src/adapters/mcp/tools.ts`
- **Commit:** bbb830b

## TDD Gate Compliance

Per plan `type: tdd` frontmatter requirements (PROJECT tdd.md rule: commit only at green):

1. RED confirmed for Task 1: `config.test.ts` failed with "Cannot find module './config.ts'" before implementation
2. GREEN commit for Task 1: `4c36fa2` — feat(01-05): Zod env config + worker composition root
3. RED confirmed for Task 2: `status.routes.test.ts` failed with "Cannot find module './status.routes.ts'" before implementation
4. GREEN commit for Task 2: `bbb830b` — feat(01-05): Hono route + MCP + composition root
5. RED confirmed for Task 3: `mcp.test.ts` failed with "Cannot find module './bearer.ts'" before implementation
6. GREEN commit for Task 3: `bbb830b` (committed with Task 2 — tightly coupled via main.ts)

No separate RED commits (per PROJECT tdd.md: "Commit only at green").

## Known Stubs

None. All plan goals are fully achieved:

- `tokenFreshness: "none yet"` and `lastJobRuns: "none yet"` are intentional Phase-1 placeholders (SPEC req 11, per plan 03 decision). They are the correct Phase-1 value per the locked spec.

## Threat Surface Scan

**T-01-11 (Spoofing — unauthenticated /mcp access):** Mitigated. `bearerAuth(token)` middleware on `/mcp/*`; no/wrong token → 401. Tested with 3 test cases (no auth, wrong auth, correct auth).

**T-01-12 (Info Disclosure — bearer/DATABASE_URL in logs):** Mitigated. `bootConfig()` logs field NAMES only on Zod failure, never values. Bearer token never logged anywhere.

**T-01-13 (Elevation — DNS rebinding against /mcp):** Mitigated. `WebStandardStreamableHTTPServerTransport` validates Origin header internally; bearer required regardless.

**T-01-14 (Info Disclosure — /api/status leaking internals):** Accepted per plan. Phase-1 payload is db/tokenFreshness/lastJobRuns/version/uptime — no secrets.

No new security-relevant surfaces beyond the plan's threat model.

## Self-Check: PASSED

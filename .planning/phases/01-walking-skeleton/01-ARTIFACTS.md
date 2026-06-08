# Phase 1 — Artifacts This Phase Produces

> Authoritative manifest of every symbol, file, package, and config created across plans 01-06.
> Consumed by `/gsd-execute-phase` and by later phases that build on the walking skeleton.

## Packages (Bun workspaces, scope `@morai/*`)

| Package | Plan | Public surface (exports) |
|---|---|---|
| `@morai/shared` | 02 | `Result<T,E>`, `Ok<T>`, `Err<E>`, `ok`, `err`, `isOk`, `isErr`, `assertDefined`, `OccSymbol`, `parseOccSymbol`, `formatOccSymbol` |
| `@morai/contracts` | 03 | `statusResponse` (Zod schema), `StatusResponse` (inferred type) |
| `@morai/core` | 03 | `ForGettingOpenCalendars`, `ForPingingDb` (driven ports), `ForGettingStatus` (driver port), `makeGetStatusUseCase` |
| `@morai/adapters` | 04 | schema (7 pgTables), `makeDb`, `runMigrations`, `makePostgresCalendarsRepo`, `makeMemoryCalendarsRepo`, `runCalendarsContractTests` |
| `@morai/server` (`apps/server`) | 05 | `parseConfig`, `Config`, `statusRoutes`, `registerStatusTool`, `makeMcpServer`, bearer middleware; composition root `main.ts` |
| `@morai/worker` (`apps/worker`) | 05 | worker `parseConfig`, `migrate.ts` (calls `runMigrations`); composition root `main.ts` |

## Exported symbols by file

| Symbol | File | Kind | Plan |
|---|---|---|---|
| `Result`, `Ok`, `Err`, `ok`, `err`, `isOk`, `isErr` | `packages/shared/src/result.ts` | types + constructors | 02 |
| `assertDefined` | `packages/shared/src/assert.ts` | type-narrowing assertion | 02 |
| `OccSymbol`, `parseOccSymbol`, `formatOccSymbol` | `packages/shared/src/occ-symbol.ts` | branded type + parse/format | 02 |
| `statusResponse`, `StatusResponse` | `packages/contracts/src/status.ts` | Zod schema + inferred type | 03 |
| `ForGettingOpenCalendars`, `ForPingingDb` | `packages/core/src/journal/application/ports.ts` | driven port types | 03 |
| `makeGetStatusUseCase`, `ForGettingStatus` | `packages/core/src/journal/application/getStatus.ts` | use-case factory + driver port | 03 |
| 7 pgTables: `calendars`, `calendarSnapshots`, `legObservations`, `contracts`, `fills`, `orders`, `rateObservations` | `packages/adapters/src/postgres/schema.ts` | Drizzle table defs | 04 |
| `makeDb` | `packages/adapters/src/postgres/db.ts` | Drizzle/postgres.js pool factory | 04 |
| `runMigrations` | `packages/adapters/src/postgres/migrate.ts` | idempotent boot migrator (max:1, direct) | 04 |
| `makePostgresCalendarsRepo` | `packages/adapters/src/postgres/repos/calendars.ts` | Postgres calendars adapter | 04 |
| `makeMemoryCalendarsRepo` | `packages/adapters/src/memory/calendars.ts` | in-memory calendars twin | 04 |
| `runCalendarsContractTests` | `packages/adapters/src/__contract__/calendars.contract.ts` | shared contract suite (reusable harness) | 04 |
| `parseConfig`, `Config` | `apps/server/src/config.ts` | Zod env config | 05 |
| `statusRoutes` | `apps/server/src/adapters/http/status.routes.ts` | Hono GET /api/status | 05 |
| `registerStatusTool` | `apps/server/src/adapters/mcp/tools.ts` | MCP get_status tool | 05 |
| `makeMcpServer` | `apps/server/src/adapters/mcp/server.ts` | MCP server + /mcp mount (fetch-to-node) | 05 |
| bearer middleware | `apps/server/src/adapters/mcp/bearer.ts` | Hono bearer auth on /mcp | 05 |

## Config / infra files

| File | Purpose | Plan |
|---|---|---|
| `package.json` (root) | Bun workspaces + scripts `dev\|test\|typecheck\|lint\|migrate` | 01 |
| `tsconfig.base.json`, `tsconfig.json` (solution) + per-workspace `tsconfig.json` | strict TS + project references | 01 |
| `eslint.config.js` | boundaries (mode:full) + strict-TS + no-restricted-imports | 01 |
| `vitest.workspace.ts` + per-package `vitest.config.ts` | aggregated test suites | 01-05 |
| `drizzle.config.ts` | drizzle-kit schema/out config | 04 |
| `packages/adapters/test/globalSetup.ts` | single testcontainers Postgres (provide/inject) | 04 |
| `packages/adapters/src/postgres/migrations/*.sql` | generated initial migration (7 tables) | 04 |
| `.github/workflows/ci.yml` | CI: typecheck+lint+test on every PR (D-02) | 06 |
| `railway.json` | force NIXPACKS builder (D-03) | 06 |
| `apps/server/Dockerfile`, `apps/worker/Dockerfile` | Dockerfile fallback (D-03) | 06 |
| `.env.example` | documented env (placeholders only) | 06 |

## Routes / tools / CLI surface

| Surface | Path / name | Plan |
|---|---|---|
| HTTP route | `GET /api/status` | 05 |
| MCP endpoint | `POST/GET /mcp` (bearer-protected) | 05 |
| MCP tool | `get_status` | 05 |
| Script | `bun run migrate` → `apps/worker/src/migrate.ts` → `runMigrations` | 05 |
| Scripts | `bun run dev \| test \| typecheck \| lint` | 01 |

---

## Multi-Source Coverage Audit

All four source types audited; every item is COVERED by a plan. No MISSING rows.

```
SOURCE    | ID        | Feature / Requirement                                              | Plan  | Status
--------- | --------- | ------------------------------------------------------------------ | ----- | -------
GOAL      | —         | Deployable monorepo, hexagon enforced, Supabase reachable,         | 01-06 | COVERED
          |           | GET /api/status + MCP get_status live in prod (one E2E slice)      |       |
REQ       | FND-01    | Bun workspaces, cross-package tsconfig refs resolve                 | 01    | COVERED
REQ       | FND-02    | ESLint boundary rule fails build on core→adapter import            | 01    | COVERED
REQ       | FND-03    | Strict TS (no any/as/!, exhaustive switches) fails build           | 01    | COVERED
REQ       | FND-04    | shared kernel: Result, assertDefined, OccSymbol (tested)           | 02    | COVERED
REQ       | FND-05    | Root scripts dev|test|typecheck|lint|migrate across workspace      | 01,05 | COVERED
REQ       | DATA-01   | Drizzle schema: 7 tables, time-leading composite PKs               | 04    | COVERED
REQ       | DATA-02   | Idempotent migrator (2nd run = 0 applied)                          | 04    | COVERED
REQ       | DATA-03   | calendars port + Postgres + in-memory + one contract test         | 03,04 | COVERED
REQ       | DATA-04   | Zod-parsed config, fails boot loudly naming var                   | 05    | COVERED
REQ       | DEPLOY-01 | Two Railway services on Supabase                                  | 06    | COVERED
REQ       | DEPLOY-02 | GET /api/status live in prod (real DB health)                     | 05,06 | COVERED
REQ       | DEPLOY-03 | MCP endpoint live, bearer-protected, registers in Claude Code     | 05,06 | COVERED
REQ       | MCP-02    | One use-case, HTTP + MCP adapters, one statusResponse schema       | 03,05 | COVERED
RESEARCH  | —         | eslint-plugin-boundaries mode:"full" (Pitfall 4)                  | 01    | COVERED
RESEARCH  | —         | MCP fetch-to-node bridge, stateless, POST+GET (Pattern 4/Pitfall 2)| 05    | COVERED
RESEARCH  | —         | Drizzle migrate max:1 over direct connection (Pitfall 3)          | 04,05 | COVERED
RESEARCH  | —         | Railway Nixpacks force + Dockerfile fallback (Pattern 6/Pitfall 1)| 06    | COVERED
RESEARCH  | —         | testcontainers single container via globalSetup (Pitfall 5)       | 04    | COVERED
RESEARCH  | —         | exactOptionalPropertyTypes vs Drizzle inference (Pitfall 6)       | 01,04 | COVERED
RESEARCH  | —         | no-restricted-imports for vendor pkgs in core (Pattern 2/A1)       | 01    | COVERED
CONTEXT   | D-01      | GitHub-connected Railway deploy (push main auto-deploys both)      | 06    | COVERED
CONTEXT   | D-02      | CI from Phase 1 (typecheck+lint+test incl. testcontainers)        | 06    | COVERED
CONTEXT   | D-03      | Nixpacks default, Dockerfile fallback                            | 06    | COVERED
CONTEXT   | D-04      | eslint-plugin-boundaries for the hexagon dependency law          | 01    | COVERED
CONTEXT   | D-05      | postgres.js driver behind Drizzle, direct/session URL            | 04,05 | COVERED
```

**Excluded (not gaps):** CONTEXT Deferred Ideas (Dockerfile-per-service as default, @supabase/supabase-js,
PR preview environments); SPEC out-of-scope items (CBOE/FRED/Schwab, BSM, other repos, real jobs,
broker_tokens, analytics, web UI) — all scoped to Phases 2-6.

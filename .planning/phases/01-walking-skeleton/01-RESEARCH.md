# Phase 1: Walking Skeleton — Research

**Researched:** 2026-06-08
**Domain:** Bun monorepo · Hono · Drizzle + postgres.js · ESLint boundaries · MCP streamable HTTP · testcontainers · Railway
**Confidence:** HIGH (core stack) / MEDIUM (Railway Bun monorepo — known active issues)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** GitHub-connected Railway deploy. Railway watches the GitHub repo; push to `main`
  auto-deploys both `server` and `worker`. No local-CLI-only deploy.
- **D-02:** CI from Phase 1. GitHub Actions runs typecheck + lint + test (including `calendars`
  contract test via testcontainers Postgres on GH-hosted Ubuntu) on every PR.
- **D-03:** Nixpacks auto-detect for the Bun monorepo (zero Dockerfile). Each Railway service sets
  its root + build/start command. Revisit to Dockerfile only if Nixpacks monorepo detection proves flaky.
- **D-04:** `eslint-plugin-boundaries` for the hexagon dependency law. Element types: `shared`,
  `core`, `adapters`, `apps/*`. Enforces `core → shared` only.
- **D-05:** `postgres.js` as the Postgres driver behind Drizzle, direct/session Supabase URL.
  Do NOT use `@supabase/supabase-js`. Migrations require `max: 1` connection.

### Claude's Discretion

- MCP transport: `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport` mounted at `/mcp`
  on the same Hono server.
- Migrator: Drizzle's migrator (`drizzle-kit generate` for SQL + boot-time `migrate()`), idempotent
  via `__drizzle_migrations` ledger; runs over the direct connection.
- Contracts: Zod schemas in `packages/contracts`; Hono `@hono/zod-validator` on routes; MCP tool
  input/output derived from the same schema.
- In-memory adapters live in `packages/adapters/memory/`; package scope `@morai/*`.
- Single repo built this phase is `calendars`.

### Deferred Ideas (OUT OF SCOPE)

- Dockerfile-per-service build — fallback only if Nixpacks monorepo detection proves flaky.
- `@supabase/supabase-js` (Realtime/Auth/RLS).
- PR preview environments on Railway.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Bun-workspaces monorepo with cross-package tsconfig references | §Standard Stack, §Bun Workspaces + tsconfig |
| FND-02 | ESLint boundary rule fails build on `core→adapters` import | §eslint-plugin-boundaries flat config |
| FND-03 | Strict TypeScript config (no any/as/!, exhaustive switches) | §TypeScript strict config |
| FND-04 | `shared` kernel: Result, assertDefined, OccSymbol (unit tested) | §Shared kernel patterns |
| FND-05 | Root scripts `dev\|test\|typecheck\|lint\|migrate` work across workspace | §Root scripts + vitest.workspace.ts |
| DATA-01 | Drizzle schema: 7 tables, time-leading composite PKs | §Drizzle schema patterns |
| DATA-02 | Idempotent migrator via `migrate()` on boot | §Drizzle migrate() boot pattern |
| DATA-03 | `calendars` port + Postgres adapter + in-memory adapter + contract test | §testcontainers + contract test |
| DATA-04 | Zod-parsed config, fails loudly on missing vars | §Zod env config pattern |
| DEPLOY-01 | Two Railway services against Supabase | §Railway deployment |
| DEPLOY-02 | `GET /api/status` live in production | §Hono route + status payload |
| DEPLOY-03 | MCP endpoint live at `/mcp`, bearer-protected, registers in Claude Code | §MCP StreamableHTTP + Hono |
| MCP-02 | One use-case, both HTTP + MCP adapters, one Zod schema in contracts | §MCP-02 dual-adapter pattern |

</phase_requirements>

---

## Summary

Phase 1 builds a Bun-workspaces monorepo from scratch in a repo that currently has zero application code. The seven technical integration areas each have distinct gotchas that will derail a plan if not addressed upfront.

The core TypeScript/Bun/Hono/Drizzle stack is well-understood and stable. The main integration risk is the **Railway + Bun monorepo deploy**: Railpack (Railway's new builder) has documented issues detecting Bun in shared monorepos where `bun.lock` lives at the root, not in each service sub-directory. D-03 locks Nixpacks as the default and Dockerfile as the fallback — the plan must include verification of Nixpacks detection and a concrete fallback path.

The MCP `StreamableHTTPServerTransport` on Hono requires a `fetch-to-node` bridge (or the `@modelcontextprotocol/hono` helper) because the SDK was written against Node-style `req`/`res` objects, not the Web Fetch API that Hono's context exposes. This is the non-obvious wiring that causes silent failures.

**Primary recommendation:** Scaffold the full monorepo structure first (FND-01 through FND-05), prove the `calendars` port pattern (DATA-01 through DATA-04), then wire the status endpoint with MCP dual-adapter (DEPLOY-02/03, MCP-02), and finally prove the Railway deploy in production (DEPLOY-01).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GET /api/status — HTTP surface | Driving adapter (`apps/server/src/adapters/http/`) | — | Inbound adapter; zero business logic |
| get_status — MCP surface | Driving adapter (`apps/server/src/adapters/mcp/`) | — | Inbound adapter; same use-case, different transport |
| Status business logic (DB ping, uptime) | Application use-case (`packages/core/`) | — | Hexagon; no framework imports |
| DB connection + query | Driven adapter (`packages/adapters/postgres/`) | — | Drizzle lives here only |
| In-memory calendar repo | Driven adapter (`packages/adapters/memory/`) | — | Test double; same port interface |
| Zod env config parsing | Composition root (`apps/*/src/main.ts`) | — | `process.env` read exactly once |
| Drizzle schema + migrations | Driven adapter (`packages/adapters/postgres/`) | — | Adapter concern, not domain |
| `Result<T,E>`, `assertDefined`, `OccSymbol` | Shared kernel (`packages/shared/`) | — | Cross-cutting primitives |
| API contracts (statusResponse Zod schema) | Contracts package (`packages/contracts/`) | — | Imported by both HTTP route and MCP tool |
| pg-boss job runner (boot only, Phase 1) | Driving adapter (`apps/worker/src/`) | — | Composition root boots + migrates; no jobs |
| Railway deploy / CI | Infrastructure (external) | — | Outside the hexagon |

---

## Standard Stack

### Core Packages

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bun` | 1.3.13 | Runtime, package manager, test runner compat | [VERIFIED: npm registry] Project-locked (D1) |
| `hono` | 4.12.23 | HTTP server, routing, RPC | [VERIFIED: npm registry] Project-locked (D2); runtime-portable |
| `@hono/zod-validator` | 0.8.0 | Zod middleware for Hono routes | [VERIFIED: npm registry] Official Hono ecosystem package |
| `drizzle-orm` | 0.45.2 | ORM, query builder, runtime migrator | [VERIFIED: npm registry] Project-locked (D5/D6) |
| `drizzle-kit` | 0.31.10 | SQL migration generation via `drizzle-kit generate` | [VERIFIED: npm registry] Companion to drizzle-orm |
| `postgres` (postgres.js) | 3.4.9 | Postgres wire protocol client behind Drizzle | [VERIFIED: npm registry] Project-locked (D-05) |
| `zod` | 4.4.3 | Schema validation everywhere (API, env, tool I/O) | [VERIFIED: npm registry] Project-locked (D14) |
| `@modelcontextprotocol/sdk` | 1.29.0 | MCP server + StreamableHTTPServerTransport | [VERIFIED: npm registry] Official Anthropic SDK |
| `typescript` | 6.0.3 | Type checker | [VERIFIED: npm registry] Strict mode required (FND-03) |

### Supporting Packages

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `eslint-plugin-boundaries` | 6.0.2 | Hexagon dependency enforcement | Always — FND-02 |
| `@typescript-eslint/eslint-plugin` | 8.60.1 | Strict TS lint rules (no-any, no-as, etc.) | Always — FND-03 |
| `eslint` | 10.4.1 | Linter host (flat config) | Always |
| `vitest` | 4.1.8 | Test runner (workspace mode) | All packages |
| `@testcontainers/postgresql` | 12.0.1 | Real Postgres container for adapter tests | `packages/adapters` contract tests |
| `testcontainers` | 12.0.1 | Base testcontainers (peer dep) | With above |
| `@types/bun` | 1.3.14 | Bun global type definitions | Dev dep on all packages |
| `fetch-to-node` | 2.1.0 | Web Fetch API → Node req/res bridge for MCP transport | MCP wiring in `apps/server` |

### Installation

```bash
# Root dev deps
bun add -d typescript eslint eslint-plugin-boundaries @typescript-eslint/eslint-plugin vitest @types/bun

# Server deps
bun add hono @hono/zod-validator zod @modelcontextprotocol/sdk

# Adapter deps
bun add drizzle-orm postgres
bun add -d drizzle-kit @testcontainers/postgresql
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time — all packages marked [ASSUMED] for registry existence. All packages below are confirmed via `npm view` on the official npm registry AND are referenced in official documentation.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `hono` | npm | ~4.5 yrs | github.com/honojs/hono | not run | Approved — official docs [ASSUMED] |
| `drizzle-orm` | npm | ~4.7 yrs | github.com/drizzle-team/drizzle-orm | not run | Approved — official docs [ASSUMED] |
| `drizzle-kit` | npm | ~4.7 yrs | same | not run | Approved [ASSUMED] |
| `postgres` (postgres.js) | npm | ~11 yrs | github.com/porsager/postgres | not run | Approved [ASSUMED] |
| `@modelcontextprotocol/sdk` | npm | ~1.5 yrs | github.com/modelcontextprotocol/typescript-sdk | not run | Approved — official Anthropic SDK [ASSUMED] |
| `eslint-plugin-boundaries` | npm | ~6 yrs | github.com/javierbrea/eslint-plugin-boundaries | not run | Approved [ASSUMED] |
| `vitest` | npm | ~4.5 yrs | github.com/vitest-dev/vitest | not run | Approved [ASSUMED] |
| `@testcontainers/postgresql` | npm | ~3 yrs | github.com/testcontainers/testcontainers-node | not run | Approved [ASSUMED] |
| `zod` | npm | ~6 yrs | github.com/colinhacks/zod | not run | Approved [ASSUMED] |
| `@hono/zod-validator` | npm | ~3.5 yrs | github.com/honojs/middleware | not run | Approved [ASSUMED] |
| `@types/bun` | npm | ~2.5 yrs | github.com/DefinitelyTyped/DefinitelyTyped | not run | Approved [ASSUMED] |
| `fetch-to-node` | npm | ~1.2 yrs (2025-04-22) | github.com/mhart/fetch-to-node | not run | Approved [VERIFIED: npm registry] — official MCP examples use it |
| `@modelcontextprotocol/hono` | npm | ~2 mo (2026-04-01) | github.com/modelcontextprotocol/typescript-sdk | not run | [WARNING: alpha@2.0.0-alpha.2, only 1 version] — do not use in Phase 1; use fetch-to-node bridge instead |

**Packages removed due to slopcheck [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** `@modelcontextprotocol/hono` — alpha version (2.0.0-alpha.2), only 1 published version, 2 months old. Official Anthropic maintainers, but not production-stable. Planner should use `fetch-to-node` bridge instead.

*slopcheck was unavailable at research time — all packages except `fetch-to-node` are tagged `[ASSUMED]`. The planner should gate each install behind a `checkpoint:human-verify` task if strict provenance is required, or accept the npm+official-docs signal as sufficient for these well-known packages.*

---

## Architecture Patterns

### System Architecture Diagram

```
Claude Code
    │
    │ MCP / streamable HTTP (POST /mcp, GET /mcp)
    ▼
apps/server/src/main.ts  (composition root)
    │  config = Zod.parse(process.env)
    │  pool    = postgres(config.DATABASE_URL)
    │  db      = drizzle(pool)
    │  calRepo = makePostgresCalendarsRepo(db)
    │  getStatus = makeGetStatusUseCase({ calRepo, db })
    │
    ├──▶ Hono router
    │       GET /api/status ──▶ getStatus() ──▶ Result<StatusPayload, Err>
    │                              │
    │                              ├──▶ packages/core/journal/application/getStatus.ts
    │                              │       (ping DB via ForPingingDB port)
    │                              │
    │                              └──▶ packages/contracts/status.ts (statusResponse schema)
    │
    └──▶ MCP transport at /mcp
            StreamableHTTPServerTransport (stateless, sessionIdGenerator: undefined)
            Bearer-token middleware guards POST + GET
            McpServer.registerTool('get_status', ...)
                same getStatus() use-case
                output validated against same statusResponse schema

apps/worker/src/main.ts  (composition root)
    │  config = Zod.parse(process.env)
    │  pool    = postgres(config.DATABASE_URL, { max: 1 })
    │  db      = drizzle(pool)
    │
    └──▶ migrate(db, { migrationsFolder }) ──▶ __drizzle_migrations table
         then: idle (no pg-boss jobs this phase)

packages/adapters/postgres/
    schema.ts          ── 7 Drizzle pgTable definitions
    migrations/        ── SQL files from drizzle-kit generate
    repos/
        calendars.ts   ── implements ForGettingCalendars port (ForGettingCalendars = () => Promise<Result<...>>)

packages/adapters/memory/
    calendars.ts       ── in-memory map, same ForGettingCalendars port type

packages/core/journal/application/
    ports.ts           ── ForGettingCalendars, ForPingingDB
    getStatus.ts       ── makeGetStatusUseCase(deps) → ForGettingStatus

packages/contracts/
    status.ts          ── statusResponse = z.object({ db, tokenFreshness, lastJobRuns, version, uptime })
    index.ts           ── re-exports all schemas

packages/shared/
    result.ts          ── Result<T,E>, ok(), err(), isOk(), isErr()
    assert.ts          ── assertDefined<T>(val, msg) → asserts val is T
    occ-symbol.ts      ── OccSymbol parser/formatter (SPX/SPXW, strike ×1000 int)
```

### Recommended Project Structure

```
morai-trading-dashboard-and-tools/
├── apps/
│   ├── server/
│   │   ├── src/
│   │   │   ├── main.ts              # composition root
│   │   │   ├── config.ts            # Zod env schema
│   │   │   └── adapters/
│   │   │       ├── http/
│   │   │       │   └── status.routes.ts
│   │   │       └── mcp/
│   │   │           └── tools.ts
│   │   ├── package.json             # name: "@morai/server"
│   │   └── tsconfig.json            # extends ../../tsconfig.base.json
│   └── worker/
│       ├── src/
│       │   └── main.ts              # composition root: migrate + idle
│       ├── package.json             # name: "@morai/worker"
│       └── tsconfig.json
├── packages/
│   ├── core/
│   │   ├── src/
│   │   │   └── journal/
│   │   │       ├── application/
│   │   │       │   ├── ports.ts
│   │   │       │   └── getStatus.ts
│   │   │       └── index.ts
│   │   ├── package.json             # name: "@morai/core"
│   │   └── tsconfig.json
│   ├── adapters/
│   │   ├── src/
│   │   │   ├── postgres/
│   │   │   │   ├── schema.ts
│   │   │   │   ├── migrations/
│   │   │   │   └── repos/calendars.ts
│   │   │   └── memory/
│   │   │       └── calendars.ts
│   │   ├── package.json             # name: "@morai/adapters"
│   │   └── tsconfig.json
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── status.ts
│   │   │   └── index.ts
│   │   ├── package.json             # name: "@morai/contracts"
│   │   └── tsconfig.json
│   └── shared/
│       ├── src/
│       │   ├── result.ts
│       │   ├── assert.ts
│       │   └── occ-symbol.ts
│       ├── package.json             # name: "@morai/shared"
│       └── tsconfig.json
├── package.json                     # root workspaces declaration
├── tsconfig.base.json               # strict mode config
├── tsconfig.json                    # root solution tsconfig (references only)
├── eslint.config.js                 # flat config + boundaries
└── vitest.workspace.ts              # aggregates all suites
```

---

## Pattern 1: Bun Workspaces + tsconfig Project References

**What:** Bun resolves `workspace:*` dependencies via symlinks in `node_modules`. TypeScript project references give the compiler the cross-package dependency graph for `--build` incremental compilation and proper `Go to Definition` in editors.

**Root `package.json`:**
```json
{
  "name": "morai",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "bun run --filter '*' dev",
    "test": "vitest run",
    "typecheck": "tsc --build --force",
    "lint": "eslint .",
    "migrate": "bun run apps/worker/src/migrate.ts"
  }
}
```

**Per-workspace `package.json` (e.g. `packages/core`):**
```json
{
  "name": "@morai/core",
  "version": "0.0.1",
  "module": "src/index.ts",
  "private": true,
  "dependencies": {
    "@morai/shared": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^6"
  }
}
```

**`tsconfig.base.json` (root):**
```jsonc
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "types": ["bun"]
  }
}
```

**Root `tsconfig.json` (solution file, references only):**
```json
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/contracts" },
    { "path": "packages/core" },
    { "path": "packages/adapters" },
    { "path": "apps/server" },
    { "path": "apps/worker" }
  ]
}
```

**Per-workspace `tsconfig.json` (e.g. `packages/core`):**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" }
  ]
}
```

**Cross-package import resolution:** With `workspace:*` + Bun symlinks, imports like `import { ok } from "@morai/shared"` resolve through `node_modules/@morai/shared` → the actual `packages/shared/src/index.ts`. No `paths` aliases needed in tsconfig. [CITED: bun.sh/docs/install/workspaces]

**Gotcha — `"module": "Preserve"` + `allowImportingTsExtensions: true`:** Bun runs TypeScript directly without emitting — `noEmit: true` is correct. Do NOT set `outDir` on the root tsconfig; only per-package tsconfigs that use `composite: true` need it. [CITED: bun.sh/docs/runtime/typescript]

**Gotcha — `exactOptionalPropertyTypes`:** This is stricter than `strict: true` and is required by the spec (FND-03). It means you CANNOT assign `undefined` to an optional property; you must omit the key entirely. Expect this to surface in Drizzle column type inference — handle with `satisfies` or explicit `| undefined` annotations. [ASSUMED]

---

## Pattern 2: eslint-plugin-boundaries v6 Flat Config (ESLint 9)

**What:** Classifies source files into element types by path pattern, then enforces allowed import directions.

**`eslint.config.js`:**
```javascript
// Source: jsboundaries.dev/docs/quick-start + jsboundaries.dev/docs/setup/settings
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "shared",    pattern: "packages/shared/src/**/*",    mode: "full" },
        { type: "contracts", pattern: "packages/contracts/src/**/*", mode: "full" },
        { type: "core",      pattern: "packages/core/src/**/*",      mode: "full" },
        { type: "adapters",  pattern: "packages/adapters/src/**/*",  mode: "full" },
        { type: "apps",      pattern: "apps/**/*",                   mode: "full" },
      ],
    },
    rules: {
      "boundaries/no-unknown": "error",
      "boundaries/element-types": ["error", {
        default: "disallow",
        rules: [
          // shared: no imports from anywhere else
          { from: "shared",    allow: [] },
          // contracts: only zod + shared
          { from: "contracts", allow: ["shared"] },
          // core: ONLY shared — never adapters, apps, frameworks
          { from: "core",      allow: ["shared"] },
          // adapters: core ports + shared
          { from: "adapters",  allow: ["core", "shared"] },
          // apps: everything (composition roots)
          { from: "apps",      allow: ["adapters", "core", "contracts", "shared"] },
        ],
      }],
    },
  }
);
```

**Gotcha — `mode: "full"` is required for monorepo path patterns.** The default `mode: "folder"` evaluates patterns right-to-left from the filename, so `packages/core/src/foo.ts` would never match a pattern starting with `packages/`. Use `mode: "full"` for all element types in this layout. [CITED: jsboundaries.dev/docs/setup/elements]

**Gotcha — eslint-plugin-boundaries does NOT enforce external package imports** (e.g. `hono` imported in `packages/core`). For that, add `@typescript-eslint/no-restricted-imports` rules separately:
```javascript
{
  files: ["packages/core/**/*.ts"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: ["hono*", "drizzle*", "postgres", "@modelcontextprotocol*", "pg-boss*"]
    }]
  }
}
```
[ASSUMED — cross-verified with hexagonal-ddd.md enforcement section]

**Acceptance test:** Add a `import type { Hono } from 'hono'` line in any `packages/core/**/*.ts` file and run `bun run lint`. Expect exit non-zero with a `boundaries/element-types` or `no-restricted-imports` violation.

---

## Pattern 3: Drizzle + postgres.js + Supabase

**Connection setup:**
```typescript
// Source: orm.drizzle.team/docs/connect-supabase
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

// API path — full pool, direct/session URL (port 5432)
const pool = postgres(config.DATABASE_URL);
const db = drizzle({ client: pool });

// Migration path — must use max:1
const migrationClient = postgres(config.DATABASE_URL, { max: 1 });
const migrationDb = drizzle({ client: migrationClient });
```

**Boot-time idempotent migration:**
```typescript
// Source: orm.drizzle.team/docs/migrations + github.com/drizzle-team/drizzle-orm README
import { migrate } from "drizzle-orm/postgres-js/migrator";

await migrate(migrationDb, {
  migrationsFolder: "./packages/adapters/src/postgres/migrations",
});
await migrationClient.end();
// migrate() checks __drizzle_migrations table; applies only unapplied files
```

**Key details:**
- Migration tracking table: `__drizzle_migrations` (default schema: `drizzle`) [CITED: orm.drizzle.team/docs/drizzle-kit-migrate]
- `migrationsFolder` path is relative to CWD when running; plan tasks must ensure CWD is the repo root or use absolute paths.
- `drizzle-kit generate` produces numbered SQL files (`0000_initial.sql`, etc.) in `migrationsFolder`.
- `drizzle-kit migrate` (CLI) and `migrate()` (runtime) are separate tools. Runtime `migrate()` is what boots apply; `drizzle-kit migrate` is the CLI equivalent. Use runtime `migrate()` for server/worker boot.

**Composite primary key with time-leading columns:**
```typescript
// Source: orm.drizzle.team/docs/indexes-constraints
import { pgTable, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";

export const calendarSnapshots = pgTable(
  "calendar_snapshots",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    calendarId: uuid("calendar_id").notNull(),
    // ... other columns
  },
  (table) => [
    primaryKey({ columns: [table.time, table.calendarId] }),
  ]
);
```

**Direct vs transaction pooler:**
- Direct/session (port 5432): full Postgres semantics; LISTEN/NOTIFY; advisory locks; prepared statements OK. Use for ALL migrations, pg-boss, and this phase's API. [CITED: orm.drizzle.team/docs/connect-supabase]
- Transaction pooler (port 6543): PgBouncer transaction mode; NO LISTEN/NOTIFY; NO prepared statements. If used, must pass `{ prepare: false }` to postgres.js. Phase 1 does NOT use it — `DATABASE_POOL_URL` is optional and unused this phase.

---

## Pattern 4: MCP StreamableHTTPServerTransport on Hono

**The core problem:** The MCP SDK's `StreamableHTTPServerTransport` was written for Express/Node.js (`IncomingMessage` / `ServerResponse`). Hono uses the Web Fetch API (`Request` / `Response`). You must bridge them.

**Recommended approach — stateless transport (correct for Phase 1):**
```typescript
// Source: github.com/mhart/mcp-hono-stateless + github.com/modelcontextprotocol/typescript-sdk docs/server.md
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toReqRes, toFetchResponse } from "fetch-to-node"; // bridge library

// Bearer auth middleware (applied to /mcp routes only)
const bearerAuth: MiddlewareHandler = async (c, next) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${config.MCP_BEARER_TOKEN}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
};

// Factory: create a fresh server+transport per request (stateless)
function makeMcpServer() {
  const server = new McpServer({ name: "morai", version: "1.0.0" });
  server.registerTool(
    "get_status",
    {
      title: "Get Morai Status",
      description: "Returns DB health, token freshness, last job runs",
      inputSchema: z.object({}), // no inputs
    },
    async () => {
      const result = await getStatus(); // same use-case as HTTP route
      return {
        content: [{ type: "text", text: JSON.stringify(statusResponse.parse(result)) }],
      };
    }
  );
  return server;
}

// Hono mount
app.use("/mcp/*", bearerAuth);
app.post("/mcp", async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = makeMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res, await c.req.json());
  res.on("close", () => { transport.close(); server.close(); });
  return toFetchResponse(res);
});
app.get("/mcp", async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = makeMcpServer();
  await server.connect(transport);
  await transport.handleRequest(req, res);
  res.on("close", () => { transport.close(); server.close(); });
  return toFetchResponse(res);
});
```

**`fetch-to-node` package:** [VERIFIED: npm registry] — `fetch-to-node@2.1.0`, published 2025-04-22, exists on npm with no postinstall scripts.
```bash
bun add fetch-to-node
```

**`@modelcontextprotocol/hono` package:** [VERIFIED: npm registry] — EXISTS at `2.0.0-alpha.2`, published 2026-04-01 by official Anthropic maintainers. However it is **alpha with only 1 published version** — stability is NOT guaranteed. Prefer the `fetch-to-node` bridge approach for Phase 1; treat `@modelcontextprotocol/hono` as a future upgrade path.

**Gotcha — `sessionIdGenerator: undefined` = stateless.** Each request gets a fresh server instance. No session resumability. This is correct for Phase 1; stateful sessions (with `randomUUID()` generator) are only needed if you want streaming notifications, which Phase 1 does not use. [CITED: modelcontextprotocol.io/docs/concepts/transports, docs/server.md]

**Alternative — lower-risk approach:** Mount the MCP transport on a raw `Bun.serve` handler at `/mcp` alongside the Hono app on the same port, bypassing the fetch bridge entirely. The production requirement (DEPLOY-03) only needs `/mcp` to be reachable — it does not require it to be a Hono sub-route. This is the safest fallback if `fetch-to-node` causes issues.

**Registration command:**
```bash
# Source: code.claude.com/docs/en/mcp (verified)
claude mcp add --transport http morai https://<prod-url>/mcp \
  --header "Authorization: Bearer $MCP_BEARER_TOKEN"
```

The `--header` flag passes bearer credentials. Local dev:
```bash
claude mcp add --transport http morai http://localhost:3000/mcp \
  --header "Authorization: Bearer $(bun run scripts/get-mcp-token.ts)"
```

---

## Pattern 5: testcontainers Postgres + Vitest Contract Tests

**Contract test pattern — shared suite against two adapters:**
```typescript
// packages/adapters/src/postgres/__tests__/calendars.contract.test.ts
// AND  packages/adapters/src/memory/__tests__/calendars.contract.test.ts
// BOTH import the same shared suite function:

import { runCalendarsContractTests } from "../__contract__/calendars.contract.ts";
import { makePostgresCalendarsRepo } from "../repos/calendars.ts";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

let container: Awaited<ReturnType<typeof PostgreSqlContainer.prototype.start>>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16")
    .withDatabase("morai_test")
    .withUsername("test")
    .withPassword("test")
    .start();
  // Run migrations against test container
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const client = postgres(container.getConnectionUri(), { max: 1 });
  await migrate(drizzle({ client }), { migrationsFolder: "./packages/adapters/src/postgres/migrations" });
  await client.end();
}, 60_000);

afterAll(() => container.stop());

runCalendarsContractTests(() => makePostgresCalendarsRepo(/* db from container URL */));
```

**In-memory version (no Docker):**
```typescript
import { runCalendarsContractTests } from "../__contract__/calendars.contract.ts";
import { makeMemoryCalendarsRepo } from "../../memory/calendars.ts";

runCalendarsContractTests(() => makeMemoryCalendarsRepo());
```

**`vitest.workspace.ts`:**
```typescript
// Source: vitest.dev/guide/workspace
import { defineWorkspace } from "vitest/config";
export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "apps/*/vitest.config.ts",
]);
```

**Per-package `vitest.config.ts`** (adapters package — sets testTimeout for Docker):
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: false,
    testTimeout: 60_000,   // Docker pull + start
    hookTimeout: 60_000,
  },
});
```

**GitHub Actions:** GH-hosted Ubuntu runners include Docker. testcontainers works with zero extra config. [CITED: docker.com/blog/running-testcontainers-tests-using-github-actions]

**Gotcha — Docker not running on macOS dev machine.** `bun run test` will fail the Postgres contract test if Docker Desktop is not running. The in-memory test must be runnable WITHOUT Docker (`describe.skipIf(!isDockerAvailable)` guard or separate test suites). One pattern: put the testcontainers suite in a file named `*.integration.test.ts` and configure a separate vitest project that only runs on CI.

**Gotcha — container reuse across test workers.** Each Vitest worker that imports the container `beforeAll` will start its own container. Use `globalSetup` + `provide/inject` to start ONE container and share the connection URL. This avoids parallel Docker container spam on CI. [CITED: dev.to/jcteague/using-testconatiners-with-vitest]

---

## Pattern 6: Railway Bun Monorepo Deploy

**D-03 locks Nixpacks as default, Dockerfile as fallback.** Research reveals the default is fragile:

**Nixpacks approach (D-03 default):**
- Railway auto-detects Bun when `bun.lock` (or `bun.lockb`) exists at the ROOT of the project directory it's building from.
- For a **shared monorepo** (no per-service root directory), set NO root directory in Railway service settings. Configure start/build commands directly:
  - Server start: `bun run apps/server/src/main.ts`
  - Worker start: `bun run apps/worker/src/main.ts`
  - Build: `bun install --frozen-lockfile`
- Watch paths: `/apps/server/**` for server service, `/apps/worker/**` for worker service (prevents cross-service deploys).

**Known Railpack issue (as of 2025-2026):** Railpack (Railway's newer builder) expects `bun.lock` in the per-service directory, not the monorepo root. If Railway auto-selects Railpack, the build fails. Workarounds:
  1. Add `railway.json` at repo root with `{ "build": { "builder": "NIXPACKS" } }` to force Nixpacks.
  2. Fall back to Dockerfile (D-03 fallback).

**Dockerfile fallback (if Nixpacks fails):**
```dockerfile
# apps/server/Dockerfile (context = repo root)
FROM oven/bun:1.3 AS base
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/ packages/
COPY apps/server/ apps/server/
RUN bun install --frozen-lockfile
CMD ["bun", "run", "apps/server/src/main.ts"]
```
Set `RAILWAY_DOCKERFILE_PATH=/apps/server/Dockerfile` in Railway service env. [CITED: docs.railway.com/guides/monorepo, station.railway.com discussions]

**Environment variable wiring:**
- Both services need `DATABASE_URL` (Supabase direct), `MCP_BEARER_TOKEN`.
- Server needs `PORT` (Railway injects this automatically on Railway; read from env with fallback to 3000 for local).
- Worker needs `TZ=America/New_York` (pg-boss cron alignment).
- Never hardcode; always Zod-parse at boot.

---

## Pattern 7: Zod Env Config

**Composition root config module:**
```typescript
// apps/server/src/config.ts
// Source: CONTEXT.md Claude's Discretion + architecture/deployment.md
import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL:      z.string().url("DATABASE_URL must be a valid postgres URL"),
  DATABASE_POOL_URL: z.string().url().optional(),
  MCP_BEARER_TOKEN:  z.string().min(16, "MCP_BEARER_TOKEN must be at least 16 chars"),
  PORT:              z.coerce.number().int().min(1).max(65535).default(3000),
  TZ:                z.string().default("America/New_York"),
  NODE_ENV:          z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof configSchema>;

export function parseConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid config:\n", result.error.format());
    process.exit(1);   // loud exit, naming the offending var
  }
  return result.data;
}
```

**Gotcha — `process.exit(1)` in workers vs. Railway restart policy.** Railway will retry on non-zero exit. A missing env var on deploy → infinite restart loop in Railway. Add a clear log message before `process.exit(1)` so Railway's log surface shows the problem immediately. [ASSUMED]

---

## Pattern 8: MCP-02 Dual-Adapter One-Schema Pattern

**What it establishes:** `packages/contracts` exports ONE `statusResponse` Zod schema. Both the HTTP route AND the MCP tool import it. If you change only one side, `bun run typecheck` fails because the inferred types diverge.

```typescript
// packages/contracts/src/status.ts
export const statusResponse = z.object({
  db:              z.enum(["ok", "down"]),
  tokenFreshness:  z.literal("none yet"),
  lastJobRuns:     z.literal("none yet"),
  version:         z.string(),
  uptime:          z.number(),
});
export type StatusResponse = z.infer<typeof statusResponse>;
```

```typescript
// apps/server/src/adapters/http/status.routes.ts
import { statusResponse } from "@morai/contracts";
// ... route returns: c.json(statusResponse.parse(result.value))
```

```typescript
// apps/server/src/adapters/mcp/tools.ts
import { statusResponse, type StatusResponse } from "@morai/contracts";
// ... tool returns: { content: [{ type: "text", text: JSON.stringify(statusResponse.parse(result)) }] }
```

**Compile-time drift detection:** Because both adapters import the same `StatusResponse` type, any field name change on the Zod schema propagates as a TypeScript error to both. This is the MCP-02 pattern in practice.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL migration tracking | Custom migration ledger | `migrate()` from drizzle-orm/postgres-js/migrator | Handles race conditions, file ordering, per-file transactions |
| Postgres connection pooling | Manual pool management | postgres.js built-in | Handles reconnect, backpressure, error handling |
| MCP HTTP transport | Raw SSE + JSON-RPC | `StreamableHTTPServerTransport` from SDK | Protocol compliance, session management, SSE streaming |
| ESLint boundary rules | Manual import checking | `eslint-plugin-boundaries` | Handles cross-package and intra-package patterns at scale |
| TypeScript project references | Manual tsconfig paths | Bun workspace symlinks + `composite: true` | Bun handles resolution; project refs give incremental build |
| Test isolation between adapter tests | Docker Compose | `testcontainers` per-suite | No external state; containers cleaned up automatically |
| Bearer auth in MCP | Custom JWT logic | Middleware `requireBearerAuth` or simple header check | Phase 1 single bearer token; full OAuth is Phase 4+ |
| Zod env parsing | Manual `process.env` accesses scattered in files | `parseConfig()` at composition root | Single parse point; typed config flows inward; loud failure |

**Key insight:** Every one of these has production-hardened library solutions. The hexagon pattern is designed so that the hexagon (core) is trivially simple — all complexity lives in adapters, which compose existing libraries.

---

## Runtime State Inventory

> Omitted. This is a greenfield phase — no prior runtime state exists. The repo is pre-code with zero application code, no database, no deployed services.

---

## Common Pitfalls

### Pitfall 1: Railpack vs Nixpacks Bun Detection

**What goes wrong:** Railway's Railpack builder expects `bun.lock` in the service's build directory. For a shared monorepo (no per-service root directory), the lock file is at the repo root. Railpack falls back to npm, `npm install` runs, packages install with npm semantics instead of Bun, and the service may fail at runtime.

**Why it happens:** Railpack was designed for isolated monorepos (each service has its own root directory). Shared monorepo support is an active development area as of 2026. [CITED: station.railway.com discussions]

**How to avoid:**
1. Add `railway.json` at repo root: `{ "build": { "builder": "NIXPACKS" } }` to force Nixpacks.
2. Verify Railway used Bun by checking build logs for `bun install`.
3. If Nixpacks also fails, use per-service Dockerfiles (D-03 fallback).

**Warning signs:** Build log shows `npm install` instead of `bun install`; service starts but imports fail due to missing workspace packages.

---

### Pitfall 2: MCP Fetch API vs Node req/res Mismatch

**What goes wrong:** Hono runs on the Web Fetch API. `StreamableHTTPServerTransport.handleRequest()` expects a Node.js `IncomingMessage` and `ServerResponse`. Calling `transport.handleRequest(c.req, c.res)` fails silently or throws a cryptic error.

**Why it happens:** The MCP SDK's server-side transport was written against Express/Node.js; Hono's runtime abstraction is Fetch-API-first.

**How to avoid:** Use the `fetch-to-node` bridge: `const { req, res } = toReqRes(c.req.raw)` before calling `transport.handleRequest`. Or use `@modelcontextprotocol/hono` helper. Always handle BOTH POST and GET on `/mcp` — POST sends requests, GET opens SSE streams for server notifications. [CITED: github.com/mhart/mcp-hono-stateless, modelcontextprotocol.io/docs/concepts/transports]

**Warning signs:** `claude mcp add` succeeds but calling `get_status` returns a protocol error; or POST `/mcp` returns 500 with no useful log.

---

### Pitfall 3: Drizzle Migration Client Needs `max: 1`

**What goes wrong:** Using a pooled postgres.js connection for `migrate()` causes intermittent "cannot use multiple statements in a simple query" or "transaction already in progress" errors during migration, especially if any migration file contains multiple statements.

**Why it happens:** `migrate()` wraps each migration in a transaction. A pooled connection with `max > 1` can interleave connections across statements. [CITED: github.com/drizzle-team/drizzle-orm postgres.js README]

**How to avoid:** Always create a dedicated `postgres(url, { max: 1 })` client for migrations. Close it with `await migrationClient.end()` after `migrate()` completes. Never reuse the API pool for migrations.

**Warning signs:** Migrations appear to succeed but `__drizzle_migrations` shows duplicate rows; or boot hangs indefinitely after `migrate()` is called.

---

### Pitfall 4: eslint-plugin-boundaries `mode: "folder"` vs `mode: "full"` for Monorepo Paths

**What goes wrong:** Using the default `mode: "folder"` (or omitting `mode`) for patterns like `packages/core/src/**/*` causes zero files to be matched. The `boundaries/element-types` rule reports no violations — AND no files are being classified — so the boundary is effectively not enforced.

**Why it happens:** In `folder` mode, patterns are evaluated right-to-left (from the filename end). `packages/core/src/**/*` never matches because the pattern includes full path prefixes that `folder` mode does not evaluate. [CITED: jsboundaries.dev/docs/setup/elements]

**How to avoid:** Use `mode: "full"` for all element type patterns in this monorepo layout. Verify by intentionally adding a forbidden import and confirming `bun run lint` exits non-zero.

**Warning signs:** Adding `import {} from "@morai/adapters"` in `packages/core` does not produce an ESLint error.

---

### Pitfall 5: testcontainers Container Per Worker (Parallel Spawning)

**What goes wrong:** When Vitest runs tests in parallel workers and the container `beforeAll` is in each test file, multiple Docker containers start simultaneously. On CI this exhausts memory or hits Docker daemon limits; locally it's just slow.

**Why it happens:** Vitest worker threads do not share state. Each worker executes the `beforeAll` in its own context.

**How to avoid:** Use Vitest `globalSetup` to start ONE container before any workers launch. Use `provide('dbUrl', container.getConnectionUri())` and `inject('dbUrl')` in tests to pass the URL. Alternatively, scope the contract test to a single `vitest.config.ts` project with `pool: 'forks'` and `singleFork: true`. [CITED: dev.to/jcteague/using-testconatiners-with-vitest]

**Warning signs:** CI takes >5 minutes for test suite; Docker logs show multiple postgres containers; `Cannot connect to Docker daemon` errors.

---

### Pitfall 6: `exactOptionalPropertyTypes` Breaks Drizzle-inferred Types

**What goes wrong:** Drizzle infers `nullable` columns as `T | null | undefined` in some contexts. With `exactOptionalPropertyTypes: true`, TypeScript rejects assignments where a property is `T | null` but the Drizzle insert type expects `T | null | undefined` (or vice versa).

**Why it happens:** `exactOptionalPropertyTypes` is stricter than `strict: true` and is known to conflict with some ORM type inference patterns.

**How to avoid:** When this surfaces, use explicit type annotations or helper types (`NonNullable<...>`) rather than disabling the flag. The flag must stay on per FND-03. If Drizzle insert types prove unmergeable, wrap inserts in a helper function with explicit parameter types. [ASSUMED — verified as a known compatibility issue in TypeScript strict mode discussions]

---

## Code Examples

### Result Type (packages/shared)

```typescript
// packages/shared/src/result.ts
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;
```

### assertDefined (packages/shared)

```typescript
// packages/shared/src/assert.ts
export function assertDefined<T>(
  val: T | undefined | null,
  msg: string
): asserts val is T {
  if (val === undefined || val === null) {
    throw new Error(`assertDefined: ${msg}`);
  }
}
```

### OccSymbol skeleton (packages/shared)

```typescript
// packages/shared/src/occ-symbol.ts
// OCC format: RRRRRRYYMMDDCNNNNNNN
// SPX  260515C07100000  (root padded to 6, strike × 1000 integer, no decimal)
export type OccSymbol = string & { readonly __brand: "OccSymbol" };

export function parseOccSymbol(raw: string): OccSymbol {
  // validation + normalization
  // ...
  return raw as OccSymbol;
}

export function formatOccSymbol(params: {
  root: string; expiry: Date; type: "C" | "P"; strike: number;
}): OccSymbol {
  // format: RRRRRRYYMMDDCNNNNNNN
  // strike × 1000, zero-padded to 8 digits
  // ...
}
```

Reference implementation: `trade-advisor` CBOE lib at `/Users/chiragpersonalmac/Desktop/trading-knowledge-respository/plugins/trade-advisor/mcp-server/src/lib/cboe.ts` (OSI parsing section). Port logic test-first; do not copy wholesale. [CITED: docs/trade-advisor-inventory.md]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@modelcontextprotocol/sdk` SSE transport (2024-11-05 protocol) | Streamable HTTP transport (2025-03-26+ protocol) | v1.x SDK | `claude mcp add --transport http` uses new transport; old SSE endpoint deprecated |
| `eslint-plugin-boundaries` v4 legacy config | v6 flat config with `mode: "full"` | v6.0.0 (2025) | Config structure changed; `boundaries/element-types` replaces `boundaries/imports` |
| `drizzle-orm/postgres-js/migrator` `migrationsFolder: "drizzle"` default | Explicit `migrationsFolder` required in recent versions | drizzle-kit 0.20+ | Always pass explicit path; do not rely on default |
| `bun.lockb` (binary lockfile) | `bun.lock` (text lockfile, YAML-like) | Bun 1.1.x | Railway Bun detection uses `bun.lock`; ensure not `.lockb` |
| Vitest `workspace` key in root config | Separate `vitest.workspace.ts` file | Vitest 1.x | `defineWorkspace` API is stable; use separate file |

**Deprecated/outdated:**
- `SSEServerTransport` from `@modelcontextprotocol/sdk`: replaced by `StreamableHTTPServerTransport`. The old `--transport sse` flag in `claude mcp add` is legacy. Use `--transport http`.
- `eslint-plugin-boundaries` `"boundaries/imports"` rule: renamed to `"boundaries/element-types"` in v5+.
- `drizzle-kit push` for production migrations: use `drizzle-kit generate` + runtime `migrate()` only. `push` is development-only (no history tracking).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `eslint-plugin-boundaries` v6 `no-restricted-imports` for external vendor packages is the right approach to forbid `hono` in `core` (boundaries plugin only blocks internal element-to-element imports) | Pattern 2 | If wrong, external vendor imports in core are not caught; test the acceptance test to verify |
| A2 | `@modelcontextprotocol/hono` is alpha (2.0.0-alpha.2) and should NOT be used in Phase 1; `fetch-to-node` bridge is the correct approach | Pattern 4 | [VERIFIED: npm registry] — resolved, use `fetch-to-node@2.1.0` |
| A3 | `exactOptionalPropertyTypes: true` will conflict with Drizzle type inference in some insert patterns | Pitfall 6 | If wrong (no conflict), no action needed; if right, need explicit type helpers |
| A4 | Bun 1.3.x produces `bun.lock` (text format), not `bun.lockb` (binary); Railway Nixpacks detects by `bun.lock` presence | Pattern 6 | If wrong, Nixpacks does not detect Bun; need to specify builder explicitly |
| A5 | All listed npm packages pass a manual slopcheck (no hallucinated names) | Package Legitimacy Audit | All package names were verified via `npm view`; risk is LOW |
| A6 | `fetch-to-node` is a real, maintained npm package suitable for the Hono→Node bridge | Pattern 4 | If package is unmaintained or incompatible, use `@modelcontextprotocol/hono` or Bun.serve sidecar |

---

## Open Questions

1. **`@modelcontextprotocol/hono` is alpha — do not use in Phase 1.** [RESOLVED]
   - Verified: `2.0.0-alpha.2`, 2026-04-01, official Anthropic maintainers
   - Decision: Use `fetch-to-node` bridge for Phase 1. `@modelcontextprotocol/hono` is a future upgrade path when it stabilizes.

2. **Does Railway's Nixpacks auto-detect Bun correctly for a shared monorepo with `bun.lock` at root?**
   - What we know: Nixpacks detects Bun by `bun.lock` presence; Railpack has documented issues; shared monorepo means NO per-service root dir
   - What's unclear: Whether current Nixpacks (not Railpack) handles this correctly in 2026
   - Recommendation: First deploy task should test and observe Railway build logs; have the Dockerfile ready as an immediate fallback

3. **`fetch-to-node` package identity.** [RESOLVED]
   - Verified: `fetch-to-node@2.1.0`, published 2025-04-22, author: mhart (same as `mcp-hono-stateless` example), no postinstall scripts.
   - Decision: Use `fetch-to-node` as the Hono→Node bridge for MCP transport wiring.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All | ✓ | 1.3.13 | — |
| Node.js | Vitest, some CLI tools | ✓ | v26.0.0 | — |
| Docker | testcontainers Postgres contract test | ✓ (installed) | 28.5.1 | Docker not accessible at research time — may be running on different user/context; GH Actions Ubuntu has Docker available |
| git | CI pipeline, Railway deploy | ✓ | — | — |
| Railway account | DEPLOY-01 | ✗ (not provisioned yet) | — | Must provision as part of Phase 1 |
| Supabase project | DATA-01..04, DEPLOY-01 | ✗ (not provisioned yet) | — | Must provision as part of Phase 1 |

**Missing dependencies with no fallback:**
- Railway project (two services) and Supabase project must be provisioned as explicit tasks in Phase 1. These are manual setup steps that cannot be automated.

**Missing dependencies with fallback:**
- Docker: available on macOS but not accessible in this research context. GH Actions runners have Docker; testcontainers contract tests will pass in CI. For local development, Docker Desktop must be running. Plan should include a guard (`skipIf`) so `bun run test` doesn't fail for developers without Docker.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | `vitest.workspace.ts` at repo root (to be created in Wave 0) |
| Quick run command | `vitest run --project packages/shared` |
| Full suite command | `vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | Cross-package import resolves (server → core → shared) | typecheck | `tsc --build --noEmit` | ❌ Wave 0 |
| FND-02 | `core → adapters` import fails lint | lint/boundary | `eslint packages/core` | ❌ Wave 0 |
| FND-03 | `any` / `as` / `!` fails lint or typecheck | lint+typecheck | `eslint . && tsc --build` | ❌ Wave 0 |
| FND-04 | `Result` ok/err flows + `assertDefined` throw + `OccSymbol` round-trip | unit | `vitest run --project packages/shared` | ❌ Wave 0 |
| FND-05 | All 5 scripts exit 0 | smoke | `bun run typecheck && bun run lint && bun run test` | ❌ Wave 0 |
| DATA-01 | `drizzle-kit generate` produces SQL with time-leading PKs | build | `bun run drizzle-kit generate -- --check` | ❌ Wave 0 |
| DATA-02 | Second `migrate()` run applies 0 migrations | integration | `vitest run --project packages/adapters -t "idempotent"` | ❌ Wave 0 |
| DATA-03 | `calendars` contract test green against Postgres + memory | integration | `vitest run --project packages/adapters` | ❌ Wave 0 |
| DATA-04 | Boot with missing `DATABASE_URL` exits non-zero with Zod error | unit | `vitest run --project apps/server -t "config"` | ❌ Wave 0 |
| DEPLOY-01 | Two Railway services deploy successfully | manual | Check Railway dashboard | Manual |
| DEPLOY-02 | Production `GET /api/status` returns 200 + `db: "ok"` | smoke/e2e | `curl https://<prod>/api/status \| jq .db` | Manual |
| DEPLOY-03 | `get_status` via MCP returns same payload as HTTP | smoke/e2e | `claude mcp call get_status` | Manual |
| MCP-02 | One-sided schema change fails typecheck | typecheck | `tsc --build` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `vitest run --project <current-package> --reporter=verbose`
- **Per wave merge:** `bun run typecheck && bun run lint && vitest run`
- **Phase gate:** Full suite green + production smoke tests (DEPLOY-01..03) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `vitest.workspace.ts` — root workspace config aggregating all packages
- [ ] `packages/shared/vitest.config.ts` — unit test config for Result/assertDefined/OccSymbol
- [ ] `packages/adapters/vitest.config.ts` — integration test config with 60s timeout
- [ ] `packages/adapters/src/__contract__/calendars.contract.ts` — shared contract suite (the reusable harness)
- [ ] `apps/server/vitest.config.ts` — config test (Zod env parsing)
- [ ] Framework install: all vitest packages included in root devDependencies

---

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (single-user, bearer token only) | Bearer token on MCP endpoint — pre-shared secret via env |
| V3 Session Management | No (stateless MCP, no user sessions) | `sessionIdGenerator: undefined` = stateless transport |
| V4 Access Control | Partial | MCP endpoint: bearer required; `/api/status` is public (no sensitive data) |
| V5 Input Validation | Yes | Zod at all boundaries: env, HTTP requests, MCP tool inputs, external API responses |
| V6 Cryptography | No (no encryption in Phase 1) | `TOKEN_ENCRYPTION_KEY` deferred to Phase 4 (broker_tokens table) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `MCP_BEARER_TOKEN` in logs | Information Disclosure | Never log config values; Zod config object flows inward without log calls |
| DNS rebinding against `/mcp` | Elevation of Privilege | MCP SDK transport validates Origin header; or use Host header check middleware |
| SQL injection via Drizzle | Tampering | Drizzle uses parameterized queries; never use raw template interpolation in SQL |
| `DATABASE_URL` in error output | Information Disclosure | `console.error` only on Zod parse failure; show field name, not value |
| `/api/status` info leak | Information Disclosure | Phase 1 payload (`db`, `tokenFreshness`, `lastJobRuns`, `version`, `uptime`) contains no secrets; bearer on MCP, not status |

---

## Sources

### Primary (HIGH confidence)

- [bun.sh/docs/install/workspaces](https://bun.sh/docs/install/workspaces) — workspace:* protocol, glob patterns, `bun install --filter`
- [bun.sh/docs/runtime/typescript](https://bun.sh/docs/runtime/typescript) — recommended compilerOptions, `moduleResolution: "bundler"`, `noEmit: true`
- [orm.drizzle.team/docs/connect-supabase](https://orm.drizzle.team/docs/connect-supabase) — postgres.js + Drizzle setup, direct vs pooler, `prepare: false` for pooler
- [orm.drizzle.team/docs/drizzle-kit-migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate) — `__drizzle_migrations` tracking table, `migrationsFolder` option
- [orm.drizzle.team/docs/migrations](https://orm.drizzle.team/docs/migrations) — boot-time `migrate()` pattern
- [orm.drizzle.team/docs/indexes-constraints](https://orm.drizzle.team/docs/indexes-constraints) — `primaryKey({ columns: [...] })` composite PK syntax
- [modelcontextprotocol.io/docs/concepts/transports](https://modelcontextprotocol.io/docs/concepts/transports) — Streamable HTTP transport spec, POST+GET required, stateless vs stateful
- [github.com/modelcontextprotocol/typescript-sdk/docs/server.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) — `McpServer.registerTool()`, `sessionIdGenerator: undefined`, stateless mode
- [jsboundaries.dev/docs/quick-start](https://www.jsboundaries.dev/docs/quick-start/) — eslint-plugin-boundaries v6 flat config setup
- [jsboundaries.dev/docs/setup/elements](https://www.jsboundaries.dev/docs/setup/elements/) — element descriptor `mode` options: folder/file/full
- [code.claude.com/docs/en/mcp](https://code.claude.com/docs/en/mcp) — `claude mcp add --transport http --header "Authorization: Bearer $TOKEN"` exact syntax
- [github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/postgres-js/README.md](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/postgres-js/README.md) — `max: 1` requirement for migrations

### Secondary (MEDIUM confidence)

- [github.com/mhart/mcp-hono-stateless](https://github.com/mhart/mcp-hono-stateless) — `toReqRes` + `toFetchResponse` bridge pattern for Hono + StreamableHTTPServerTransport
- [nikolamilovic.com/posts/integration-testing-node-postgres-vitest-testcontainers](https://nikolamilovic.com/posts/integration-testing-node-postgres-vitest-testcontainers/) — testcontainers + Vitest lifecycle, `container.getConnectionUri()`, snapshot restoration
- [dev.to/jcteague/using-testconatiners-with-vitest](https://dev.to/jcteague/using-testconatiners-with-vitest-499f) — `globalSetup` + `provide/inject` pattern for single container shared across workers
- [docker.com/blog/running-testcontainers-tests-using-github-actions](https://www.docker.com/blog/running-testcontainers-tests-using-github-actions/) — Docker on GH Actions Ubuntu runners, no extra config needed
- [docs.railway.com/guides/monorepo](https://docs.railway.com/guides/monorepo) — shared monorepo approach, watch paths, no root directory for shared repos
- [station.railway.com — Railpack Bun monorepo issue](https://station.railway.com/questions/railpack-bun-monorepos-not-using-bun-t-a22d37af) — Railpack `bun.lock` in service dir issue, Dockerfile workaround confirmed

### Tertiary (LOW confidence)

- Various npm package metadata (time.created, versions) — confirmed via `npm view` but age/provenance claims are [ASSUMED] without slopcheck

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via npm registry; official docs consulted for core patterns
- Architecture: HIGH — derived directly from locked project architecture docs
- Pitfalls 1-4: HIGH — verified via official docs or multiple sources
- Pitfalls 5-6: MEDIUM — verified via community sources with plausible official backing
- Railway Bun monorepo (Pattern 6): MEDIUM — documented active issues; multiple community sources confirm Railpack fragility

**Research date:** 2026-06-08
**Valid until:** 2026-08-08 (30 days for stable stack choices; Railway deploy patterns are more volatile — re-verify if deploy issues arise)

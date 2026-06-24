# Phase 8: Web Dashboard Backend — GEX endpoint, contract, RPC export, Supabase Auth + CORS - Pattern Map

**Mapped:** 2026-06-24
**Files analyzed:** 18 new/modified files
**Analogs found:** 17 / 18 (one file — `gex.ts` domain — has a partial analog only; primary reference is the mockup oracle)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/contracts/src/gex.ts` | contract | request-response | `packages/contracts/src/analytics.ts` | exact |
| `packages/contracts/src/index.ts` | config | export barrel | `packages/contracts/src/index.ts` (self) | exact |
| `packages/core/src/analytics/domain/gex.ts` | domain | transform | `packages/core/src/journal/domain/bsm.ts` | partial (math style) |
| `packages/core/src/analytics/domain/gex.test.ts` | test | unit+property | `packages/core/src/analytics/application/ports.ts` (style) | role-match |
| `packages/core/src/analytics/application/ports.ts` | application port | CRUD | `packages/core/src/analytics/application/ports.ts` (self, append) | exact |
| `packages/core/src/analytics/application/computeGexSnapshot.ts` | application | CRUD | `packages/core/src/analytics/application/` (compute-analytics pattern) | role-match |
| `packages/core/src/analytics/application/getGex.ts` | application | request-response | `packages/core/src/analytics/application/` (getSkew/getTermStructure pattern) | role-match |
| `packages/adapters/src/postgres/gex-snapshot.repo.ts` | driven adapter | CRUD | `packages/adapters/src/postgres/repos/risk-reversal-observations.ts` | exact |
| `packages/adapters/src/memory/gex-snapshot.memory.ts` | driven adapter | CRUD | existing memory adapters in `packages/adapters/src/memory/` | role-match |
| `packages/adapters/src/postgres/schema.ts` | config | CRUD | `packages/adapters/src/postgres/schema.ts` (self, append) | exact |
| `packages/adapters/src/postgres/migrations/0008_gex_snapshot.sql` | migration | CRUD | `packages/adapters/src/postgres/migrations/0007_analytics_observations.sql` | exact |
| `apps/server/src/config.ts` | config | — | `apps/server/src/config.ts` (self, append) | exact |
| `apps/server/src/main.ts` | driving adapter | request-response | `apps/server/src/main.ts` (self, refactor) | exact |
| `apps/server/src/adapters/http/gex.routes.ts` | driving adapter | request-response | `apps/server/src/adapters/http/analytics.routes.ts` | exact |
| `apps/server/src/adapters/mcp/tools.ts` | driving adapter | request-response | `apps/server/src/adapters/mcp/tools.ts` (self, append) | exact |
| `apps/worker/src/handlers/compute-gex-snapshot.ts` | driving adapter | event-driven | `apps/worker/src/handlers/compute-analytics.ts` | exact |
| `apps/worker/src/schedule.ts` | config | event-driven | `apps/worker/src/schedule.ts` (self, append) | exact |
| `apps/worker/src/main.ts` | config | event-driven | `apps/worker/src/main.ts` (self, append) | role-match |

---

## Pattern Assignments

### `packages/contracts/src/gex.ts` (contract, request-response)

**Analog:** `packages/contracts/src/analytics.ts`

**Imports pattern** (lines 1-2):
```typescript
import { z } from "zod";
```

**Core pattern** (lines 12-72 of analytics.ts — one schema per logical entry, one response per surface):
```typescript
/** skewEntry — the headline 25Δ risk-reversal + rank per (underlying, expiration). */
export const skewEntry = z.object({
  time: z.string().datetime(),
  underlying: z.string(),
  expiration: z.string(),
  value: z.number().nullable(),
  rrRank: z.number().nullable(),
});
export type SkewEntry = z.infer<typeof skewEntry>;

export const skewResponse = z.array(skewEntry);
export type SkewResponse = z.infer<typeof skewResponse>;
```

**Adaptation:** GEX is a single-object response (not an array). Model the `gexSnapshotEntry` schema after `skewEntry` but return an object, not `z.array(...)`. Export both schema and inferred type for each named shape. The GEX contract target shape from CONTEXT.md:
```typescript
export const gexWallEntry = z.object({ k: z.number().int(), gex: z.number(), coi: z.number().int(), poi: z.number().int(), vol: z.number().int() });
export const gexSnapshotEntry = z.object({
  spot: z.number(), flip: z.number().nullable(),
  callWall: z.number().int().nullable(), putWall: z.number().int().nullable(),
  netGammaAtSpot: z.number(),
  profile: z.array(z.object({ strike: z.number(), gamma: z.number() })),
  strikes: z.array(gexWallEntry),
  byExpiry: z.array(z.object({ date: z.string(), gex: z.number() })),
  computedAt: z.string().datetime(),
});
export type GexSnapshotEntry = z.infer<typeof gexSnapshotEntry>;
export const gexSnapshotResponse = gexSnapshotEntry;
export type GexSnapshotResponse = GexSnapshotEntry;
```

---

### `packages/contracts/src/index.ts` (config, export barrel)

**Analog:** `packages/contracts/src/index.ts` (self, append)

**Existing export pattern** (lines 29-45):
```typescript
// Analytics contracts (MCP-02: ONE schema source for HTTP routes + MCP get_skew/get_term_structure)
export {
  skewEntry,
  skewResponse,
  skewSmileEntry,
  skewSmileResponse,
  termStructureEntry,
  termStructureResponse,
} from "./analytics.ts";
export type {
  SkewEntry,
  SkewResponse,
  // ...
} from "./analytics.ts";
```

**Adaptation:** Append the same two-block pattern (value exports + type exports) for `gexWallEntry`, `gexSnapshotEntry`, `gexSnapshotResponse` and their inferred types from `"./gex.ts"`. Add a comment block matching the existing style: `// GEX contracts (MCP-02: ONE schema source for GET /api/analytics/gex + get_gex MCP tool)`.

---

### `packages/core/src/analytics/domain/gex.ts` (domain, transform)

**Analog:** `packages/core/src/journal/domain/bsm.ts` (pure math style), mockups/playground-v3.html (oracle)

**BSM function signature style** (from bsm.ts — pure exported functions, no class):
```typescript
export function bsmGreeks(spot: number, strike: number, dte: number, iv: number, r: number, q: number, type: "C" | "P"): BsmGreeks { ... }
```

**Adaptation:** Follow the same style — pure exported functions, no class, no side effects, no imports except `@morai/shared`. Key functions to implement:
- `dollarGamma(gamma, oi, spot): number` — $Bn/1% contribution for one contract
- `strikeGex(contracts, spot): Map<number, number>` — per-strike net GEX
- `findFlip(grid): number | null` — linear interpolation zero-crossing
- `buildProfile(contracts, spotGrid): ReadonlyArray<{s: number; g: number}>` — grid re-pricing using `bsmGreeks`

Import `bsmGreeks` from `../../journal/domain/bsm.ts` (same bounded context, same `packages/core`). This is an intra-core import within the same package — allowed by the architecture because `packages/core` may import from itself; the boundary rule forbids importing other *packages* (adapters, hono, etc.). However, cross-context domain imports are forbidden per the ports.ts comment. Clarify with the architecture rule: since both `journal/domain/bsm.ts` and `analytics/domain/gex.ts` live in `packages/core`, the import is legal. Confirm in `eslint.config.js` boundary rules before implementing.

---

### `packages/core/src/analytics/application/ports.ts` (application port, CRUD — append)

**Analog:** `packages/core/src/analytics/application/ports.ts` (self, lines 89-182)

**Port naming convention** (lines 101-103):
```typescript
export type ForReadingSmileSource = (
  snapshotTime: Date,
) => Promise<Result<SmileReadResult, StorageError>>;
```

**Adaptation:** Append four new port types following the exact `ForVerbingNoun` convention:
```typescript
export type LegObsForGex = {
  readonly time: Date; readonly contract: string;
  readonly underlyingPrice: number; readonly bsmGamma: string | null;
  readonly bsmIv: string | null; readonly openInterest: number;
  readonly contractType: "C" | "P"; readonly strike: number;
  readonly expiration: string;
};
export type ForReadingLegObsForGex = () => Promise<Result<ReadonlyArray<LegObsForGex>, StorageError>>;

export type GexSnapshotRow = { readonly cycleTime: Date; /* + all gexSnapshotEntry fields */ };
export type ForReadingGexSnapshot = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
export type ForPersistingGexSnapshot = (row: GexSnapshotRow) => Promise<Result<void, StorageError>>;
export type ForRunningComputeGexSnapshot = () => Promise<Result<void, StorageError>>;
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
```

---

### `packages/adapters/src/postgres/gex-snapshot.repo.ts` (driven adapter, CRUD)

**Analog:** `packages/adapters/src/postgres/repos/risk-reversal-observations.ts`

**Imports pattern** (lines 14-26):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForWritingRiskReversalObservations, ... } from "@morai/core";
import { and, eq, lte, isNotNull, asc, desc } from "drizzle-orm";
import { riskReversalObservations } from "../schema.ts";
import type { Db } from "../db.ts";
```

**onConflictDoNothing pattern** (lines 44-57):
```typescript
await db
  .insert(riskReversalObservations)
  .values(rows.map((row) => ({
    snapshotTime: row.snapshotTime,
    riskReversal: row.riskReversal !== null ? String(row.riskReversal) : null,
    rrRank: row.rrRank !== null ? String(row.rrRank) : null,
  })))
  .onConflictDoNothing();
return ok(undefined);
```

**Error wrapping pattern** (lines 58-62):
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

**Adaptation:** The GEX repo implements three ports: `ForReadingLegObsForGex` (JOIN `leg_observations` with `contracts` on `occ_symbol`, filter for latest `cycle_time`), `ForPersistingGexSnapshot` (single-row upsert with `onConflictDoNothing` on `cycle_time` PK, JSONB columns passed as JS objects), `ForReadingGexSnapshot` (read latest row ORDER BY `cycle_time DESC LIMIT 1`). JSONB columns (`profile`, `strikes`, `byExpiry`) are passed directly as JS objects — Drizzle's `jsonb()` column handles serialization.

---

### `packages/adapters/src/postgres/schema.ts` (config, CRUD — append)

**Analog:** `packages/adapters/src/postgres/schema.ts` (self, lines 110-140 — legObservations table)

**Import additions needed:**
```typescript
import { jsonb } from "drizzle-orm/pg-core";   // add to existing import line
```

**Table definition pattern** (lines 76-107 — calendarSnapshots with composite PK):
```typescript
export const calendarSnapshots = pgTable(
  "calendar_snapshots",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    calendarId: uuid("calendar_id").notNull(),
    spot: numeric("spot").notNull(),
    // ...
  },
  (table) => [primaryKey({ columns: [table.time, table.calendarId] })],
).enableRLS();
```

**Adaptation:** Add `gexSnapshots` table with `cycleTime` as a single-column `.primaryKey()` (not composite). JSONB for array columns:
```typescript
export const gexSnapshots = pgTable(
  "gex_snapshots",
  {
    cycleTime: timestamp("cycle_time", { withTimezone: true }).primaryKey(),
    spot: numeric("spot").notNull(),
    flip: numeric("flip"),           // nullable
    callWall: integer("call_wall"),  // nullable
    putWall: integer("put_wall"),    // nullable
    netGammaAtSpot: numeric("net_gamma_at_spot").notNull(),
    profile: jsonb("profile").notNull(),    // [{strike, gamma}]
    strikes: jsonb("strikes").notNull(),    // [{k, gex, coi, poi, vol}]
    byExpiry: jsonb("by_expiry").notNull(), // [{date, gex}]
  },
).enableRLS();
```

---

### `packages/adapters/src/postgres/migrations/0008_gex_snapshot.sql` (migration)

**Analog:** `packages/adapters/src/postgres/migrations/0007_analytics_observations.sql`

**Pattern** (full file — 32 lines):
```sql
CREATE TABLE "risk_reversal_observations" (
    "snapshot_time" timestamp with time zone NOT NULL,
    "underlying" varchar(16) NOT NULL,
    CONSTRAINT "..." PRIMARY KEY("snapshot_time","underlying","expiration")
);
--> statement-breakpoint
ALTER TABLE "risk_reversal_observations" ENABLE ROW LEVEL SECURITY;
```

**Adaptation:** Single table `gex_snapshots`, single-column primary key on `cycle_time`, JSONB columns use `jsonb` type:
```sql
CREATE TABLE "gex_snapshots" (
    "cycle_time" timestamp with time zone PRIMARY KEY,
    "spot" numeric NOT NULL,
    "flip" numeric,
    "call_wall" integer,
    "put_wall" integer,
    "net_gamma_at_spot" numeric NOT NULL,
    "profile" jsonb NOT NULL,
    "strikes" jsonb NOT NULL,
    "by_expiry" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gex_snapshots" ENABLE ROW LEVEL SECURITY;
```
Follow Phase 6 precedent: rename from drizzle-kit generated filename to `0008_gex_snapshot.sql`, update `meta/*.json` journal tag.

---

### `apps/server/src/config.ts` (config — append)

**Analog:** `apps/server/src/config.ts` (self, lines 3-22)

**Existing configSchema pattern** (lines 3-22):
```typescript
const configSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  MCP_BEARER_TOKEN: z.string().min(16, "MCP_BEARER_TOKEN must be at least 16 chars"),
  TOKEN_ENCRYPTION_KEY: z.string().min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 chars"),
  // ...
});
```

**Adaptation:** Append two fields to `configSchema`:
```typescript
SUPABASE_JWT_SECRET: z.string().min(32, "SUPABASE_JWT_SECRET must be at least 32 chars"),
WEB_ORIGIN: z.string().url("WEB_ORIGIN must be a valid URL"),
```
T-01-12: these secrets must never be logged — the existing `bootConfig()` already logs only field names on failure, so no change needed there.

---

### `apps/server/src/main.ts` (driving adapter — refactor + extend)

**Analog:** `apps/server/src/main.ts` (self)

**Current statement-style route wiring** ("before" — lines 170-184):
```typescript
// Build the Hono app
const app = new Hono();

// Mount HTTP routes
app.route("/api", statusRoutes(getStatus));
app.route("/api", calendarRoutes(registerCalendar, listCalendars, closeCalendar));
app.route("/api", journalRoutes(getJournal));
app.route("/api", brokerageRoutes(getPositions, getTransactions, getOrders));
app.route("/api", analyticsRoutes(getTermStructure, getSkew));

// JOB-01 / MCP-02: bearer-guarded jobs group
const jobsGroup = new Hono();
jobsGroup.use("/*", bearerAuth(config.MCP_BEARER_TOKEN));
jobsGroup.route("/", jobsRoutes(enqueueJob));
app.route("/api", jobsGroup);
```

**Jobs group pattern** (lines 181-184 — the existing bearer guard pattern):
```typescript
const jobsGroup = new Hono();
jobsGroup.use("/*", bearerAuth(config.MCP_BEARER_TOKEN));
jobsGroup.route("/", jobsRoutes(enqueueJob));
app.route("/api", jobsGroup);
```

**Adaptation — "after" pattern** (three changes):

1. Add imports at top:
```typescript
import { jwt } from "hono/jwt";
import { cors } from "hono/cors";
import { gexRoutes } from "./adapters/http/gex.routes.ts";
```

2. Apply CORS before all route groups (Pitfall 7 — must be first):
```typescript
app.use("/*", cors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));
```

3. Replace statement-style read routes with a chained sub-router (required for AppType inference — A5):
```typescript
const apiRouter = new Hono()
  .route("/", statusRoutes(getStatus))
  .route("/", calendarRoutes(registerCalendar, listCalendars, closeCalendar))
  .route("/", journalRoutes(getJournal))
  .route("/", brokerageRoutes(getPositions, getTransactions, getOrders))
  .route("/", analyticsRoutes(getTermStructure, getSkew))
  .route("/analytics", gexRoutes(getGex));

const authReadGroup = new Hono();
authReadGroup.use("/*", jwt({ secret: config.SUPABASE_JWT_SECRET, alg: "HS256" }));
authReadGroup.route("/", apiRouter);
app.route("/api", authReadGroup);

// Jobs group UNCHANGED — separate bearerAuth, not gated by Supabase Auth
const jobsGroup = new Hono();
jobsGroup.use("/*", bearerAuth(config.MCP_BEARER_TOKEN));
jobsGroup.route("/", jobsRoutes(enqueueJob));
app.route("/api", jobsGroup);
```

4. Add named export at bottom (after `export default { port, fetch: app.fetch }`):
```typescript
export type AppType = typeof app;
```

---

### `apps/server/src/adapters/http/gex.routes.ts` (driving adapter, request-response)

**Analog:** `apps/server/src/adapters/http/analytics.routes.ts`

**Full file pattern** (lines 1-88):
```typescript
import { Hono } from "hono";
import { termStructureResponse, skewResponse } from "@morai/contracts";
import type { ForRunningGetTermStructure, ForRunningGetSkew } from "@morai/core";

export function analyticsRoutes(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew,
) {
  const router = new Hono();
  router.get("/analytics/term-structure", async (c) => {
    const result = await getTermStructure(query);
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(termStructureResponse.parse(result.value.map((row) => ({ ... }))));
  });
  return router;
}
```

**Adaptation:** GEX route is `GET /analytics/gex` (no query params — returns latest snapshot). No-snapshot case returns 404 with `{ error: "no-snapshot" }` (not 500):
```typescript
import { Hono } from "hono";
import { gexSnapshotResponse } from "@morai/contracts";
import type { ForRunningGetGex } from "@morai/core";

export function gexRoutes(getGex: ForRunningGetGex) {
  const router = new Hono();
  router.get("/gex", async (c) => {
    const result = await getGex();
    if (!result.ok) return c.json({ error: "internal" }, 500);
    if (result.value === null) return c.json({ error: "no-snapshot" }, 404);
    return c.json(gexSnapshotResponse.parse(result.value));
  });
  return router;
}
```

---

### `apps/server/src/adapters/mcp/tools.ts` (driving adapter — append `registerGetGexTool`)

**Analog:** `apps/server/src/adapters/mcp/tools.ts` (self, lines 224-269 — `registerGetTermStructureTool` is the closest: no input params, returns single payload)

**No-params tool pattern** (lines 38-69 — `registerStatusTool`):
```typescript
export function registerStatusTool(server: McpServer, getStatus: ForGettingStatus): void {
  server.registerTool(
    "get_status",
    { title: "...", description: "...", inputSchema: {} },
    async () => {
      const result = await getStatus();
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
```

**Adaptation:** `get_gex` takes no input (`inputSchema: {}`). Handle the `null` (no-snapshot) case explicitly — return a structured `{ error: "no-snapshot" }` JSON, never throw:
```typescript
export function registerGetGexTool(server: McpServer, getGex: ForRunningGetGex): void {
  server.registerTool("get_gex", { title: "Get GEX", description: "...", inputSchema: {} }, async () => {
    const result = await getGex();
    if (!result.ok) return { content: [{ type: "text" as const, text: "internal error" }] };
    if (result.value === null) return { content: [{ type: "text" as const, text: JSON.stringify({ error: "no-snapshot" }) }] };
    const payload = gexSnapshotResponse.parse(result.value);
    return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
  });
}
```

---

### `apps/worker/src/handlers/compute-gex-snapshot.ts` (driving adapter, event-driven)

**Analog:** `apps/worker/src/handlers/compute-analytics.ts` (exact match — same pattern)

**Full analog** (44 lines):
```typescript
import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningComputeAnalytics } from "@morai/core";

type ComputeAnalyticsHandlerDeps = {
  readonly computeAnalyticsUseCase: ForRunningComputeAnalytics;
  readonly now: () => Date;
};

export function makeComputeAnalyticsHandler(
  deps: ComputeAnalyticsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    if (job === undefined) return;
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("compute-analytics: skipping — outside RTH or NYSE holiday");
      return;
    }
    const result = await deps.computeAnalyticsUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    // Terminal job — no boss.send.
  };
}
```

**Adaptation:** Copy verbatim, replacing `computeAnalytics` → `computeGexSnapshot`. GEX is the NEW terminal job; add a `boss` dep (like `snapshot-calendars.ts`) if chaining to a future job — for now it is terminal. Add `BossForChainHandler` import only if the research confirms chaining. The RTH+holiday gate is identical.

---

### `apps/worker/src/schedule.ts` (config — append)

**Analog:** `apps/worker/src/schedule.ts` (self, lines 45-135)

**AllHandlers pattern** (lines 45-55):
```typescript
export type AllHandlers = {
  readonly fetchSchwabChain: PgBossHandler;
  // ... 9 entries
  readonly rebuildJournal: PgBossHandler;
};
```

**createQueue + work pattern** (lines 68-134):
```typescript
await boss.createQueue("compute-analytics"); // chain-triggered; no cron
// ...
await boss.work("compute-analytics", POLLING_INTERVAL, handlers.computeAnalytics);
```

**Adaptation:** Three additive changes:
1. Add `computeGexSnapshot: PgBossHandler` to `AllHandlers` type.
2. Add `await boss.createQueue("compute-gex-snapshot");` in Phase 1 (all createQueue before schedule/work — CR-01).
3. Add `await boss.work("compute-gex-snapshot", POLLING_INTERVAL, handlers.computeGexSnapshot);` in Phase 3. No cron — chain-triggered only by `compute-analytics`.

---

## Shared Patterns

### Auth Middleware (bearerAuth — existing, preserved unchanged)

**Source:** `apps/server/src/adapters/mcp/bearer.ts` (lines 1-19)
**Apply to:** Jobs group only (unchanged). The `bearerAuth` function is the existing MCP bearer pattern; do NOT apply it to the new read group.

```typescript
export function bearerAuth(token: string): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header("Authorization");
    if (auth !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
```

### Supabase Auth Middleware (new — hono/jwt)

**Source:** RESEARCH.md Pattern 1 + Hono 4.x built-in `hono/jwt`
**Apply to:** All read endpoint groups in `apps/server/src/main.ts`
**Key constraint:** CORS middleware (`hono/cors`) must be applied BEFORE the JWT middleware group (Pitfall 7).

```typescript
import { jwt } from "hono/jwt";
// Inside the auth group:
authReadGroup.use("/*", jwt({ secret: config.SUPABASE_JWT_SECRET, alg: "HS256" }));
```

### Error Handling

**Source:** `apps/server/src/adapters/http/analytics.routes.ts` (lines 36-37, 64-65)
**Apply to:** All new HTTP routes
```typescript
if (!result.ok) {
  return c.json({ error: "internal" }, 500);
}
```
GEX adds a second case: `if (result.value === null) return c.json({ error: "no-snapshot" }, 404);`

### onConflictDoNothing (idempotent writes)

**Source:** `packages/adapters/src/postgres/repos/risk-reversal-observations.ts` (lines 44-62)
**Apply to:** `gex-snapshot.repo.ts` insert method
```typescript
await db.insert(table).values(row).onConflictDoNothing();
return ok(undefined);
```

### Port error type (StorageError)

**Source:** `packages/core/src/analytics/application/ports.ts` (lines 10-14)
**Apply to:** All new GEX ports in `packages/core/src/analytics/application/ports.ts`
```typescript
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};
```
Use the existing `StorageError` defined in the analytics ports file — do not define a new one.

### pg-boss handler pattern

**Source:** `apps/worker/src/handlers/compute-analytics.ts` (full file, 44 lines)
**Apply to:** `apps/worker/src/handlers/compute-gex-snapshot.ts`

Array-guard + RTH+holiday gate + use-case call + throw-on-error. This pattern is non-negotiable per architecture-boundaries.md §3.

### MCP tool registration pattern (no-input)

**Source:** `apps/server/src/adapters/mcp/tools.ts` lines 38-69 (`registerStatusTool`)
**Apply to:** `registerGetGexTool` in the same file

`inputSchema: {}`, `async () => { ... }`, always return `{ content: [{ type: "text" as const, text: ... }] }`.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/src/analytics/domain/gex.ts` | domain | transform | Pure GEX math (sumGamma, flipLevel, profileGrid) has no existing analog; `bsm.ts` provides function style only. Primary reference is `mockups/playground-v3.html` (oracle algorithm) and `mockups/gex-snapshot.json` / `mockups/gex-profile.json` (oracle values). |
| `packages/adapters/src/memory/gex-snapshot.memory.ts` | driven adapter | CRUD | No existing memory adapters were read in this session; follow the driven-port interface exactly (architecture-boundaries.md §8 — in-memory twin required). |

---

## Metadata

**Analog search scope:** `apps/server/src/`, `apps/worker/src/handlers/`, `apps/worker/src/schedule.ts`, `packages/contracts/src/`, `packages/core/src/analytics/application/`, `packages/adapters/src/postgres/`
**Files scanned:** 14 source files read directly
**Pattern extraction date:** 2026-06-24

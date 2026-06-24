# Phase 8: Web Dashboard Backend — GEX endpoint, contract, RPC export, Supabase Auth + CORS - Research

**Researched:** 2026-06-24
**Domain:** Hono API, Supabase Auth JWT, GEX gamma-exposure computation, pg-boss job pattern, Drizzle migration, AppType RPC export
**Confidence:** HIGH (codebase verified) / MEDIUM (Hono/Supabase JWT patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (GEX compute strategy):** Snapshot-job, not on-read. A scheduled pg-boss job computes the full GEX payload from the latest `leg_observations` each RTH snapshot cycle and writes one `gex_snapshot` row. The endpoint serves the most recent stored row (cheap read). Re-run within a cycle is idempotent (0 duplicate rows).
- **D-02 (Auth):** Supabase Auth (full login) gates the read endpoints. The API verifies a Supabase Auth JWT/session on read endpoints; unauthenticated → 401. CORS allows the Vercel web origin only. **Single account (the trader); signups closed.**
- **D-02a (Doc gate):** The Supabase-Auth deferral in `docs/architecture/stack-decisions.md` (D18 + deferred-features note) MUST be updated before auth code lands. New ADR or extended D18 row.
- **D-03 (MCP-02 cross-cut):** The GEX use-case ships both an HTTP route and an MCP tool (`get_gex`) in the same change.
- **D-04 (Hexagon boundary):** GEX is a new application use-case: core port + domain computation (reuse BSM), driven adapter (read `leg_observations`, persist `gex_snapshot`), and driving adapters (HTTP route + MCP tool + job handler). `core` imports `shared` only.
- **D-05 (Phasing):** Backend (Phase 8) before frontend (Phase 9).
- **D-06 (Refresh model):** Frontend will auto-poll via TanStack `refetchInterval`. Recorded here, implemented in Phase 9.

### Claude's Discretion

Endpoint path/naming and MCP tool name, exact port/interface shapes, the `gex_snapshot` migration, the CORS allowed-origins config mechanism, and the Supabase-JWT-verification middleware mechanism are left to research + planning.

### Deferred Ideas (OUT OF SCOPE)

`apps/web` scaffold, the five screens, auto-poll wiring, Supabase Auth login UI, per-calendar rebuild button (REBUILD-01), pre-Jun-12 journal UX (JOURNAL-01), coming-soon stubs. Charm/Vanna, intraday delta-flow, economic-calendar feed.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GEX-01 | Scheduled pg-boss job computes full GEX payload (net gamma profile, flip level, call/put walls, by-strike, by-expiry) from `leg_observations` and writes one `gex_snapshot` row per RTH cycle | Sections: GEX Computation, Idempotent Snapshot Job |
| GEX-02 | Zod contract `gexSnapshot` in `packages/contracts/src/gex.ts`: `{ spot, flip, callWall, putWall, netGammaAtSpot, profile[], strikes[], byExpiry[] }` | Section: Standard Stack / GEX Contract Shape |
| RPC-01 | `AppType` exported from `apps/server` for `hc<AppType>()` RPC client in `apps/web` | Section: Hono AppType Export |
| AUTH-01 | Supabase Auth JWT verification middleware on read endpoints; CORS for Vercel origin; unauthenticated → 401 | Section: Supabase Auth JWT Verification, CORS |
| SC-4 (idempotency) | Re-run of the snapshot job within the same cycle produces 0 duplicate rows | Section: Idempotent Snapshot Job |
| POSITIONS-01 | Confirm whether `GET /api/positions` returns computed greeks or raw | Section: POSITIONS-01 Gap |
</phase_requirements>

---

## Summary

Phase 8 builds the entire backend surface the React SPA (Phase 9) will consume: one new GEX analytics endpoint, a scheduled snapshot job that produces it, a Zod contract, the `AppType` RPC export, and Supabase Auth + CORS on the existing read endpoints. No frontend code.

The codebase is mature and patterns are consistent. Every question in this phase has a direct codebase analog to follow. The six research unknowns all have concrete, implementable answers:

1. **Supabase Auth JWT** — verify with Hono's built-in `jwt()` middleware using the Supabase project's JWT secret (HS256, shared symmetric key) obtained from Supabase dashboard. No JWKS needed for single-account; offline HS256 verify is a clean one-liner. The secret goes in `SUPABASE_JWT_SECRET` env var.
2. **CORS** — `hono/cors` ships in Hono 4.12+. `cors({ origin: config.WEB_ORIGIN, credentials: true })` applied before route groups. `WEB_ORIGIN` is a new required env var.
3. **Idempotent snapshot job** — `gex_snapshot` table uses a unique key on `cycle_time` (the snapped-to-30-min timestamp matching `leg_observations` cycles). Drizzle `onConflictDoNothing` on that column = zero duplicates on re-run.
4. **`gex_snapshot` schema** — `cycle_time` (PK), `spot`, `flip`, `call_wall`, `put_wall`, `net_gamma_at_spot` as numeric columns, `profile`, `strikes`, `by_expiry` as JSONB columns. This matches the contract shape and avoids the 65,534-param insert ceiling.
5. **GEX computation** — sum `bsmGamma × openInterest × spot² × 0.01` per contract from `leg_observations` at the latest cycle; the existing `bsmGreeks()` engine is the tool. Net profile is computed by re-pricing over a spot grid. Flip level = zero-crossing of the cumulative gamma profile. Reference oracle: playground-v3 values (γ-flip 7488, net −47 $Bn/1%, call wall 7600, put wall 7400).
6. **`AppType` export** — Hono 4.x supports full end-to-end type inference when routes are chained via `.route()`. The app in `apps/server/src/main.ts` must export `typeof app` as `AppType`.
7. **MCP-02** — `get_gex` tool registers in `apps/server/src/adapters/mcp/tools.ts` exactly as all other MCP tools. The same `gexSnapshotResponse` Zod schema is shared.

**Primary recommendation:** Follow the `computeAnalytics` handler + `analytics.routes.ts` pattern exactly. GEX is structurally identical to the analytics use-case (schedule-free job triggered by the chain, one new table, one new read endpoint, MCP-02 cross-cut), with the addition of a Supabase Auth middleware layer applied to the /api read group.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GEX computation (gamma sum, flip level, walls) | API/Backend (core domain) | — | Pure math over stored chain data; belongs in hexagon, not browser |
| GEX snapshot persistence | Database/Storage (driven adapter) | — | One `gex_snapshot` row per RTH cycle; Drizzle in adapters package |
| GEX scheduled job (compute trigger) | API/Backend (worker driving adapter) | — | pg-boss job handler; follows existing `compute-analytics` pattern |
| GEX read endpoint + MCP tool | API/Backend (driving adapters) | — | Thin adapters over the same use-case; MCP-02 dual-surface |
| Supabase Auth JWT verification | API/Backend (Hono middleware) | — | Server-side JWT verify; never in browser or frontend |
| CORS configuration | API/Backend (Hono middleware) | — | `Access-Control-Allow-Origin` belongs on the API server |
| `AppType` export for RPC client | API/Backend (apps/server) | Frontend (apps/web) | The type flows from server → web at build time; server owns the definition |
| GEX Zod contract | packages/contracts | — | Single schema source for HTTP route + MCP tool (MCP-02) |

---

## Standard Stack

### Core (existing — no new installs)
| Library | Version (installed) | Purpose | Why Standard |
|---------|---------------------|---------|--------------|
| hono | 4.12.23 (^4.12.27 current) | HTTP, cors middleware, jwt middleware | Already in use; `hono/cors` and `hono/jwt` ship built-in |
| drizzle-orm | pinned in adapters | New `gex_snapshot` table + JSONB columns, onConflictDoNothing | Already used for all other tables |
| zod | ^4.4.3 | GEX contract shape validation | MCP-02 pattern; all existing contracts use Zod v4 |
| pg-boss | ^12.18.3 | `compute-gex-snapshot` job queue | Existing job infra; identical to `compute-analytics` job |

No new npm packages are required. All needed tools are already installed.

### New env vars required

| Env Var | Service | Required By |
|---------|---------|-------------|
| `SUPABASE_JWT_SECRET` | server | Hono jwt() middleware to verify Supabase Auth JWTs (HS256) |
| `WEB_ORIGIN` | server | CORS allowed origin; value = Vercel web URL, e.g. `https://morai.vercel.app` |

Both vars must be added to the `configSchema` in `apps/server/src/config.ts` and to Railway env.

### Package Legitimacy Audit

> All packages used in Phase 8 are already installed in this codebase. No new packages are being added.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| hono | npm (4.12.23 installed) | Already in use | Approved (existing) |
| drizzle-orm | npm (already in adapters) | Already in use | Approved (existing) |
| @supabase/supabase-js | npm (not installed — NOT needed) | Not installed, not needed | N/A — JWT verification uses Hono's built-in jwt() middleware with the Supabase JWT secret |
| zod | npm (^4.4.3 installed) | Already in use | Approved (existing) |
| pg-boss | npm (^12.18.3 installed) | Already in use | Approved (existing) |

**No new packages install required for Phase 8.**

*Note: `hono` and `@supabase/supabase-js` are flagged `SUS` by the legitimacy seam due to "too-new" (published within 90 days at check time — recent version releases). Both are 50M+/week download packages with official source repos and are already verified in use. The `SUS` flag reflects version freshness, not package legitimacy.*

---

## Architecture Patterns

### System Architecture Diagram

```
  leg_observations (DB)
        │
        ▼
  [compute-gex-snapshot job] ← chain-triggered by compute-analytics (or direct cron)
        │
        ▼
  gex_snapshot (DB) — one row per cycle_time, JSONB payload
        │
        ▼
  makeGetGexUseCase (core/analytics/application)
        │
        ├──▶ GET /api/analytics/gex (gex.routes.ts) ←── Supabase Auth JWT middleware
        │                                               ← CORS middleware (WEB_ORIGIN)
        └──▶ get_gex MCP tool (tools.ts)

  apps/server/src/main.ts
        └── exports typeof app as AppType ──▶ apps/web hc<AppType>() client
```

Data enters via the pg-boss job (driven by the existing snapshot chain), flows through the domain use-case, and exits through two driving adapters (HTTP + MCP). The Auth middleware layer gates all read-endpoint groups.

### Recommended Project Structure (new files only)

```
packages/
  contracts/src/
    gex.ts                          # NEW: gexSnapshotEntry + gexSnapshotResponse Zod schema
    index.ts                        # Updated: export gex types
  core/src/analytics/
    application/
      getGex.ts                     # NEW: makeGetGexUseCase use-case factory
      getGex.test.ts                # NEW: unit tests (in-memory twin)
      computeGexSnapshot.ts         # NEW: makeComputeGexSnapshotUseCase
      computeGexSnapshot.test.ts    # NEW: unit + property tests (oracle check)
      ports.ts                      # Updated: ForReadingGexSnapshot, ForPersistingGexSnapshot,
                                    #          ForReadingLegObsForGex, ForRunningGetGex,
                                    #          ForRunningComputeGexSnapshot
    domain/
      gex.ts                        # NEW: pure GEX math (sumGamma, flipLevel, profileGrid)
      gex.test.ts                   # NEW: oracle property tests
  adapters/src/postgres/
    gex-snapshot.repo.ts            # NEW: Postgres implementation of ForPersistingGexSnapshot +
                                    #      ForReadingGexSnapshot + ForReadingLegObsForGex
    gex-snapshot.repo.test.ts       # NEW: testcontainers integration test
    schema.ts                       # Updated: gexSnapshots table
    migrations/
      0008_gex_snapshot.sql         # NEW: CREATE TABLE gex_snapshots
  adapters/src/memory/
    gex-snapshot.memory.ts          # NEW: in-memory twin (required by architecture-boundaries rule)

apps/
  server/src/
    config.ts                       # Updated: SUPABASE_JWT_SECRET, WEB_ORIGIN env vars
    main.ts                         # Updated: AppType export, CORS middleware, Supabase Auth
                                    #          middleware group, GEX route + MCP tool wiring
    adapters/
      http/
        gex.routes.ts               # NEW: GET /api/analytics/gex route
      mcp/
        tools.ts                    # Updated: registerGetGexTool added
  worker/src/
    handlers/
      compute-gex-snapshot.ts       # NEW: makeComputeGexSnapshotHandler (RTH + holiday gate)
      compute-gex-snapshot.test.ts  # NEW: handler unit tests
    schedule.ts                     # Updated: compute-gex-snapshot queue + chain trigger
    main.ts                         # Updated: wire makeComputeGexSnapshotHandler
```

### Pattern 1: Hono JWT Middleware for Supabase Auth (offline HS256 verify)

**What:** Verify Supabase Auth JWTs using Hono's built-in `jwt()` middleware with the project's JWT secret (HS256 symmetric key). No Supabase SDK needed on the server for token verification.

**Why HS256 (not RS256):** Supabase Auth issues JWTs signed with HS256 using the project JWT secret (visible in Supabase Dashboard → Settings → API → JWT Secret). This is a symmetric shared key. Offline verification requires only the secret — no JWKS endpoint, no network call.

**Env:** `SUPABASE_JWT_SECRET` — a 32+ char hex string from the Supabase dashboard.

**Pattern (matches bearerAuth usage in main.ts):**

```typescript
// Source: Hono 4.x built-in middleware (hono/middleware/jwt)
// Applied as a Hono middleware group, exactly as jobsGroup uses bearerAuth

import { jwt } from "hono/jwt";

// In apps/server/src/main.ts — Supabase Auth-gated read group
const readGroup = new Hono();
readGroup.use("/*", jwt({
  secret: config.SUPABASE_JWT_SECRET,
  alg: "HS256",
}));
readGroup.route("/", statusRoutes(getStatus));
readGroup.route("/", calendarRoutes(registerCalendar, listCalendars, closeCalendar));
readGroup.route("/", journalRoutes(getJournal));
readGroup.route("/", brokerageRoutes(getPositions, getTransactions, getOrders));
readGroup.route("/", analyticsRoutes(getTermStructure, getSkew));
readGroup.route("/", gexRoutes(getGex));
app.route("/api", readGroup);
```

No/invalid JWT → Hono's `jwt()` middleware throws an `HTTPException(401)` internally. The existing `bearerAuth` pattern at `/api/jobs/*` is preserved unchanged (separate group).

**Supabase Auth client (D-09 UI-SPEC context):** The Supabase Auth client in `apps/web` (Phase 9) gets the session JWT via `@supabase/ssr`. The web client sends `Authorization: Bearer <access_token>` on every request. The server verifies this JWT offline with the secret.

**Key constraint:** `SUPABASE_JWT_SECRET` must be treated as a secret. Add to `config.ts` `configSchema` as `z.string().min(32)`. Never log its value.

### Pattern 2: Hono CORS Middleware

**What:** `hono/cors` middleware restricts the `Access-Control-Allow-Origin` header to the Vercel web origin. Applied before route groups at the top level.

**Pattern:**

```typescript
// Source: Hono 4.x built-in cors middleware (hono/middleware/cors)
import { cors } from "hono/cors";

// Applied at the top of the app, before route mounting
app.use("/*", cors({
  origin: config.WEB_ORIGIN,   // e.g. "https://morai.vercel.app"
  credentials: true,            // required for Authorization header forwarding
  allowMethods: ["GET", "POST", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
```

`WEB_ORIGIN` must be a new config field: `z.string().url()` in `configSchema`. For local dev, set it to `"http://localhost:5173"` (Vite default).

**Credentials note:** With `credentials: true`, the origin must be exact (not `*`). The function-based `origin` option (accepts a function `(origin) => origin | null`) is also available when multiple origins are needed (e.g., localhost + production). For Phase 8, a single-string origin is sufficient since signups are closed.

### Pattern 3: Idempotent GEX Snapshot Job

**What:** The job handler follows the `makeComputeAnalyticsHandler` pattern exactly. The key idempotency mechanism is the `cycle_time` unique constraint on `gex_snapshots` + Drizzle `onConflictDoNothing`.

**Cycle time:** The "30-min slot" timestamp is computed by flooring `now` to the nearest 30-minute boundary:

```typescript
// Source: codebase pattern (analogous to analytics cycle resolution in computeAnalytics.ts)
function snapCycleTime(now: Date): Date {
  const ms = now.getTime();
  const slotMs = 30 * 60 * 1000;
  return new Date(Math.floor(ms / slotMs) * slotMs);
}
```

Re-running within the same cycle produces the same `cycle_time` → `onConflictDoNothing` → zero duplicate rows (idempotent).

**Chain trigger:** The job is chain-triggered from `compute-analytics` (or directly from `snapshot-calendars` if we want GEX computed every snapshot cycle regardless of whether analytics ran). Recommend chain-triggering from `compute-analytics` since GEX also needs the fresh `leg_observations` data. The pattern is identical to `boss.send("compute-analytics", {}, { singletonKey: "triggered-by-snapshot" })`.

**Schedule registration pattern:**

```typescript
// In apps/worker/src/schedule.ts — add to AllHandlers and registerAllJobs
await boss.createQueue("compute-gex-snapshot");
// No cron schedule — chain-triggered only by compute-analytics
await boss.work("compute-gex-snapshot", POLLING_INTERVAL, handlers.computeGexSnapshot);
```

### Pattern 4: `gex_snapshot` Drizzle Migration

**What:** One new table. JSONB for the array columns avoids the 65,534-parameter insert ceiling (a Phase 2 lesson). Numeric columns for the scalar GEX fields.

**Drizzle schema:**

```typescript
// Source: packages/adapters/src/postgres/schema.ts pattern (matching analytics tables)
export const gexSnapshots = pgTable(
  "gex_snapshots",
  {
    cycleTime: timestamp("cycle_time", { withTimezone: true }).primaryKey(),
    spot: numeric("spot").notNull(),
    flip: numeric("flip"),           // nullable — may not exist (zero-crossing absent)
    callWall: integer("call_wall"),  // nullable
    putWall: integer("put_wall"),    // nullable
    netGammaAtSpot: numeric("net_gamma_at_spot").notNull(),
    // JSONB for array columns — avoids 65,534-param ceiling (Phase 2 lesson)
    profile: jsonb("profile").notNull(),      // [{strike: number, gamma: number}]
    strikes: jsonb("strikes").notNull(),      // [{k, gex, coi, poi, vol}]
    byExpiry: jsonb("by_expiry").notNull(),   // [{date: string, gex: number}]
  },
).enableRLS();
```

Migration filename: `0008_gex_snapshot.sql`. Follow Phase 6 precedent: rename from drizzle-kit generated name, update `meta/*.json` journal tag.

**JSONB insert pattern in Drizzle:**

```typescript
// Source: drizzle-orm Postgres JSONB pattern (verified: drizzle-orm 0.41+ supports jsonb)
import { jsonb } from "drizzle-orm/pg-core";

// Insert with jsonb:
db.insert(gexSnapshots).values({
  cycleTime: cycleTime,
  spot: row.spot.toString(),
  flip: row.flip !== null ? row.flip.toString() : null,
  // ...
  profile: row.profile,    // JS object/array → stored as JSONB
  strikes: row.strikes,
  byExpiry: row.byExpiry,
}).onConflictDoNothing();
```

### Pattern 5: GEX Computation Algorithm

**Source:** `mockups/playground-v3.html` (oracle) and `mockups/gex-snapshot.json` + `mockups/gex-profile.json`.

**Oracle values (from playground-v3 + gex-profile.json):**
- spot: 7381
- flip: 7488 (from gex-profile.json)
- netGammaAtSpot: −47 $Bn/1% (atSpot=-47 from gex-profile.json)
- callWall: 7600 (max positive aggregate GEX strike)
- putWall: 7400 (max absolute-value negative GEX strike)

**Algorithm (from gex-snapshot.json analysis — per-strike aggregate data):**

The `gex_snapshot.json` already contains pre-computed per-strike GEX values (the `gex` field per strike row). The domain computation reads the latest `leg_observations` at the cycle time, groups by strike, and computes:

```
// For each (strike, expiry) in leg_observations at the latest cycle_time:
// GEX_per_contract = gamma × OI × spot² × 0.01 × multiplier(100)
//   gamma = bsmGamma (BSM-computed per-contract gamma, already in leg_observations)
//   OI = openInterest
//   multiplier = 100 (SPX contracts)
//   spot² × 0.01 = dollar-per-1%-move scaling
//
// Per-strike net GEX = sum(calls GEX) + sum(puts GEX)
//   calls contribute positive, puts contribute negative
//   (dealer is short calls → long gamma; short puts → short gamma from dealer perspective)
//
// Net total GEX (dealer) = sum of all per-strike GEX values
// callWall = argmax of positive GEX strikes
// putWall = argmax(abs) of negative GEX strikes
// flip = strike where net cumulative GEX crosses zero (linear interpolation)
//
// Profile grid: for each spot S in [spot-600, spot+600] step 20:
//   re-price gamma at that spot using bsmGreeks(S, K, T, iv, r, q, type)
//   netGamma(S) = sum over all contracts of: gamma(S) × OI × S² × 0.01 × 100
//   netGammaAtSpot = netGamma(current spot) in $Bn/1% (divide by 1e9)
```

**Key insight on `byExpiry`:** Group per-strike GEX further by expiration date → `byExpiry[{date, gex}]` is the per-expiry sum. This allows the frontend to show a bar chart of gamma concentration by expiry date.

**BSM engine reuse:** The existing `bsmGreeks()` in `packages/core/src/journal/domain/bsm.ts` is the correct tool. For the profile grid computation, call `bsmGreeks(S, K, T, bsmIv, r, q, type)` for each contract at each spot grid point. The `bsmIv` column in `leg_observations` is already the per-contract IV (computed by Phase 3 `compute-bsm-greeks` job).

**Port shape for `ForReadingLegObsForGex`:**

```typescript
// The driven adapter port for GEX reads — analogous to ForReadingPendingObs
export type LegObsForGex = {
  readonly time: Date;
  readonly contract: OccSymbol;
  readonly underlyingPrice: number;
  readonly bsmGamma: string | null;   // numeric string or 'NaN'
  readonly bsmIv: string | null;
  readonly openInterest: number;
  readonly contractType: "C" | "P";
  readonly strike: number;       // ×1000 int (e.g. 7100000)
  readonly expiration: string;   // YYYY-MM-DD
};

export type ForReadingLegObsForGex = () => Promise<
  Result<ReadonlyArray<LegObsForGex>, StorageError>
>;
```

The repo implementation joins `leg_observations` with `contracts` to get `contractType`, `strike`, `expiration` for each observation. It reads only the latest cycle (same pattern as `readSnapshotsForCycle` in Phase 6).

### Pattern 6: Hono AppType Export

**What:** Export `typeof app` from `apps/server/src/main.ts` so `apps/web` can use `hc<AppType>()` for end-to-end type safety.

**Requirements:**
1. The `app` must be a fully-typed `Hono` instance with all routes chained via `.route()`.
2. The main.ts file currently exports a Bun-style default `{ port, fetch: app.fetch }`. The `AppType` export is an additional named export.
3. All routes mounted via `app.route("/api", router)` contribute to the AppType inference — but ONLY routes mounted directly on `app`. Routes mounted on a sub-group (`jobsGroup`, `readGroup`) that is then mounted on `app` ARE included, because `.route()` preserves the type.

**Pattern:**

```typescript
// apps/server/src/main.ts — add named export at the bottom (after existing default export)
export type AppType = typeof app;

// apps/web/src/client.ts (Phase 9) — usage:
import { hc } from "hono/client";
import type { AppType } from "@morai/server";
const client = hc<AppType>("https://api.morai.app");
```

**Chaining requirement:** Hono's RPC type inference requires that each `.route()` call returns a typed `Hono` instance. The existing pattern in `main.ts` does NOT chain routes — it calls `app.route(...)` as statements. For AppType to carry full route type information, the chain must be:

```typescript
// Option A (minimal change): use a typed app variable for RPC routes only
// Route the RPC-relevant routes through a typed sub-router that gets mounted on app.
// The existing statement-style calls still work but AppType won't include them.
// RECOMMENDED: wrap all API routes in one chained sub-router.

const apiRouter = new Hono()
  .route("/", statusRoutes(getStatus))
  .route("/", calendarRoutes(...))
  .route("/", journalRoutes(getJournal))
  .route("/", brokerageRoutes(...))
  .route("/", analyticsRoutes(...))
  .route("/analytics", gexRoutes(getGex))
  .route("/jobs", jobsGroup);

app.route("/api", apiRouter);
export type AppType = typeof app;
```

The `hc()` client in Phase 9 will then have full type inference for all API routes.

**tsconfig implications:** `apps/web` must be able to import `type { AppType } from "@morai/server"`. This requires:
- `@morai/server` has a `types` or `exports` field pointing to `src/main.ts` in the package.json, OR
- `apps/web` imports via a relative path / workspace reference.
- Since `apps/server` is `"module": "src/main.ts"` (Bun entry), Vite/TypeScript must resolve the type. The safest approach for Phase 9 is a direct import path; document in the Phase 9 research.

### Pattern 7: GEX Contract Shape

**Target (from CONTEXT.md Specifics and UI-SPEC GEX-02):**

```typescript
// packages/contracts/src/gex.ts
import { z } from "zod";

export const gexWallEntry = z.object({
  k: z.number().int(),
  gex: z.number(),
  coi: z.number().int(),
  poi: z.number().int(),
  vol: z.number().int(),
});

export const gexSnapshotEntry = z.object({
  spot: z.number(),
  flip: z.number().nullable(),
  callWall: z.number().int().nullable(),
  putWall: z.number().int().nullable(),
  netGammaAtSpot: z.number(),
  profile: z.array(z.object({ strike: z.number(), gamma: z.number() })),
  strikes: z.array(gexWallEntry),
  byExpiry: z.array(z.object({ date: z.string(), gex: z.number() })),
  computedAt: z.string().datetime(),  // ISO string of cycle_time
});

export type GexSnapshotEntry = z.infer<typeof gexSnapshotEntry>;

// The HTTP route and MCP tool both return a single entry (not an array)
export const gexSnapshotResponse = gexSnapshotEntry;
export type GexSnapshotResponse = GexSnapshotEntry;
```

**Endpoint:** `GET /api/analytics/gex` → returns `gexSnapshotEntry` | `{ error: "no-snapshot" }` with 404 when no snapshot exists yet.
**MCP tool:** `get_gex` → same contract shape via `gexSnapshotResponse.parse(...)`.

### Pattern 8: docs-before-code update

**MANDATORY before any auth code lands** (D-02a, workflow.md rule):

1. Update `docs/architecture/stack-decisions.md` — extend D18 to document the Supabase Auth decision: what changed (un-defer Auth), why (web dashboard behind login), how it's implemented (HS256 JWT verification with Supabase JWT secret, NOT Supabase RLS/SDK coupling), swap cost impact (low — still just a JWT verify, swappable to any auth provider).
2. Add a short ADR note in the D18 section body, referencing Phase 8 and CONTEXT.md D-02.

### Anti-Patterns to Avoid

- **Calling `supabase.auth.getUser(token)` on every request:** This makes a network call to Supabase on every API request. Use offline JWT verification (Hono `jwt()` with the HS256 secret) instead. Network calls in middleware create latency and availability dependency.
- **Using `origin: "*"` with `credentials: true`:** Browsers reject this combination. Always use the exact origin string.
- **Re-computing GEX on every HTTP request:** Explicitly forbidden by D-01. The endpoint is a DB read of a cached snapshot row, not a computation.
- **Storing profile/strikes/byExpiry as individual DB rows:** Leads to the 65,534-param ceiling. JSONB columns are the correct choice for these arrays.
- **Not joining `leg_observations` with `contracts` for GEX reads:** The `leg_observations` table does not store `contractType`, `strike`, or `expiration` directly — those live in the `contracts` table. The repo must JOIN `leg_observations` with `contracts` on `occ_symbol` to get the fields needed for GEX computation.
- **Exporting AppType without chaining routes:** Hono's type inference only propagates through `.route()` chains, not statement-style `app.route()` calls without reassignment.
- **Applying Supabase Auth middleware to `/api/jobs/*`:** The jobs group already uses `bearerAuth` (MCP bearer token). Keep them separate; do not layer both middlewares.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT verification | Custom JWT decoder | `hono/jwt` middleware | Hono 4.x ships this built-in; handles exp/iat/aud checks + 401 |
| CORS headers | Manual `c.res.headers.set(...)` | `hono/cors` middleware | Handles preflight OPTIONS, all headers correctly |
| Gamma math (individual contracts) | Re-derive bsmGreeks | `bsmGreeks()` from `packages/core/src/journal/domain/bsm.ts` | BSM engine already property-tested (BSM-02); do not re-derive |
| IV inversion | Re-derive invertIv | `invertIv()` from `packages/core/src/journal/domain/iv-inversion.ts` | Already validated round-trip (BSM-01) |
| JSONB serialization | Manual JSON.stringify in SQL | Drizzle `jsonb()` column type | Handles serialization transparently |
| Job scheduling | Manual `setTimeout` or cron | pg-boss `createQueue` / `work` / chain via `boss.send` | Existing infra handles dedup, retries, crash recovery |
| Cycle time flooring | Custom date math | Extract pattern from analytics `computeAnalytics.ts` seam | Already solved in Phase 6 cycle resolution |

---

## POSITIONS-01 Gap Analysis

From the UI-SPEC Backend Data Gaps table: "Confirm whether `GET /api/positions` returns computed greeks or raw (may need a read-through-BSM layer)."

**Finding (ASSUMED — confirmed by code inspection):** The existing `GET /api/positions` route (via `getPositions` → `makeSchwabPositionsAdapter`) returns the raw Schwab positions response, which includes Schwab-reported greeks (vendor-raw, not BSM-computed). The `positionsResponse` Zod contract in `packages/contracts/src/brokerage.ts` mirrors Schwab's field names.

**Decision needed:** Phase 8 should confirm whether the Positions screen requires BSM-recomputed greeks. Based on the architecture, the simplest path is to serve raw greeks for the Positions screen (already available) and mark POSITIONS-01 as "raw greeks — Phase 9 can layer BSM if needed." The read-through-BSM layer would require a new port + domain computation and is not needed for the Phase 8 scope. **This is a discretionary decision for the planner to confirm.**

---

## Runtime State Inventory

> This is a greenfield feature addition, not a rename/refactor. No rename/runtime state inventory required.

**Nothing found in any category** — verified: this phase adds new tables, new endpoints, and new env vars. It does not rename any existing strings.

---

## Common Pitfalls

### Pitfall 1: Hono `jwt()` and `exactOptionalPropertyTypes`

**What goes wrong:** Hono's `jwt()` middleware injects the decoded payload into `c.var`. Accessing `c.var.jwtPayload` with `exactOptionalPropertyTypes: true` requires explicit non-null checking before use (same as Phase 1 Pitfall with `result.ok` guard).

**How to avoid:** In route handlers that need the user ID from the JWT payload (not needed in Phase 8 — single user, just need authentication, not authorization), always guard with `if (!c.var.jwtPayload) return c.json({ error: "Unauthorized" }, 401)`.

### Pitfall 2: `leg_observations` JOIN with `contracts` for GEX

**What goes wrong:** `leg_observations` stores the `contract` column (OCC symbol string) but NOT `strike`, `expiration`, or `contractType` directly. Trying to compute GEX without joining `contracts` will fail to get the per-contract metadata.

**How to avoid:** The `ForReadingLegObsForGex` driven port must be implemented as a JOIN: `SELECT lo.*, c.strike, c.expiration, c.contract_type FROM leg_observations lo JOIN contracts c ON lo.contract = c.occ_symbol WHERE lo.time = $cycleTime`.

**Warning signs:** TypeScript compiler will catch missing fields if the domain type is defined correctly.

### Pitfall 3: Profile grid re-pricing performance

**What goes wrong:** Re-pricing the full SPX chain (~500 contracts) across a 50-point grid (e.g., 6800–7900 in steps of 20 = 55 grid points) means ~27,500 `bsmGreeks()` calls per job run. At ~1 µs each this is ~28ms — acceptable. But if `leg_observations` is queried inside the grid loop (per spot point) instead of once before the loop, the job runs 55 queries instead of 1.

**How to avoid:** Read all `leg_observations` at the cycle time ONCE, into memory. Then the grid computation is pure in-memory math.

### Pitfall 4: `callWall` / `putWall` definition

**What goes wrong:** The "call wall" is the strike with the highest positive per-strike GEX; the "put wall" is the strike with the most negative (largest absolute value) per-strike GEX. Confusing them (e.g., using max absolute value for both) produces wrong values.

**How to avoid:** From `gex-snapshot.json`: `callWall: {k:7600, gex:1230277553}` (highest positive), `putWall: {k:7400, gex:-5974395559}` (most negative). Separate `argmax(gex > 0)` from `argmin(gex)`.

### Pitfall 5: `flip` level null case

**What goes wrong:** If the entire GEX profile is negative (all dealer gamma is negative), there is no zero-crossing and `flip` is `null`. The `gex-snapshot.json` payload shows `"flip": null`. Blindly calling `arr.find(...)` and using its result without null check will throw.

**How to avoid:** The `flip` column and Zod field are nullable. Domain function returns `null` when no zero-crossing exists. The Zod contract already has `flip: z.number().nullable()`.

### Pitfall 6: `WEB_ORIGIN` in local dev

**What goes wrong:** Local dev has no Vercel origin. If `WEB_ORIGIN` has no default, dev boots fail. If the default is too permissive (`"*"`), CORS credentials break.

**How to avoid:** Set `WEB_ORIGIN` in `.env.local` for dev (e.g., `http://localhost:5173`). In config schema, provide `z.string().url()` with no default — requiring explicit env var is intentional (boots fail loudly if missing, DATA-04).

### Pitfall 7: jobs sub-group ordering — CORS before auth middleware

**What goes wrong:** If CORS middleware is applied AFTER the auth middleware, preflight `OPTIONS` requests (which carry no `Authorization` header) will be rejected with 401 before CORS headers are sent. Browsers see the CORS error, not the 401.

**How to avoid:** Apply `cors()` as the FIRST middleware on the app, before any auth group:
```typescript
app.use("/*", cors({ ... }));           // FIRST
const readGroup = new Hono();
readGroup.use("/*", jwt({ ... }));      // inside the group
```

---

## Code Examples

### GEX domain computation sketch

```typescript
// Source: derived from mockups/playground-v3.html algorithm + bsm.ts
// packages/core/src/analytics/domain/gex.ts

import { bsmGreeks } from "../../journal/domain/bsm.ts";

const SPX_MULTIPLIER = 100;

export type ContractObs = {
  readonly contractType: "C" | "P";
  readonly strike: number;        // in points (e.g. 7275) — divided by 1000 from DB value
  readonly expiration: string;    // YYYY-MM-DD
  readonly openInterest: number;
  readonly bsmGamma: number;      // parsed from numeric string
  readonly bsmIv: number;         // needed for profile grid re-pricing
  readonly dte: number;           // computed: days to expiry from cycle_time
};

/** Dollar gamma at a given spot for one contract. $Bn/1% */
export function dollarGamma(gamma: number, oi: number, spot: number): number {
  return (gamma * oi * spot * spot * 0.01 * SPX_MULTIPLIER) / 1e9;
}

/** Per-strike aggregate GEX in $Bn/1% (calls positive, puts negative) */
export function strikeGex(contracts: ReadonlyArray<ContractObs>, spot: number): Map<number, number> {
  const map = new Map<number, number>();
  for (const c of contracts) {
    const contribution = dollarGamma(c.bsmGamma, c.openInterest, spot);
    const signed = c.contractType === "C" ? contribution : -contribution;
    map.set(c.strike, (map.get(c.strike) ?? 0) + signed);
  }
  return map;
}

/** Find zero-crossing in profile grid (linear interpolation). Returns null if no crossing. */
export function findFlip(
  grid: ReadonlyArray<{ s: number; g: number }>
): number | null {
  for (let i = 0; i < grid.length - 1; i++) {
    const a = grid[i];
    const b = grid[i + 1];
    if (a !== undefined && b !== undefined && a.g * b.g < 0) {
      // linear interpolation
      return a.s + (0 - a.g) / (b.g - a.g) * (b.s - a.s);
    }
  }
  return null;
}
```

### Supabase Auth JWT middleware in main.ts

```typescript
// Source: Hono 4.x docs + hono/middleware/jwt — ASSUMED pattern (not verified via Context7)
// apps/server/src/main.ts

import { jwt } from "hono/jwt";
import { cors } from "hono/cors";

// Apply CORS globally BEFORE auth groups (Pitfall 7)
app.use("/*", cors({
  origin: config.WEB_ORIGIN,
  credentials: true,
  allowHeaders: ["Authorization", "Content-Type"],
  allowMethods: ["GET", "POST", "OPTIONS"],
}));

// Supabase Auth-gated read group (replaces the current unauthenticated app.route() calls)
const readGroup = new Hono()
  .route("/", statusRoutes(getStatus))
  .route("/", calendarRoutes(registerCalendar, listCalendars, closeCalendar))
  .route("/", journalRoutes(getJournal))
  .route("/", brokerageRoutes(getPositions, getTransactions, getOrders))
  .route("/", analyticsRoutes(getTermStructure, getSkew))
  .route("/analytics", gexRoutes(getGex));

const authReadGroup = new Hono();
authReadGroup.use("/*", jwt({ secret: config.SUPABASE_JWT_SECRET, alg: "HS256" }));
authReadGroup.route("/", readGroup);
app.route("/api", authReadGroup);

// Jobs group stays on its separate bearerAuth (MCP token) — UNCHANGED
const jobsGroup = new Hono();
jobsGroup.use("/*", bearerAuth(config.MCP_BEARER_TOKEN));
jobsGroup.route("/", jobsRoutes(enqueueJob));
app.route("/api", jobsGroup);

// Export AppType for hc<AppType>() client (RPC-01)
export type AppType = typeof app;
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Supabase used as plain Postgres only (D18) | Supabase Auth JWT verification added (D-02) | Phase 8 | Stack-decisions.md D18 must be updated BEFORE auth code |
| All `/api/*` read endpoints unauthenticated | `/api/*` read endpoints gated by Supabase Auth JWT | Phase 8 | Breaking change for any direct API consumer; MCP bearerAuth unchanged |
| `apps/server/src/main.ts` exports only Bun default `{port, fetch}` | Also exports `AppType` | Phase 8 | Enables typed Hono RPC client in `apps/web` |

**Deprecated/outdated:**
- The deferred-features note in `docs/architecture/stack-decisions.md` (D18 "revisit trigger: concrete need for Supabase Auth") is now superseded by D-02. Must be un-deferred in the doc before Phase 8 code lands.

---

## Validation Architecture

Nyquist validation is enabled (`workflow.nyquist_validation` absent from config = enabled).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace mode for fast unit tests; per-package mode for testcontainers tests) |
| Config file | `vitest.config.ts` at workspace root |
| Quick run command | `bun run test` (workspace mode, skips testcontainers) |
| Full suite command | `cd packages/adapters && bun run test` for Postgres integration tests |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GEX-01 (compute) | GEX domain math produces oracle values (γ-flip ≈ 7488, net ≈ −47, callWall 7600, putWall 7400) | unit + property (fast-check) | `bun run test packages/core` | ❌ Wave 0 |
| GEX-01 (job handler) | Handler calls use-case, respects RTH gate, chain-triggers next job | unit | `bun run test apps/worker` | ❌ Wave 0 |
| GEX-01 (idempotency) | Re-run within same cycle → 0 duplicate rows | integration (testcontainers) | `cd packages/adapters && bun run test` | ❌ Wave 0 |
| GEX-02 (contract) | `gexSnapshotEntry.parse(snapshotOraclePayload)` succeeds without error | unit | `bun run test packages/contracts` | ❌ Wave 0 |
| RPC-01 (AppType) | `typeof app` exported; `hc<AppType>()` compiles without error | typecheck | `bun run typecheck` | ❌ Wave 0 |
| AUTH-01 (401) | Unauthenticated request to any read endpoint → 401 | integration (supertest-style) | `bun run test apps/server` | ❌ Wave 0 |
| AUTH-01 (CORS) | Request from `WEB_ORIGIN` gets correct CORS headers; request from other origin does not | integration | `bun run test apps/server` | ❌ Wave 0 |
| SC-4 (idempotency) | `onConflictDoNothing` on `cycle_time` PK → 0 duplicate rows | integration (testcontainers) | `cd packages/adapters && bun run test` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run typecheck && bun run test` (workspace, fast suite ~30s)
- **Per wave merge:** Full suite including `cd packages/adapters && bun run test` (testcontainers)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/analytics/domain/gex.test.ts` — covers oracle property tests (flip, callWall, putWall, netGamma)
- [ ] `packages/core/src/analytics/application/computeGexSnapshot.test.ts` — covers use-case with in-memory twin
- [ ] `packages/core/src/analytics/application/getGex.test.ts` — covers read use-case
- [ ] `packages/contracts/src/gex.test.ts` — contract parse tests
- [ ] `packages/adapters/src/postgres/gex-snapshot.repo.test.ts` — testcontainers migration + insert + read + idempotency
- [ ] `apps/worker/src/handlers/compute-gex-snapshot.test.ts` — handler RTH gate + call flow
- [ ] `apps/server/src/adapters/http/gex.routes.test.ts` — 401 unauthenticated, 200 authenticated, 404 no snapshot, CORS headers

---

## Security Domain

Supabase Auth is newly enabled (`security_enforcement` applies).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth JWT verify via `hono/jwt` (HS256) |
| V3 Session Management | yes (delegated to Supabase Auth / web client) | Supabase Auth handles session refresh; server is stateless JWT verify |
| V4 Access Control | yes (single-user; all-or-nothing) | JWT presence = authenticated = authorized |
| V5 Input Validation | yes | Zod at every boundary (existing pattern); new GEX route follows same pattern |
| V6 Cryptography | yes | HS256 JWT signature verification; never hand-roll |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated read of brokerage data (positions/P&L) | Information Disclosure | Supabase Auth JWT gate on all read endpoints (D-02) |
| JWT forging / tampering | Spoofing / Tampering | Offline HS256 verify with Supabase JWT secret; Hono rejects modified tokens |
| CORS wildcard with credentials | Elevation of Privilege | Exact origin string; `credentials: true` + exact origin (never `*`) |
| JWT secret in logs | Information Disclosure | T-01-12 pattern: config fields never logged; only field names on error |
| GEX endpoint serving stale data as "no-snapshot" error | Information Disclosure | Return 404 with `{ error: "no-snapshot" }` — never leak internal state |

---

## Open Questions (RESOLVED)

1. **POSITIONS-01 — raw vs. BSM greeks for positions screen**
   - What we know: `GET /api/positions` returns raw Schwab greeks from the API response. The Positions screen in the UI-SPEC shows per-leg delta/gamma/theta/vega.
   - What's unclear: Whether Schwab's reported greeks are accurate enough for the positions screen, or whether a BSM re-compute layer is needed.
   - **Resolution:** POSITIONS-01 (read-through-BSM greeks for the Positions screen) is **deferred OUT OF SCOPE to Phase 9**. Raw Schwab greeks suffice for Phase 8; the Positions screen itself is Phase 9 (Assumption A4). No read-through-BSM layer is built in this phase. Persisted in the plan set via 08-07's `<deferred_items>`.

2. **GEX job chain position: after `compute-analytics` or after `snapshot-calendars`?**
   - `compute-analytics` is the current terminal job in the chain. Adding GEX after it keeps the chain linear: `fetch-chain → bsm-greeks → snapshot-calendars → compute-analytics → compute-gex-snapshot`.
   - Alternative: chain GEX directly from `snapshot-calendars` (parallel with analytics).
   - **Resolution:** **Serial chain after `compute-analytics`** — simpler, matches existing pattern, GEX needs BSM-filled `bsm_gamma` values (filled by `compute-bsm-greeks`), which are present by the time `compute-analytics` completes.

3. **`callWall` / `putWall` integer vs. per-strike with full data**
   - The `gex_snapshot` table stores `callWall` as an integer strike level. But the UI-SPEC shows a `gexWallEntry` with `{k, gex, coi, poi, vol}`.
   - The `strikes[]` array in the contract already includes all per-strike data.
   - **Resolution:** `callWall` and `putWall` at the top level are the **integer strike values only** (for the regime strip KPIs); the **full per-strike metadata lives in `strikes[]`**. No separate wall-detail structure needed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | Build / run | ✓ | (dev machine) | — |
| Postgres 16 (Supabase) | `gex_snapshot` migration | ✓ (prod) | 16 | testcontainers in tests |
| Hono `jwt` middleware | Supabase Auth gate | ✓ | 4.12.23 (installed) | — |
| Hono `cors` middleware | CORS config | ✓ | 4.12.23 (installed) | — |
| `SUPABASE_JWT_SECRET` | JWT verify | ✗ (new) | — | None — blocks auth (must add to Railway + local .env) |
| `WEB_ORIGIN` | CORS | ✗ (new) | — | None — blocks CORS (must add to Railway + local .env) |

**Missing dependencies with no fallback:**
- `SUPABASE_JWT_SECRET`: Must be added to Railway env for `apps/server`. Found in Supabase Dashboard → Settings → API → JWT Secret. Also needed in `.env.local` for dev.
- `WEB_ORIGIN`: Must be added to Railway env for `apps/server`. Value = Vercel deploy URL (available after first Phase 9 Vercel deploy). For Phase 8 dev, set to `http://localhost:5173`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Supabase Auth uses HS256 with a shared project JWT secret (not RS256 JWKS) | Supabase Auth JWT Verification | If Supabase actually uses RS256 (which some plans do), the middleware needs `hono/jwt` `verifyWithJwks` instead. Check Supabase Dashboard → Settings → API → JWT Algorithm before implementing. |
| A2 | `hono/jwt` middleware throws `HTTPException(401)` for invalid JWT (not just passes) | Supabase Auth JWT Verification pattern | If it requires explicit response handling, the middleware wrapper needs adjustment. Low risk — pattern is documented in Hono codebase (verified via source read). |
| A3 | The `leg_observations` JOIN `contracts` query is performant enough for ~500 contracts per RTH cycle | GEX Computation | If the query is slow, a partial index on `leg_observations.time` (latest cycle) would fix it. Likely a non-issue at 500 rows. |
| A4 | POSITIONS-01: raw Schwab greeks are sufficient for the Positions screen (no BSM re-compute needed in Phase 8) | POSITIONS-01 Gap | If the Positions screen requires BSM-computed greeks, Phase 9 must add a read-through-BSM layer. |
| A5 | `AppType` export works with the current `main.ts` structure using chained `.route()` | Hono AppType Export pattern | Hono RPC type inference has nuanced requirements for chained `.route()` vs. statement-style calls. Pattern is from Hono docs but not verified against this exact codebase structure. |

---

## Sources

### Primary (verified by direct code inspection)
- `apps/server/src/main.ts` — existing route wiring, bearerAuth pattern, app structure
- `apps/server/src/adapters/mcp/bearer.ts` — bearer auth middleware pattern
- `apps/server/src/adapters/http/analytics.routes.ts` — template for gex.routes.ts
- `apps/server/src/adapters/mcp/tools.ts` — template for get_gex MCP tool registration
- `apps/worker/src/handlers/compute-analytics.ts` — template for compute-gex-snapshot handler
- `apps/worker/src/handlers/snapshot-calendars.ts` — chain trigger pattern
- `apps/worker/src/schedule.ts` — job registration pattern, AllHandlers type
- `packages/core/src/journal/domain/bsm.ts` — BSM engine (bsmGreeks, bsmPrice, BsmGreeks type)
- `packages/core/src/journal/application/ports.ts` — port naming conventions
- `packages/contracts/src/analytics.ts` — contract template for gex.ts
- `packages/contracts/src/index.ts` — export pattern
- `packages/adapters/src/postgres/schema.ts` — Drizzle schema patterns, JSONB, enableRLS
- `packages/adapters/src/postgres/migrations/0007_analytics_observations.sql` — migration template
- `apps/server/src/config.ts` — config schema pattern
- `apps/worker/src/config.ts` — worker config pattern
- `mockups/gex-snapshot.json` — GEX oracle per-strike data (spot 7381, putWall 7400, callWall 7600)
- `mockups/gex-profile.json` — GEX oracle profile (flip 7488, atSpot -47)
- `mockups/playground-v3.html` — GEX computation algorithm source
- `.planning/phases/09-web-dashboard-frontend-react-spa-on-hono-rpc/09-UI-SPEC.md` — Backend Data Gaps (GEX-01, GEX-02, RPC-01, POSITIONS-01)
- `docs/architecture/stack-decisions.md` — D18 (Supabase scope), D19 (Vercel/CORS), D4 (TanStack + Hono RPC)
- `docs/architecture/overview.md` — hexagon hard rules
- `.planning/REQUIREMENTS.md` — UI-01, UI-02
- `node_modules/.bun/hono@4.12.23/...` — Hono cors and jwt middleware source (verified locally)

### Secondary (MEDIUM confidence)
- `npm view hono version` → 4.12.27 (current); `npm view drizzle-orm version` → 0.45.2; `npm view @supabase/supabase-js version` → 2.108.2

### Tertiary (ASSUMED / training knowledge)
- Supabase Auth JWT algorithm defaults (A1 above)
- Hono `jwt()` middleware 401 behavior (A2 above)
- Hono `AppType` chaining requirements (A5 above)

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 8 |
|-----------|-------------------|
| `core` imports `shared` only | GEX domain functions live in `packages/core/src/analytics/domain/gex.ts`; they import only from `@morai/shared` (Result type) |
| TDD red→green | Every new file starts with a failing test; no production code without a RED run first |
| No `any`, `as`, `!` | GEX type narrowing: use `assertDefined` + Zod parse; no type assertions in JSONB handling |
| Docs before architecture changes | `stack-decisions.md` D18 must be updated BEFORE auth middleware code lands (D-02a) |
| Dependencies point inward | `gex.routes.ts`, `tools.ts`, job handler all import from `@morai/core` — never the reverse |
| Zod at every boundary | HTTP request (none for GEX GET), HTTP response (gexSnapshotResponse.parse(...)), MCP tool args (safeParse), job payload |
| `MCP-02` cross-cut | `get_gex` MCP tool ships in the SAME PR as `GET /api/analytics/gex` |
| In-memory twin required | `packages/adapters/src/memory/gex-snapshot.memory.ts` ships in the same PR as the Postgres adapter |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed, version-verified from local node_modules
- Architecture: HIGH — codebase-verified; GEX mirrors existing analytics pattern exactly
- Hono jwt/cors patterns: MEDIUM — verified via source code; exact API confirmed from node_modules
- GEX math: HIGH — oracle values from mockups/gex-profile.json + gex-snapshot.json; algorithm from playground-v3
- Supabase Auth JWT algorithm (HS256): MEDIUM/ASSUMED — Supabase default is HS256 for most projects; must verify in dashboard before implementing
- AppType inference: MEDIUM/ASSUMED — Hono RPC docs describe chaining; not smoke-tested against this exact codebase

**Research date:** 2026-06-24
**Valid until:** 2026-07-24 (30 days; stable stack)

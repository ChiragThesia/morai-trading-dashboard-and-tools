# Phase 2: Market Data & BSM Engine - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 22 new/modified files
**Analogs found:** 22 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/journal/application/ports.ts` | ports (extend) | — | self (lines 1-33) | exact — extend in place |
| `packages/core/src/journal/domain/bsm.ts` | domain (new) | transform | no analog (pure math) | no analog |
| `packages/core/src/journal/domain/iv-inversion.ts` | domain (new) | transform | no analog (pure math) | no analog |
| `packages/core/src/journal/domain/rth-window.ts` | utility (new) | transform | no analog | no analog |
| `packages/core/src/journal/application/fetchChain.ts` | use-case (new) | request-response | `packages/core/src/journal/application/getStatus.ts` | role-match |
| `packages/core/src/journal/application/fetchRate.ts` | use-case (new) | request-response | `packages/core/src/journal/application/getStatus.ts` | role-match |
| `packages/core/src/journal/application/computeBsmGreeks.ts` | use-case (new) | batch | `packages/core/src/journal/application/getStatus.ts` | role-match |
| `packages/core/src/journal/application/getStatus.ts` | use-case (extend) | request-response | self | exact |
| `packages/contracts/src/status.ts` | contract (extend) | — | self (lines 1-14) | exact — extend in place |
| `packages/adapters/src/http/cboe.ts` | driven adapter (new) | request-response | no HTTP adapters yet | no analog — use RESEARCH.md Pattern 1 |
| `packages/adapters/src/http/fred.ts` | driven adapter (new) | request-response | no HTTP adapters yet | no analog — use RESEARCH.md |
| `packages/adapters/src/memory/chain.ts` | in-memory twin (new) | request-response | `packages/adapters/src/memory/calendars.ts` | exact |
| `packages/adapters/src/memory/rate.ts` | in-memory twin (new) | request-response | `packages/adapters/src/memory/calendars.ts` | exact |
| `packages/adapters/src/postgres/repos/leg-observations.ts` | Postgres repo (new) | CRUD | `packages/adapters/src/postgres/repos/calendars.ts` | exact |
| `packages/adapters/src/postgres/repos/rate-observations.ts` | Postgres repo (new) | CRUD | `packages/adapters/src/postgres/repos/calendars.ts` | exact |
| `packages/adapters/src/postgres/repos/contracts.ts` | Postgres repo (new) | CRUD | `packages/adapters/src/postgres/repos/calendars.ts` | exact |
| `packages/adapters/src/postgres/repos/job-runs.ts` | Postgres repo (new) | request-response | `packages/adapters/src/postgres/repos/calendars.ts` | role-match |
| `packages/adapters/src/__contract__/chain.contract.ts` | contract test suite (new) | — | `packages/adapters/src/__contract__/calendars.contract.ts` | exact |
| `packages/adapters/src/__contract__/rate.contract.ts` | contract test suite (new) | — | `packages/adapters/src/__contract__/calendars.contract.ts` | exact |
| `apps/worker/src/config.ts` | config (extend) | — | self (lines 1-52) | exact — extend in place |
| `apps/worker/src/main.ts` | composition root (extend) | — | self (lines 1-21) | exact — extend in place |
| `apps/worker/src/handlers/*.ts` (3 handlers) | job handler (new) | event-driven | `apps/server/src/adapters/http/status.routes.ts` | role-match (thin adapter) |

---

## Pattern Assignments

### `packages/core/src/journal/application/ports.ts` (extend)

**Analog:** self — `packages/core/src/journal/application/ports.ts` lines 1-33

**Extension pattern** — append new driven port types following the exact style of the existing ones:

```typescript
// Existing (lines 1-33) — copy this style for all new ports
import type { Result } from "@morai/shared";

export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

// ForVerbingNoun convention — fine-grained function type per hexagonal-ddd.md
export type ForGettingOpenCalendars = () => Promise<
  Result<ReadonlyArray<Calendar>, StorageError>
>;

export type ForPingingDb = () => Promise<Result<void, StorageError>>;
```

**New ports to add** (follow same pattern):
- `ForFetchingChain` — fetch raw chain for a root symbol; returns `Result<RawChain, FetchError>`
- `ForFetchingRate` — fetch current DGS3MO rate; returns `Result<RateObservation, FetchError>`
- `ForPersistingObservations` — bulk upsert leg_observations; returns `Result<void, StorageError>`
- `ForReadingPendingObs` — read rows from partial index (bsm_iv IS NULL); returns `Result<ReadonlyArray<PendingObs>, StorageError>`
- `ForWritingBsmResults` — write bsm_* columns + NaN stamp; returns `Result<void, StorageError>`
- `ForPersistingRate` — upsert rate_observations row; returns `Result<void, StorageError>`
- `ForReadingRate` — get most-recent rate ≤ a date; returns `Result<string | null, StorageError>`
- `ForUpsertingContracts` — first-seen metadata upsert; returns `Result<void, StorageError>`
- `ForReadingJobRuns` — query pgboss.job for last success/error per job; returns `Result<JobRunMap, StorageError>`

---

### `packages/core/src/journal/application/fetchChain.ts` (new use-case)

**Analog:** `packages/core/src/journal/application/getStatus.ts` lines 1-50

**Factory + injection pattern** (lines 1-50):
```typescript
// getStatus.ts lines 22-50 — factory shape to copy
export function makeGetStatusUseCase(deps: {
  readonly pingDb: ForPingingDb;
  readonly version: string;
  readonly startedAt: Date;
}): ForGettingStatus {
  return async () => {
    let dbStatus: "ok" | "down";
    try {
      const pingResult = await deps.pingDb();
      dbStatus = pingResult.ok ? "ok" : "down";
    } catch {
      dbStatus = "down";
    }
    return ok(payload);
  };
}
```

**Adaptation for fetchChain:** replace `ForPingingDb` with `ForFetchingChain`, `ForPersistingObservations`, `ForUpsertingContracts`, and config values (`maxDte`, `strikeBandPct`). Core must not import pg-boss, Hono, or `process.env`. Pass `now: Date` as a dep, never `Date.now()` in the factory closure — core must be pure.

**Imports pattern** (lines 1-3):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingChain, ForPersistingObservations, ... } from "./ports.ts";
```

---

### `packages/core/src/journal/application/computeBsmGreeks.ts` (new use-case, batch)

**Analog:** `packages/core/src/journal/application/getStatus.ts` lines 22-50

Same factory pattern. Deps: `ForReadingPendingObs`, `ForWritingBsmResults`, `ForReadingRate`. Calls domain functions `bsmGreeks()` and `invertIv()` — both pure, no I/O. Maps `IvError` to NaN-stamp path (D-09). Never throws; absorbs per-row errors as NaN stamps.

---

### `packages/core/src/journal/application/getStatus.ts` (extend)

**Analog:** self lines 1-50

**StatusPayload extension** — change `lastJobRuns` from `"none yet"` literal to a union type that adds a `JobRunMap` shape once data exists. Follow D-10.

Add `ForReadingJobRuns` to the deps record:
```typescript
// Current deps (line 23-26):
export function makeGetStatusUseCase(deps: {
  readonly pingDb: ForPingingDb;
  readonly version: string;
  readonly startedAt: Date;
}): ForGettingStatus {

// Extended deps (Phase 2):
export function makeGetStatusUseCase(deps: {
  readonly pingDb: ForPingingDb;
  readonly readJobRuns: ForReadingJobRuns;   // new
  readonly version: string;
  readonly startedAt: Date;
}): ForGettingStatus {
```

`StatusPayload.lastJobRuns` changes from `"none yet"` to `"none yet" | JobRunMap`. The use-case calls `deps.readJobRuns()` and falls back to `"none yet"` when the result is empty or errors.

---

### `packages/core/src/journal/domain/bsm.ts` (new, pure domain)

**No codebase analog.** Use RESEARCH.md Code Examples section ("BSM Price Function") directly.

Key conventions to maintain:
- Export only pure functions and `readonly` types — zero I/O
- `BsmGreeks` type uses `readonly` fields (typescript.md)
- `bsmVega` exported separately for IV inversion denominator
- No `any`, no `as`, no `!`
- No imports from outside `packages/shared` (architecture-boundaries.md §2)

---

### `packages/core/src/journal/domain/iv-inversion.ts` (new, pure domain)

**No codebase analog.** Use RESEARCH.md Pattern 4 directly.

`invertIv` returns `Result<number, IvError>` — never throws. `IvError` is a discriminated union: `{ kind: 'expired' } | { kind: 'below-intrinsic' } | { kind: 'above-bound' }`. Callers (use-cases) map `err` to the NaN-stamp path.

---

### `packages/core/src/journal/domain/rth-window.ts` (new utility)

**No codebase analog.** Use RESEARCH.md Pattern 5 RTH self-check snippet.

`isWithinRth(now: Date): boolean` — pure, takes `now` explicitly, never reads `Date.now()`. Belongs in `packages/core` (shared business rule for job gating). No imports from outside `packages/shared`.

---

### `packages/contracts/src/status.ts` (extend)

**Analog:** self lines 1-14

**Current shape** (lines 1-14):
```typescript
import { z } from "zod";

export const statusResponse = z.object({
  db: z.enum(["ok", "down"]),
  tokenFreshness: z.literal("none yet"),
  lastJobRuns: z.literal("none yet"),
  version: z.string(),
  uptime: z.number(),
});

export type StatusResponse = z.infer<typeof statusResponse>;
```

**Extension** — replace `lastJobRuns: z.literal("none yet")` with a union. Add `jobRunRecord` as a named const for reuse:
```typescript
const jobRunRecord = z.object({
  lastSuccessAt: z.string().datetime().nullable(),
  lastErrorAt:   z.string().datetime().nullable(),
  lastError:     z.string().nullable(),
});

// then in statusResponse:
lastJobRuns: z.union([
  z.literal("none yet"),
  z.record(z.string(), jobRunRecord),
]),
```

MCP-02 rule: this one change automatically updates both the HTTP route and MCP tool because both import `statusResponse` from this file.

---

### `packages/adapters/src/memory/chain.ts` (new in-memory twin)

**Analog:** `packages/adapters/src/memory/calendars.ts` lines 1-58

**Full pattern** (lines 1-58):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForGettingOpenCalendars, ForPingingDb, ... } from "@morai/core";

export type MemoryCalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  readonly seedOpenCalendar: (...) => Promise<void>;
};

export function makeMemoryCalendarsRepo(): MemoryCalendarsRepo {
  const store = new Map<string, Calendar>();

  const getOpenCalendars: ForGettingOpenCalendars = async () => {
    return ok([...store.values()]);
  };

  const pingDb: ForPingingDb = async () => ok(undefined);

  const seedOpenCalendar = async (...) => { store.set(...); };

  return { getOpenCalendars, pingDb, seedOpenCalendar };
}
```

**Adaptation for chain:** `makeMemoryChainAdapter()` stores a `Map<string, RawChain>` keyed by root (`"SPX"` | `"SPXW"`). Exposes `seed(root, chain)` for test setup. Always returns `ok(...)` — in-memory never fails. Implements `ForFetchingChain`.

**Adaptation for rate:** `makeMemoryRateAdapter()` stores a single `RateObservation | null`. Exposes `seed(rate)`. Implements `ForFetchingRate`.

---

### `packages/adapters/src/postgres/repos/leg-observations.ts` (new Postgres repo)

**Analog:** `packages/adapters/src/postgres/repos/calendars.ts` lines 1-95

**Imports pattern** (lines 1-12):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPersistingObservations, ForReadingPendingObs, StorageError } from "@morai/core";
import { sql } from "drizzle-orm";
import { and, isNull, isNotNull } from "drizzle-orm";
import { legObservations } from "../schema.ts";
import type { Db } from "../db.ts";
```

**Core CRUD pattern** (lines 33-60 of calendars.ts):
```typescript
export function makePostgresCalendarsRepo(db: Db): PostgresCalendarsRepo {
  const getOpenCalendars: ForGettingOpenCalendars = async () => {
    try {
      const rows = await db.select({ ... }).from(calendars).where(...);
      return ok(rows.map(...));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };
```

**Upsert pattern** for append-only idempotency (D-03 Claude's Discretion — `ON CONFLICT DO NOTHING` equivalent in Drizzle):
```typescript
await db.insert(legObservations)
  .values(rows)
  .onConflictDoNothing();
```

**Pending scan** uses the partial index via Drizzle `where`:
```typescript
await db.select().from(legObservations)
  .where(and(isNull(legObservations.bsmIv), isNotNull(legObservations.mark)));
```

**NaN stamp** (D-09) — pass the string `'NaN'`, not JS `NaN`:
```typescript
await db.update(legObservations)
  .set({ bsmIv: 'NaN', bsmDelta: 'NaN', bsmGamma: 'NaN', bsmTheta: 'NaN', bsmVega: 'NaN' })
  .where(and(eq(legObservations.time, obs.time), eq(legObservations.contract, obs.contract)));
```

**Error handling** (lines 54-60 of calendars.ts):
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

---

### `packages/adapters/src/postgres/repos/rate-observations.ts` (new Postgres repo)

**Analog:** `packages/adapters/src/postgres/repos/calendars.ts` lines 1-95

Same structure. Implements `ForPersistingRate` (upsert by date PK) and `ForReadingRate` (latest date ≤ given date). Key Drizzle snippet for "latest rate ≤ date":
```typescript
await db.select().from(rateObservations)
  .where(lte(rateObservations.date, targetDate))
  .orderBy(desc(rateObservations.date))
  .limit(1);
```

---

### `packages/adapters/src/postgres/repos/contracts.ts` (new Postgres repo)

**Analog:** `packages/adapters/src/postgres/repos/calendars.ts` lines 76-94 (insert pattern)

Implements `ForUpsertingContracts`. First-seen only — `onConflictDoNothing()` on `occ_symbol` PK. Same error wrapping.

---

### `packages/adapters/src/postgres/repos/job-runs.ts` (new Postgres repo)

**Analog:** `packages/adapters/src/postgres/repos/calendars.ts` (structure), raw SQL query from RESEARCH.md Pattern 6

Uses raw `db.execute(sql`...`)` rather than Drizzle table helpers because `pgboss.job` is an external schema not in `schema.ts`. Returns `Result<JobRunMap, StorageError>`. Must return `ok({})` (empty map, not throw) when no rows exist — handles first-deploy case (Pitfall 6).

```typescript
const rows = await db.execute(sql`
  SELECT DISTINCT ON (name)
    name,
    state,
    completed_on,
    output
  FROM pgboss.job
  WHERE name IN ('fetch-cboe-chain', 'fetch-rates', 'compute-bsm-greeks')
    AND state IN ('completed', 'failed')
  ORDER BY name, completed_on DESC NULLS LAST
`);
```

---

### `packages/adapters/src/__contract__/chain.contract.ts` (new contract suite)

**Analog:** `packages/adapters/src/__contract__/calendars.contract.ts` lines 1-81

**Full pattern** (lines 1-81):
```typescript
import { describe, it, expect, beforeEach } from "vitest";
import type { ForFetchingChain } from "@morai/core";

export type ChainAdapter = {
  readonly fetchChain: ForFetchingChain;
  readonly seed?: (root: string, chain: RawChain) => Promise<void>;
};

export function runChainContractTests(makeAdapter: () => ChainAdapter): void {
  describe("chain port contract", () => {
    let adapter: ChainAdapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it("returns ok(chain) after seed", async () => { ... });
    it("returns err when root not found", async () => { ... });
  });
}
```

Run suite in: `packages/adapters/src/memory/chain.contract.test.ts` (no Docker) and `packages/adapters/src/http/cboe.contract.test.ts` (msw mock).

---

### `apps/worker/src/config.ts` (extend)

**Analog:** self lines 1-52 + `apps/server/src/config.ts` lines 1-56

**Existing pattern** (worker config lines 1-52):
```typescript
import { z } from "zod";

const workerConfigSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  TZ: z.string().default("America/New_York"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function parseWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const result = workerConfigSchema.safeParse(env);
  if (!result.success) throw result.error;
  return result.data;
}

export function bootWorkerConfig(): WorkerConfig {
  try {
    return parseWorkerConfig(process.env);
  } catch (e) {
    console.error("Worker configuration error — check the following environment variables:");
    if (e instanceof z.ZodError) {
      for (const issue of e.issues) {
        console.error(` - ${issue.path.join(".")}: ${issue.message}`);
      }
    }
    process.exit(1);
  }
}
```

**Extend schema with Phase 2 tunables** (D-13) — append to the `z.object({...})`:
```typescript
// New Phase 2 fields (all have defaults — no required Railway env additions):
DATABASE_POOL_URL: z.string().url().optional(),  // for pg-boss connection
FRED_API_KEY: z.string().optional(),             // absent → skip fetch, use 4.5% fallback
BSM_MAX_DTE: z.coerce.number().int().positive().default(90),
BSM_STRIKE_BAND_PCT: z.coerce.number().positive().default(0.10),
BSM_DIVIDEND_YIELD: z.coerce.number().nonnegative().default(0.013),
BSM_RATE_FALLBACK: z.coerce.number().nonnegative().default(0.045),
```

---

### `apps/worker/src/main.ts` (extend)

**Analog:** self lines 1-21

**Existing composition root** (lines 1-21):
```typescript
import { bootWorkerConfig } from "./config.ts";
import { runMigrations } from "@morai/adapters";

const config = bootWorkerConfig();
await runMigrations(config.DATABASE_URL);
console.warn("morai worker: migrations applied, idling");

setInterval(() => { /* intentional idle */ }, 60_000);
```

**Phase 2 extension shape** — replace idle interval with pg-boss boot + job registration:
```typescript
import PgBoss from "pg-boss";
import { bootWorkerConfig } from "./config.ts";
import { runMigrations } from "@morai/adapters";
// ... use-case factories and repo factories ...

const config = bootWorkerConfig();
await runMigrations(config.DATABASE_URL);

const boss = new PgBoss(config.DATABASE_URL);
await boss.start();

// Schedule jobs (idempotent — safe to call on every boot)
await boss.schedule('fetch-cboe-chain', '*/30 * * * 1-5', null, { tz: 'America/New_York' });
await boss.schedule('fetch-rates', '0 9 * * 1-5', null, { tz: 'America/New_York' });
await boss.schedule('compute-bsm-greeks', '0 10-16 * * 1-5', null, { tz: 'America/New_York' });

// Register handlers (array destructure — pg-boss v10+ breaking change)
await boss.work('fetch-cboe-chain', { pollingIntervalSeconds: 30 }, async ([job]) => {
  if (job === undefined) return;
  // call handler
});
```

---

### `apps/worker/src/handlers/fetch-cboe-chain.ts` (new job handler)

**Analog:** `apps/server/src/adapters/http/status.routes.ts` lines 1-29 (thin adapter pattern)

**Thin adapter pattern** (lines 14-29):
```typescript
// Pattern: Zod-parse input → call use-case → map Result → respond
export function statusRoutes(getStatus: ForGettingStatus) {
  const router = new Hono();
  router.get("/status", async (c) => {
    const result = await getStatus();
    if (!result.ok) {
      return c.json({ error: "internal" }, 500);
    }
    return c.json(statusResponse.parse(result.value));
  });
  return router;
}
```

**Handler adaptation** — handler is a plain async function, not a Hono route. The exact same "zero business logic" discipline applies:
```typescript
// Pattern: parse job payload → RTH self-check → call use-case → map Result → throw on err
export function makeFetchCboeChainHandler(deps: {
  fetchChain: ForFetchingChain;
  // ... other use-case deps
}) {
  return async ([job]: [{ data: unknown } | undefined]) => {
    if (job === undefined) return;
    if (!isWithinRth(new Date())) {
      console.warn('fetch-cboe-chain: skip, outside RTH');
      return;
    }
    const result = await deps.fetchChainUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);  // pg-boss marks job failed; triggers retry
    }
    // D-07: enqueue compute on success
    await deps.boss.send('compute-bsm-greeks', {}, { singletonKey: 'triggered-by-chain' });
  };
}
```

Same thin-adapter shape applies to `fetch-rates.ts` and `compute-bsm-greeks.ts`.

---

### `packages/adapters/src/http/cboe.ts` (new HTTP adapter)

**No codebase analog for HTTP adapters.** Use RESEARCH.md Pattern 1 (CBOE Zod schemas) and Pattern 2 (OSI→OCC conversion).

**Key conventions to match:**
- Import `parseOccSymbol` / `formatOccSymbol` from `@morai/shared` — do not re-implement
- Return `Result<RawChain, FetchError>` — never throw across port boundary
- Zod-parse response immediately on receipt, before any core logic
- Use `.passthrough()` on CBOE option objects to avoid parse failures on unknown fields
- Fetch SPX and SPXW in parallel: `await Promise.all([fetchRoot('SPX'), fetchRoot('SPXW')])`
- Add `User-Agent` header; add 1-2 second delay between sequential calls if needed
- ET timestamp pitfall (RESEARCH.md Pitfall 1): append timezone when constructing Date from CBOE timestamp

**msw mock** required for all tests — set up a `setupServer(http.get(CBOE_URL_SPX, ...))` server per tdd.md rule.

---

### `packages/adapters/src/http/fred.ts` (new HTTP adapter)

**No codebase analog.** Use RESEARCH.md FRED Rate Adapter section.

Same structural conventions as `cboe.ts`. Key additions:
- `FRED_API_KEY` injected from config; when absent, return `ok({ skipped: true })` immediately
- Filter out `"."` values before upsert (RESEARCH.md Pitfall 7)
- Returns `Result<RateObservation | null, FetchError>`

---

## Shared Patterns

### Result + error wrapping
**Source:** `packages/adapters/src/postgres/repos/calendars.ts` lines 54-60
**Apply to:** all new Postgres repos, all HTTP adapters
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

### use-case factory shape
**Source:** `packages/core/src/journal/application/getStatus.ts` lines 22-50
**Apply to:** `fetchChain.ts`, `fetchRate.ts`, `computeBsmGreeks.ts`
```typescript
export function makeXxxUseCase(deps: {
  readonly portA: ForVerbingNoun;
  // ...
}): ForVerbingNoun {
  return async (...) => {
    try {
      // orchestrate ports + domain calls
      return ok(result);
    } catch {
      // absorb or rethrow depending on use-case contract
    }
  };
}
```

### Zod config extend
**Source:** `apps/worker/src/config.ts` lines 1-52
**Apply to:** `apps/worker/src/config.ts` extension
```typescript
// parseXxxConfig takes env Record explicitly — never process.env inside the function
export function parseWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const result = workerConfigSchema.safeParse(env);
  if (!result.success) throw result.error;
  return result.data;
}
```

### In-memory adapter shape
**Source:** `packages/adapters/src/memory/calendars.ts` lines 1-58
**Apply to:** `memory/chain.ts`, `memory/rate.ts`
```typescript
export function makeMemoryXxxRepo(): MemoryXxxRepo {
  const store = new Map<...>();
  const portMethod: ForVerbingNoun = async (...) => ok(...);
  const seed = async (...) => { store.set(...); };
  return { portMethod, seed };
}
```

### Contract test harness
**Source:** `packages/adapters/src/__contract__/calendars.contract.ts` lines 1-81
**Apply to:** `__contract__/chain.contract.ts`, `__contract__/rate.contract.ts`
```typescript
export function runXxxContractTests(makeAdapter: () => XxxAdapter): void {
  describe("xxx port contract", () => {
    let adapter: XxxAdapter;
    beforeEach(() => { adapter = makeAdapter(); });
    // ... shared assertions ...
  });
}
```

### Postgres contract test wiring
**Source:** `packages/adapters/src/postgres/repos/calendars.contract.test.ts` lines 1-35
**Apply to:** all new Postgres repo contract test files
```typescript
const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres adapter", () => {
  let db: ReturnType<typeof makeDb>;
  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });
  runXxxContractTests(() => {
    if (!db) throw new Error("db not initialized");
    return makePostgresXxxRepo(db);
  });
});
```

### HTTP route thin-adapter
**Source:** `apps/server/src/adapters/http/status.routes.ts` lines 1-29
**Apply to:** any new HTTP or MCP adapters; job handlers follow the same discipline
```typescript
// Zero business logic in adapter.
// Pattern: Zod-parse input → call use-case → map Result → respond
```

### MCP tool thin-adapter
**Source:** `apps/server/src/adapters/mcp/tools.ts` lines 1-47
**Apply to:** any extension to MCP tools
```typescript
export function registerXxxTool(server: McpServer, useCase: ForVerbingNoun): void {
  server.registerTool("tool_name", { title: "...", description: "...", inputSchema: {} },
    async () => {
      const result = await useCase();
      if (!result.ok) return { content: [{ type: "text" as const, text: "internal error" }] };
      const payload = xyzSchema.parse(result.value);
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    });
}
```

---

## No Analog Found

Files whose implementation has no codebase analog — planner must use RESEARCH.md code examples as the primary reference:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/src/journal/domain/bsm.ts` | domain | transform | No numerical domain functions exist yet; use RESEARCH.md "BSM Price Function" code example |
| `packages/core/src/journal/domain/iv-inversion.ts` | domain | transform | No iterative solver exists; use RESEARCH.md Pattern 4 |
| `packages/core/src/journal/domain/rth-window.ts` | utility | transform | No time-window utilities exist; use RESEARCH.md Pattern 5 RTH snippet |
| `packages/adapters/src/http/cboe.ts` | driven adapter | request-response | No HTTP adapters exist; use RESEARCH.md Pattern 1 + Pattern 2 |
| `packages/adapters/src/http/fred.ts` | driven adapter | request-response | No HTTP adapters exist; use RESEARCH.md FRED section |

---

## Metadata

**Analog search scope:** `packages/core/src/`, `packages/adapters/src/`, `packages/contracts/src/`, `apps/server/src/`, `apps/worker/src/`
**Files scanned:** 18
**Pattern extraction date:** 2026-06-10

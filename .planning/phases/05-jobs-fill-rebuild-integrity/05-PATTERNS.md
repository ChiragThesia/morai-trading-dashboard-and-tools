# Phase 05: Jobs, Fill Rebuild & Integrity — Pattern Map

**Mapped:** 2026-06-21
**Files analyzed:** 22 new/modified files
**Analogs found:** 21 / 22

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `apps/worker/src/schedule.ts` | driving-adapter / composition | batch wiring | `apps/worker/src/main.ts` | exact (extract + extend) |
| `apps/worker/src/main.ts` | composition root | wiring | self (modified) | n/a — modify only |
| `apps/worker/src/handlers/sync-fills.ts` | driving-adapter handler | event-driven | `apps/worker/src/handlers/fetch-schwab-chain.ts` | role-match |
| `apps/worker/src/handlers/sync-fills.test.ts` | test | unit | `apps/worker/src/handlers/compute-bsm-greeks.test.ts` | role-match |
| `apps/worker/src/handlers/refresh-tokens.ts` | driving-adapter handler | event-driven | `apps/worker/src/handlers/fetch-schwab-chain.ts` | role-match |
| `apps/worker/src/handlers/refresh-tokens.test.ts` | test | unit | `apps/worker/src/handlers/compute-bsm-greeks.test.ts` | role-match |
| `apps/worker/src/handlers/rebuild-journal.ts` | driving-adapter handler | event-driven | `apps/worker/src/handlers/compute-bsm-greeks.ts` | role-match |
| `apps/worker/src/handlers/rebuild-journal.test.ts` | test | unit | `apps/worker/src/handlers/compute-bsm-greeks.test.ts` | role-match |
| `packages/core/src/journal/domain/calendar-event.ts` | domain type | transform | `packages/core/src/journal/application/ports.ts` | partial (types only) |
| `packages/core/src/journal/domain/fill-pairing.ts` | domain pure functions | transform | `packages/core/src/journal/domain/bsm.ts` | role-match |
| `packages/core/src/journal/domain/fill-pairing.test.ts` | test | unit + property | `packages/core/src/journal/domain/bsm.test.ts` | role-match |
| `packages/core/src/journal/application/ports.ts` | core port | request-response | self (extended) | n/a |
| `packages/core/src/journal/application/syncFills.ts` | application use-case | event-driven / CRUD | `packages/core/src/journal/application/snapshotCalendars.ts` | exact |
| `packages/core/src/journal/application/syncFills.test.ts` | test | unit | `packages/core/src/journal/application/snapshotCalendars.test.ts` | exact |
| `packages/core/src/journal/application/rebuildJournal.ts` | application use-case | CRUD | `packages/core/src/journal/application/snapshotCalendars.ts` | role-match |
| `packages/core/src/journal/application/rebuildJournal.test.ts` | test | unit | `packages/core/src/journal/application/snapshotCalendars.test.ts` | role-match |
| `packages/core/src/brokerage/application/refreshTokens.ts` | application use-case | request-response | `packages/core/src/brokerage/application/refreshToken.ts` | exact |
| `packages/core/src/brokerage/application/refreshTokens.test.ts` | test | unit | `packages/core/src/brokerage/application/refreshToken.test.ts` | exact |
| `packages/adapters/src/postgres/schema.ts` | schema | CRUD | self (extended) | n/a |
| `packages/adapters/src/postgres/repos/calendar-events.ts` | driven-adapter repo | CRUD | `packages/adapters/src/postgres/repos/calendar-snapshots.ts` | exact |
| `packages/adapters/src/postgres/repos/calendar-events.contract.test.ts` | test | integration | `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` | exact |
| `packages/adapters/src/postgres/repos/orphan-fills.ts` | driven-adapter repo | CRUD | `packages/adapters/src/postgres/repos/calendar-snapshots.ts` | role-match |
| `packages/adapters/src/postgres/repos/orphan-fills.contract.test.ts` | test | integration | `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` | role-match |
| `packages/adapters/src/postgres/repos/job-runs.ts` | driven-adapter repo | CRUD | self (modified — extend TRACKED_JOBS) | n/a |
| `packages/adapters/src/memory/calendar-events.ts` | in-memory twin | CRUD | `packages/adapters/src/memory/calendar-snapshots.ts` | exact |
| `packages/adapters/src/memory/orphan-fills.ts` | in-memory twin | CRUD | `packages/adapters/src/memory/broker-tokens.ts` | role-match |
| `apps/server/src/adapters/http/jobs.routes.ts` | driving-adapter HTTP | request-response | `apps/server/src/adapters/http/calendar.routes.ts` | exact |
| `apps/server/src/adapters/mcp/tools/trigger-job.ts` | driving-adapter MCP | request-response | `apps/server/src/adapters/mcp/tools.ts` (registerGetJournalTool) | exact |
| `packages/adapters/src/postgres/migrations/0004_calendar_events.sql` | migration | n/a | `packages/adapters/src/postgres/schema.ts` | n/a — drizzle-kit generate |

---

## Pattern Assignments

### `apps/worker/src/schedule.ts` (driving-adapter, batch wiring)

**Analog:** `apps/worker/src/main.ts` — extract queue/schedule/work blocks from here.

**Core extraction pattern** (main.ts lines 183–217):
```typescript
// createQueue — idempotent, must precede schedule/work (CR-01)
await boss.createQueue("fetch-schwab-chain");
await boss.createQueue("fetch-rates");
await boss.createQueue("compute-bsm-greeks");
await boss.createQueue("snapshot-calendars"); // chain-triggered only; no schedule (D-03)
// NEW for Phase 5:
await boss.createQueue("sync-fills");
await boss.createQueue("refresh-tokens");
await boss.createQueue("rebuild-journal"); // on-demand only; no schedule

// boss.schedule — idempotent
await boss.schedule("fetch-schwab-chain", "*/30 * * * 1-5", null, { tz: "America/New_York" });
await boss.schedule("fetch-rates", "0 9 * * 1-5", null, { tz: "America/New_York" });
await boss.schedule("compute-bsm-greeks", "0 10-16 * * 1-5", null, { tz: "America/New_York" });
// NEW:
await boss.schedule("sync-fills", "*/10 9-16 * * 1-5", null, { tz: "America/New_York" });
await boss.schedule("refresh-tokens", "0 4 * * *", null, { tz: "America/New_York" });
// snapshot-calendars: NO schedule — chain-triggered only by compute-bsm-greeks (Pitfall 2)
// rebuild-journal: NO schedule — on-demand only via trigger_job

// boss.work — array handler pattern (Pitfall 2, pg-boss v12)
await boss.work("fetch-schwab-chain", { pollingIntervalSeconds: 30 }, fetchSchwabChainHandler);
```

**Schedule signature** (new export):
```typescript
// apps/worker/src/schedule.ts
export async function registerAllJobs(boss: PgBoss, handlers: AllHandlers): Promise<void> {
  // createQueue → schedule → work in that order
}
```

**main.ts change:** Import `registerAllJobs` from `./schedule.ts`; delete the inline queue/schedule/work blocks.

---

### `apps/worker/src/handlers/sync-fills.ts` (driving-adapter handler, event-driven)

**Analog:** `apps/worker/src/handlers/fetch-schwab-chain.ts`

**Imports pattern** (fetch-schwab-chain.ts lines 1–6):
```typescript
import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSyncFills } from "@morai/core"; // new port
```

**Handler factory + array-guard + RTH gate pattern** (fetch-schwab-chain.ts lines 59–109):
```typescript
export function makeSyncFillsHandler(
  deps: SyncFillsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // RTH + NYSE holiday gate (sync-fills only runs during market hours)
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("sync-fills: skipping — outside RTH or NYSE holiday");
      return;
    }

    // Zod-parse job payload at handler boundary
    const payloadResult = syncFillsPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(`sync-fills: invalid payload: ${payloadResult.error.message}`);
    }

    const result = await deps.syncFillsUseCase(payloadResult.data);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
}
```

**Error handling pattern** (fetch-schwab-chain.ts lines 96–98):
```typescript
// Throw to signal failure to pg-boss — marks job as failed for retry/alerting
throw new Error(result.error.message);
```

---

### `apps/worker/src/handlers/refresh-tokens.ts` (driving-adapter handler, event-driven)

**Analog:** `apps/worker/src/handlers/fetch-schwab-chain.ts`

**Key difference from other handlers:** NO RTH gate (per D-13, Pitfall 5 in RESEARCH.md).

**Pattern:**
```typescript
export function makeRefreshTokensHandler(
  deps: RefreshTokensHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    if (job === undefined) return;

    // No RTH gate — runs at 04:00 ET outside market hours by design (D-13, Pitfall 5)

    const result = await deps.refreshTokensUseCase();
    // Handler does NOT throw on per-app failure — both apps always attempted (D-13).
    // Per-app failures are surfaced via result fields + console.warn, not throw.
    if (!result.ok) {
      // Never reached (makeRefreshTokensUseCase returns ok() always — see RESEARCH §refreshTokens)
      console.warn("refresh-tokens: unexpected err result", result.error);
      return;
    }
    const { trader, market } = result.value;
    if (!trader.ok) {
      console.warn(`refresh-tokens: trader refresh failed: ${trader.error ?? "unknown"}`);
    }
    if (!market.ok) {
      console.warn(`refresh-tokens: market refresh failed: ${market.error ?? "unknown"}`);
    }
    if (trader.warnExpirySoon || market.warnExpirySoon) {
      console.warn("refresh-tokens: one or more apps have a refresh token expiring within 1 day — re-auth required");
    }
  };
}
```

---

### `apps/worker/src/handlers/rebuild-journal.ts` (driving-adapter handler, event-driven)

**Analog:** `apps/worker/src/handlers/compute-bsm-greeks.ts`

Thin handler: array-guard → Zod-parse payload (`{ calendarId: z.string().uuid() }`) → call use-case → map Result → throw on error. No RTH gate (on-demand job).

**Core pattern** (compute-bsm-greeks.ts lines 32–62):
```typescript
export function makeRebuildJournalHandler(
  deps: RebuildJournalHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    if (job === undefined) return;
    // No RTH gate — on-demand job

    const payloadResult = rebuildJournalPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(`rebuild-journal: invalid payload: ${payloadResult.error.message}`);
    }
    const result = await deps.rebuildJournalUseCase(payloadResult.data.calendarId);
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
}
```

---

### `packages/core/src/journal/domain/fill-pairing.ts` (domain pure functions, transform)

**Analog:** `packages/core/src/journal/domain/bsm.ts` — pure numeric domain functions.

**Imports pattern** (bsm.ts):
```typescript
// packages/core/src/journal/domain/fill-pairing.ts
// No imports from adapters. Only @morai/shared + intra-domain types.
import type { Result } from "@morai/shared";
// (no ok/err needed if functions are pure transforms that don't fail)
```

**Function signatures to implement** (one per exported function, no body coupling):
```typescript
// classifyFill: positionEffect + side → "OPEN" | "CLOSE" | "UNKNOWN"
export function classifyFill(
  side: "buy" | "sell",
  positionEffect: "OPENING" | "CLOSING" | "UNKNOWN",
): "OPEN" | "CLOSE" | "UNKNOWN"

// aggregatePartialFills: group fills by (calendarId, legOccSymbol, orderId) → AggregatedFill
export function aggregatePartialFills(fills: ReadonlyArray<RawFill>): ReadonlyArray<AggregatedFill>
// AggregatedFill: { sumQty, avgPrice, totalCommission, totalFees, ... }

// computePnl: (openDebit, closeCredit, totalFees) → realizedPnl (D-08/D-09)
// realizedPnl = |closeCredit| - openDebit - totalFees
export function computePnl(openDebit: number, closeCredit: number, totalFees: number): number

// detectRoll: (closingGroup, openingGroup) → boolean (D-03)
// Same calendar + same orderId + same underlying/strike/type + different expiry
export function detectRoll(closing: AggregatedFill, opening: AggregatedFill): boolean

// hashFillIds: sorted fill UUIDs → SHA-256 hex string (idempotency key)
// Use import { createHash } from "node:crypto"
export function hashFillIds(ids: ReadonlyArray<string>): string
```

**Property-test pattern** (bsm.test.ts, fast-check):
- `computePnl` monotonicity: increasing `closeCredit` → increasing P&L
- `aggregatePartialFills` round-trip: sumQty === sum of individual fill qtys
- `classifyFill` completeness: every (side, positionEffect) pair maps to one of the three values

---

### `packages/core/src/journal/application/syncFills.ts` (application use-case, event-driven)

**Analog:** `packages/core/src/journal/application/snapshotCalendars.ts`

**Imports pattern** (snapshotCalendars.ts lines 1–33):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingUnprocessedFills,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  StorageError,
} from "./ports.ts";
import { classifyFill, aggregatePartialFills, computePnl, detectRoll, hashFillIds } from "../domain/fill-pairing.ts";
```

**Factory + Deps pattern** (snapshotCalendars.ts lines 38–47):
```typescript
export type SyncFillsDeps = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly storeOrphanFill: ForStoringOrphanFill;
  readonly now: () => Date;
};

export type ForRunningSyncFills = () => Promise<Result<void, StorageError>>;

export function makeSyncFillsUseCase(deps: SyncFillsDeps): ForRunningSyncFills {
  return async (): Promise<Result<void, StorageError>> => {
    // 1. Read unprocessed fills (excluding already-seen fillIdsHash)
    // 2. Parse each fill's OCC symbol
    // 3. Match to calendar legs — unmatched → orphan_fills (D-05)
    // 4. Aggregate partial fills per (calendarId, legOccSymbol, orderId) (D-04)
    // 5. Classify OPEN/CLOSE/ROLL (D-02/D-03) using classifyFill/detectRoll
    // 6. Compute P&L on CLOSE/ROLL events (D-08/D-09) using computePnl
    // 7. storeCalendarEvent (onConflictDoNothing on fillIdsHash) — idempotent
    // 8. Return ok(undefined) or propagate StorageError
  };
}
```

**Error pattern** (snapshotCalendars.ts lines 143–168):
```typescript
const fillsResult = await deps.readUnprocessedFills();
if (!fillsResult.ok) return err(fillsResult.error);
// ... per-item errors treated as orphans, not abort (D-05)
const storeResult = await deps.storeCalendarEvent(event);
if (!storeResult.ok) return err(storeResult.error);
return ok(undefined);
```

---

### `packages/core/src/journal/application/rebuildJournal.ts` (application use-case, CRUD)

**Analog:** `packages/core/src/journal/application/snapshotCalendars.ts`

**Pattern:** factory returning `(calendarId: string) => Promise<Result<void, StorageError>>`.

Steps: delete all `calendar_events` for `calendarId` → reset `calendars.openNetDebit / closeNetCredit` → re-run `syncFillsUseCase` scoped to that calendar.

```typescript
export type RebuildJournalDeps = {
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;  // DELETE WHERE calendar_id = ?
  readonly resetCalendarAmounts: ForResettingCalendarAmounts; // UPDATE calendars SET openNetDebit=NULL, closeNetCredit=NULL
  readonly syncFillsForCalendar: (calendarId: string) => Promise<Result<void, StorageError>>;
  readonly now: () => Date;
};

export function makeRebuildJournalUseCase(deps: RebuildJournalDeps) {
  return async (calendarId: string): Promise<Result<void, StorageError>> => {
    const del = await deps.deleteCalendarEvents(calendarId);
    if (!del.ok) return err(del.error);
    const reset = await deps.resetCalendarAmounts(calendarId);
    if (!reset.ok) return err(reset.error);
    return deps.syncFillsForCalendar(calendarId);
  };
}
```

---

### `packages/core/src/brokerage/application/refreshTokens.ts` (application use-case)

**Analog:** `packages/core/src/brokerage/application/refreshToken.ts`

**Imports pattern** (refreshToken.ts lines 1–22):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  AuthExpiredError,
  StorageError,
  ForRefreshingToken,
} from "./ports.ts";
```

**Promise.allSettled independence pattern** (RESEARCH.md Pattern 3):
```typescript
export type RefreshTokensResult = {
  readonly trader: { ok: boolean; error?: string; warnExpirySoon: boolean };
  readonly market: { ok: boolean; error?: string; warnExpirySoon: boolean };
};

export function makeRefreshTokensUseCase(deps: {
  readonly refreshTraderToken: ForRefreshingToken;
  readonly refreshMarketToken: ForRefreshingToken;
  readonly readTokenFreshness: ForReadingTokenFreshness;
  readonly now: () => Date;
}): () => Promise<Result<RefreshTokensResult, never>> {
  return async () => {
    // D-13: both apps always attempted — Promise.allSettled never short-circuits
    const [traderOutcome, marketOutcome] = await Promise.allSettled([
      deps.refreshTraderToken("trader"),
      deps.refreshMarketToken("market"),
    ]);
    // D-14: proactive expiry warning using refreshIssuedAt
    const freshnessResult = await deps.readTokenFreshness();
    // compute warnExpirySoon via isNearExpiry(refreshIssuedAt, now) — pure domain fn
    // Return ok() always; per-app failures surfaced in result fields, not via throw
    return ok({ trader: {...}, market: {...} });
  };
}
```

**Token-never-logged rule** (refreshToken.ts comment pattern): Only `appId` in error messages. Never log `accessToken`, `refreshToken`, or `TOKEN_ENCRYPTION_KEY`.

---

### `packages/adapters/src/postgres/schema.ts` (extended)

**Analog:** self — existing `pgTable` declarations in schema.ts lines 1–64.

**New enum + table patterns** (schema.ts lines 29–64):
```typescript
// New enum — additive, no existing enum changed
export const calendarEventTypeEnum = pgEnum("calendar_event_type", [
  "OPEN",
  "CLOSE",
  "ROLL",
]);

// calendar_events table — FK to calendars (same uuid pattern)
export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  calendarId: uuid("calendar_id").notNull(),              // FK → calendars.id
  eventType: calendarEventTypeEnum("event_type").notNull(),
  eventedAt: timestamp("evented_at", { withTimezone: true }).notNull(),
  fillIdsHash: varchar("fill_ids_hash", { length: 64 }).notNull().unique(), // SHA-256 hex
  legOccSymbol: varchar("leg_occ_symbol", { length: 32 }).notNull(),
  rolledFromOccSymbol: varchar("rolled_from_occ_symbol", { length: 32 }),
  qty: integer("qty").notNull(),
  avgPrice: numeric("avg_price").notNull(),
  netAmount: numeric("net_amount").notNull(),
  realizedPnl: numeric("realized_pnl"),
  legBreakdown: text("leg_breakdown"),               // JSON string: per-leg amounts
  entryThesis: text("entry_thesis"),                 // D-07: free text hook
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

// orphan_fills — PK is the fill UUID (append-only, upsert on fillId)
export const orphanFills = pgTable("orphan_fills", {
  fillId: uuid("fill_id").primaryKey(),
  occSymbol: varchar("occ_symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(),
  qty: integer("qty").notNull(),
  price: numeric("price").notNull(),
  filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```

**`calendars` table extension** (D-07): add `entryThesis: text("entry_thesis")` — nullable, no default.

---

### `packages/adapters/src/postgres/repos/calendar-events.ts` (driven-adapter repo)

**Analog:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts`

**File header + imports** (calendar-snapshots.ts lines 1–31):
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForDeletingCalendarEvents,
  StorageError,
} from "@morai/core";
import { calendarEvents } from "../schema.ts";
import type { Db } from "../db.ts";
```

**Idempotent insert pattern** (calendar-snapshots.ts lines 44–77):
```typescript
const storeCalendarEvent: ForStoringCalendarEvent = async (row): Promise<Result<void, StorageError>> => {
  try {
    await db
      .insert(calendarEvents)
      .values({ ...row })
      .onConflictDoNothing(); // idempotent on fillIdsHash unique constraint
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err<StorageError>({ kind: "storage-error", message });
  }
};
```

**Error wrapping pattern** (calendar-snapshots.ts lines 73–76 — apply to ALL repo methods):
```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

---

### `packages/adapters/src/postgres/repos/orphan-fills.ts` (driven-adapter repo)

**Analog:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts` — same structure, different table.

Upsert pattern: `onConflictDoNothing` on `fillId` PK (orphan row for a fill is idempotent).

---

### `packages/adapters/src/memory/calendar-events.ts` (in-memory twin)

**Analog:** `packages/adapters/src/memory/calendar-snapshots.ts`

**File structure** (calendar-snapshots.ts lines 1–113):
```typescript
// Map key: fillIdsHash (unique constraint equivalent)
const store = new Map<string, CalendarEventRow>();

const storeCalendarEvent: ForStoringCalendarEvent = async (row) => {
  if (!store.has(row.fillIdsHash)) store.set(row.fillIdsHash, row); // onConflictDoNothing
  return ok(undefined);
};

// seedCalendar equivalent: seedContext for contract tests
// Expose seed() + countEvents() for test helpers
```

**Twin parity rule** (architecture-boundaries.md §8): Every method on the Postgres repo has an in-memory equivalent with identical semantics.

---

### `packages/adapters/src/memory/orphan-fills.ts` (in-memory twin)

**Analog:** `packages/adapters/src/memory/broker-tokens.ts`

Map backed by `fillId` PK. Expose `seed()` and `getAll()` for test helpers.

---

### `packages/adapters/src/__contract__/calendar-events.contract.ts` + test files

**Analog:** `packages/adapters/src/__contract__/calendar-snapshots.contract.ts`

**Contract test structure** (calendar-snapshots.contract.ts lines 107–130):
```typescript
// Export runCalendarEventsContractTests(makeRepo, getSeedContext)
// Test cases: insert → 1 row; same fillIdsHash twice → 1 row (idempotent);
// different fillIdsHash → 2 rows; readByCalendar returns correct rows;
// deleteCalendarEvents removes all rows for calendarId
export function runCalendarEventsContractTests(
  makeRepo: (seed: SeedContext) => CalendarEventsRepo,
  getSeedContext: () => SeedContext,
): void {
  describe("calendar-events persistence contract", () => { ... });
}
```

**In-memory contract test** (memory/calendar-snapshots.contract.test.ts lines 1–40):
```typescript
// memory/calendar-events.contract.test.ts
import { describe } from "vitest";
import { runCalendarEventsContractTests } from "../__contract__/calendar-events.contract.ts";
import { makeMemoryCalendarEventsRepo } from "./calendar-events.ts";
// No Docker — always runs
```

**Postgres contract test** (postgres/repos/calendar-snapshots.contract.test.ts pattern):
```typescript
// postgres/repos/calendar-events.contract.test.ts
// testcontainers + runMigrations — real Postgres
```

---

### `packages/adapters/src/postgres/repos/job-runs.ts` (modified)

**Analog:** self — one-line change to TRACKED_JOBS constant (line 8).

```typescript
// Before:
const TRACKED_JOBS = ["fetch-cboe-chain", "fetch-rates", "compute-bsm-greeks"] as const;

// After (Phase 5):
const TRACKED_JOBS = [
  "fetch-schwab-chain",   // renamed from fetch-cboe-chain (State of the Art in RESEARCH.md)
  "fetch-rates",
  "compute-bsm-greeks",
  "snapshot-calendars",
  "sync-fills",
  "refresh-tokens",
  "rebuild-journal",
] as const;
```

Also update the inline SQL `WHERE name IN (...)` on line 85 to use the new list.

---

### `apps/server/src/adapters/http/jobs.routes.ts` (driving-adapter HTTP)

**Analog:** `apps/server/src/adapters/http/calendar.routes.ts`

**Imports pattern** (calendar.routes.ts lines 1–13):
```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { ForEnqueueingJob } from "@morai/core";
```

**Route pattern** (calendar.routes.ts lines 28–70):
```typescript
export function jobsRoutes(enqueueJob: ForEnqueueingJob) {
  const router = new Hono();

  const TRIGGERABLE_JOBS = ["rebuild-journal", "sync-fills", "refresh-tokens", "compute-bsm-greeks"] as const;
  const triggerJobParam = z.object({ name: z.enum(TRIGGERABLE_JOBS) });
  const triggerJobBody = z.object({ calendarId: z.string().uuid().optional() });

  router.post(
    "/jobs/:name/trigger",
    zValidator("param", triggerJobParam),
    zValidator("json", triggerJobBody),
    async (c) => {
      const { name } = c.req.valid("param");
      const body = c.req.valid("json");
      const result = await enqueueJob(name, body);
      if (!result.ok) {
        return c.json({ error: result.error.message }, 422);
      }
      return c.json({ jobId: result.value }, 202);
    },
  );

  return router;
}
```

---

### `apps/server/src/adapters/mcp/tools/trigger-job.ts` (driving-adapter MCP)

**Analog:** `apps/server/src/adapters/mcp/tools.ts` — `registerGetJournalTool` (lines 113–166)

**Pattern** (tools.ts lines 113–166):
```typescript
export function registerTriggerJobTool(
  server: McpServer,
  enqueueJob: ForEnqueueingJob,
): void {
  server.registerTool(
    "trigger_job",
    {
      title: "Trigger Job",
      description: "Manually trigger a background job by name.",
      inputSchema: {
        name: z.enum(["rebuild-journal", "sync-fills", "refresh-tokens", "compute-bsm-greeks"]),
        calendarId: z.string().uuid().optional(),
      },
    },
    async (args) => {
      // safeParse at boundary — Pitfall 6 pattern from tools.ts
      const parsed = z.object({
        name: z.enum(["rebuild-journal", "sync-fills", "refresh-tokens", "compute-bsm-greeks"]),
        calendarId: z.string().uuid().optional(),
      }).safeParse(args);
      if (!parsed.success) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid params" }) }] };
      }
      const result = await enqueueJob(parsed.data.name, { calendarId: parsed.data.calendarId });
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ jobId: result.value }) }] };
    },
  );
}
```

---

## Shared Patterns

### Result<T, E> — all fallible operations in core

**Source:** `packages/shared/src/result.ts`
**Apply to:** all use-case factories, repo methods, port implementations

```typescript
// packages/shared/src/result.ts
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });
```

**Usage:** `if (!result.ok) return err(result.error);` — never `throw` inside use-cases.

---

### Zod at Boundaries — handler payload parsing

**Source:** `apps/server/src/adapters/http/calendar.routes.ts` lines 36–44, `apps/server/src/adapters/mcp/tools.ts` lines 129–138
**Apply to:** all job handlers (Zod-parse `job.data`), HTTP routes, MCP tools

```typescript
// Handler: safeParse job payload before use
const payloadResult = myPayloadSchema.safeParse(job.data);
if (!payloadResult.success) {
  throw new Error(`handler-name: invalid payload: ${payloadResult.error.message}`);
}
// MCP tool: safeParse args before calling use-case
const parsed = myInputSchema.safeParse(args);
if (!parsed.success) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: "invalid params" }) }] };
}
```

---

### StorageError wrapping — all Postgres repo methods

**Source:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts` lines 73–76
**Apply to:** every `try/catch` in calendar-events.ts, orphan-fills.ts repos

```typescript
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err<StorageError>({ kind: "storage-error", message });
}
```

---

### pg-boss array-guard — all handlers

**Source:** `apps/worker/src/handlers/compute-bsm-greeks.ts` lines 34–36
**Apply to:** sync-fills.ts, refresh-tokens.ts, rebuild-journal.ts handlers

```typescript
// Pitfall 2 (pg-boss v12): array element can be undefined
if (job === undefined) return;
```

---

### Port naming — ForVerbingNoun function types

**Source:** `packages/core/src/journal/application/ports.ts` lines 95–354
**Apply to:** all new ports in `packages/core/src/journal/application/ports.ts`

New ports to add:
- `ForStoringCalendarEvent` — write one calendar_events row
- `ForReadingCalendarEvents` — read events by calendarId
- `ForDeletingCalendarEvents` — delete all events for calendarId (rebuild-journal)
- `ForReadingUnprocessedFills` — read fills not yet in calendar_events or orphan_fills
- `ForReadingCalendarLegs` — read calendar + leg OCC symbols for matching
- `ForStoringOrphanFill` — write one orphan_fills row
- `ForResettingCalendarAmounts` — set openNetDebit/closeNetCredit to NULL on calendars
- `ForEnqueueingJob` — call pg-boss.send(name, payload, singletonKey)
- `ForRefreshingTokens` — the multi-app refresh use-case driver port

---

### onConflictDoNothing — idempotent inserts

**Source:** `packages/adapters/src/postgres/repos/calendar-snapshots.ts` line 51
**Apply to:** calendar-events repo `storeCalendarEvent` (on `fillIdsHash` unique), orphan-fills repo `storeOrphanFill` (on `fillId` PK)

```typescript
await db.insert(calendarEvents).values(row).onConflictDoNothing();
```

---

### In-memory twin — seedCalendar + seedLegSnapshot pattern

**Source:** `packages/adapters/src/memory/calendar-snapshots.ts` lines 40–53
**Apply to:** memory/calendar-events.ts, memory/orphan-fills.ts

Each twin exposes:
- Port methods (identical signature to Postgres repo)
- `seed*(...)` helpers for test setup
- `count*()` / `getAll()` for assertion in contract tests

---

### MCP tool + HTTP route — ship in same PR (MCP-02)

**Source:** `apps/server/src/adapters/mcp/tools.ts` + `apps/server/src/adapters/http/calendar.routes.ts`
**Apply to:** `trigger_job` MCP tool + `POST /api/jobs/:name/trigger` HTTP route

Both adapters call the same `ForEnqueueingJob` use-case. Same Zod schema for the `TRIGGERABLE_JOBS` enum. Same `{ jobId: string }` response shape.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/core/src/journal/domain/calendar-event.ts` | domain type | transform | No existing domain-event type in codebase; closest is `ports.ts` type definitions, but this is a new ADT. Pattern: readonly discriminated union + `pgEnum` values mirrored as literal union. |

---

## Metadata

**Analog search scope:** `apps/worker/src/`, `apps/server/src/adapters/`, `packages/core/src/`, `packages/adapters/src/`
**Files scanned:** 29 source files
**Pattern extraction date:** 2026-06-21

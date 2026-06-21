# Phase 05: Jobs, Fill Rebuild & Integrity — Research

**Researched:** 2026-06-21
**Domain:** pg-boss job scheduling, fill→event pairing logic, Drizzle schema design, refresh-token lifecycle
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Fill → event pairing (JRNL-01)**
- D-01: Auto-match each Schwab fill to a calendar leg by parsing `fills.occSymbol` (OCC 21-char → underlying + expiry + strike + put/call) and matching the calendar's defined legs. No manual tagging in the happy path. Reuse Phase 4 `parseSchwabSymbol` / `formatOccSymbol`.
- D-02: Classify each fill OPEN (establishes/increases the intended leg) vs CLOSE (reduces/unwinds it), cross-checked against the calendar's `openedAt`/`closedAt`.
- D-03 (ROLL is first-class): ROLL is its own event type — NOT a bare close+open. References both legs, preserving the "same trade continued" chain.
- D-04: Aggregate partial/multiple fills per leg — sum qty, qty-weighted average price.
- D-05: Fills matching no calendar → parked as `orphan` for later review. Never silently dropped; never auto-create a calendar.

**Journal event model**
- D-06: Phase 5 introduces `calendar_events` table (OPEN/CLOSE/ROLL) as the trade-ledger layer, distinct from the 30-min greeks `calendar_snapshots`.
- D-07 (entry-thesis hook): Add a MINIMAL free-text/tag "entry thesis" field per calendar (or per OPEN event) — explicitly NOT a rules engine.

**P&L / net debit-credit (JRNL-01)**
- D-08: Include commissions + fees in net debit/credit. Sign: open debit positive, close credit negative.
- D-09: P&L = close credit − open debit − fees. Store BOTH the net-calendar number AND a per-leg breakdown. Populates `calendars.openNetDebit` / `closeNetCredit` + the event/leg records.

**rebuild-journal scope (JRNL-01 / SC5)**
- D-10: `rebuild-journal` reconstructs ONLY the event/position layer (OPEN/CLOSE/ROLL + net debit/credit/P&L) from fills, idempotently. Does NOT re-derive 30-min greeks snapshots. SC5 "reconcile" means position/P&L fields only.

**Jobs backbone (JOB-01)**
- D-11: All jobs run behind the `JobQueue` port (pg-boss adapter) with deterministic dedupe keys + idempotent, Zod-parsed handlers (re-run produces no duplicate rows).
- D-12: All existing handlers + new `sync-fills` / `refresh-tokens` registered in new `apps/worker/src/schedule.ts`; surfaced in `/api/status` `lastJobRuns`.

**refresh-tokens job (JOB-02)**
- D-13: Runs 04:00 ET; refreshes both Schwab apps INDEPENDENTLY; one failure does not block the other; failures surface via per-app `/api/status` flag + log.
- D-14 (proactive expiry warning): Daily check warns when refresh token nears 7-day hard expiry. Channel this phase = status flag + log only.

**compute-bsm-greeks backfill (JOB-03)**
- D-15: Drains `leg_observations WHERE bsm_iv IS NULL AND mark IS NOT NULL`, upserts computed IV/greeks, idempotent. SC3 = zero such rows remain after a run.

### Claude's Discretion

`calendar_events` table shape + how ROLL references its legs; dedupe-key shapes per job; orphan-review surface; leg-match tolerance + multi-calendar tie-breaking; pg-boss retry / dead-letter config; `trigger_job` MCP tool + HTTP route (SC5, MCP-02); RTH gating reuse.

### Deferred Ideas (OUT OF SCOPE)

- L3 — P&L attribution (Phase 6)
- L4 — Strategy rules / logical gates (NEW roadmap phase)
- Historical-snapshot replay (re-fetch historical chains to recompute 30-min greeks)
- email/Slack notification channel for token failure / pre-expiry alerts
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| JOB-01 | All jobs run behind a `JobQueue` port (pg-boss adapter) with deterministic dedupe keys and idempotent, Zod-parsed handlers | See §Standard Stack (pg-boss v12.18.3), §Architecture Patterns (schedule.ts pattern, dedupe-key shapes), §Common Pitfalls (singletonKey vs singletonSeconds) |
| JOB-02 | The `refresh-tokens` job (04:00 ET) refreshes both Schwab apps independently and alerts on failure | See §Architecture Patterns (refresh-tokens handler design), §Common Pitfalls (one-app-failure isolation) |
| JOB-03 | `compute-bsm-greeks` drains `leg_observations WHERE bsm_iv IS NULL` and upserts computed values | Already wired in existing `compute-bsm-greeks.ts` handler; Phase 5 registers it in schedule.ts with correct dedupe key. SC3 verified by partial-index query |
| JRNL-01 | A `sync-fills` / rebuild path pairs Schwab fills into calendar OPEN/CLOSE events with net debit/credit/P&L — journal history is rebuilt from fills, never hand-written | See §calendar_events Table Design, §Fill→Event Pairing Logic, §rebuild-journal Idempotency |
</phase_requirements>

---

## Summary

Phase 5 delivers two independent capabilities wired together by the `JobQueue` port abstraction. The first capability is the jobs backbone: extracting scheduling configuration out of `main.ts` and into a `schedule.ts` file, adding `refresh-tokens` and `sync-fills` jobs to the queue, and surfacing all job runs in `/api/status`. The second capability — and the most algorithmically complex — is the fill-to-event pairing system: a `sync-fills` job reads Schwab `fills` rows, parses each fill's OCC symbol using the already-built `parseSchwabSymbol`/`formatOccSymbol` pair, matches fills to calendar legs, aggregates partial fills, classifies events as OPEN/CLOSE/ROLL, computes P&L including commissions, writes `calendar_events` rows idempotently, and parks unmatched fills as orphans.

The `rebuild-journal` capability is a special-case wrapper around the same pairing logic: it deletes then re-inserts all `calendar_events` for one calendar from fills, making the event layer reconstructable at any time. The reconciliation check (SC5) compares only position/P&L fields from `calendar_events` against `calendars.openNetDebit` / `closeNetCredit` — not the greeks time-series in `calendar_snapshots`.

The entire phase is constrained by the strict hexagonal boundary: `calendar_events` schema changes go through Drizzle migrations; the `sync-fills` use-case lives in `packages/core/src/journal/application/`; its ports are fine-grained function types; and every driven port ships an in-memory twin in the same PR (architecture-boundaries.md §8). TDD red→green is mandatory throughout.

**Primary recommendation:** Introduce `calendar_events` and `orphan_fills` tables in a single new Drizzle migration; build `sync-fills` use-case with pure domain logic for OPEN/CLOSE/ROLL classification; wire all seven jobs in a new `schedule.ts`; ship HTTP + MCP `trigger_job` adapter for `rebuild-journal`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fill parsing (OCC symbol decode) | Domain (`packages/core/src/journal/domain/`) | Adapters (reuse `parseSchwabSymbol`) | Pure function; no I/O; belongs with domain math |
| OPEN/CLOSE/ROLL classification | Domain (`packages/core/src/journal/domain/`) | — | Pure function over fill + calendar fields |
| P&L computation (D-08/D-09) | Domain | — | Pure arithmetic; should be property-tested |
| Fill aggregation (D-04 partial fills) | Domain | — | Pure reduce; no I/O |
| sync-fills orchestration | Application (`packages/core/src/journal/application/syncFills.ts`) | — | Reads fills + calendars → writes events; orchestrates ports |
| rebuild-journal orchestration | Application (`packages/core/src/journal/application/rebuildJournal.ts`) | — | Deletes events for one calendar + re-runs pairing |
| calendar_events Postgres repo | Adapters (`packages/adapters/src/postgres/repos/calendar-events.ts`) | Memory twin | Drizzle insert/upsert; idempotent on event_id PK |
| orphan_fills Postgres repo | Adapters (`packages/adapters/src/postgres/repos/orphan-fills.ts`) | Memory twin | Append-only orphan parking; upsert on fill_id |
| refresh-tokens handler | Worker (`apps/worker/src/handlers/refresh-tokens.ts`) | — | Thin adapter; calls use-case per app independently |
| refresh-tokens use-case | Application (`packages/core/src/brokerage/application/`) | — | Pure token-refresh orchestration; per-app isolation |
| Job scheduling | Worker (`apps/worker/src/schedule.ts`) | — | pg-boss specifics confined here; extracted from main.ts |
| /api/status lastJobRuns | Application (`getStatus` use-case) | — | Already built; extend `TRACKED_JOBS` list in job-runs.ts |
| trigger_job HTTP + MCP | Server adapters | — | MCP-02 cross-cut: both adapters in same PR |
| Drizzle migration | Adapters (`packages/adapters/src/postgres/migrations/`) | — | Schema is adapter concern |

---

## Standard Stack

### Core (all versions verified from workspace package.json and lock file)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pg-boss | 12.18.3 | Postgres-backed job queue | Already wired in worker; `singletonKey` provides natural dedupe; `retryLimit` + exponential backoff built-in [VERIFIED: workspace package.json] |
| drizzle-orm | 0.45.2 | Schema + migrations | Already in use; `onConflictDoNothing` / `onConflictDoUpdate` for idempotent inserts [VERIFIED: workspace package.json] |
| drizzle-kit | 0.31.10 | Schema migration generation | Already in use; `bunx drizzle-kit generate` → SQL in `packages/adapters/src/postgres/migrations/` [VERIFIED: workspace package.json] |
| zod | 4.4.3 | Job payload validation at boundaries | Project requirement; all handler boundaries Zod-parse payloads [VERIFIED: workspace package.json] |
| vitest | 4.1.8 | Test runner | Project standard [VERIFIED: workspace package.json] |
| testcontainers/postgresql | 12.0.1 | Real Postgres for repo tests | Already in use for Drizzle repos [VERIFIED: adapters/package.json] |
| msw | 2.14.6 | Mock Schwab HTTP for refresh-tokens tests | Already in use for HTTP adapter tests [VERIFIED: adapters/package.json] |

### Reused Assets (no new installs needed)

| Asset | Location | Reuse In |
|-------|----------|----------|
| `parseSchwabSymbol` | `packages/adapters/src/schwab/market/schwab-symbol.ts` | Fill→leg matching — already Phase 4 built |
| `formatOccSymbol` | `packages/shared/src/` | After `parseSchwabSymbol` to produce canonical OCC key |
| `isWithinRth` / `isNyseHoliday` | `packages/core/src/journal/domain/` | sync-fills RTH guard; refresh-tokens does NOT gate on RTH |
| `makeSchwabOAuthClient` / `refreshToken` use-case | `packages/adapters/src/schwab/auth/` and core | refresh-tokens job reuses the already-built refresh flow |
| `makePostgresBrokerTokensRepo` | `packages/adapters/src/postgres/repos/broker-tokens.ts` | refresh-tokens reads/writes token rows |
| `toAppTokenStatus` | `packages/core/src/brokerage/domain/token-freshness.ts` | Compute proactive expiry warning from `refreshIssuedAt` |
| `BrokerTransaction` | `packages/core/src/brokerage/application/ports.ts` | Domain type for fills fetched from Schwab |

**Installation:** No new packages needed — all required libraries already in workspace.

---

## Package Legitimacy Audit

No new external packages are introduced in Phase 5. All dependencies listed above are pre-existing in the workspace (`pg-boss`, `drizzle-orm`, `zod`, `vitest`, `testcontainers`, `msw`).

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| pg-boss | npm | Already in workspace | Approved (in use since Phase 2) |
| drizzle-orm | npm | Already in workspace | Approved (in use since Phase 1) |
| zod | npm | Already in workspace | Approved (in use since Phase 1) |
| vitest | npm | Already in workspace | Approved (in use since Phase 1) |
| testcontainers | npm | Already in workspace | Approved (in use since Phase 2) |
| msw | npm | Already in workspace | Approved (in use since Phase 2) |

**Packages removed due to SLOP verdict:** none
**Packages flagged as suspicious SUS:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Schwab Trader API
       │ (D-13: every 10 min RTH)
       ▼
  fetch-transactions ──▶ BrokerTransaction[]
                                │
                                ▼
              sync-fills use-case (core)
                 │
                 ├─ parseSchwabSymbol(fill.occSymbol)
                 │         │
                 │         ▼ OccSymbolParsed
                 │  match against calendars.legs
                 │         │
                 │   ┌─────┴──────┐
                 │ matched?    unmatched
                 │   │             │
                 │   ▼             ▼
                 │ aggregate    orphan_fills
                 │ partial fills  (upsert on fill_id)
                 │   │
                 │   ▼
                 │ classify OPEN / CLOSE / ROLL
                 │   │
                 │   ▼
                 │ compute P&L (D-08/D-09)
                 │   │
                 │   ▼
                 │ calendar_events INSERT
                 │ (idempotent: onConflictDoNothing)
                 │
                 └─▶ update calendars.openNetDebit
                         / closeNetCredit (D-09)

──────────────────────────────────────────────────

  schedule.ts (apps/worker)
       │
       ├─▶ "sync-fills"         every 10 min RTH
       ├─▶ "refresh-tokens"     04:00 ET daily
       ├─▶ "compute-bsm-greeks" every 1 min (drain)
       ├─▶ "fetch-schwab-chain" every 30 min RTH (existing)
       ├─▶ "fetch-rates"        09:00 ET daily (existing)
       └─▶ "rebuild-journal"    queue only, no schedule (on-demand)

──────────────────────────────────────────────────

  trigger_job HTTP POST /api/jobs/:name/trigger
       │
       ▼
  MCP trigger_job tool  ◀─── MCP-02: both adapters in same PR
       │
       ▼
  enqueueJob use-case → pg-boss.send(name, payload, {singletonKey})
```

### Recommended Project Structure (Phase 5 additions)

```
packages/core/src/journal/
├── domain/
│   ├── calendar-event.ts        # CalendarEvent domain type + OPEN/CLOSE/ROLL enum
│   ├── fill-pairing.ts          # classifyFill(), aggregatePartialFills(), computePnl()
│   └── (existing domain files)
├── application/
│   ├── ports.ts                 # NEW: ForStoringCalendarEvent, ForReadingFillsByCalendar,
│   │                            #      ForStoringOrphanFill, ForEnqueueingJob
│   ├── syncFills.ts             # NEW: makeSyncFillsUseCase
│   ├── rebuildJournal.ts        # NEW: makeRebuildJournalUseCase
│   ├── enqueueJob.ts            # NEW: makeEnqueueJobUseCase (trigger_job HTTP+MCP)
│   └── (existing use-cases)
packages/core/src/brokerage/
└── application/
    ├── refreshTokens.ts         # NEW: makeRefreshTokensUseCase (wraps existing refreshToken per app)
    └── (existing use-cases)

packages/adapters/src/
├── postgres/
│   ├── schema.ts                # EXTENDED: calendarEvents, orphanFills tables
│   ├── repos/
│   │   ├── calendar-events.ts   # NEW: makePostgresCalendarEventsRepo
│   │   └── orphan-fills.ts      # NEW: makePostgresOrphanFillsRepo
│   └── migrations/
│       └── 0004_calendar_events.sql  # NEW: drizzle-kit generate output
└── memory/
    ├── calendar-events.ts       # NEW: in-memory twin
    └── orphan-fills.ts          # NEW: in-memory twin

apps/worker/src/
├── schedule.ts                  # NEW: extracted from main.ts; all 7 queues + schedules
├── handlers/
│   ├── sync-fills.ts            # NEW
│   ├── refresh-tokens.ts        # NEW
│   └── (existing handlers)
└── main.ts                      # MODIFIED: import schedule.ts; remove inline schedule config

apps/server/src/adapters/
├── http/
│   └── jobs.routes.ts           # NEW: POST /api/jobs/:name/trigger
└── mcp/
    └── tools/
        └── trigger-job.ts       # NEW: MCP trigger_job tool (MCP-02)
```

### Pattern 1: Deterministic Dedupe Keys Per Job Type

Scheduled jobs use a window-start key; fill-based jobs use fill-set fingerprint.

```typescript
// Source: docs/architecture/jobs.md — "Deterministic dedupe keys"

// Scheduled jobs: name + window start rounded to cadence boundary
function scheduledDedupeKey(jobName: string, now: Date, windowMinutes: number): string {
  const windowMs = windowMinutes * 60 * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  return `${jobName}:${windowStart.toISOString()}`;
}
// e.g. "sync-fills:2026-06-21T14:10:00.000Z"

// On-demand / rebuild: calendar-scoped key
function rebuildDedupeKey(calendarId: string): string {
  return `rebuild-journal:${calendarId}`;
}

// pg-boss send with singletonKey — second enqueue within same window is a no-op
await boss.send(
  "sync-fills",
  payload,
  { singletonKey: scheduledDedupeKey("sync-fills", now, 10) }
);
```

### Pattern 2: Idempotent calendar_events Insert

```typescript
// Source: existing pattern from calendar-snapshots.ts (onConflictDoNothing on composite PK)
// calendar_events composite PK: (calendar_id, event_type, fill_ids_hash) or UUID PK with
// unique constraint on the business key that identifies one pairing.

// Recommended: UUID PK + unique index on (calendar_id, fill_id_set_hash)
// fill_id_set_hash = sha256(sorted fill UUIDs that compose this event)
await db.insert(calendarEvents)
  .values(row)
  .onConflictDoNothing(); // idempotent: same fills → same hash → skip
```

### Pattern 3: refresh-tokens Independent Per-App

```typescript
// Source: docs/architecture/jobs.md + D-13 decision
// Each app runs in its own try/catch; one error does not throw globally.
async function refreshBothApps(deps: RefreshTokensDeps): Promise<RefreshReport> {
  const [traderResult, marketResult] = await Promise.allSettled([
    deps.refreshApp("trader"),
    deps.refreshApp("market"),
  ]);
  return {
    trader: traderResult.status === "fulfilled" ? traderResult.value : { ok: false, error: traderResult.reason },
    market: marketResult.status === "fulfilled" ? marketResult.value : { ok: false, error: marketResult.reason },
  };
}
```

### Pattern 4: ROLL Detection

ROLL = one fill CLOSING one expiry leg + one fill OPENING the next expiry leg, same underlying/strike/type, same order (same `fills.orderId`) or within a configurable time window.

```typescript
// Source: D-03 decision + fill domain analysis
type FillGroup = {
  calendarId: string;
  legOccSymbol: OccSymbolParsed;
  fills: AggregatedFill[];
};

function detectRoll(closing: FillGroup, opening: FillGroup): boolean {
  return (
    closing.calendarId === opening.calendarId &&
    closing.legOccSymbol.underlying === opening.legOccSymbol.underlying &&
    closing.legOccSymbol.type === opening.legOccSymbol.type &&
    closing.legOccSymbol.strike === opening.legOccSymbol.strike &&
    closing.legOccSymbol.expiry.getTime() !== opening.legOccSymbol.expiry.getTime()
    // Same order window: fill.orderId match OR filledAt within ROLL_WINDOW_MS
  );
}
```

### Pattern 5: Proactive Refresh Token Expiry Warning (D-14)

```typescript
// Source: broker_tokens schema (refresh_issued_at) + toAppTokenStatus domain fn
// The 7-day clock starts at refreshIssuedAt (no sliding window — confirmed Phase 4)
const WARN_DAYS_BEFORE = 1; // warn on day 6 of 7
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WARN_THRESHOLD_MS = WARN_DAYS_BEFORE * 24 * 60 * 60 * 1000;

function isNearExpiry(refreshIssuedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - refreshIssuedAt.getTime();
  return ageMs >= REFRESH_TTL_MS - WARN_THRESHOLD_MS;
}
// If true: console.warn with app_id + refreshIssuedAt; surface in /api/status
```

### Anti-Patterns to Avoid

- **Scheduling snapshot-calendars directly:** The existing design chains snapshot from compute-bsm-greeks (D-03). `schedule.ts` must NOT add a separate cron for snapshot-calendars. Add only sync-fills and refresh-tokens as newly scheduled jobs.
- **ROLL as close+open:** D-03 requires a first-class ROLL event type. Never write two separate CLOSE + OPEN events for a roll — the chain continuity is lost.
- **Swallowing orphan fills:** D-05 requires orphans to be parked, not dropped. A fill that cannot be matched must produce an orphan row.
- **Checking RTH for refresh-tokens:** refresh-tokens runs at 04:00 ET (outside RTH by design). Do NOT apply the `isWithinRth` gate to this handler.
- **Using `sql.raw()` with the encryption key:** Broker token encryption key must only ever appear as a bound `$N` parameter (confirmed Phase 4 pattern — never in query logs).
- **Blocking one app's refresh on the other's failure:** D-13 requires `Promise.allSettled` pattern, not sequential awaits that could short-circuit.

---

## calendar_events Table Design

### Recommended Schema (Drizzle)

```typescript
// Source: D-06, D-07, D-08, D-09 decisions + existing schema.ts conventions

export const calendarEventTypeEnum = pgEnum("calendar_event_type", [
  "OPEN",
  "CLOSE",
  "ROLL",
]);

export const calendarEvents = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),

  // FK to calendars — which calendar this event belongs to
  calendarId: uuid("calendar_id").notNull(),

  eventType: calendarEventTypeEnum("event_type").notNull(), // OPEN | CLOSE | ROLL

  // ISO timestamp of the first fill that produced this event
  eventedAt: timestamp("evented_at", { withTimezone: true }).notNull(),

  // Idempotency key: SHA-256 of sorted fill UUIDs that compose this event.
  // Unique constraint prevents duplicate events from re-runs.
  fillIdsHash: varchar("fill_ids_hash", { length: 64 }).notNull().unique(),

  // Leg identification — the OCC symbol of the primary leg (front for OPEN, back for CLOSE)
  legOccSymbol: varchar("leg_occ_symbol", { length: 32 }).notNull(),

  // For ROLL events only: the OCC symbol of the OLD leg being closed
  // NULL for OPEN and CLOSE events (D-03 first-class roll chain)
  rolledFromOccSymbol: varchar("rolled_from_occ_symbol", { length: 32 }),

  // Quantities and pricing (D-04 aggregated)
  qty: integer("qty").notNull(),
  avgPrice: numeric("avg_price").notNull(),      // qty-weighted average fill price

  // Net debit/credit for THIS event (D-08 includes commission + fees)
  // Sign: OPEN debit = positive; CLOSE credit = negative (D-08)
  netAmount: numeric("net_amount").notNull(),

  // P&L — only populated on CLOSE and ROLL events (D-09)
  // realizedPnl = closeNetCredit − openNetDebit − totalFees
  realizedPnl: numeric("realized_pnl"),

  // Per-leg breakdown for L3 attribution (D-09 hard requirement)
  // Stored as JSONB: { front: { qty, avgPrice, netAmount }, back: { ... } }
  legBreakdown: text("leg_breakdown"),  // JSON string; JSONB if pg-core supports it

  // D-07: entry thesis hook — free text or tag, set at OPEN time, carried to CLOSE/ROLL
  entryThesis: text("entry_thesis"),

  // Audit
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```

### Orphan Fills Table

```typescript
export const orphanFills = pgTable("orphan_fills", {
  // Fill UUID is PK — one orphan row per unmatched fill (D-05)
  fillId: uuid("fill_id").primaryKey(),
  occSymbol: varchar("occ_symbol", { length: 32 }).notNull(),
  side: varchar("side", { length: 4 }).notNull(),
  qty: integer("qty").notNull(),
  price: numeric("price").notNull(),
  filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),   // "no matching calendar", "ambiguous calendar", etc.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
```

### Migration Flow

```bash
# From packages/adapters/
bunx drizzle-kit generate
# Inspect output: packages/adapters/src/postgres/migrations/0004_calendar_events.sql
bun run migrate
```

**Destructive-change caveat:** Adding new tables is non-destructive. No existing columns are modified. The `calendarStatusEnum` already exists — no enum changes needed for the event type (new enum `calendarEventTypeEnum` is additive). Adding `entryThesis` to `calendars` table (D-07) IS a destructive ALTER on an existing table — add it as a nullable column with no default to be safe.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OCC symbol parsing from fills | Custom regex | `parseSchwabSymbol` + `formatOccSymbol` (Phase 4) | Already production-tested; handles edge cases (SPXW vs SPX, padding) |
| Idempotent DB inserts | Track seen IDs in memory | `onConflictDoNothing` on `fillIdsHash` unique constraint | Survives worker restarts; no in-memory state needed |
| Per-app token refresh isolation | try/catch with returns | `Promise.allSettled` | Guarantees both apps always attempt refresh regardless of the other's result |
| Refresh token expiry math | Time arithmetic inline | `toAppTokenStatus` (Phase 4 domain fn) + `refreshIssuedAt` field | Already tested; 7-day-no-sliding-window semantics encoded |
| Job deduplication | Application-level locks | pg-boss `singletonKey` | pg-boss guarantees at-most-one job per key via Postgres advisory locks |
| Fill matching | Fuzzy string search | OCC symbol canonical form via `formatOccSymbol` → exact equality | OCC symbols are deterministic; no fuzzy matching needed |
| P&L rounding | Float arithmetic | Postgres `numeric` (already in schema) + string-based arithmetic in domain | Avoids float precision errors on financial values |

**Key insight:** Fill→event pairing looks complex but is really three pure domain functions (parse symbol, aggregate fills, classify event) composed sequentially. The complexity is in edge cases (ROLL detection, orphan parking) not in infrastructure.

---

## Fill→Event Pairing Logic (D-01 through D-05)

### Matching Algorithm

1. Read all `fills` rows not yet processed (use `orphan_fills.fillId` + `calendar_events.fillIdsHash` to identify already-processed fills).
2. For each fill, call `parseSchwabSymbol(fill.occSymbol)` → `OccSymbolParsed`.
3. Query `calendars` for a calendar whose legs match `{underlying, strike, optionType, expiry}` — this is the `getCalendarById`-family query.
4. If no calendar matches → write to `orphan_fills` with reason.
5. If multiple calendars match → park as orphan with reason "ambiguous calendar" (Claude's discretion: no auto-pick).
6. If exactly one calendar matches → proceed to classification.

### Classification (D-02)

```
fill.side = "buy"  + fill.positionEffect = "OPENING"  → OPEN
fill.side = "sell" + fill.positionEffect = "CLOSING"   → CLOSE
fill.side = "buy"  + fill.positionEffect = "CLOSING"   → CLOSE (bought-to-close)
fill.side = "sell" + fill.positionEffect = "OPENING"   → OPEN (sold-to-open)
fill.positionEffect = "UNKNOWN"                        → cross-check against calendar.openedAt/closedAt
```

Schwab's `positionEffect` field (from `BrokerTransaction.legs[].positionEffect`) is the primary classifier. The `openedAt`/`closedAt` cross-check is a secondary confirmation.

### Partial Fill Aggregation (D-04)

Group by `(calendarId, legOccSymbol, orderId)`. Within each group:
- `sumQty = sum(fill.qty)`
- `avgPrice = sum(fill.qty * fill.price) / sumQty`
- `totalCommission = sum(fill.commission ?? 0)`
- `totalFees = sum(fill.fees ?? 0)`

### ROLL Detection (D-03)

A ROLL is detected when, for the same calendar and same order (same `orderId` or within a configurable time window, default 5 minutes):
- One aggregated fill group closes the front expiry leg (positionEffect CLOSING)
- Another aggregated fill group opens a new back expiry leg (positionEffect OPENING, same underlying/strike/type, different expiry)

When detected:
- Write one `calendar_events` row with `eventType = "ROLL"`
- Set `legOccSymbol` = the NEW leg being opened
- Set `rolledFromOccSymbol` = the OLD leg being closed
- The `legBreakdown` JSON carries per-leg amounts for both old and new

### P&L Computation (D-08/D-09)

```
openDebit   = netAmount on OPEN event  (positive: premium paid to open calendar)
closeCredit = netAmount on CLOSE event (negative: premium received on close)
totalFees   = totalCommission + totalFees from aggregated fills

For CLOSE event:
realizedPnl = |closeCredit| - openDebit - totalFees
```

Update `calendars.openNetDebit` on OPEN event; `calendars.closeNetCredit` on CLOSE event.

### Idempotency Key (fillIdsHash)

The `fillIdsHash` column stores `SHA-256(sorted UUIDs of fills that compose this event)` as a hex string. This is the deduplication mechanism for `calendar_events`:
- Re-running `sync-fills` against the same fill set produces the same hash.
- `onConflictDoNothing` on `(fillIdsHash)` unique constraint → no duplicate rows.

In `packages/shared/`, a `hashFillIds(ids: string[]): string` pure function computes this via Bun's built-in `crypto.subtle.digest("SHA-256", ...)`. [ASSUMED: Bun has crypto.subtle available; verify at implementation time — alternatively use Node.js `crypto.createHash("sha256")`]

---

## rebuild-journal Idempotency (D-10)

`rebuild-journal` is a manual-trigger job (queue only, no schedule). The handler:

1. Takes `{ calendarId: string }` as Zod-parsed payload.
2. Deletes all `calendar_events` rows where `calendar_id = calendarId`.
3. Deletes all `orphan_fills` rows derived from that calendar's fills (identify by re-parsing).
4. Resets `calendars.openNetDebit` and `calendars.closeNetCredit` to NULL for that calendar.
5. Re-runs the sync-fills pairing logic for that calendar's fills only.

This "delete-then-reinsert" pattern is safe because `calendar_events` is purely derived from `fills` — fills are the source of truth (JRNL-01). The sync-fills use-case is called with `calendarId` filter to scope the rebuild.

SC5 reconciliation check: After rebuild, verify that `calendar_events` P&L aggregates match `calendars.openNetDebit` / `closeNetCredit`. This is a query assertion, not a greeks comparison.

---

## refresh-tokens Handler (JOB-02, D-13/D-14)

### Use-case design

```typescript
// packages/core/src/brokerage/application/refreshTokens.ts
// makeRefreshTokensUseCase wraps existing refreshToken.ts per-app logic

type RefreshTokensResult = {
  readonly trader: { ok: boolean; error?: string; warnExpirySoon: boolean };
  readonly market: { ok: boolean; error?: string; warnExpirySoon: boolean };
};

export function makeRefreshTokensUseCase(deps: {
  readonly refreshTraderTokens: ForRefreshingToken;  // existing refreshToken use-case for 'trader'
  readonly refreshMarketTokens: ForRefreshingToken;  // existing refreshToken use-case for 'market'
  readonly readTokenFreshness: ForReadingTokenFreshness;  // existing port
  readonly now: () => Date;
}): ForRefreshingTokens {
  return async (): Promise<Result<RefreshTokensResult, never>> => {
    const [traderOutcome, marketOutcome] = await Promise.allSettled([
      deps.refreshTraderTokens(),
      deps.refreshMarketTokens(),
    ]);
    // Read freshness for expiry warning (D-14)
    const freshnessResult = await deps.readTokenFreshness();
    // ... compute warnExpirySoon from refreshIssuedAt + WARN_THRESHOLD
    // Return ok() always — both outcomes surfaced in result, not via throw
  };
}
```

### Handler (apps/worker/src/handlers/refresh-tokens.ts)

- No RTH gate (runs at 04:00 ET outside market hours by design).
- No holiday gate (token refresh runs daily regardless of market calendar).
- On per-app failure: `console.warn` with app_id + error; do NOT throw (would mark the whole job failed and block the status-flag surface).
- Handler returns normally; logs surface per-app failures.
- `/api/status` gains a `tokenRefreshFailures` map from a new `readRefreshStatus` port backed by a small in-memory or DB state.

**Simpler approach for status surface:** Rather than a new DB table, the handler writes the result to a per-app key in `broker_tokens` metadata (or a new column). The getStatus use-case reads it alongside `tokenFreshness`. [ASSUMED: exact surface mechanism — confirm with planner]

---

## schedule.ts Extraction Pattern

The existing `main.ts` has inline `boss.createQueue`, `boss.schedule`, and `boss.work` calls. Phase 5 extracts these into `apps/worker/src/schedule.ts` which exports a single `registerAllJobs(boss, handlers)` function.

```typescript
// apps/worker/src/schedule.ts
// All pg-boss specifics confined here; main.ts becomes a composition-only file.

export async function registerAllJobs(
  boss: PgBoss,
  handlers: AllHandlers,
): Promise<void> {
  // Create queues (idempotent)
  await boss.createQueue("fetch-schwab-chain");
  await boss.createQueue("fetch-rates");
  await boss.createQueue("compute-bsm-greeks");
  await boss.createQueue("snapshot-calendars");
  await boss.createQueue("sync-fills");        // NEW
  await boss.createQueue("refresh-tokens");    // NEW
  await boss.createQueue("rebuild-journal");   // NEW (on-demand only; no schedule)

  // Schedules (idempotent)
  await boss.schedule("fetch-schwab-chain", "*/30 9-16 * * 1-5", null, { tz: "America/New_York" });
  await boss.schedule("fetch-rates", "0 7 * * 1-5", null, { tz: "America/New_York" });
  await boss.schedule("compute-bsm-greeks", "* * * * 1-5", null, { tz: "America/New_York" }); // every 1 min
  await boss.schedule("sync-fills", "*/10 9-16 * * 1-5", null, { tz: "America/New_York" }); // every 10 min RTH
  await boss.schedule("refresh-tokens", "0 4 * * *", null, { tz: "America/New_York" }); // 04:00 ET daily

  // Register handlers
  await boss.work("fetch-schwab-chain", ..., handlers.fetchSchwabChain);
  await boss.work("fetch-rates", ..., handlers.fetchRates);
  await boss.work("compute-bsm-greeks", ..., handlers.computeBsmGreeks);
  await boss.work("snapshot-calendars", ..., handlers.snapshotCalendars);
  await boss.work("sync-fills", ..., handlers.syncFills);
  await boss.work("refresh-tokens", ..., handlers.refreshTokens);
  await boss.work("rebuild-journal", ..., handlers.rebuildJournal);
}
```

Note: `snapshot-calendars` is NOT scheduled (chain-triggered only via compute-bsm-greeks D-03). This is preserved from the current `main.ts` design.

---

## lastJobRuns Extension (D-12, SC1)

The existing `job-runs.ts` repo has a hard-coded `TRACKED_JOBS` array with three entries. Phase 5 extends this to all seven jobs:

```typescript
// packages/adapters/src/postgres/repos/job-runs.ts
const TRACKED_JOBS = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "snapshot-calendars",
  "sync-fills",
  "refresh-tokens",
  "rebuild-journal",
] as const;
```

The SQL query already uses `WHERE name IN (...)` and `DISTINCT ON (name)` so the extension is a one-line change. The existing `getStatus` use-case and `statusResponse` contract will surface the new entries automatically.

---

## trigger_job HTTP + MCP (MCP-02, SC5)

### HTTP Route

```
POST /api/jobs/:name/trigger
Body: {} or { calendarId?: string }  (Zod-parsed)
Response: { jobId: string }
```

```typescript
// apps/server/src/adapters/http/jobs.routes.ts
// Pattern: Zod-parse → call use-case → map Result → respond
.post('/jobs/:name/trigger',
  zValidator('param', z.object({ name: z.enum(TRIGGERABLE_JOBS) })),
  zValidator('json', triggerJobPayload),
  async (c) => {
    const result = await c.var.deps.enqueueJob(
      c.req.valid('param').name,
      c.req.valid('json'),
    );
    if (isErr(result)) return c.json(toApiError(result.error), 422);
    return c.json({ jobId: result.value });
  }
);
```

### MCP Tool

```typescript
// apps/server/src/adapters/mcp/tools/trigger-job.ts
// Identical use-case call, MCP tool input → call → format result
server.tool(
  "trigger_job",
  "Manually trigger a background job by name",
  { name: z.enum(TRIGGERABLE_JOBS), calendarId: z.string().optional() },
  async ({ name, calendarId }) => {
    const result = await deps.enqueueJob(name, { calendarId });
    // ... format as MCP content
  }
);
```

`TRIGGERABLE_JOBS` = `["rebuild-journal", "sync-fills", "refresh-tokens", "compute-bsm-greeks"]` — scheduled jobs can also be manually triggered.

---

## Common Pitfalls

### Pitfall 1: pg-boss singletonKey vs singletonSeconds

**What goes wrong:** Using `singletonSeconds` (time-window deduplication) instead of `singletonKey` (explicit key deduplication) causes races when the window boundary is crossed mid-run.
**Why it happens:** Both sound similar; `singletonSeconds` is based on the pg-boss clock, not the business key.
**How to avoid:** Always use `singletonKey` with a deterministic business key (`{jobName}:{windowStart}`) for scheduled jobs. Never use `singletonSeconds` for fill-based jobs.
**Warning signs:** Duplicate `calendar_events` rows with different `createdAt` but same `fillIdsHash` — would be caught by unique constraint violation.

### Pitfall 2: Snapshot-calendars accidentally re-scheduled

**What goes wrong:** Adding `snapshot-calendars` to the `boss.schedule()` calls in `schedule.ts` would run it on a cron AND chain-trigger it, doubling snapshot frequency.
**Why it happens:** The cron-trigger vs chain-trigger distinction lives in comments; easy to miss when migrating to schedule.ts.
**How to avoid:** `schedule.ts` must include a comment: `// snapshot-calendars: NO schedule — chain-triggered only by compute-bsm-greeks (D-03 / Pitfall 5)`.
**Warning signs:** `calendar_snapshots` gets rows with duplicate `time` values (caught by composite PK constraint).

### Pitfall 3: Refresh-token refresh doesn't extend the refresh token itself

**What goes wrong:** Assuming that calling Schwab's refresh grant automatically resets the 7-day refresh-token TTL. It does NOT.
**Why it happens:** Most OAuth servers use sliding windows; Schwab uses a hard 7-day cutoff from initial auth-code exchange.
**How to avoid:** The `refreshIssuedAt` column is NEVER updated by the refresh-tokens job (it was set during `auth setup` and stays fixed). Only the `issuedAt` + `accessToken` + `refreshToken` columns update on refresh. The D-14 warning reads `refreshIssuedAt` and computes `now - refreshIssuedAt > 6 days`.
**Warning signs:** `refreshIssuedAt` being overwritten to `now()` in the refresh handler — wrong.

### Pitfall 4: Partial fill aggregation race (fills landing mid-job)

**What goes wrong:** If Schwab delivers fills in two batches and `sync-fills` runs between them, the first run parks a partial fill as orphan, then the second run cannot match it because orphan parking removes it from the unprocessed pool.
**Why it happens:** The fill set is not stable between job runs.
**How to avoid:** The orphan parking does NOT remove fills from the `fills` table — it only records them in `orphan_fills`. On re-run, all fills are re-evaluated. The `fillIdsHash` deduplication prevents duplicates when the same fill set is re-processed.
**Warning signs:** Orphan fills that appear to match a calendar — investigate for incomplete-fill races.

### Pitfall 5: RTH gating on refresh-tokens handler

**What goes wrong:** Applying `isWithinRth(now)` gate to the `refresh-tokens` handler causes it to no-op at 04:00 ET (outside RTH).
**Why it happens:** Copy-paste from other handlers that DO need the RTH gate.
**How to avoid:** Explicitly document in `refresh-tokens.ts` handler: `// No RTH gate — runs at 04:00 ET outside market hours by design`.
**Warning signs:** `refresh-tokens` job shows `state = 'completed'` but logs show "skipping — outside RTH".

### Pitfall 6: Multi-calendar fill ambiguity

**What goes wrong:** A fill's OCC symbol matches legs from TWO open calendars (e.g., two calendars both with SPX 7100P, same back expiry but different front expiries).
**Why it happens:** The OCC symbol only encodes one expiry (the leg expiry); a calendar has two legs. A fill against the back expiry could belong to multiple calendars.
**How to avoid:** When multiple calendars match, park as orphan with reason "ambiguous calendar: [calendarIds]". Never auto-assign. The operator reviews orphan_fills.
**Warning signs:** Orphan fills with reason "ambiguous calendar" during a period when multiple related calendars are open.

### Pitfall 7: fill_ids_hash collision on large fill sets

**What goes wrong:** SHA-256 hex string may be truncated if `varchar(64)` is used — SHA-256 produces 64 hex chars (256 bits / 4 bits per hex char). This is exactly 64 characters.
**How to avoid:** `varchar(64)` is exactly right for SHA-256 hex. Do not use `varchar(32)` (MD5 territory) or `varchar(128)` (unnecessary).
**Warning signs:** Constraint violation on insert citing column length.

---

## Runtime State Inventory

This is not a rename/refactor phase. No runtime state migration is needed. The additions are:
- New `calendar_events` table (Drizzle migration — new table, non-destructive)
- New `orphan_fills` table (Drizzle migration — new table, non-destructive)
- New `entry_thesis` nullable column on `calendars` table (Drizzle migration — additive ALTER TABLE, non-destructive)
- New pg-boss queues (`sync-fills`, `refresh-tokens`, `rebuild-journal`) — `boss.createQueue` is idempotent
- New pg-boss schedules — `boss.schedule` is idempotent

**No data migration required.** The `fills` table already has existing rows from Phase 4 ingestion. `sync-fills` will process them on first run.

---

## Environment Availability

All dependencies are already available in the deployed environment (Phase 4 complete and live). No new external tools, services, or runtimes are required.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| pg-boss | Job queue | YES | 12.18.3 (in worker) | — |
| Supabase Postgres | DB (direct URL) | YES | Phase 4 live | — |
| Schwab trader API | sync-fills, refresh-tokens | YES | Phase 4 live (tokens may need re-auth) | AUTH_EXPIRED degradation |
| `bunx drizzle-kit generate` | Migration | YES | 0.31.10 | — |
| `bun run migrate` | Apply migration | YES | Phase 4 verified | — |
| `bun` runtime | Crypto for fillIdsHash | YES | Bun latest | crypto.createHash fallback |

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 |
| Config file | Root `vitest.config.ts` with `test.projects` |
| Quick run command | `bun run test --project packages/core` |
| Full suite command | `bun run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| JOB-01 | All jobs registered in schedule.ts; pg-boss createQueue+schedule idempotent | Integration (pg-boss testcontainers) | `bun run test --project apps/worker` | NO — Wave 0 |
| JOB-01 | sync-fills handler is idempotent on re-run (same fill set → no duplicate calendar_events rows) | Integration (testcontainers Postgres) | `bun run test --project packages/adapters` | NO — Wave 0 |
| JOB-01 | Job dedupe key is deterministic for scheduled jobs | Unit | `bun run test --project packages/core` | NO — Wave 0 |
| JOB-02 | refresh-tokens refreshes both apps independently; one app failure does not block the other | Use-case (in-memory twin + msw) | `bun run test --project packages/core` | NO — Wave 0 |
| JOB-02 | proactive expiry warning fires when refreshIssuedAt is 6+ days ago | Unit (pure domain fn) | `bun run test --project packages/core` | NO — Wave 0 |
| JOB-02 | /api/status flags failing app after refresh-tokens failure | Use-case | `bun run test --project packages/core` | NO — Wave 0 |
| JOB-03 | After compute-bsm-greeks runs, zero rows with bsm_iv IS NULL AND mark IS NOT NULL | Integration (testcontainers) | `bun run test --project packages/adapters` | Partial (existing compute tests cover logic; SC3 assertion query needs new test) |
| JRNL-01 | parseSchwabSymbol → formatOccSymbol round-trip for all fill scenarios | Unit + property | `bun run test --project packages/adapters` | YES (parseSchwabSymbol has tests) |
| JRNL-01 | OPEN/CLOSE/ROLL classification from fill positionEffect | Unit | `bun run test --project packages/core` | NO — Wave 0 |
| JRNL-01 | Partial fill aggregation: qty-weighted avg price | Unit | `bun run test --project packages/core` | NO — Wave 0 |
| JRNL-01 | ROLL detection from close+open pair within time window | Unit | `bun run test --project packages/core` | NO — Wave 0 |
| JRNL-01 | P&L = close credit − open debit − fees (D-08/D-09) | Unit (fast-check property) | `bun run test --project packages/core` | NO — Wave 0 |
| JRNL-01 | Orphan fill parking for unmatched OCC symbol | Use-case | `bun run test --project packages/core` | NO — Wave 0 |
| JRNL-01 | rebuild-journal: delete-then-reinsert produces same calendar_events as original sync-fills run | Integration (testcontainers) | `bun run test --project packages/adapters` | NO — Wave 0 |
| JRNL-01 | SC4: re-running sync-fills against same fill set produces zero duplicate calendar_events rows | Integration (testcontainers) | `bun run test --project packages/adapters` | NO — Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run test --project packages/core` (fast, no Docker)
- **Per wave merge:** `bun run test` (full suite, Docker/testcontainers)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/journal/domain/fill-pairing.test.ts` — covers OPEN/CLOSE/ROLL classification, partial fill aggregation, P&L formula (fast-check property tests for P&L monotonicity)
- [ ] `packages/core/src/journal/domain/calendar-event.test.ts` — CalendarEvent domain type invariants
- [ ] `packages/core/src/journal/application/syncFills.test.ts` — use-case tests with in-memory twin; covers orphan parking, ROLL detection, idempotency
- [ ] `packages/core/src/journal/application/rebuildJournal.test.ts` — delete-then-reinsert behavior; reconciliation assertion
- [ ] `packages/core/src/brokerage/application/refreshTokens.test.ts` — per-app independence; proactive expiry warning; msw mock for Schwab refresh endpoint
- [ ] `packages/adapters/src/postgres/repos/calendar-events.contract.test.ts` — testcontainers; CRUD + idempotency; fillIdsHash unique constraint
- [ ] `packages/adapters/src/postgres/repos/orphan-fills.contract.test.ts` — testcontainers; upsert on fillId PK
- [ ] `apps/worker/src/handlers/sync-fills.test.ts` — thin handler test; RTH gate fires; delegates to use-case
- [ ] `apps/worker/src/handlers/refresh-tokens.test.ts` — no RTH gate; both apps attempted; handler does not throw on one-app failure
- [ ] `apps/worker/src/schedule.test.ts` (optional) — verify all 7 queues created, 5 crons registered (rebuild-journal has no cron)
- [ ] Framework install: None needed — vitest, testcontainers, msw already installed

---

## Security Domain

Security enforcement applies. Phase 5 inherits all Phase 4 security patterns.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (token refresh) | Existing `refreshToken` use-case; `pgp_sym_encrypt` for token at rest |
| V3 Session Management | No | Stateless job handlers |
| V4 Access Control | Yes (trigger_job) | Existing bearer token middleware on `/api` and `/mcp` |
| V5 Input Validation | Yes | Zod on all job payloads + HTTP/MCP inputs |
| V6 Cryptography | Yes | pgcrypto key ALWAYS as `$N` bound param; never `sql.raw()` |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token logged during refresh | Information Disclosure | Tokens never in console.warn/error; only appId + timestamps logged |
| Encryption key interpolated in SQL | Tampering | Confirmed Phase 4 pattern: key as bound `$N` parameter only |
| Unauthenticated trigger_job | Elevation of Privilege | Bearer token middleware guards `/api/jobs/:name/trigger` (existing pattern) |
| Duplicate event injection via re-run | Tampering | fillIdsHash unique constraint + `onConflictDoNothing` |
| Orphan fills silently dropped | Repudiation | `orphan_fills` table: every unmatched fill is auditable |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All job scheduling inline in main.ts | Extracted to schedule.ts | Phase 5 | Composition root stays clean; schedule config readable |
| Job runs tracked by 3 job names | Extended to 7 job names in TRACKED_JOBS | Phase 5 | SC1 complete visibility |
| No fill→event layer (manual journal) | calendar_events sourced from broker fills | Phase 5 | Journal is reconstructable from fills at any time |

**Deprecated/outdated:**
- `fetch-cboe-chain` queue name: replaced by `fetch-schwab-chain` in Phase 4. The `TRACKED_JOBS` list in job-runs.ts still references the old name — Phase 5 MUST update it to `fetch-schwab-chain`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bun has `crypto.subtle.digest("SHA-256", ...)` for computing fillIdsHash | Fill→Event Pairing Logic | Need to use Node.js `crypto.createHash("sha256")` instead — both Bun-compatible; low risk |
| A2 | Schwab `BrokerTransaction.legs[].positionEffect` is reliably populated (not "UNKNOWN") for SPX options | Fill→Event Pairing Logic | More fills land in orphan_fills needing manual review; fallback cross-check against calendar.openedAt/closedAt covers this |
| A3 | `Promise.allSettled` is sufficient isolation — one rejected promise doesn't surface as a thrown error in the caller | refresh-tokens handler | Platform risk is nil (standard JS spec); implementation risk only if someone adds `.catch` incorrectly |
| A4 | Exact refresh-token expiry warning surface (status flag column vs log-only) | refresh-tokens / /api/status | If a new DB column is added vs log-only approach, small schema delta needed; conservative choice is log-only first (D-14 says "status flag + log only this phase") |

---

## Open Questions (RESOLVED)

> All three resolved during planning (Phase 5 plans 05-01 / 05-03); answers encoded in plan tasks.

1. **fillIdsHash implementation: Bun crypto.subtle vs crypto module**
   - What we know: Bun supports both `crypto.subtle` (WebCrypto API) and Node.js `crypto` module.
   - What's unclear: Which is preferred for `packages/shared/` where the hash function should live?
   - Recommendation: Use `crypto.createHash("sha256")` from Node.js `crypto` module — it's sync, simpler, and available in both Bun and Node runtimes. Import as `import { createHash } from "node:crypto"`.
   - **RESOLVED:** `node:crypto` `createHash("sha256")` (sync) adopted in plan 05-01 Task 3 / 05-03 `hashFillIds`.

2. **entryThesis field placement: on calendars table or on calendar_events table**
   - What we know: D-07 says "per calendar (or per OPEN event)".
   - What's unclear: If placed on OPEN event only, it's harder to surface without a join; if on calendars table, it's simpler but less granular.
   - Recommendation: Add `entry_thesis TEXT` as a nullable column on `calendars` (not `calendar_events`) for Phase 5. The OPEN event creation sets it. This avoids a join on the common case. Per-event thesis is a Phase 6+ enhancement.
   - **RESOLVED:** nullable `entry_thesis` declared in plan 05-01 Task 2 (primary attach point on `calendars`); per-event thesis deferred to Phase 6+.

3. **ROLL detection time window**
   - What we know: Same `orderId` is the strongest signal. Not all rolls share an orderId (OCO orders vs manual).
   - What's unclear: Whether a configurable `ROLL_WINDOW_MS` is needed or if orderId matching alone is sufficient for the expected trading style (calendar spreads via Schwab).
   - Recommendation: Start with orderId matching only; if the orderId is null or mismatched, park as two separate CLOSE + OPEN events. Add time-window matching as a Claude's Discretion enhancement if needed.
   - **RESOLVED:** orderId-only matching for Phase 5 (plan 05-03 `detectRoll`); null/mismatched orderId → separate CLOSE + OPEN; time-window matching deferred as a Claude's Discretion enhancement.

---

## Sources

### Primary (HIGH confidence)

- `docs/architecture/jobs.md` — Job catalog, dedupe key pattern, singletonKey semantics, RTH gating, refresh-tokens 04:00 ET spec [VERIFIED: read directly]
- `docs/architecture/data-model.md` — fills, calendars, calendar_snapshots, broker_tokens schema shapes [VERIFIED: read directly]
- `apps/worker/src/main.ts` — existing pg-boss wiring pattern, createQueue order, singletonKey usage [VERIFIED: read directly]
- `packages/adapters/src/postgres/schema.ts` — exact Drizzle column types, enum definitions, existing patterns [VERIFIED: read directly]
- `packages/adapters/src/postgres/repos/broker-tokens.ts` — pgcrypto bound-param pattern (D-03) [VERIFIED: read directly]
- `packages/adapters/src/postgres/repos/job-runs.ts` — TRACKED_JOBS array, SQL query pattern for lastJobRuns [VERIFIED: read directly]
- `packages/core/src/brokerage/application/ports.ts` — BrokerTransaction type shape including `positionEffect` [VERIFIED: read directly]
- `packages/adapters/src/schwab/market/schwab-symbol.ts` — parseSchwabSymbol implementation + OCC format details [VERIFIED: read directly]
- `.planning/phases/05-jobs-fill-rebuild-integrity/05-CONTEXT.md` — all 15 locked decisions D-01..D-15 [VERIFIED: read directly]

### Secondary (MEDIUM confidence)

- pg-boss v12 README — `singletonKey`, `retryLimit`, `boss.schedule`, `boss.work` array handler [ASSUMED: training knowledge, consistent with existing worker code patterns]

### Tertiary (LOW confidence)

- ROLL detection time-window heuristic — derived from domain reasoning about how calendar spread rolls typically execute on Schwab; no authoritative source [ASSUMED]

---

## Project Constraints (from CLAUDE.md)

All constraints carried from previous phases remain in force:

1. **Dependencies point inward** — `calendar_events` schema in adapters; pairing logic in core; no Drizzle in core.
2. **TDD red→green** — every new function (classifyFill, aggregatePartialFills, computePnl, detectRoll) needs a failing test before implementation.
3. **No `any`, no `as`, no `!`** — OccSymbolParsed results from `parseSchwabSymbol` are `Result<T,E>` — use `if (result.ok)` branching.
4. **Docs before architecture changes** — the new `calendar_events` table shape and `sync-fills` use-case must be documented in `docs/architecture/data-model.md` and `docs/architecture/jobs.md` BEFORE implementation.
5. **MCP-02 cross-cut** — `trigger_job` HTTP route + MCP tool MUST ship in the same PR.
6. **In-memory twin for every new driven port** — `ForStoringCalendarEvent`, `ForStoringOrphanFill`, `ForReadingFillsByCalendar` all need in-memory twins in `packages/adapters/src/memory/`.
7. **No `eslint-disable` for boundary rules** — if a boundary rule blocks, fix the design.
8. **Supabase direct connection for worker** — `DATABASE_URL` (not pooler port 6543) for pg-boss LISTEN/NOTIFY.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already in workspace; versions verified.
- Architecture patterns: HIGH — derived directly from existing handler code + architecture docs.
- calendar_events table design: HIGH — column choices follow existing schema conventions.
- Fill→event pairing algorithm: MEDIUM — classification logic is sound; ROLL detection edge cases (A3, Open Question 3) need planner decision.
- refresh-tokens design: HIGH — existing `refreshToken` use-case already built; independence pattern is standard.
- Common pitfalls: HIGH — 6 of 7 derived from reading actual existing handler code and known Phase 4 decisions.

**Research date:** 2026-06-21
**Valid until:** 2026-07-21 (30 days — stack is stable, no fast-moving dependencies)

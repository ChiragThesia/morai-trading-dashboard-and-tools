# Background Jobs

Runner: **pg-boss** (Postgres-backed — D8). Lives behind a `JobQueue` driven port;
handlers are thin inbound adapters calling application use-cases.

> **Supabase connection (D18)**: pg-boss needs `LISTEN/NOTIFY` + session advisory locks, so the
> worker connects over Supabase's **direct/session** URL (`DATABASE_URL`), never the transaction
> pooler (6543). The queue tables live in the same Supabase Postgres as app data.

## What Jobs Are For

1. **Scheduled data collection** — pull Schwab/CBOE on a cadence; we are not streaming-first.
2. **Derived computation** — BSM greeks, IV inversion, skew, term structure run *after*
   raw data lands, decoupled from request latency.
3. **Hygiene** — token refresh, journal rebuild, stale-data pruning.
4. **Rate-limit protection** — all upstream API calls funnel through queues with per-queue
   concurrency caps. User-triggered work enqueues; it never hits Schwab directly from a request.
   This is also the multi-user story: N users fan into one rate-controlled pipe.

## Job Catalog (initial)

| Job | Schedule (America/New_York) | Does |
|---|---|---|
| `snapshot-calendars` | chain-triggered only (NO cron) | For each open calendar: fetch chain → compute marks/IV/greeks/term-slope → store `calendar_snapshots` row |
| `compute-bsm-greeks` | every 1 min (drains pending) | Scan `leg_observations WHERE bsm_iv IS NULL` → IV invert → BSM → upsert |
| `sync-fills` | `*/10 9-16 * * 1-5` (every 10 min RTH) | Schwab transactions → `fills`/`orders`; pair into calendar OPEN/CLOSE/ROLL events |
| `refresh-tokens` | `0 4 * * *` (04:00 ET, NO RTH gate) | Refresh both Schwab apps independently; proactive 7-day expiry warning; alert on failure |
| `fetch-rates` | `0 7 * * 1-5` | FRED DGS3MO daily |
| `compute-analytics` | after `snapshot-calendars` completes | Skew, term structure observations |
| `rebuild-journal` | on-demand only (no schedule) | Reconstructs OPEN/CLOSE/ROLL events for one calendar from fills; idempotent delete-then-reinsert |

Notes carried from old dashboard:
- **All crons in `America/New_York`** — DST-safe market alignment.
- **Holiday handling**: market-hours check must consult an NYSE holiday calendar (old dashboard
  TODO — fixed here from day one). Jobs no-op gracefully on holidays.
- **Token refresh at 04:00 ET** — keeps access tokens fresh outside market hours. Does NOT
  extend the refresh token: Schwab refresh tokens hard-expire 7 days after issuance →
  weekly interactive re-auth is mandatory (`deployment.md` + `stack-decisions.md` D16).
  On `invalid_grant`, Schwab jobs pause gracefully and status flags AUTH_EXPIRED.

## sync-fills (Phase 5, JOB-01 / JRNL-01)

**Schedule:** `*/10 9-16 * * 1-5` — every 10 minutes during RTH.

**Dedupe key:** `sync-fills:{windowStart}` where `windowStart` is the 10-minute boundary
rounded from `now()` (e.g. `sync-fills:2026-06-21T14:10:00.000Z`). Uses pg-boss `singletonKey`
— not `singletonSeconds` (Pitfall 1).

**What it does:**
1. Reads all fills not yet in `calendar_events` (by `fill_ids_hash`) or `orphan_fills`.
2. Parses each fill's OCC symbol via `parseSchwabSymbol` + `formatOccSymbol` (Phase 4).
3. Matches fills to calendar legs — exact OCC equality, no fuzzy matching.
4. Aggregates partial fills per `(calendarId, legOccSymbol, orderId)` — qty-weighted avg price.
5. Classifies events: OPEN, CLOSE, or ROLL (D-02/D-03). ROLL is first-class.
6. Computes realized P&L on CLOSE/ROLL by reading the prior OPEN event for the leg:
   `realizedPnl = closeCredit − originalOpenDebit − feesOnClose` (D-08/D-09). The
   `originalOpenDebit` is that prior OPEN event's recorded debit. When no prior OPEN event
   exists for the leg, `realizedPnl` is left NULL rather than reporting a wrong number. On a
   ROLL the new leg's premium is cost basis (`netAmount`), never realized P&L.
7. Writes `calendar_events` rows idempotently (`onConflictDoNothing` on `fill_ids_hash`).
8. Parks unmatched fills in `orphan_fills` with a reason string (D-05 — never silently dropped).

**RTH gate:** Yes. Does not run outside market hours or on NYSE holidays.

## sync-transactions (Phase 5, JRNL-01 — fills source)

The `fills` table is populated from Schwab transactions. A `sync-transactions` job reads the
broker transaction feed (the Phase-4 transactions adapter) and writes `fills` rows, giving
`sync-fills` real input to pair. Without it `sync-fills` reads an empty table and produces no
events. This source job lands in plan 05-12; the `ForWritingFills` port (below) is its writer
contract. It runs before `sync-fills` in the RTH cadence so each pairing run sees fresh fills.

## refresh-tokens (Phase 5, JOB-02)

**Schedule:** `0 4 * * *` — 04:00 ET daily (America/New_York).

**No RTH gate.** Runs every day regardless of market hours or NYSE holidays (D-13). It runs
at 04:00 ET specifically because that is outside RTH — a deliberate design choice.

**Per-app independence (D-13):** Both the `trader` and `market` Schwab apps are refreshed via
`Promise.allSettled`. One app failing does not block the other. Per-app failures surface in
`/api/status` and `console.warn`. The handler does not throw on per-app failure.

**Proactive expiry warning (D-14):** After each refresh, the job checks whether the refresh
token is within 1 day of its 7-day hard expiry. This is computed from `refreshIssuedAt` (set
during the initial auth-code exchange and never updated by the refresh job itself — D-14 /
Pitfall 3 in RESEARCH.md). When the check fires, a warning is emitted to `console.warn` and
the `/api/status` response includes a token-freshness flag.

**Dedupe key:** Not applicable — only one run per day. pg-boss schedule provides natural
deduplication.

## rebuild-journal (Phase 5, JRNL-01)

**Schedule:** None — on-demand only. Triggered via `POST /api/jobs/rebuild-journal/trigger`
or the `trigger_job` MCP tool.

**Dedupe key:** `rebuild-journal:{calendarId}` — prevents concurrent rebuilds for the same
calendar. Uses pg-boss `singletonKey`.

**Payload:** `{ calendarId: string }` — Zod-parsed at the handler boundary.

**What it does:**
1. Deletes all `calendar_events` rows for the given `calendarId`.
2. Resets `calendars.openNetDebit` and `calendars.closeNetCredit` to NULL.
3. Re-runs the `sync-fills` pairing logic scoped to that calendar's fills.

This reconstructs the entire event/position layer (OPEN/CLOSE/ROLL + P&L) from fills (D-10).
It does NOT re-derive the 30-min greeks in `calendar_snapshots` — fills carry no greeks.

The "delete-then-reinsert" pattern is safe because `calendar_events` is purely derived from
`fills`, which are the source of truth (JRNL-01). Re-running against the same fills produces
identical output due to `fill_ids_hash` determinism.

## The JobQueue Port

```ts
// packages/core/src/shared-kernel — or per-context ports.ts
export type ForEnqueueingJob = (
  job: { name: JobName; payload: unknown; dedupeKey?: string },
) => Promise<Result<void, QueueError>>;
```

- Core/application can *request* work (e.g., a use-case enqueues `compute-analytics` after a
  snapshot) without knowing pg-boss exists.
- pg-boss specifics (singleton keys, retry config, cron registration) live in
  `packages/adapters/jobqueue/` + `apps/worker/src/schedule.ts` only.

## Reliability Rules

- **Deterministic dedupe keys** — `name:bizkey` (e.g., `snapshot-calendars:2026-06-05T14:30`),
  pg-boss singleton semantics. Re-enqueue is a no-op, retries are safe. (SHA1-ID pattern from
  old dashboard, adapted to pg-boss.)
- **Idempotent handlers** — every handler safe to run twice (append-only tables + upserts make
  this natural).
- **Retries**: default `retryLimit: 5`, exponential backoff. 4xx-class errors (bad request,
  auth permanently broken) fail fast — no retry.
- **Structured failure results** — handlers return `{ computed: false, reason }` style results,
  logged queryably; never swallow.
- **Job payloads Zod-parsed** at the handler boundary.

## Swap Path (D8 trigger)

If throughput or rate-limit-group needs outgrow pg-boss → BullMQ+Redis adapter implements the
same port; handlers and schedules unchanged; Railway gains a Redis service. Estimated swap: 1 day.

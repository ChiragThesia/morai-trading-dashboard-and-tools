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
| `snapshot-calendars` | `*/30 9-16 * * 1-5` (RTH only, ~13/day) | For each open calendar: fetch chain → compute marks/IV/greeks/term-slope → store `calendar_snapshots` row |
| `compute-bsm-greeks` | every 1 min (drains pending) | Scan `leg_observations WHERE bsm_iv IS NULL` → IV invert → BSM → upsert |
| `sync-fills` | every 10 min RTH | Schwab transactions → `fills`/`orders`; pair into calendar open/close events |
| `refresh-tokens` | `0 4 * * *` (04:00 ET) | Refresh both Schwab apps; one failure must not block the other; alert on failure |
| `fetch-rates` | `0 7 * * 1-5` | FRED DGS3MO daily |
| `compute-analytics` | after `snapshot-calendars` completes | Skew, term structure observations |
| `rebuild-journal` | manual / on-demand | Full rebuild of calendars+fills from Schwab history (source of truth) |

Notes carried from old dashboard:
- **All crons in `America/New_York`** — DST-safe market alignment.
- **Holiday handling**: market-hours check must consult an NYSE holiday calendar (old dashboard
  TODO — fixed here from day one). Jobs no-op gracefully on holidays.
- **Token refresh at 04:00 ET** — keeps access tokens fresh outside market hours. Does NOT
  extend the refresh token: Schwab refresh tokens hard-expire 7 days after issuance →
  weekly interactive re-auth is mandatory (`deployment.md` + `stack-decisions.md` D16).
  On `invalid_grant`, Schwab jobs pause gracefully and status flags AUTH_EXPIRED.

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

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
| `fetch-schwab-chain` | every 30 min RTH | Dual-source SPX/SPXW chain fetch (Schwab + CBOE) → `leg_observations` + `contracts`; see "Chain fetch" section |
| `snapshot-calendars` | chain-triggered only (NO cron) | For each open calendar: resolve front + back legs; write a `calendar_snapshots` row ONLY when both legs are present and fresher than `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` (~45 min = 1.5x the 30-min chain cadence). A missing or stale leg means that calendar is skipped for the cycle (no row written), logged via `console.warn` — this live gate is forward-only and unchanged (OPS-01). The skipped slot is no longer lost forever: `self-heal-journal` repairs OPEN-calendar gaps within a bounded lookback, and `repair-journal-history` repairs any calendar's full history on demand |
| `self-heal-journal` | chain-triggered after `snapshot-calendars` (bounded lookback, no cron) | For OPEN calendars only, over a bounded lookback (default 7 days), re-derives missing/gap `calendar_snapshots` slots from `leg_observations` using the SAME pure metric functions as the live writer (`computeLegPairMetrics` + `computeSnapshotPnl`). Fill-only: never overwrites an existing non-gap row — live rows always win. The OPS-01 freshness gate stays on the live-write path; this job only repairs slots that gate already skipped |
| `repair-journal-history` | on-demand only (via `trigger_job` + operator CLI) | Rebuilds the full journal history for one calendar or all calendars from `leg_observations`, for the range `[openedAt, min(closedAt, now)]`. Same fill-only semantics as `self-heal-journal`, unbounded lookback. Prints per-calendar before/after coverage counts (rows, non-gap rows, days covered). CLI-explicit only: can also trim rows outside a calendar's life window, printing a count |
| `compute-bsm-greeks` | chain-triggered (`fetch-schwab-chain`/`fetch-cboe-chain` on success) + hourly `0 * * * *` sparse fallback | Batch-commit loop (OPS-02): reads newest-first pending rows in `COMMIT_BATCH_SIZE` (800) slices, solves + `writeBsm`s each slice as a durable checkpoint, and voluntarily returns `ok` when the `BSM_TIME_BUDGET_MS` (700,000ms) wall-clock budget is hit — remaining rows drain on the next trigger (the `bsm_iv IS NULL` predicate makes resume free). Both constants are tunable (MEDIUM confidence, see RESEARCH A2) |
| `sync-fills` | `*/10 9-16 * * 1-5` (every 10 min RTH) | Schwab transactions → `fills`/`orders`; pair into calendar OPEN/CLOSE/ROLL events |
| `refresh-tokens` | RETIRED (GW-03) | Token refresh moved to the schwab-py sidecar (Phase 11 cutover); removed from the trigger surface in Phase 15 — see section below |
| `fetch-rates` | `0 9 * * 1-5` + `30 18 * * 1-5` | FRED DGS3MO daily (BSM rate) + expanded macro fetch (Phase 14) |
| `fetch-news` | `*/5 * * * *` (24/7) | Alpaca News API (Benzinga wire, D28) → idempotent upsert into `news_items`; headlines + summaries only. No-op with a log line when the optional Alpaca keys are unset |
| `compute-analytics` | chain-triggered only (NO cron) | Reads `leg_observations` + `calendar_snapshots`; writes `skew_observations`, `risk_reversal_observations`, `term_structure_observations` |
| `compute-exit-advice` | chain-triggered only (NO cron) | Thin terminal handler: reads open calendars + the latest snapshot + economic events + the previous cycle's verdict per open calendar, evaluates the exit rule ladder ([exit-rules.md](exit-rules.md)), and appends one `exit_verdicts` row per calendar. Terminal — nothing enqueues after it |
| `rebuild-journal` | on-demand only (no schedule) | Reconstructs OPEN/CLOSE/ROLL events for one calendar from fills; idempotent delete-then-reinsert |

Notes carried from old dashboard:
- **All crons in `America/New_York`** — DST-safe market alignment.
- **Holiday handling**: market-hours check must consult an NYSE holiday calendar (old dashboard
  TODO — fixed here from day one). Jobs no-op gracefully on holidays.
- **Token refresh is NOT a worker job** (GW-03) — the schwab-py sidecar refreshes access
  tokens in-process. Refreshing does NOT extend the refresh token: Schwab refresh tokens
  hard-expire 7 days after issuance → weekly interactive re-auth is mandatory
  (`deployment.md` + `stack-decisions.md` D22). On `invalid_grant`, Schwab jobs pause
  gracefully and status flags AUTH_EXPIRED.

## Chain fetch (dual-source — chain-window-narrow-regression fix)

**Schedule:** `fetch-schwab-chain`, every 30 min during RTH. One job run fetches the SPX +
SPXW chains from **both** sources and persists all of them to `leg_observations`
(append-only, `source`-tagged) in a single cycle:

- **Schwab (via sidecar)** — freshness. The Schwab gateway caps response size, so the sidecar
  requests a bounded window (`strike_count=50`, 90-day lookahead). Wider single calls 502
  (`TooBigBody`); the window cannot be widened.
- **CBOE (delayed)** — breadth. Full strike range and all expiries. This is what carries the
  far-OTM put mass and long-dated open-position legs the Schwab window cannot reach.

Source selection (`selectChainSources`, brokerage context): market token fresh/stale →
`[schwab, cboe]`; AUTH_EXPIRED, no token, or freshness read failure → `[cboe]` only. A cycle
succeeds if at least one source succeeds — a Schwab failure never darkens the pipeline.

**Why dual-source (not either/or):** a single Schwab call is too narrow — it distorts GEX
(missing far-OTM put gamma biases the flip low and fakes the put wall) and misses open
position legs outside its window (stale journal marks). CBOE alone is delayed. Fetching both
gives fresh near-ATM data AND full-width coverage every cycle.

**Downstream cohort semantics:** observations keep each source's own `observedAt` timestamp,
so one logical cycle spans two nearby timestamps. Readers that need "the latest cycle" must
union per 30-minute slot, not take strict `max(time)`:

- `readLegObsForGex` (GEX input) reads all BSM-solved rows in the 30-min slot of the latest
  solved observation, deduped per contract (newest row wins) so overlapping near-ATM strikes
  are never double-counted.
- `snapshot-calendars` leg resolution is per-contract latest — unaffected by design.
- `compute-bsm-greeks` drains newest-first with a batch bound sized above one full
  dual-source cycle (~15k rows).

**Trigger chain (single-trigger):** `fetch-schwab-chain` → `compute-bsm-greeks` →
`snapshot-calendars` → `compute-analytics` → `compute-gex-snapshot` → `compute-picker` →
`compute-exit-advice`. `compute-picker` scores candidates against the typed rule registry —
see [picker-rules.md](picker-rules.md) for the full gate/score/experimental table.
`compute-exit-advice` is the new terminal step: it scores every OPEN calendar against the
exit rule ladder — see [exit-rules.md](exit-rules.md) for the full ladder, precedence order,
and hysteresis bands.

### GEX methodology (compute-gex-snapshot)

Standard naive dealer-positioning model (Perfiliev / SqueezeMetrics): per contract
`$GEX = Γ × OI × 100 × S² × 0.01`, calls positive / puts negative (dealers assumed long
calls, short puts); flip = zero-crossing of the profile re-priced across a spot grid.
Known model caveats (inherited from the standard): IV held constant across the grid,
spreads/structured flow ignored → exposure overstated.

**Walls are side-specific (SpotGamma convention):** callWall = strike with the largest
call-side dollar gamma; putWall = strike with the largest put-side dollar gamma. NOT the
net-GEX argmax — netting lets one side's OI cancel the other and moves the wall away
from where the hedging concentration actually sits.

**Near-term level set:** far-dated OI (e.g. Sept quarterly 8000s) can dominate the
all-expiry walls with a structural level irrelevant intraday. The snapshot therefore also
carries `near_term` (nullable JSONB column on `gex_snapshots`): `{callWall, putWall, flip}`
recomputed from only the legs with ≤45 calendar-day DTE; null when no near-term legs
solve. Read surfaces expose it additively (`nearTerm` on the gex contract).

## fetch-rates (Phase 2 + Phase 14 macro expansion, MAC-01)

**Schedule:** TWO daily runs, Mon-Fri, `America/New_York` — `0 9 * * 1-5` (09:00 ET) and
`30 18 * * 1-5` (18:30 ET). The evening run catches same-day VIXCLS/treasury publications;
the morning run catches SOFR's next-morning (T+1) publication lag. Both runs share the same
handler and NYSE-holiday gate.

**Two independent responsibilities in one run:**
1. **DGS3MO → `rate_observations`** (unchanged, Phase 2) — the BSM risk-free rate. `readRate`
   and `computeBsmGreeks.ts` keep reading this path exactly as before (D-02 — untouched).
2. **Expanded macro fetch → `macro_observations`** (new, Phase 14; VXVCLS added Phase 23;
   BAMLH0A0HYM2 + VIX9D added Phase 24, see [regime-board.md](regime-board.md)) —
   9 FRED series (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VXVCLS, BAMLH0A0HYM2)
   plus VVIX and VIX9D via the existing CBOE adapter. DGS3MO is double-written: the legacy
   single-row BSM pipeline AND a `macro_observations` row for the macro API (MAC-02).

**Failure policy (D-07):** best-effort per series, fail-loud finish. Every series is fetched
independently; every successful fetch persists regardless of the others' outcome. If ANY of
the 11 series failed, the handler throws after persisting all successes, naming the failed
series — pg-boss marks the run failed and `/api/status` surfaces `lastErr`. No silent
failures.

**Gap behavior:** each run persists only the LATEST observation per series (the most recent
non-`'.'` row). The `(series_id, date)` upsert makes re-runs idempotent (D-05), but it does
NOT backfill days missed while the worker or a source was down — those dates stay empty.
Historical backfill is not implemented; if a multi-day outage leaves holes that matter,
build a `max(date)+1` incremental fetch as a follow-up.

**Hard requirement (D-09):** the macro fetch requires `FRED_API_KEY` — missing key fails
loud, no silent skip. This is the OPPOSITE of the legacy DGS3MO adapter's lenient 4.5%
fallback (D-13), which stays unchanged for the BSM path.

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

**Raw persistence (Trade Ledger).** Before flattening to `fills`, the use-case stores each
transaction verbatim into `broker_transactions` (see data-model.md) — upsert on
`activity_id`, so the 7-day trailing window re-covers old rows as no-ops. A store failure
fails the run (retryable) and skips fills writing, so raw never lags derived. The backfill
CLI shares the use-case and therefore backfills raw rows too.

### Historical backfill (Phase 7, BRK-04)

The scheduled `sync-transactions` job only ever covers a rolling 7-day window. To pull older
trade history there is an on-demand CLI: `bun run backfill-transactions <from> <to>` in
`apps/worker`. It is not a pg-boss job. It runs the same `sync-transactions` use-case over an
operator-supplied `[from, to]` range, so backfilled trades flow into `fills` and from there into
calendar events through the existing `sync-fills` / `rebuild-journal` path.

**Chunking and the two Schwab caps.** Schwab applies two distinct limits, and the backfill
keeps them separate (both are domain constants in `@morai/core` beside `chunkDateRange`):

- `SCHWAB_TX_LOOKBACK_MAX_DAYS = 365` — the **total** span the operator may request in one run.
- `SCHWAB_TX_MAX_RANGE_DAYS = 90` — the **per-call** window passed to `chunkDateRange`.

A pure domain function `chunkDateRange(from, to, maxDays)` splits the requested range into
contiguous windows, each no longer than `maxDays`, with no gaps and no overlapping days. The CLI
passes the per-call cap as `maxDays`, so a wide-but-within-lookback range is fetched in cap-sized
windows — the chunk loop actually splits in production, not only in tests. (CONFIRM Schwab's real
per-call transactions range on the first live run; if it differs from 90, adjust the constant.)

**Over-cap is an error, not a silent truncation.** If the requested `[from, to]` spans more days
than `SCHWAB_TX_LOOKBACK_MAX_DAYS`, the backfill returns a clear error and writes nothing. It
never quietly clips the range to what Schwab allows — the operator must narrow the range and
re-run.

**Idempotent.** A second run over the same range adds zero `fills` rows. The use-case derives
each fill id deterministically from `(activityId, legIndex)`, and `writeFills` is
`onConflictDoNothing`, so re-running a window is a no-op.

A live run needs valid Schwab trader tokens; building and testing the backfill does not (the
chunk loop and idempotency are covered offline with a faked fetch and the in-memory fills twin).

## compute-analytics (Phase 6, ANLY-01/ANLY-02)

**Schedule:** None — chain-triggered only. It fires after `snapshot-calendars` completes a
cycle, the same chain pattern as `compute-bsm-greeks` → `snapshot-calendars`: the upstream
handler enqueues the next job on success (fire-and-forget). There is no cron entry.

**What it does:** for the snapshot time of the cycle, it reads `leg_observations` (the
per-strike smile) and `calendar_snapshots` (the stored `term_slope`), then writes all three
analytics tables:
1. `skew_observations` — one row per `(underlying, expiration, strike)` in the smile.
2. `risk_reversal_observations` — the interpolated 25Δ risk-reversal plus its trailing-window
   rank per `(underlying, expiration)`. The risk-reversal is NULL when ±25Δ cannot be
   bracketed (never fabricated), and a NULL value is excluded from the rank.
3. `term_structure_observations` — one row per calendar, `value` read through from that
   calendar's `calendar_snapshots.term_slope` (no recompute drift).

**Idempotent:** every table has a per-grain UNIQUE key (the time-leading composite PK). A
re-run for the same snapshot time inserts zero new rows (`onConflictDoNothing`).

**RTH gate:** none — the fetch→bsm→analytics→gex→picker pipeline runs 24/7 (the user checks
candidates at any hour; every write in the chain is idempotent per cohort, so off-hours re-runs
on frozen closing quotes are no-ops). The ONLY remaining RTH+holiday gate is the journal write
inside `snapshot-calendars`: off-hours it skips the `calendar_snapshots` write (the journal's
30-min-RTH cadence must never see off-hours rows) but still chain-enqueues `compute-analytics`.

**Surfaced in status:** added to `TRACKED_JOBS` so its last success/error appears in
`GET /api/status` `lastJobRuns`.

## refresh-tokens (RETIRED — GW-03)

**Status:** retired. Built in Phase 5 (JOB-02) as an 04:00 ET daily cron; retired at the
Phase 11 sidecar cutover (the worker handler and cron registration were removed), and removed
from the `TRIGGERABLE_JOBS` surface (HTTP trigger + MCP `trigger_job`) in Phase 15.

The schwab-py sidecar is the sole token refresher: it refreshes access tokens in-process and
writes them back to `broker_tokens`. The 7-day refresh-token hard expiry still stands —
weekly interactive re-auth per `docs/operations/schwab-reauth-runbook.md`, surfaced by the
T-24h `refreshExpiresIn` warning (AUTH-05) and the AUTH_EXPIRED status flag.

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
It does NOT re-derive the 30-min greeks in `calendar_snapshots` — fills carry no greeks. It also
does NOT re-derive `calendar_snapshots.pnl_open` — see recompute-snapshot-pnl below.

## recompute-snapshot-pnl (JRNL-01 pnl-unit-mismatch fix)

**Schedule:** None — on-demand only. Triggered via `POST /api/jobs/recompute-snapshot-pnl/trigger`
or the `trigger_job` MCP tool.

**Dedupe key:** `recompute-snapshot-pnl:{calendarId}` — calendar-scoped, mirrors rebuild-journal
(a window-based key would wrongly collapse two different calendars triggered in the same window).

**Payload:** `{ calendarId: string }` — Zod-parsed at the handler boundary.

**What it does:** re-derives `pnl_open` on every stored `calendar_snapshots` row for the calendar
from its CURRENT `open_net_debit` + `qty` (D-05: `pnl_open = (net_mark - open_net_debit) * qty *
100`). `pnl_open` is frozen at snapshot-write time — if `open_net_debit` is corrected after the
fact (e.g. rebuild-journal fixes a unit-mismatch — dollars stored where points were expected),
every historical row still carries the stale value until this job runs. Re-derives purely from
each row's already-stored `net_mark` — no online fetch, no broker call. Run this AFTER any
`open_net_debit` correction on the calendar.

The "delete-then-reinsert" pattern is safe because `calendar_events` is purely derived from
`fills`, which are the source of truth (JRNL-01). Re-running against the same fills produces
identical output due to `fill_ids_hash` determinism.

### One-off: fix-pnl-reingest (journal-pnl-opennetdebit-units round 3)

`bun run apps/worker/src/fix-pnl-reingest.ts` (not a pg-boss job, run once via `railway run`) —
use this ONLY when a `fills.side`-signing fix has shipped and calendars backfilled BEFORE that
fix need their historical P&L corrected. It wipes `fills`/`calendar_events`/`orphan_fills`,
re-ingests from Schwab with the fixed adapter, then runs `rebuild-journal` +
`recompute-snapshot-pnl` for every calendar. See
`.planning/debug/journal-pnl-opennetdebit-units.md` for the incident this was built for.

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
- **Retries**: pg-boss v12 `QUEUE_DEFAULTS` — `retry_limit: 2`, `retry_backoff: false`,
  `retry_delay: 0` (no override in `schedule.ts`). `retry_delay: 0` means a retry fires
  immediately once pg-boss's maintenance cycle detects a job stuck past `expire_seconds`
  (900s default) — so the "~15-min retry" behavior seen in practice is expiry-detection
  latency, not a configured backoff. 4xx-class errors (bad request, auth permanently
  broken) fail fast — no retry.
- **Structured failure results** — handlers return `{ computed: false, reason }` style results,
  logged queryably; never swallow.
- **Job payloads Zod-parsed** at the handler boundary.

## Swap Path (D8 trigger)

If throughput or rate-limit-group needs outgrow pg-boss → BullMQ+Redis adapter implements the
same port; handlers and schedules unchanged; Railway gains a Redis service. Estimated swap: 1 day.

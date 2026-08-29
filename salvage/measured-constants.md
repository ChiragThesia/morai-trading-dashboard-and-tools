# Measured constants — salvaged before deletion

Source: `packages/core/` and `apps/worker/` (plus the two `packages/adapters/` files a
constant's own comment pointed at — `db.ts` and the repo insert-chunk sites — because the
number and its reasoning live there, not in core/worker).

Every row quotes the real comment. Paths only, no line numbers (they rot).

## Table

| Constant | Value | File | Justification |
|---|---|---|---|
| `COMMIT_BATCH_SIZE` | 800 | `packages/core/src/journal/application/computeBsmGreeks.ts` | MEASURED — sized to worst-case 14.3 rows/sec solve rate so one batch finishes well under the pg-boss expire cap |
| `BSM_TIME_BUDGET_MS` | 700,000 (~11.7 min) | `packages/core/src/journal/application/computeBsmGreeks.ts` | MEASURED — leaves ~3 min margin under the 900s pg-boss default expire, at the worst observed per-batch duration |
| `NEAR_TERM_DTE_WINDOW.maxDays` | 45 | `packages/core/src/analytics/application/computeGexSnapshot.ts` | MEASURED — live book 2026-08-05: uncapped walls landed on LEAPS strikes 9.4% from spot |
| `NEAR_TERM_DTE_WINDOW.minDays` | 8 (15 tried and was wrong) | `packages/core/src/analytics/application/computeGexSnapshot.ts` | MEASURED — live book 2026-08-06 gamma-by-DTE-bucket breakdown; 15 excluded a still-live front leg's own gamma |
| `VEGA_THRESHOLD` | 1e-8 | `packages/core/src/journal/domain/iv-inversion.ts` | Documented as "RESEARCH.md Pattern 4 verbatim" — no derivation shown in this file; treat as chosen, not measured here |
| `MAX_ITER` (Newton) | 50 | `packages/core/src/journal/domain/iv-inversion.ts` | Threat T-02-06 hard cap — no measurement recorded |
| `NR_TOL` | 1e-10 | `packages/core/src/journal/domain/iv-inversion.ts` | Same "Pattern 4 verbatim" note — UNJUSTIFIED here |
| `BISECT_LO` / `BISECT_HI` | 0.001 / 5.0 | `packages/core/src/journal/domain/iv-inversion.ts` | Plausible vol bounds — UNJUSTIFIED here |
| `BISECT_STEPS` | 200 | `packages/core/src/journal/domain/iv-inversion.ts` | Guaranteed-convergence cap, Threat T-02-06 — UNJUSTIFIED here |
| residual-check tolerance | 1e-4 | `packages/core/src/journal/domain/iv-inversion.ts` | Deliberately looser than the 1e-6 round-trip test tolerance — reasoned, not measured |
| INSERT chunk size (leg_observations) | 2,000 rows | `packages/adapters/src/postgres/repos/leg-observations.ts` | MEASURED against Postgres's fixed 65,534 bind-parameter ceiling: 2,000 × 14 cols = 28,000 params |
| INSERT chunk size (skew_observations) | 2,000 rows | `packages/adapters/src/postgres/repos/skew-observations.ts` | Same ceiling: 2,000 × 9 cols = 18,000 params |
| calendar-ranking write cap | 200 rows/cycle | `packages/adapters/src/postgres/repos/calendar-ranking.ts` | MEASURED — 96 pairs/cycle observed in production; 200×20 cols = 4,000 params, 6% of the ceiling, so this table needs NO chunking |
| pg-boss pool | `max: 4` | `apps/worker/src/main.ts` | Reasoned from the Supavisor session-pooler ceiling, not from a load test |
| Drizzle direct pool (worker) | `max: 3` | `apps/worker/src/main.ts` | "job handlers run sequentially; a small pool is ample" — reasoned, not measured |
| `makeDb` default pool | `max: 10` | `packages/adapters/src/postgres/db.ts` | The DEFAULT that caused the outage when 4 uncapped pools ran at once — callers must override it |
| Boot retry | 10 attempts, 1s base, 30s max delay | `apps/worker/src/main.ts` | "~4 minutes of in-process patience" before exiting for Railway to restart — reasoned, not measured |
| `SCHWAB_TX_LOOKBACK_MAX_DAYS` | 365 | `packages/core/src/journal/application/chunkDateRange.ts` | UNJUSTIFIED — comment says to CONFIRM against Schwab's real limit on first live run |
| `SCHWAB_TX_MAX_RANGE_DAYS` | 90 | `packages/core/src/journal/application/chunkDateRange.ts` | UNJUSTIFIED — "kept conservative (a calendar quarter)" so chunking is exercised at all; not Schwab's actual documented cap |
| `MIN_SOLVE_YEARS` (implied carry) | 7/365.25 (7 calendar days) | `packages/core/src/analytics/domain/implied-carry.ts` | MEASURED in production 2026-07-27: 0DTE solved to q=29.8%, only settled to real ~1.2% from 4DTE out |
| `MIN_YIELD` / `MAX_YIELD` (implied carry) | 0 / 0.10 | `packages/core/src/analytics/domain/implied-carry.ts` | MEASURED negative outputs in production (2026-08-23: −0.1201); upper bound reasoned as "~5× historical high," not itself measured |
| `Q` (SPX dividend yield, GEX) | 0.013 | `packages/core/src/analytics/domain/gex.ts` | Labeled a decision (D-01) — no experiment shown; chosen, not measured |
| `R` (risk-free rate, GEX) | 0.043 | `packages/core/src/analytics/domain/gex.ts` | Comment says "Fed funds approx" — chosen, not measured |
| `BSM_RATE_FALLBACK` | 0.045 (4.5%) | `apps/worker/src/config.ts` | Used when no FRED rate row exists ≤ observation date — chosen approximation (D-02), not measured |
| `BSM_DIVIDEND_YIELD` | 0.013 | `apps/worker/src/config.ts` | Same chosen SPX yield as `Q` above |
| `BSM_MAX_DTE` | 90 | `apps/worker/src/config.ts` | Labeled "D-13 default" — UNJUSTIFIED, no measurement in this file |
| `BSM_STRIKE_BAND_PCT` | 0.10 | `apps/worker/src/config.ts` | Labeled "D-13 default" — UNJUSTIFIED, no measurement in this file |
| `SLOT_MINUTES` (RTH snapshot cadence) | 30 | `packages/core/src/journal/domain/rth-slot.ts` | System-wide fact, not a tunable — every journal snapshot, GEX cycle, and cron offset below assumes this cadence |
| `pollingIntervalSeconds` (all pg-boss `work()` calls) | 30 | `apps/worker/src/schedule.ts` | Chosen, not measured — applies uniformly to all 14 queues |
| `persist-calendar-ranking` cron offset | `:25,:55` (25 min after each half-hourly chain fetch) | `apps/worker/src/schedule.ts` | MEASURED — 2026-07-28: the 18:00:22Z cohort had 853 unsolved put legs at 18:05Z and 0 by 18:14Z; the offset is deliberately NOT chain-triggered, to dodge a race with the BSM drain |
| `sync-transactions` cron offset | 5 min ahead of `sync-fills` in each 10-min slot | `apps/worker/src/schedule.ts` | Reasoned ordering (transactions must land before fills pairs them), not measured |
| `fetch-rates` cron | 09:00 ET + 18:30 ET, Mon–Fri | `apps/worker/src/schedule.ts` | Reasoned — morning catches SOFR's T+1 lag, evening catches same-day VIXCLS/treasury prints |
| pg-boss expire cap | 900s | (not set anywhere in this codebase) | This is pg-boss's own library DEFAULT — the repo never overrides it. `BSM_TIME_BUDGET_MS` is sized against this default, so if the rebuild changes libraries or configures `expireInSeconds` explicitly, the BSM budget's margin no longer holds |

## Full reasoning, by constant

### `COMMIT_BATCH_SIZE = 800` and `BSM_TIME_BUDGET_MS = 700_000`
File: `packages/core/src/journal/application/computeBsmGreeks.ts`.

This pair governs the BSM-greeks batch-commit loop, and the file's header comment is the
fullest piece of institutional memory in the codebase — quote it close to verbatim:

> "OPS-02 (this restructure, 2026-07-09): a single read-solve-write-once run made a 900s
> pg-boss timeout lose the ENTIRE run's progress — every retry redid the whole (growing)
> backlog. Batching converts 'lose the whole run on any kill' into 'lose at most one batch
> (~800 rows, ~1 min).' COMMIT_BATCH_SIZE/BSM_TIME_BUDGET_MS sizing: RESEARCH A2, derived
> from the observed 14.3-20 rows/sec solve rate (worst case: 800 rows ≈ 56s/batch, budget
> leaves ~3 min margin under the 900s expire cap). MEDIUM-confidence tunables — retune if
> production durations still brush the cap."

Mechanism, fully spelled out because the structure is being deleted:

- The loop computes a wall-clock deadline = `now() + BSM_TIME_BUDGET_MS` at the start of one
  use-case invocation.
- Each iteration reads up to `COMMIT_BATCH_SIZE` rows **newest-first** — `ORDER BY time DESC
  LIMIT 800` against a partial index on `bsm_iv IS NULL AND mark IS NOT NULL`. Newest-first is
  deliberate, not incidental: preserved from a prior incident (`gex-schwab-bsm-null-puts` /
  `chain-window-narrow-regression`) so that if the backlog is too big to fully drain in one run,
  the freshest cohort — the one currently feeding the live dashboard — is always attempted
  first, not starved behind a growing tail of stale rows.
- Each batch is solved in-process, then written in **one Postgres transaction per batch** — a
  durable checkpoint. A kill after that transaction commits keeps that batch's results forever;
  the batch is small (~800 rows, ~1 min) so the worst-case loss on a kill is bounded to roughly
  one minute of work instead of the whole run.
- The risk-free-rate lookup (`readRate`) is memoized in a `Map` created ONCE outside the loop,
  spanning the entire run (not reset per batch) — this fixes a distinct earlier root cause
  (RC#1, a 2026-07-01 incident) where `readRate` was awaited per-row with no cache at all and
  that alone caused the original timeout.
- When the wall-clock budget is exhausted with rows still pending, the use-case returns
  `ok(undefined)` — **not** `err(...)`. This is deliberate: pg-boss would otherwise mark the job
  failed and retry it, but there is nothing wrong to retry — the remaining rows are still
  `bsm_iv IS NULL` and will be picked up for free by the next chain-triggered run or the hourly
  cron fallback, with no cursor or progress table needed. Returning `err` here would be treating
  "ran out of time this cycle" as a bug, when it's the loop's designed steady state under a
  large backlog.

What breaks at other values: a much larger `COMMIT_BATCH_SIZE` re-approaches the original
failure mode (losing more work per kill, and risking one batch alone exceeding the 900s pg-boss
expire cap at the measured worst-case rate). A much smaller batch size increases per-batch
transaction overhead for no benefit once you're safely under the time cap. The 700s budget is
sized with ~3 minutes of margin under pg-boss's *default* 900s expire — nothing in this codebase
sets `expireInSeconds` explicitly, so that default is itself worth carrying forward as a fact,
not an assumption.

### `NEAR_TERM_DTE_WINDOW = { minDays: 8, maxDays: 45 }`
File: `packages/core/src/analytics/application/computeGexSnapshot.ts`.

Two independently measured bounds, quoted verbatim:

> "The CEILING (45d) keeps far-dated OI out. Round-number LEAPS strikes carry enormous open
> interest whose gamma is near zero, and pickWalls scans by OI-weighted gamma with no DTE
> bound, so without a ceiling the walls land on a parking lot: measured live 2026-08-05 with
> spot 7729, the all-expiry put wall sat at 7000 (9.4% away, net GEX −1.12 Bn) while the
> near-term put wall sat at 7700, 0.4% away."

> "The FLOOR (8d) keeps sub-week churn out. Measured on the live book 2026-08-06, gamma by DTE
> bucket was 0-7d 28.2%, 8-14d 11.9%, 15-30d 41.1%, 31-45d 14.2%, >45d 4.6%. The 0-7d share is
> real gamma that genuinely pins price today, but it has decayed to nothing well before a
> 15-30 DTE position matures — so including it sets levels for a tape the trade never lives in.
> The floor is 8 rather than 15 deliberately: a front leg opened at 15-30 DTE ages down THROUGH
> the 8-14d bucket, so that band is still the position's own gamma and belongs in the window."

So: **15 was tried first as the floor and was wrong** — it excluded gamma that actually belongs
to a live, still-open front leg as it ages toward expiry. 8 was chosen specifically because it
is the point below which a *typical entered position* (15–30 DTE at open) has not yet aged.
This window is exposed as an injectable dependency (`nearTermDteWindow`) precisely because the
"right" floor is a function of the holding horizon being traded — a 0DTE scalper wants the
opposite selection (only sub-week gamma) — so it is documented as a trading decision, not a
frozen domain constant, even though the default itself came from measurement.

What breaks at other values: a maxDays much above 45 reintroduces the LEAPS "parking lot" wall
artifact measured 2026-08-05. A minDays below 8 (i.e., 0 or unfloored) mixes in fast-decaying
sub-week gamma that measurably dilutes the level set (the 2026-08-06 bucket breakdown). A
minDays above 8 (the tried-and-rejected 15) excludes gamma belonging to positions the window is
meant to serve.

### `VEGA_THRESHOLD = 1e-8` and the bisection fallback
File: `packages/core/src/journal/domain/iv-inversion.ts`.

The IV solver is Newton-Raphson first, with a 200-step bisection fallback. The file's own
comment marks the whole constant block as "RESEARCH.md Pattern 4 verbatim" — i.e. this file
does not itself contain the derivation of `1e-8`, `MAX_ITER=50`, `NR_TOL=1e-10`,
`BISECT_LO=0.001`, `BISECT_HI=5.0`, or `BISECT_STEPS=200`. Treat all six as **UNJUSTIFIED**
within this codebase; whatever `RESEARCH.md` originally held did not travel into this file as a
comment, so the rebuild is free to re-derive or re-pick them.

The *reason the fallback exists at all* is documented and is worth keeping regardless of the
threshold's exact value: Newton-Raphson's step is `diff / vega`, so as vega flattens toward
zero (deep ITM/OTM, or very short-dated options) the step becomes numerically unstable — a
small vega in the denominator amplifies any price residual into a huge, wrong jump in sigma.
The loop detects this (`vega < VEGA_THRESHOLD`) and a second failure mode (`newSigma` stepping
outside `[BISECT_LO, BISECT_HI]`) and in either case abandons Newton for bisection, which is
slower but mathematically guaranteed to converge within `BISECT_STEPS` since it only relies on
the price function being monotonic in sigma, never on a derivative.

One more solver detail worth preserving because a fresh implementer would get it wrong by
default: the lower/upper no-arbitrage bounds use the **European** discounted bound, not American
intrinsic — `max(S·e^{-qT} - K·e^{-rT}, 0)` for calls, `max(K·e^{-rT} - S·e^{-qT}, 0)` for puts
— because "SPX/SPXW are European-exercise. Using American intrinsic (max(K-S,0)) would reject
valid deep-ITM European put marks that legitimately trade below raw intrinsic." A 0.5-point
tolerance is subtracted from the lower bound to allow for bid-ask rounding.

There is also a post-solve residual check (not itself named as a threshold constant but load-
bearing): after solving, the code re-prices at the recovered sigma and rejects (`err`) if it
misses the original mark by more than `1e-4` absolute. This exists specifically to catch the
"the bisection interval didn't actually bracket the mark, so the solver silently returned a
clamped endpoint" failure mode — without it, a hopeless mark could return a *plausible-looking
but fabricated* IV instead of a typed error.

### Postgres bind-parameter limit and the insert-chunk sizes
Files: `packages/adapters/src/postgres/repos/leg-observations.ts`,
`packages/adapters/src/postgres/repos/skew-observations.ts`,
`packages/adapters/src/postgres/repos/calendar-ranking.ts`.

Postgres has a fixed, non-configurable limit of **65,534 bind parameters** per statement. This
codebase hit it in production (`leg-observations.ts` calls it "GAP-A fix") and now chunks every
large multi-row insert at `INSERT_CHUNK_ROWS = 2000` rows:

> "GAP-A fix: chunk large batches to stay below Postgres's 65,534 bind-parameter limit. 2,000
> rows × 14 cols (observations) = 28,000 params per INSERT. 2,000 rows × 8 cols (contracts) =
> 16,000 params per INSERT."

`skew-observations.ts` uses the same 2,000-row chunk size against its own 9-column table
(18,000 params). Both leave roughly half the ceiling as margin — 2,000 was picked as a round
number that comfortably clears the limit for tables in the 8–14 column range, not derived from
the ceiling itself (a table with more columns would need a smaller chunk).

`calendar-ranking.ts` explicitly does **not** chunk, and says why — a measured production
volume, not a guess:

> "NO CHUNKING. The use-case caps a write at 200 rows (measured 96 pairs a cycle) × 20 columns
> = 4,000 bind parameters, 6% of Postgres's 65,534 limit — the bound that forced chunking in
> leg-observations does not apply here."

What breaks at other values: below the ceiling, any single INSERT with `rows × cols >= 65,534`
fails outright — this is a hard, non-negotiable database limit, so the chunk row-count for any
new wide table must be derived as `floor(65534 / columns)` with margin, not copy-pasted as 2000
if the table is unusually wide.

### pg-boss queue configuration
File: `apps/worker/src/schedule.ts`.

pg-boss itself is configured minimally — `new PgBoss({ connectionString, max: 4 })` in
`apps/worker/src/main.ts` — no explicit `expireInSeconds` or retry policy is set anywhere in
this codebase; every queue runs under pg-boss's own library defaults for those. The only
runtime knob this repo sets uniformly is polling:

```
const POLLING_INTERVAL = { pollingIntervalSeconds: 30 };
```
applied to all 14 `boss.work(...)` registrations — a chosen value, not measured.

Fourteen queues are created; most are chain-triggered (no cron) rather than scheduled, and the
file is explicit and repetitive about which ones must stay that way, because getting this wrong
previously broke the pipeline (see "CRITICAL (RESEARCH Pitfall 2)" block in the file). The
non-obvious cron design decisions, with their stated reasons:

- **Two `fetch-rates` schedules on the same queue name** (09:00 ET and 18:30 ET, Mon–Fri) must
  carry **distinct `key`s** (`"morning"` / `"evening"`) — pg-boss v12 upserts schedules on
  `(name, key)` with `key` defaulting to `''`, so two `schedule()` calls on the same name with
  no key silently collapse to one, and only the second ever fires. The file leaves an explicit
  prod-cleanup note that a pre-fix keyless row is not auto-removed and must be deleted by hand:
  `DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';`
- **`compute-bsm-greeks` also has an hourly cron** (`0 * * * *`) *despite* being primarily
  chain-triggered — described as a "sparse fallback... drain is idempotent," a deliberate
  belt-and-suspenders in case the chain trigger is ever missed.
- **`sync-transactions` runs 5 minutes ahead of `sync-fills`** in every 10-minute RTH slot
  (`5,15,25,35,45,55` vs `*/10`) specifically so transactions are already ingested before
  `sync-fills` tries to pair them.
- **`persist-calendar-ranking` runs at `:25` and `:55`** — 25 minutes after each half-hourly
  chain fetch, 5 minutes before the next one — and this offset is a measured, deliberate choice
  to avoid a race, not an arbitrary cron. Quoted because the reasoning does not survive as
  obvious from the cron string alone:

  > "readChainForPicker anchors its cohort window on `max(time) WHERE bsm_iv IS NOT NULL`, so a
  > new cohort's asOf advances the moment its FIRST leg solves, while compute-bsm-greeks is
  > still draining the rest. A chain-trigger fires exactly then, and the write is
  > first-write-wins, so the starved ranking would become that cycle's permanent record.
  > Measured 2026-07-28: the 18:00:22Z cohort carried 853 unsolved put legs at 18:05Z and 0 by
  > 18:14Z. :25/:55 sits ~25 minutes behind the half-hourly chain fetch and 5 minutes ahead of
  > the next one."

- **`self-heal-journal` runs hourly with no RTH gate** — deliberately, because it repairs
  *past* slots (fill-only) and so never races the live-data gate.
- **`fetch-cot` and `fetch-economic-events` share the exact same weekly slot** (Friday 17:00
  ET, after close) — this is intentional convergence on one "after the week's data is final"
  time, not a coincidence to preserve separately.

### Pool sizes
Files: `apps/worker/src/main.ts`, `packages/adapters/src/postgres/db.ts`.

The production incident this guards against is recorded directly in `db.ts`:

> "Pool bounds matter: the app runs behind a Supavisor session pooler with a hard client
> ceiling. Four uncapped pools (server + worker × {postgres.js, pg-boss}) each defaulting to
> max:10 exhaust that ceiling and crash the server with EMAXCONNSESSION."

Concretely, in the worker: pg-boss's own pool is capped at `max: 4` ("bounded pool for the 10
low-frequency cron queues (30s polling). Keeps the worker's pg-boss + Drizzle pools under the
Supavisor session-pooler ceiling"), and the worker's separate Drizzle pool (for repos, used
directly by job handlers) is capped at `max: 3` ("job handlers run sequentially; a small pool
is ample and bounds total usage"). `makeDb`'s own default (when a caller passes no `max`) is
10 — that default is exactly the value that caused the outage when left uncapped across four
independent pools simultaneously, so it is a trap for a new caller, not a safe default to trust.

Related, same root cause class: Supavisor **strips `statement_timeout` sent as a connection
startup parameter**, so per-connection timeout config is silently ignored — a long batch SELECT
(the BSM drain on cold-cache I/O) gets killed mid-run with Postgres error `57014`. The
workaround, `withStatementTimeout` in `db.ts`, wraps the call in a transaction and issues
`SET LOCAL statement_timeout = <ms>` *inside* the transaction instead — `SET LOCAL` is
pooler-proof because it is a regular SQL statement, not a startup parameter, and it auto-reverts
at commit/rollback so it never leaks outside the one call that needed it.

Boot sequencing is also bounded, though reasoned rather than measured: `apps/worker/src/main.ts`
retries boot-time DB/migration I/O with `attempts: 10, baseDelayMs: 1_000, maxDelayMs: 30_000`
— "~4 minutes of in-process patience; past that we exit and let Railway restart, which retries
again — so an outage of any length is ridden out without hot-looping."

### Schwab transaction-range chunking — UNJUSTIFIED
File: `packages/core/src/journal/application/chunkDateRange.ts`.

`SCHWAB_TX_LOOKBACK_MAX_DAYS = 365` and `SCHWAB_TX_MAX_RANGE_DAYS = 90` are both explicitly
flagged in their own file as not yet verified against the vendor:

> "CONFIRM Schwab's real per-call transactions range limit on first live run; if it is smaller
> than the lookback cap, this constant drives the chunk-splitting in production. Kept
> conservative (a calendar quarter) so chunking is actually exercised by the prod default
> rather than being an inert no-op when per-call == lookback."

Both numbers are free to change in the rebuild — they were never confirmed against Schwab's
actual documented API limits, only picked so the chunking code path would not go untested.

### Implied dividend-yield solver guards
File: `packages/core/src/analytics/domain/implied-carry.ts`.

Two measured guards protect a put-call-parity solve for the per-expiry dividend yield `q`:

`MIN_SOLVE_YEARS = 7/365.25` (a 7-calendar-day floor) exists because the solve's noise gain is
`1/T` — at short horizons a few cents of quote noise blows up into a huge yield error even
though the input marks are fine:

> "Measured in production 2026-07-27, where the marks themselves were fine: 0DTE solved to
> q = 0.2984 (29.8%), 1DTE 0.0823, 2DTE 0.0450, 3DTE 0.0291, and only from 4DTE out did it
> settle to the ~0.009–0.012 SPX actually yields."

`MIN_YIELD = 0`, `MAX_YIELD = 0.1` bound the physically plausible band; the floor is measured,
the ceiling is reasoned:

> "SPX yields roughly 1.2–2.0%... production produced [negative yields] (2026-08-23 → −0.1201,
> 2026-09-02 → −0.0857) off thin quotes on sparse expiries. The upper bound is deliberately
> loose at 10%, roughly five times the historical high: its job is to catch solver artifacts,
> not to second-guess a real dividend regime."

Design point worth keeping: an out-of-band or under-conditioned solve degrades to `null`, never
to a clamped value — "a clamped value still looks like a measurement," whereas `null` correctly
propagates as "no data" to every downstream consumer's flat-default fallback.

### SPX rate/dividend-yield assumptions — chosen, not measured
Files: `packages/core/src/analytics/domain/gex.ts`, `apps/worker/src/config.ts`.

`gex.ts` hardcodes `R = 0.043` ("risk-free rate") and `Q = 0.013` ("continuous dividend yield")
with only a decision-ID comment (D-01) and no experiment. `apps/worker/src/config.ts` exposes
the same dividend yield as an env-overridable default, `BSM_DIVIDEND_YIELD = 0.013`, and a
fallback risk-free rate `BSM_RATE_FALLBACK = 0.045` used "when no rate row exists ≤ the
observation date" (i.e., FRED fetch failed or hasn't run yet). None of the four carry a measured
derivation in this codebase — they are reasonable point-in-time approximations, not calibrated
constants, and are free to be replaced with a live source rather than re-copied as literals.

`BSM_MAX_DTE = 90` and `BSM_STRIKE_BAND_PCT = 0.10` (chain-fetch filter bounds) are similarly
labeled only "D-13 default" with no measurement shown — **UNJUSTIFIED**.

### RTH snapshot cadence
File: `packages/core/src/journal/domain/rth-slot.ts` (`SLOT_MINUTES = 30`).

Not really a "tunable" — it's the fixed cadence the entire journal/GEX/picker pipeline is built
around (30-minute RTH snapshots), and several of the cron-offset decisions above (particularly
`persist-calendar-ranking`'s `:25/:55` placement relative to the half-hourly chain fetch) are
only correct *because* this is 30, not some other number. A rebuild that changes the snapshot
cadence must re-derive every downstream offset that assumes it, not just this one constant.

## Unjustified constants (free to change)

- `VEGA_THRESHOLD = 1e-8`, `MAX_ITER = 50`, `NR_TOL = 1e-10`, `BISECT_LO = 0.001`,
  `BISECT_HI = 5.0`, `BISECT_STEPS = 200` — all six marked "RESEARCH.md Pattern 4 verbatim"
  in `iv-inversion.ts`, with no derivation surviving in the code itself.
- `SCHWAB_TX_LOOKBACK_MAX_DAYS = 365`, `SCHWAB_TX_MAX_RANGE_DAYS = 90` — explicitly flagged
  by their own comment as unconfirmed against Schwab's real API limits.
- `R = 0.043` (risk-free rate), `Q = 0.013` (SPX dividend yield) in `gex.ts` — decision-ID only.
- `BSM_RATE_FALLBACK = 0.045`, `BSM_DIVIDEND_YIELD = 0.013` in `config.ts` — same two values,
  reasoned as plausible approximations, no measurement shown.
- `BSM_MAX_DTE = 90`, `BSM_STRIKE_BAND_PCT = 0.10` in `config.ts` — "D-13 default," no
  measurement shown.
- `pollingIntervalSeconds: 30` for every pg-boss `work()` call — chosen uniformly, not tuned
  per queue.
- pg-boss's 900-second job expire cap — never set explicitly in this codebase; it is the
  library's own default, and `BSM_TIME_BUDGET_MS` is sized against it. If the rebuild's job
  runner has a different default (or none), this budget must be re-derived, not copied.

# Roadmap: Morai — Trading Dashboard & Tools

## Overview

Six phases deliver the backend + data layer from zero to a live, queryable trading journal.
Phase 1 puts a real walking skeleton in production. Phase 2 wires in market data and a
tested BSM engine. Phase 3 delivers the MVP anchor: a calendar's journal readable by API
and Claude Code. Phase 4 adds Schwab auth and brokerage. Phase 5 completes the job
plumbing and fill-based journal rebuild. Phase 6 adds derived analytics (skew,
term-structure). No web UI in v1 (D19). Every phase is test-first, every use-case ships
both HTTP and MCP adapters (MCP-02 cross-cut, established Phase 1).

Cross-cutting constraints active from Phase 1:

- TDD red→green: no production code without a failing test first; commit at green only.
- Hexagon boundary enforcement: `core` imports `shared` only; violations fail the build.
- In-memory adapter per driven port: fast acceptance tests, no Docker needed for unit work.
- Zod at every boundary: env config, inbound HTTP, external API responses, job payloads.
- Every use-case ships both HTTP route and MCP tool in the same change (MCP-02).

Cross-cutting regression gates (must never regress across any phase):

- SPX OI=0 / SPY proxy: OI is always zero for SPX options; use SPY × 10.048 as proxy.
- CBOE timestamps are UTC: never interpret as ET; do not apply ET offset.
- GEX put-sign: puts carry negative gamma exposure; sign must be preserved in all GEX math.
- 65,534-param insert limit: chunk Postgres inserts at ≤ 2,000 rows per statement.

## Phases

### Milestone v1.0 — Backend + Data Layer

- [x] **Phase 1: Walking Skeleton** - Monorepo + hexagon + DB + deployed status endpoint
- [x] **Phase 2: Market Data & BSM Engine** - CBOE chain in, BSM greeks computed and stored (gap closure in progress) (completed 2026-06-11)
- [x] **Phase 3: Calendar Journal (MVP)** - Register calendar, snapshot job, journal read surface live (completed 2026-06-14)
- [x] **Phase 4: Schwab Auth & Brokerage** - OAuth client, tokens in DB, Schwab chain + positions (completed 2026-06-21)
- [x] **Phase 5: Jobs, Fill Rebuild & Integrity** - Full job queue, sync-fills, journal rebuilt from broker data (completed 2026-06-22; 13 plans + 2 gap rounds, SC4/SC5 verified 5/5)
- [x] **Phase 6: Derived Analytics** - Skew + term-structure observations, API + MCP exposed (verified 4/4 2026-06-22; 8 plans + 1 gap round; merged PR #5; prod migration 0007 applied + verified)
- [x] **Phase 7: Trade History** - `get_transactions` MCP tool (date-ranged) + historical `sync-transactions` backfill (chunked, idempotent) — pull/journal Schwab trade history (verified 2/2 offline 2026-06-22; 2 plans + 1 review round; live pull needs Schwab auth + healthy deploy)
- [x] **Phase 8: Web Dashboard Backend** - GEX analytics endpoint + Zod contract (scheduled snapshot job), Hono `AppType` export for typed RPC, Supabase Auth on read endpoints + CORS (completed 2026-06-24)
- [x] **Phase 9: Web Dashboard Frontend** - React + Vite SPA (apps/web) on Vercel: 5 screens over typed Hono RPC, TanStack auto-poll, Supabase Auth login (completed 2026-06-25)

### Milestone v1.1 — Real-Time Schwab Streaming

- [x] **Phase 10: Stack Decisions Doc Update** - Record Python sidecar as 3rd Railway service; lift D17 (streaming deferred); supersede D16 (TS OAuth client) (completed 2026-06-25)
- [x] **Phase 11: Sidecar Scaffold + Auth Migration** - schwab-py sidecar deployed; TS refresh-tokens job retired; sidecar is sole token owner; journal re-sourced through sidecar REST proxy (completed 2026-06-25)
- [ ] **Phase 12: Streaming + TS Fan-Out** - LEVELONE_OPTION + ACCT_ACTIVITY ingestion; `GET /api/stream` with Supabase JWT edge; Zod stream contracts; cold-start reconcile
- [ ] **Phase 13: COT Adapter** - Weekly `fetch-cot` job; `cot_observations` table; `GET /api/analytics/cot` + MCP `get_cot`
- [ ] **Phase 14: FRED Expansion** - Expanded macro series (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS + VVIX via CBOE); prod FRED_API_KEY set; `GET /api/analytics/macro` + MCP `get_macro`
- [ ] **Phase 15: Re-Auth Smoothing** - T-24h expiry alert; one-click/operator re-auth flow; operator runbook

## Phase Details

### Phase 1: Walking Skeleton

**Goal**: A real, deployable monorepo where the hexagon boundary is enforced, Supabase
Postgres is reachable, and `GET /api/status` plus MCP `get_status` are live in production —
one end-to-end vertical slice from HTTP request through use-case to DB and back.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04, FND-05, DATA-01, DATA-02, DATA-03, DATA-04, DEPLOY-01, DEPLOY-02, DEPLOY-03, MCP-02
**Success Criteria** (what must be TRUE):

  1. `bun install && bun run typecheck && bun run lint` pass from a clean checkout; `bun run test` runs the full workspace suite.
  2. `bun run migrate` runs pending drizzle-kit migrations idempotently; a second run is a no-op with no errors.
  3. `GET /api/status` in production returns JSON with `db: "ok"`, `tokenFreshness`, and `lastJobRuns`; the MCP `get_status` tool returns the same payload to Claude Code.
  4. Introducing a `core → adapter` import causes `bun run lint` to fail with a boundary error, confirming ESLint enforcement is live.
  5. Every driven port (repository interfaces defined in Phase 1) has both a Postgres implementation and an in-memory implementation; the shared contract test suite passes against both.

**Plans**: 6 plans
Plans:

- [x] 01-01-PLAN.md — Monorepo scaffold + hexagon boundary + strict-TS enforcement (FND-01/02/03/05)
- [x] 01-02-PLAN.md — Shared kernel TDD: Result, assertDefined, OccSymbol (FND-04)
- [x] 01-03-PLAN.md — statusResponse contract + calendars port + get_status use-case (DATA-03, MCP-02)
- [x] 01-04-PLAN.md — Drizzle schema + idempotent migrator + calendars both adapters + contract test (DATA-01/02/03)
- [x] 01-05-PLAN.md — Zod config + Hono /api/status + MCP /mcp get_status + worker (DATA-04, DEPLOY-02/03, MCP-02)
- [x] 01-06-PLAN.md — CI + Railway/Supabase production deploy (DEPLOY-01/02/03)

### Phase 2: Market Data & BSM Engine

**Goal**: A delayed SPX option chain flows from CBOE through Zod parsing into
`leg_observations`, and a tested BSM engine can invert IV and compute greeks for any
stored observation — giving the journal job real computed values to write.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: MKT-01, MKT-02, MKT-03, BSM-01, BSM-02, BSM-03
**Success Criteria** (what must be TRUE):

  1. `GET /api/status` (or a dedicated health endpoint) shows a successful CBOE chain fetch; `leg_observations` table gains rows with `source = 'cboe'` after the fetch runs.
  2. The BSM IV-inversion property tests pass: monotonicity holds across a fast-check suite, and round-trip accuracy (invert → recompute mark) is within tolerance for 1000+ random inputs.
  3. BSM greeks (delta, gamma, theta, vega) match known reference values to within documented tolerance in at least three calibration fixtures.
  4. `leg_observations` rows written by the CBOE fetch have `bsm_iv IS NULL`; after `compute-bsm-greeks` runs, those rows have non-null `bsm_iv`, `bsm_delta`, `bsm_gamma`, `bsm_theta`, `bsm_vega`.
  5. FRED rate fetch returns a numeric rate, and the 4.5% fallback activates (logged) when FRED is unreachable (tested with msw).

**Plans**: 12 plans (7 base + 5 gap closure)
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Wave 0: install pg-boss + msw (legitimacy gate), worker vitest project, recorded CBOE fixtures (MKT-01 prep)
- [x] 02-02-PLAN.md — BSM price + greeks domain, fast-check + 3 calibration fixtures (BSM-02)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-03-PLAN.md — IV inversion Newton-Raphson + bisection fallback, round-trip property tests (BSM-01)
- [x] 02-04-PLAN.md — CBOE chain slice: ForFetchingChain + adapter + in-memory twin + filtered leg_observations persistence (MKT-01, MKT-03)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-05-PLAN.md — FRED rate slice: ForFetchingRate + adapter + 4.5% fallback + rate_observations persistence (MKT-02)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-06-PLAN.md — compute-bsm-greeks use-case + settlement-aware DTE + pending-scan/NaN-stamp repo methods (BSM-03)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-07-PLAN.md — Worker jobs (RTH gating + chain→compute) + lastJobRuns status across HTTP + MCP (scheduling, D-06/07/10)

**Gap Closure — Round 1** *(from 02-VERIFICATION.md — 2 gaps; both Wave 1, parallel, zero file overlap)*

- [x] 02-08-PLAN.md — Compute engine fixes: obs.time T (CR-02), European no-arb lower bound (CR-03), post-solve residual check (WR-01) — TDD regression (BSM-01, BSM-03)
- [x] 02-09-PLAN.md — Worker boot fix: pg-boss createQueue for 3 queues (CR-01) + chain enqueue .catch (WR-02) (BSM-03)

**Gap Closure — Round 2** *(from 02-UAT.md live RTH test — 2 blocker defects; both Wave 1, parallel, zero file overlap)*

- [x] 02-10-PLAN.md — Chunk persistObservations + upsertContracts (≤2,000 rows/INSERT) to clear the 65,534 Postgres param limit; large-batch TDD regression (DATA-04, BSM-03)
- [x] 02-11-PLAN.md — Normalize job-runs timestamps to ISO-8601 Z so /api/status parses against contracts jobRunRecord; real-pgboss-row contract test closes the test blind spot (STATUS-01)

**Gap Closure — Round 3** *(from 02-UAT.md Gap C — CBOE timestamp is UTC, not ET; 1 major defect; Wave 1)*

- [x] 02-12-PLAN.md — Parse CBOE timestamp as UTC (delete etToUtc/isDstInET/nthSunday); flip observedAt tests to UTC; documented orchestrator runbook for one-time prod data correction (time -= 4h, bsm_* → NULL re-derive) (DATA-04)

### Phase 3: Calendar Journal (MVP)

**Goal**: A trader can register a calendar spread via the API, the snapshot job writes
30-minute RTH journal rows, and `GET /api/journal/:calendarId` plus MCP `get_journal`
return the ordered snapshot series — the end-to-end MVP anchor.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: CAL-01, CAL-02, CAL-03, CAL-04, CAL-05, MCP-01
**Success Criteria** (what must be TRUE):

  1. `POST /api/calendars` registers an open calendar; `GET /api/calendars` lists it; the MCP `list_calendars` tool returns the same list to Claude Code.
  2. `GET /api/journal/:calendarId` returns an ordered JSON array of snapshot objects (time, spot, net_mark, front_iv, back_iv, net_delta, term_slope, pnl_open, …) for a registered calendar after at least one snapshot has been written.
  3. The MCP `get_journal` tool returns the same snapshot series as the HTTP route for the same calendar ID, sharing one Zod schema from `contracts`.
  4. The `snapshot-calendars` job no-ops (logs "outside RTH / holiday, skipping") when triggered outside Regular Trading Hours or on an NYSE holiday; it never writes a snapshot row in those conditions.
  5. All six MCP tools defined in MCP-01 (`get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew`) are registered and reachable; tools whose backing data does not yet exist return a typed empty result, not an error.

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Extend Calendar domain type + Phase 3 ports + calendarDte (foundation, CAL-01/02/04)
- [x] 03-02-PLAN.md — D-01 option_type migration + [BLOCKING] live schema push (CAL-01)

**Wave 2**

- [x] 03-03-PLAN.md — Calendar register/list/close slice: contracts + use-cases + repos + routes (CAL-01/04)

**Wave 3**

- [x] 03-04-PLAN.md — NYSE holiday domain + RTH/holiday gate into fetch handlers (CAL-05)

**Wave 4**

- [x] 03-05-PLAN.md — Snapshot slice: use-case (D-05/D-06) + repos + targeted-fetch (D-04) + job chain (D-03) (CAL-02/04/05)

**Wave 5**

- [x] 03-06-PLAN.md — Journal read + live-greeks slice: contracts + use-cases + HTTP route (CAL-03, MCP-01)

**Wave 6**

- [x] 03-07-PLAN.md — Six MCP tools registered + server router wiring + live verify (MCP-01)

### Phase 4: Schwab Auth & Brokerage

**Goal**: The Schwab OAuth two-app flow is implemented with tokens persisted in Supabase;
Schwab option chains are available behind the same market-data port as CBOE; positions,
orders, and transactions are fetchable; and AUTH_EXPIRED degrades gracefully.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, BRK-01, BRK-02
**Success Criteria** (what must be TRUE):

  1. `auth setup` walks through the OAuth authorization-code flow and writes encrypted tokens to `broker_tokens` in Supabase; `auth status` reads and reports token freshness without hitting Schwab.
  2. `auth doctor` detects and reports: missing env vars, callback-URL mismatch, and a live refresh-grant failure — three distinct diagnostic conditions.
  3. Schwab market adapter can fetch a live SPX option chain via the same `ForFetchingChain` port as the CBOE adapter; the Schwab chain upserts rows in `leg_observations` tagged `source = 'schwab_chain'`.
  4. When Schwab returns `invalid_grant`, `GET /api/status` reports `tokenFreshness: AUTH_EXPIRED`; Schwab-dependent jobs pause (no new Schwab API calls, logged); the CBOE pull and other non-Schwab jobs continue running.
  5. Schwab trader adapter returns positions and transactions behind their ports; data is Zod-parsed before it reaches core, and a failed parse surfaces a typed `Result.err`, not a thrown exception.

**Plans**: 6 plans
Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Foundation: install oauth-callback/open, brokerage ports + freshness domain, broker_tokens schema + [BLOCKING] live migration, in-memory twin, config env (AUTH-02)

**Wave 2** *(blocked on Wave 1)*

- [x] 04-02-PLAN.md — TDD: vendored Schwab OAuth client + pgcrypto broker_tokens repo + on-demand refresh use-case (AUTH-01, AUTH-02)

**Wave 3** *(blocked on Wave 2)*

- [x] 04-03-PLAN.md — auth CLI setup|refresh|status|doctor (loopback HTTPS dance) + live verify checkpoint (AUTH-03)

**Wave 4** *(blocked on Wave 2)*

- [x] 04-04-PLAN.md — TDD: Schwab market chain adapter behind ForFetchingChain + source widening + CBOE-fallback selector (BRK-01)

**Wave 5** *(blocked on Wave 4)*

- [x] 04-05-PLAN.md — TDD: Schwab trader adapter (positions/orders/transactions) + use-cases + HTTP routes + MCP tools (BRK-02)

**Wave 6** *(blocked on Waves 4+5)*

- [x] 04-06-PLAN.md — TDD: per-app AUTH_EXPIRED status contract + getStatus freshness + job degradation guard (AUTH-04)

### Phase 5: Jobs, Fill Rebuild & Integrity

**Goal**: All background jobs run behind the `JobQueue` port with deterministic dedupe
keys and idempotent handlers; the `sync-fills` path pairs Schwab fills into calendar
open/close events; and `rebuild-journal` can reconstruct a calendar's history entirely
from broker transactions.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: JOB-01, JOB-02, JOB-03, JRNL-01
**Success Criteria** (what must be TRUE):

  1. All seven jobs (`fetch-schwab-chain`, `fetch-rates`, `compute-bsm-greeks`, `snapshot-calendars`, `sync-fills`, `refresh-tokens`, `rebuild-journal`) are registered in `apps/worker/src/schedule.ts` and visible in `GET /api/status` under `lastJobRuns` (`snapshot-calendars` is chain-triggered and `rebuild-journal` is on-demand — both registered but cronless); duplicate enqueues within the same window are idempotent (no duplicate rows in the DB).
  2. `JOB-02` (`refresh-tokens`, 04:00 ET): both Schwab apps refresh independently; a simulated failure on one app does not block the other; `GET /api/status` flags the failing app.
  3. `JOB-03` (`compute-bsm-greeks`): after running, `SELECT count(*) FROM leg_observations WHERE bsm_iv IS NULL AND mark IS NOT NULL` returns 0 (all pending observations computed).
  4. `sync-fills` pairs Schwab fill transactions into calendar OPEN/CLOSE events with correct net debit, credit, and P&L; paired events are idempotent on re-run (re-running against the same fill set produces no duplicate rows).
  5. `rebuild-journal` (manual trigger via `trigger_job` MCP tool or API) reconstructs a calendar's snapshot history from fills; the resulting `calendar_snapshots` rows match those written by the live snapshot job for the same period.

**Plans**: 15/16 plans executed
Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Docs-first + schema.ts (calendar_events, orphan_fills, entry_thesis) + new ports/domain types + 9 Wave-0 failing-test stubs (JOB-01, JRNL-01) [completed 2026-06-21]

**Wave 2** *(blocked on Wave 1)*

- [x] 05-02-PLAN.md — [BLOCKING] drizzle generate + live migrate (0004_calendar_events.sql) (JRNL-01)
- [x] 05-03-PLAN.md — TDD fill-pairing domain: classifyFill/aggregatePartialFills/computePnl/detectRoll/hashFillIds (JRNL-01)

**Wave 3** *(blocked on Wave 2)*

- [x] 05-04-PLAN.md — JobQueue port + pg-boss adapter + in-memory twin + dedupe-key + schedule.ts (7 jobs) + job-runs TRACKED_JOBS + /api/status (JOB-01, SC1)

**Wave 4** *(blocked on Wave 3; 05-05 ‖ 05-06)*

- [x] 05-05-PLAN.md — refresh-tokens slice: per-app independence (allSettled) + isNearExpiry warning + no-RTH handler + status flag (JOB-02, SC2)
- [x] 05-06-PLAN.md — compute-bsm-greeks drain SC3 contract (testcontainers): zero pending rows, idempotent (JOB-03, SC3)

**Wave 5** *(blocked on Waves 2/3/4)*

- [x] 05-07-PLAN.md — sync-fills slice: pairing use-case (OPEN/CLOSE/ROLL + per-leg P&L + orphan parking) + calendar-events/orphan-fills repos + twins + contracts + RTH handler (JRNL-01, SC4)

**Wave 6** *(blocked on Waves 4/5)*

- [x] 05-08-PLAN.md — rebuild-journal (delete-then-reinsert, SC5 reconciliation) + trigger_job HTTP route + MCP tool sharing one contracts schema (JRNL-01, SC5, MCP-02)

**Gap Closure — Round 1** *(from 05-REVIEW.md 4 critical + 8 warning + corrected 05-VERIFICATION SC4/SC5 fail; full SC4/SC5 vertical slice — real fills repo + source)*

*Wave 7 (parallel; zero file overlap)*

- [x] 05-09-PLAN.md — Docs-first D-08/D-09 realized-P&L redefinition + fill-pairing domain fixes (B1-B4) + C1 boundary + data-path port contracts anchor (JRNL-01) (completed 2026-06-21)
- [x] 05-10-PLAN.md — Criticals/infra: CR-02 token refresh mapping, CR-03 job-runs independent success/error, WR-04 rebuild calendarId boundary, WR-05 twin dedup, IN-01 (JOB-01, MCP-02) (completed 2026-06-21)

*Wave 8 (blocked on 05-09; parallel; zero file overlap)*

- [x] 05-11-PLAN.md — sync-fills use-case: B1 realized-P&L lookup, B5 orphan parking, C1 injection, A2 calendar-scoped sync / CR-04 (JRNL-01) (completed 2026-06-21)
- [x] 05-12-PLAN.md — Data path: A1 fills repo + twin (testcontainers), A3 recompute amounts, A4 fills source (sync-transactions from Schwab BrokerTransaction) (JRNL-01)

*Wave 9 (blocked on 05-10/05-11/05-12)*

- [x] 05-13-PLAN.md — A5 real wiring (delete fills stubs) + sync-transactions job + WR-08 rebuild reconciliation + end-to-end SC4/SC5 verification (JRNL-01, JOB-01) (completed 2026-06-22)

**Gap Closure — Round 2** *(from 05-REVIEW-2.md re-review: 1 blocker + 4 warnings + 2 info; round-1 fixes verified genuine)*

*Wave 1 (parallel; zero file overlap)*

- [x] 05-14-PLAN.md — CR-A1 MCP trigger_job ⇒ triggerJobBodyFor parity (blocker) + WR-A3 hexToUuid total-nibble mapping + IN-A1 job-runs cleanup (MCP-02, JRNL-01)
- [x] 05-15-PLAN.md — WR-A2 fills.processed_at + ForMarkingFillsProcessed (no re-pair/double-count) + WR-A1 ROLL recompute by eventType (explicit components) + WR-A4 full-shape memory seedEvent (JRNL-01)

*Wave 2 (blocked on 05-14 + 05-15)*

- [x] 05-16-PLAN.md — fast-check property tests: no double-count, idempotent sync, rebuild reconciliation (OPEN/CLOSE/ROLL), distinct keys ⇒ distinct fill UUID (JRNL-01) — P1 exposed + fixed a real ROLL double-count (eager OPEN emission); full suite 790 green

### Phase 6: Derived Analytics

**Goal**: The `compute-analytics` job writes skew and term-structure observations after
each snapshot cycle; `GET /api/analytics/skew` and `GET /api/analytics/term-structure`
return current and historical series queryable by API and Claude Code.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: ANLY-01, ANLY-02, ANLY-03, MCP-02
**Success Criteria** (what must be TRUE):

  1. After `snapshot-calendars` completes a cycle, `skew_observations` gains new append-only rows for that snapshot time; duplicate runs for the same snapshot time produce no duplicate rows.
  2. After `snapshot-calendars` completes a cycle, `term_structure_observations` gains new rows capturing `back_iv - front_iv` (forward-vol signal) for each calendar; values match the `term_slope` stored in the corresponding `calendar_snapshots` row.
  3. `GET /api/analytics/skew` returns a JSON array with at least one entry of `{ time, value, … }`; `GET /api/analytics/term-structure` returns the same shape for term-structure data.
  4. MCP `get_skew` and `get_term_structure` tools return the same series as their HTTP counterparts, validated against the shared Zod contract from `contracts`.

**Plans**: 8/8 plans complete
Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Docs-first (data-model/jobs/hexagonal-ddd/api-design) + schema.ts 3 analytics tables + shared @morai/contracts analytics Zod (MCP-02) + analytics context ports + 3 RED test scaffolds (ANLY-01/02/03, MCP-02)

**Wave 2** *(blocked on 06-01)*

- [x] 06-02-PLAN.md — [BLOCKING] drizzle generate + live migrate (0007_analytics_observations.sql) (ANLY-01/02/03)

**Wave 3** *(blocked on 06-01)*

- [x] 06-03-PLAN.md — TDD skew numerics domain: interpolateRiskReversal (linear-in-delta ±25Δ, null when unbracketable) + percentileRank (inclusive trailing window) + fast-check (ANLY-01)

**Wave 4** *(blocked on 06-02 + 06-03)*

- [x] 06-04-PLAN.md — Term-structure vertical slice: repo+twin+contract + compute-analytics use-case (term_slope passthrough) + chain-triggered job + GET /api/analytics/term-structure + MCP get_term_structure + TRACKED_JOBS (ANLY-02/03, MCP-02)

**Wave 5** *(blocked on 06-03 + 06-04)*

- [x] 06-05-PLAN.md — Skew vertical slice: skew + risk-reversal repos+twins+contracts + smile/RR/rank compute-analytics half + GET /api/analytics/skew + MCP get_skew over shared schema (ANLY-01/03, MCP-02)

**Gap round** *(post-review 06-REVIEW.md — 2 BLOCKER + 4 WARNING + 2 INFO; Phase 6 left unmerged)*

**Wave 1 (gap)**

- [x] 06-06-PLAN.md — [BLOCKER] Cycle-resolution seam (CR-01/CR-02): data-anchored bounded smile read (latest leg cycle ≤ anchor, repo+twin+contract) + computeAnalytics stamps skew/RR/term with ONE resolved instant (never now()) + Postgres testcontainer seam suite (distinct broker-observedAt/snapshotTime/now() FAILS on old code; run-twice = 0 new rows) (ANLY-01/03)
- [x] 06-07-PLAN.md — [WARNING] RR domain guards: WR-04 |delta|≥1 non-physical drop (mis-signed wing protection) + WR-02 ±25Δ bracket-width policy (decide/enforce/document) + fast-check (ANLY-01)

**Wave 2 (gap)** *(blocked on 06-06 — shares computeAnalytics.ts / leg-observations.ts / smile-source contract)*

- [x] 06-08-PLAN.md — [WARNING+INFO] WR-01 percentileRank empty→null carried through use-case+contract + WR-03 populate moneyness (K/S from spot) on both smile reads+contract (no migration) + IN-01 stale 7-queue/5-cron worker comments → 9/6 (ANLY-01/03, MCP-02)

### Phase 7: Trade History

**Goal**: Expose Schwab trade transactions via an MCP `get_transactions` tool (date-ranged,
over the shared contract) and add a historical `sync-transactions` backfill (chunked to
Schwab's lookback cap, idempotent) so trade history flows into `fills` → calendar events.
**Mode:** mvp
**Depends on**: Phase 4 (transactions read path), Phase 5 (sync-transactions)
**Requirements**: BRK-03, BRK-04
**Spec:** `.planning/phases/07-trade-history/07-SPEC.md`
**Success Criteria** (what must be TRUE):

  1. MCP `get_transactions` returns date-ranged trade transactions over the shared
     `transactionsResponse` contract (default last 90d); AUTH_EXPIRED → typed paused payload.

  2. A backfill entrypoint runs `sync-transactions` over an arbitrary past range, chunked within
     Schwab's lookback cap, writing `fills`; re-run is idempotent (0 duplicate rows).

**Note:** built + tested OFFLINE (msw + testcontainers); a live pull additionally requires the
Schwab OAuth dance + a healthy deploy (db-up) — operator prerequisites, tracked separately.

**Plans**: 2/2 plans complete

- [x] 07-01-PLAN.md — get_transactions MCP tool: contract-locked + tested (msw-equivalent valid-range payload, default-90d, AUTH_EXPIRED typed payload, MCP-02) + docs (BRK-03)
- [x] 07-02-PLAN.md — historical backfill CLI: pure chunkDateRange (fast-check) + sync-transactions per chunk, idempotent, error-on-over-cap + docs (BRK-04)

### Phase 8: Web Dashboard Backend — GEX analytics endpoint, contract, RPC export, Supabase Auth + CORS

**Goal:** Build the typed, authenticated API surface the web SPA consumes. Add a GEX
(gamma exposure) analytics endpoint backed by a **scheduled snapshot job** (computed from
`leg_observations` into a new `gex_snapshot` table, served cached — not per-request), its Zod
contract in `packages/contracts`, export the Hono `AppType` so `hc<AppType>()` typed RPC works
from `apps/web`, and gate the read endpoints behind **Supabase Auth** + CORS for the Vercel
origin. Backend slice of the web dashboard (frontend is Phase 9).
**Requirements**: New web-backend scope (no v1 REQ IDs) — GEX endpoint + contract, `AppType`
export, Supabase Auth + CORS. See CONTEXT for locked decisions; formalize via `/gsd-spec-phase 8`
if needed.
**Depends on:** Phase 6 (derived analytics + `leg_observations`), Phase 7
**Context:** `.planning/phases/08-web-dashboard-backend-gex-auth-rpc/08-CONTEXT.md`
**Success Criteria** (what must be TRUE):

  1. A read endpoint returns a `gexSnapshot` over a shared Zod contract (`spot`, `flip`,
     `callWall`, `putWall`, `netGammaAtSpot`, `profile[]`, `strikes[]`, `byExpiry[]`), served
     from a stored snapshot row — not recomputed per request.

  2. A scheduled pg-boss job computes GEX from the latest `leg_observations` each RTH snapshot
     cycle and writes a `gex_snapshot` row; re-run within a cycle is idempotent (0 duplicate rows).

  3. `apps/server` exports `AppType`; a typed `hc<AppType>()` client compiles against it.

  4. Read endpoints (status, journal, brokerage, analytics, gex) require a valid Supabase Auth
     session; CORS allows the Vercel web origin; unauthenticated request → 401.

**Plans:** 8/7 plans complete

Plans:
**Wave 1**

- [x] 08-01-PLAN.md — Docs-before-code: un-defer Supabase Auth + CORS in stack-decisions.md (D-02a gate, AUTH-01)
- [x] 08-02-PLAN.md — Foundation: GEX Zod contract + barrel + gex_snapshots schema + 5 ports + Wave-0 RED scaffolds (GEX-02, GEX-01, MCP-02)

**Wave 2** *(blocked on 08-02)*

- [x] 08-03-PLAN.md — TDD GEX domain math: dollarGamma/strikeGex/findFlip/buildProfile vs playground-v3 oracle (GEX-01)
- [x] 08-04-PLAN.md — [BLOCKING] migration 0008_gex_snapshot.sql + live push (GEX-01)

**Wave 3** *(blocked on 08-02/08-03/08-04)*

- [x] 08-05-PLAN.md — TDD computeGexSnapshot + getGex use-cases + Postgres repo + memory twin + testcontainers idempotency (GEX-01, SC-4)

**Wave 4** *(08-06 blocked on 08-05; 08-07 blocked on 08-01+08-05; parallel, zero file overlap)*

- [x] 08-06-PLAN.md — compute-gex-snapshot job: handler RTH gate + serial chain after compute-analytics + worker wiring (GEX-01, D-01)
- [x] 08-07-PLAN.md — GEX route + get_gex MCP tool + env config + main.ts CORS-first/Supabase-Auth/AppType + auth integration test (GEX-01/02, RPC-01, AUTH-01)

### Phase 9: Web Dashboard Frontend — React SPA (apps/web) on Vercel over typed Hono RPC

**Goal:** Scaffold `apps/web` (Vite + React + Tailwind v4 + shadcn/ui + TanStack Query) and
build the five approved screens (Overview, Analyzer, Positions, Journal, Market) per the locked
UI-SPEC, consuming the typed Hono RPC client. Live data (greeks, positions, GEX) auto-polls via
TanStack `refetchInterval`; Supabase Auth login gates the app; the three coming-soon features
render as badged stubs. Frontend slice of the web dashboard (backend is Phase 8).
**Requirements**: UI-01, UI-02
**Depends on:** Phase 8 (typed authenticated API + GEX endpoint)
**UI Design Contract:** `.planning/phases/09-web-dashboard-frontend-react-spa-on-hono-rpc/09-UI-SPEC.md` (approved — LOCKED)
**Success Criteria** (what must be TRUE):

  1. `apps/web` builds and deploys to Vercel; renders all five screens per the UI-SPEC over the
     typed RPC client (UI-01).

  2. Live data (greeks, positions, GEX) auto-polls via TanStack `refetchInterval`; journal renders
     30-min snapshots and handles trades older than the Jun-12 chain-history start gracefully (UI-01).

  3. The status banner surfaces `AUTH_EXPIRED` and job failures (UI-02).

  4. Supabase Auth login gates the app; the three coming-soon features (Charm/Vanna, intraday
     delta-flow, economic calendar) render as badged stubs — never errors, never omitted.

**Plans:** 10/10 plans complete

Plans:
**Wave 1** *(docs-before-code — BLOCKING predecessor)*

- [x] 09-01-PLAN.md — Docs-before-code: reconcile D3 charting → visx/uPlot/ECharts (D-05) + record quant-leaf decision (D-01) + eslint quant boundary + apps/web lint wiring (UI-01)

**Wave 2** *(blocked on 09-01)*

- [x] 09-02-PLAN.md — TDD: extract pure BSM kernel to packages/quant leaf, parity + fast-check, core re-export shim (D-01, UI-01)

**Wave 3** *(blocked on 09-01)*

- [x] 09-03-PLAN.md — apps/web scaffold: Vite + React + Tailwind v4 @theme + shadcn init + TanStack provider + Supabase client + jsdom vitest (WEB-01, UI-01)

**Wave 4** *(blocked on 09-03)*

- [x] 09-04-PLAN.md — Auth gate + typed hc<AppType>() RPC client + 401 intercept + AUTH_EXPIRED banner + Login (threat model L1) (UI-01, UI-02)

**Wave 5** *(blocked on 09-04 — closes the D-02 thin-slice)*

- [x] 09-05-PLAN.md — Layout Shell (sticky header + live market strip) + Overview screen + economic-calendar stub + Vercel deploy + human-verify (D-02, UI-01, UI-02)

**Wave 6** *(blocked on 09-05; 06 also on 09-02; parallel, zero file overlap)*

- [x] 09-06-PLAN.md — Positions screen + POSITIONS-01 resolve (client-side greeks via @morai/quant) + GreekStrips/AttributionWaterfall/LevelBar (D-01, D-03, UI-01)
- [x] 09-07-PLAN.md — Journal screen: lifecycle + scrubber + pre-Jun-12 graceful UX (JOURNAL-01) + rebuild button (REBUILD-01) (UI-01)
- [x] 09-08-PLAN.md — Market screen: gamma profile (visx) + GEX bars/by-expiry (ECharts) + regime + Charm/Vanna + intraday coming-soon stubs (UI-01)

**Wave 7** *(TDD parser — blocked on 09-02 quant)*

- [x] 09-09-PLAN.md — TDD: TOS calendar paste parser (9 rules) + implied-IV bisection over @morai/quant (threat model L1) (UI-01)

**Wave 8** *(Analyzer LAST — hardest; blocked on 09-06/09-08 components + 09-09 parser)*

- [x] 09-10-PLAN.md — Analyzer 3-col cockpit: client-side live re-pricing (scenario engine over @morai/quant) + payoff z-order + heatmap + roll simulator (D-01, D-02, D-04, UI-01)

---

## Milestone v1.1 Phase Details

### Phase 10: Stack Decisions Doc Update

**Goal**: `docs/architecture/stack-decisions.md` records the three architectural changes that
make v1.1 possible before any sidecar code is written — satisfying the docs-before-code rule
and giving every subsequent phase a stable decision record to cite.
**Depends on**: Phase 9 (milestone v1.0 complete)
**Requirements**: DOC-01
**Research flag**: None — standard doc edit, established pattern (Phases 1, 5, 6, 8, 9 all opened with a doc plan).
**Success Criteria** (what must be TRUE):

  1. `docs/architecture/stack-decisions.md` contains a superseded entry for D16 (TS OAuth client retired in favor of schwab-py sidecar) with rationale referencing the dual-refresher race and streamer ownership.
  2. `docs/architecture/stack-decisions.md` contains a lifted entry for D17 (streaming no longer deferred) scoped to account/position legs only (not full-chain), with the 500-symbol cap noted.
  3. `docs/architecture/stack-decisions.md` contains a new decision for the Python schwab-py sidecar as the third Railway service (`apps/sidecar/`), documenting the FastAPI + schwab-py stack, the `broker_tokens` Postgres callback pattern, and the Railway private-network isolation requirement.
  4. `docs/TOPIC-MAP.md` is updated to reference any new sidecar architecture doc if one is created alongside the decision entries.

**Plans**: 1/1 plans complete
Plans:

- [x] 10-01-PLAN.md — Supersede D16 + lift D17 + add D22 (schwab-py sidecar) in stack-decisions.md; reconcile 3 cross-refs in deployment.md/jobs.md (DOC-01)

### Phase 11: Sidecar Scaffold + Auth Migration

**Goal**: The Python schwab-py sidecar is running as a third Railway service and is the
sole process that authenticates to Schwab; the TS `refresh-tokens` job is retired before
the sidecar goes active (closing the dual-refresher rotating-token race); the sidecar owns
a Postgres advisory lock so restarts cannot open a second streamer session; and the
journal's chain-snapshot job is re-sourced through the sidecar REST proxy (with CBOE as
fallback during the 7-day re-auth gap).
**Depends on**: Phase 10
**Requirements**: GW-01, GW-02, GW-03, GW-04, GW-05, JRNL-02
**Research flag**: Railway private-networking config (prefer internal URL with no egress cost; confirm at infra setup). Confirm 500-symbol streamer cap on Schwab Developer Portal; scope subscriptions to legs-only regardless.
**Cross-cutting**: Regression gates (SPX OI=0/SPY proxy, CBOE UTC timestamps, GEX put-sign, 65,534-param chunking) must all remain green after the chain-source switch.
**Success Criteria** (what must be TRUE):

  1. `apps/sidecar/` builds and deploys as a Railway service; `GET /sidecar/health` returns `{ status: "ok", tokenFreshness: "... " }` — the sidecar is reading `broker_tokens` from Postgres via `client_from_access_functions` callbacks (GW-01).
  2. The TS `refresh-tokens` job is removed from `apps/worker/src/schedule.ts` and its `TRACKED_JOBS` entry is retired before the sidecar's auto-refresh is activated — `GET /api/status` no longer lists it; no dual-writer window exists (GW-03).
  3. The chain-snapshot job (`fetch-schwab-chain`) routes through the sidecar REST proxy (`/sidecar/chain`) instead of direct Schwab REST; CBOE fallback activates automatically when the sidecar returns `AUTH_EXPIRED` or is unreachable, and `leg_observations` continues to gain rows with `source = 'cboe'` in that case (GW-02, JRNL-02).
  4. `apps/server` is the only process that can reach the sidecar (Railway private network / service binding); the sidecar has no public ingress route (GW-05).
  5. A Postgres advisory lock is held by the sidecar's StreamClient before `login()` is called; a second sidecar instance (simulated restart) cannot acquire the lock and logs a clear error rather than opening a second Schwab streaming session (GW-04).

**Plans**: 7/7 plans complete
Plans:
**Wave 1** *(docs-before-code — BLOCKING predecessor)*

- [x] 11-01-PLAN.md — Docs-first GW-01 relaxation (token_json) in stack-decisions.md + additive schema column + Wave-0 RED scaffolds (Python pytest lane + TS adapter test) (GW-01, JRNL-02)

**Wave 2** *(blocked on 11-01)*

- [x] 11-02-PLAN.md — [BLOCKING] drizzle generate 0011_broker_tokens_token_json + live `bun run migrate` (direct conn, port 5432) (GW-01)
- [x] 11-03-PLAN.md — TDD: TS sidecar chain-adapter (ForFetchingChain, adapter-local Zod) + in-memory twin + barrel (JRNL-02, GW-02)

**Wave 3** *(blocked on 11-02 — needs live token_json column)*

- [x] 11-04-PLAN.md — TDD Python core: token_store dual-write callbacks (GW-01) + advisory_lock guard (GW-04) + pytest fixtures

**Wave 4** *(blocked on 11-04)*

- [x] 11-05-PLAN.md — Python FastAPI service (lifespan: lock→2 clients→not-seeded degrade) + /sidecar/health + /sidecar/chain + Dockerfile + Railway internal-only service + deploy checkpoint (GW-01, GW-02, GW-05)

**Wave 5** *(blocked on 11-03 + 11-05)*

- [x] 11-06-PLAN.md — GW-03 sole-writer cutover: retire refresh-tokens (RED-first schedule.test) + swap chain source to sidecar + SIDECAR_URL config (GW-03, JRNL-02, GW-02)

**Wave 6** *(blocked on 11-05 + 11-06)*

- [x] 11-07-PLAN.md — Retire the TS `apps/auth` (`@morai/auth`) OAuth setup/refresh CLI now the sidecar owns the dance + refresh; drop it from the workspace; prove typecheck/lint/test green (D-04, GW-03)

### Phase 12: Streaming + TS Fan-Out

**Goal**: The sidecar streams live LEVELONE_OPTION data (marks, per-leg greeks, IV) and
ACCT_ACTIVITY fill events for open position legs **and for ad-hoc instrument lookups** (any
OCC symbol the user selects — scope expanded per CONTEXT D-05, 2026-06-28); live greeks/IV are
recomputed via the BSM engine, not shown raw (D-02). `apps/server` multiplexes the sidecar's
single SSE stream to N browser clients over an authed `GET /api/stream` endpoint, with a
Supabase JWT verified at the server edge (short-lived opaque ticket — D-01); on cold start or
reconnect the sidecar reconciles current state via a REST pull so the live view has no gaps.
**Depends on**: Phase 11 (stable sidecar with advisory lock and REST proxy)
**Requirements**: STRM-01, STRM-02, STRM-03, STRM-04, STRM-05
**Scope note**: STRM-01 expanded beyond open-legs-only to include ad-hoc instrument lookup (any OCC symbol) — CONTEXT D-05, 2026-06-28; see goal + criterion 6.
**Research flag**: ACCT_ACTIVITY `MESSAGE_TYPE` values are not publicly documented — discover empirically once the sidecar runs; do not hard-code from assumptions. EventSource JWT-as-query-param vs opaque-ticket security choice — prefer a short-lived ticket if cheap (query-param JWTs leak into server logs).
**Cross-cutting**: Stream data is display-only — no per-tick Postgres writes; `sync-transactions` (REST) remains the authoritative fill source (STRM-04 constraint applies across all streaming code).
**Success Criteria** (what must be TRUE):

  1. With at least one open position leg, the sidecar logs LEVELONE_OPTION updates (mark, delta, gamma, theta, vega, IV) for that leg's OCC symbol within 30 seconds of market open; fields map to the Zod `liveGreeks` contract from `packages/contracts` (STRM-01).
  2. A fill event executed in a test account appears as an ACCT_ACTIVITY message in the sidecar's stream within 10 seconds of execution; the message is forwarded to the server fan-out (STRM-02).
  3. `GET /api/stream` (with a valid Supabase JWT) delivers a well-formed SSE stream to a browser client; an unauthenticated request is rejected at the server edge before proxying to the sidecar (STRM-03).
  4. After a sidecar restart, `GET /sidecar/positions` is called and the resulting positions are reconciled so the first SSE event to reconnecting browsers reflects current state, not a stale pre-restart snapshot (STRM-05).
  5. The stream contains no Postgres writes in the hot path; `SELECT count(*) FROM leg_observations` does not grow during a streaming-only session (STRM-04 regression gate).
  6. Entering an arbitrary OCC symbol in the ad-hoc lookup streams its live BSM greeks the same way as an open leg — the symbol is added to the subscription set (respecting the 500-symbol cap) and dropped when cleared; the result row is visually distinguished from owned positions (STRM-01 expanded, D-05; UI-SPEC Surface 4).

**Plans**: 6/6 complete (executed 2026-06-28; verification `human_needed` — code complete + all offline suites green [1321 TS + 60 py, typecheck + lint clean], but SC1/SC2 + ad-hoc live-tick timing are RTH-gated → live UAT pending market open; see 12-VERIFICATION.md)
- [x] 12-01-PLAN.md — Stream contracts + core BSM recompute + ForReconcilingPositions port/twin + architecture docs (wave 1)
- [x] 12-02-PLAN.md — Sidecar streamer: trader StreamClient session, LEVELONE+ACCT_ACTIVITY, 490-cap LRU + reconcile diff (wave 2)
- [x] 12-04-PLAN.md — Server opaque-ticket store + SSE fan-out 1/sec coalescer + STRM-04 no-persist gate (wave 2)
- [x] 12-03-PLAN.md — Sidecar /sidecar/events SSE + /sidecar/positions reconcile + streamer task wiring (wave 3)
- [x] 12-05-PLAN.md — Server /api/stream/ticket + /api/stream fan-out (reconcile-first) + sidecar SSE consumer + SIDECAR_URL config (wave 3)
- [x] 12-06-PLAN.md — Web useLiveStream + LiveStatusBadge + Positions live overlay/stale + ad-hoc picker (wave 4)

**Operator go-live items** (post-execution, pending market open): (1) set `SIDECAR_URL` on the Railway **server** service (match the sidecar's deployed port); (2) deploy sidecar + server + web; (3) RTH UAT for SC1/SC2 + ad-hoc live ticks per 12-VERIFICATION.md.

### Phase 13: COT Adapter

**Goal**: A weekly `fetch-cot` job pulls CFTC COT data for E-mini S&P 500 (TFF report) into
a `cot_observations` table, storing the Tuesday `as_of` date separately from the Friday
`published_at` date; `GET /api/analytics/cot` and MCP `get_cot` expose current and
historical COT positioning series.
**Depends on**: Phase 10 (docs complete); independent of sidecar — can run in parallel with Phase 12 execution.
**Requirements**: COT-01, COT-02
**Research flag**: Confirm exact CFTC COT DataFrame column names from the `cot-reports` library before writing the `cot_observations` schema (validate against a live pull, not community examples).
**Cross-cutting**: MCP-02 applies — `get_cot` and `GET /api/analytics/cot` ship in the same change; Zod contract in `packages/contracts`.
**Success Criteria** (what must be TRUE):

  1. After `fetch-cot` runs on a Friday, `cot_observations` gains one row per report week with `as_of` set to the preceding Tuesday and `published_at` set to the Friday fetch date; a second run for the same week is idempotent (0 duplicate rows) (COT-01).
  2. `GET /api/analytics/cot` returns a JSON array of COT series entries (as_of, net_noncommercial, net_commercial, open_interest, …) over the shared Zod contract; MCP `get_cot` returns the same data to Claude Code (COT-02, MCP-02).

**Plans**: TBD

### Phase 14: FRED Expansion

**Goal**: The `fetch-rates` job is extended to an expanded FRED series set (DFF, DGS1MO,
DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS); VVIX is sourced via the existing CBOE adapter; the
production `FRED_API_KEY` is set; `GET /api/analytics/macro` and MCP `get_macro` expose the
full macro series.
**Depends on**: Phase 10 (docs complete); independent of sidecar — can run in parallel with Phase 12 or 13 execution.
**Requirements**: MAC-01, MAC-02
**Research flag**: None — FRED series IDs are confirmed; VVIX via CBOE is an established pattern; env var set is operator work.
**Cross-cutting**: MCP-02 applies — `get_macro` and `GET /api/analytics/macro` ship in the same change; Zod contract in `packages/contracts`.
**Success Criteria** (what must be TRUE):

  1. After `fetch-rates` runs with the prod `FRED_API_KEY` set, `rate_observations` contains rows for all seven FRED series (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS) plus VVIX sourced via the CBOE adapter; a second run for the same observation date is idempotent (MAC-01).
  2. `GET /api/analytics/macro` returns a JSON object keyed by series ID, each containing a time-ordered array of `{ time, value }` entries over the shared Zod contract; MCP `get_macro` returns the same payload to Claude Code (MAC-02, MCP-02).

**Plans**: TBD

### Phase 15: Re-Auth Smoothing

**Goal**: The system alerts the operator at T-24h before the Schwab refresh-token 7-day
cutoff (never a silent outage) and provides a one-click/operator re-auth flow that writes
a fresh token pair to Postgres without a Railway redeploy, so the sidecar picks up the
new tokens on its next auto-refresh cycle.
**Depends on**: Phase 11 (sidecar health endpoint + `broker_tokens` ownership established)
**Requirements**: AUTH-05, AUTH-06
**Research flag**: None — alert pattern matches Phase 5 `isNearExpiry` (JOB-02); re-auth flow uses `client_from_manual_flow` (established schwab-py pattern from SUMMARY.md).
**Success Criteria** (what must be TRUE):

  1. When the Schwab refresh token is within 24 hours of its 7-day expiry, `GET /api/status` includes a non-null `refreshExpiresIn` field and the status surface logs a warning; the alert fires before the token expires (AUTH-05).
  2. The operator can run a local re-auth flow (manual-flow → `token_write` callback → Postgres) that writes a new refresh token to `broker_tokens`; the sidecar picks up the new token on its next auto-refresh cycle without a Railway redeploy; `GET /api/status` reports token freshness restored (AUTH-06).

**Plans**: TBD

## Backlog / Future Enhancements

*Unscheduled — not yet assigned to a phase.*

### Schwab client library — revisit vendored TS vs @sudowealth/schwab-api

**Decided 2026-06-21** (full analysis: `.planning/notes/schwab-client-decision.md`). Phase 4
UAT found the vendored chain adapter 502s on the live `$SPX` chain (missing scoping params, not
a missing library). Decision: fix vendored TS now (add `strikeCount`/`fromDate`/`toDate`);
**reject** the Python `schwab-py` sidecar for the pure-TS hexagon (v1.0 decision, now superseded
by v1.1 arch for streaming ownership — the sidecar is the right answer for streaming but not
for the hexagon core). Revisit TS client adoption behind ports, version-pinned, human-verify gate.

### Strategy rules / logical gates engine (the "why I acted" layer — L4)

**Surfaced during Phase 5 discuss (2026-06-21).** User's stated end-goal: record the
enter/exit/roll RULES per trade + which rule fired, to improve the system/algo. This is a
NEW capability beyond Phase 5's trade ledger (JRNL-01 only pairs fills into events). The
Phase 5 D-07 "entry-thesis" field is the minimal attach point. Pairs with **L3 attribution**
(decompose a calendar's move into θ/vega/δ + event contributions). Candidate for its own
phase after v1.1. The 4-layer model (ledger → greeks time-series → attribution → rules) is
documented in `.planning/phases/05-jobs-fill-rebuild-integrity/05-CONTEXT.md`.

### Event-triggered supplemental journal snapshot

**Surfaced in SUMMARY.md.** On large underlying moves (captured via stream), trigger a
supplemental out-of-cycle snapshot. P2 — depends on the live stream (Phase 12). Candidate
for a v1.2 addendum after streaming is stable in production.

## Progress

**Execution Order:**
Phases execute in numeric order. Phases 13 and 14 are independent of the sidecar and can
be executed in parallel with each other or interleaved with Phase 12 execution. Phase 15
requires Phase 11 complete (sidecar health endpoint).

### Milestone v1.0

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Walking Skeleton | 6/6 | Complete | - |
| 2. Market Data & BSM Engine | 12/12 | Complete | 2026-06-12 |
| 3. Calendar Journal (MVP) | 7/7 | Complete | 2026-06-14 |
| 4. Schwab Auth & Brokerage | 6/6 | Complete | 2026-06-20 |
| 5. Jobs, Fill Rebuild & Integrity | 15/16 | Complete | 2026-06-22 |
| 6. Derived Analytics | 8/8 | Complete | 2026-06-22 |
| 7. Trade History | 2/2 | Complete | 2026-06-22 |
| 8. Web Dashboard Backend | 8/7 | Complete | 2026-06-24 |
| 9. Web Dashboard Frontend | 10/10 | Complete | 2026-06-25 |

### Milestone v1.1

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Stack Decisions Doc Update | 1/1 | Complete   | 2026-06-25 |
| 11. Sidecar Scaffold + Auth Migration | 7/7 | Complete   | 2026-06-25 |
| 12. Streaming + TS Fan-Out | 0/TBD | Not started | - |
| 13. COT Adapter | 0/TBD | Not started | - |
| 14. FRED Expansion | 0/TBD | Not started | - |
| 15. Re-Auth Smoothing | 0/TBD | Not started | - |

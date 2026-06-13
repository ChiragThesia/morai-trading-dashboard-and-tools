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

## Phases

- [x] **Phase 1: Walking Skeleton** - Monorepo + hexagon + DB + deployed status endpoint
- [x] **Phase 2: Market Data & BSM Engine** - CBOE chain in, BSM greeks computed and stored (gap closure in progress) (completed 2026-06-11)
- [ ] **Phase 3: Calendar Journal (MVP)** - Register calendar, snapshot job, journal read surface live
- [ ] **Phase 4: Schwab Auth & Brokerage** - OAuth client, tokens in DB, Schwab chain + positions
- [ ] **Phase 5: Jobs, Fill Rebuild & Integrity** - Full job queue, sync-fills, journal rebuilt from broker data
- [ ] **Phase 6: Derived Analytics** - Skew + term-structure observations, API + MCP exposed

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

**Plans**: TBD

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

**Plans**: TBD

### Phase 5: Jobs, Fill Rebuild & Integrity

**Goal**: All background jobs run behind the `JobQueue` port with deterministic dedupe
keys and idempotent handlers; the `sync-fills` path pairs Schwab fills into calendar
open/close events; and `rebuild-journal` can reconstruct a calendar's history entirely
from broker transactions.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: JOB-01, JOB-02, JOB-03, JRNL-01
**Success Criteria** (what must be TRUE):

  1. All scheduled jobs (`snapshot-calendars`, `compute-bsm-greeks`, `sync-fills`, `refresh-tokens`, `fetch-rates`, `compute-analytics`) are registered in `apps/worker/src/schedule.ts` and visible in `GET /api/status` under `lastJobRuns`; duplicate enqueues within the same window are idempotent (no duplicate rows in the DB).
  2. `JOB-02` (`refresh-tokens`, 04:00 ET): both Schwab apps refresh independently; a simulated failure on one app does not block the other; `GET /api/status` flags the failing app.
  3. `JOB-03` (`compute-bsm-greeks`): after running, `SELECT count(*) FROM leg_observations WHERE bsm_iv IS NULL AND mark IS NOT NULL` returns 0 (all pending observations computed).
  4. `sync-fills` pairs Schwab fill transactions into calendar OPEN/CLOSE events with correct net debit, credit, and P&L; paired events are idempotent on re-run (re-running against the same fill set produces no duplicate rows).
  5. `rebuild-journal` (manual trigger via `trigger_job` MCP tool or API) reconstructs a calendar's snapshot history from fills; the resulting `calendar_snapshots` rows match those written by the live snapshot job for the same period.

**Plans**: TBD

### Phase 6: Derived Analytics

**Goal**: The `compute-analytics` job writes skew and term-structure observations after
each snapshot cycle; `GET /api/analytics/skew` and `GET /api/analytics/term-structure`
return current and historical series queryable by API and Claude Code.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: ANLY-01, ANLY-02, ANLY-03
**Success Criteria** (what must be TRUE):

  1. After `snapshot-calendars` completes a cycle, `skew_observations` gains new append-only rows for that snapshot time; duplicate runs for the same snapshot time produce no duplicate rows.
  2. After `snapshot-calendars` completes a cycle, `term_structure_observations` gains new rows capturing `back_iv - front_iv` (forward-vol signal) for each calendar; values match the `term_slope` stored in the corresponding `calendar_snapshots` row.
  3. `GET /api/analytics/skew` returns a JSON array with at least one entry of `{ time, value, … }`; `GET /api/analytics/term-structure` returns the same shape for term-structure data.
  4. MCP `get_skew` and `get_term_structure` tools return the same series as their HTTP counterparts, validated against the shared Zod contract from `contracts`.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Walking Skeleton | 4/6 | In Progress|  |
| 2. Market Data & BSM Engine | 12/12 | Complete    | 2026-06-12 |
| 3. Calendar Journal (MVP) | 0/TBD | Not started | - |
| 4. Schwab Auth & Brokerage | 0/TBD | Not started | - |
| 5. Jobs, Fill Rebuild & Integrity | 0/TBD | Not started | - |
| 6. Derived Analytics | 0/TBD | Not started | - |

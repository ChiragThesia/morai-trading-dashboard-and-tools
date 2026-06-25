# Requirements: Morai — Trading Dashboard & Tools

**Defined:** 2026-06-07
**Core Value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.

> Scope note: v1 is the **backend + data layer**, driven by the HTTP API and MCP. No web UI (D19).
> "User" below means the trader operating via API/CLI/MCP, and Claude Code as an API consumer.

## v1 Requirements

Requirements for the initial backend release. Each maps to exactly one roadmap phase.

### Foundation

- [x] **FND-01**: Bun-workspaces monorepo installs from one lockfile; `core` / `adapters` / `contracts` / `shared` packages resolve via tsconfig project references.
- [x] **FND-02**: ESLint boundary rules fail the build when `core` imports an adapter, app, framework, or vendor SDK.
- [x] **FND-03**: Strict TypeScript config (no `any`/`as`/`!`, exhaustive switches, no floating promises) fails the build on violation.
- [x] **FND-04**: `shared` kernel provides `Result<T,E>`, `assertDefined`, and an `OccSymbol` parser/formatter, all unit-tested.
- [x] **FND-05**: Root scripts `bun run dev | test | typecheck | lint | migrate` run across the workspace.

### Persistence

- [ ] **DATA-01**: Drizzle schema defines the journal-context tables (`calendars`, `calendar_snapshots`, `leg_observations`, `contracts`, `fills`, `orders`, `rate_observations`) with time-leading composite keys on observation tables.
- [ ] **DATA-02**: Idempotent migrator runs pending drizzle-kit migrations on server/worker boot, safe across restarts.
- [ ] **DATA-03**: Every driven repository port has both a Supabase-Postgres implementation and an in-memory implementation; an integration test suite runs the same contract against both (testcontainers Postgres).
- [ ] **DATA-04**: Config layer Zod-parses env once at the composition root and fails boot loudly on bad/missing config, including the direct vs pooled Supabase URLs.

### Deployment

- [ ] **DEPLOY-01**: `apps/server` and `apps/worker` deploy as separate Railway services pointed at Supabase Postgres.
- [ ] **DEPLOY-02**: `GET /api/status` is reachable in production and reports DB reachability, token freshness, and last successful run per job.
- [ ] **DEPLOY-03**: The MCP endpoint is reachable in production over streamable HTTP, bearer-token protected, and registers in Claude Code.

### Market Data

- [x] **MKT-01**: A CBOE adapter fetches a delayed SPX option chain behind a `ForFetchingChain` port, Zod-parsing the response before it reaches core (no auth required).
- [x] **MKT-02**: A FRED adapter fetches the DGS3MO risk-free rate behind a port, falling back to 4.5% when unreachable.
- [x] **MKT-03**: Raw per-contract quotes land in `leg_observations` (append-only) with their source tagged.

### Schwab Auth & Brokerage

- [x] **AUTH-01**: A vendored OAuth client authenticates both Schwab apps (trader + market) via authorization-code + refresh grant.
- [ ] **AUTH-02**: Tokens persist encrypted in Supabase `broker_tokens`; any service reads one source of truth.
- [x] **AUTH-03**: An `auth` CLI exposes `setup | refresh | status | doctor` (doctor checks env completeness, callback-URL exact match, live refresh-grant).
- [ ] **AUTH-04**: On `invalid_grant`, Schwab-dependent jobs pause and status flags `AUTH_EXPIRED`; the other app keeps working.
- [ ] **BRK-01**: A Schwab market adapter fetches option chains and quotes behind the same market-data ports as CBOE.
- [ ] **BRK-02**: A Schwab trader adapter fetches positions, orders, and transactions behind their ports.
- [x] **BRK-03**: A `get_transactions` MCP tool returns date-ranged trade transactions over the shared `transactionsResponse` contract (MCP-02).
- [x] **BRK-04**: A historical backfill runs `sync-transactions` over an arbitrary past range (chunked to Schwab's lookback cap, idempotent) to populate `fills` from trade history.

### BSM Analytics Engine

- [x] **BSM-01**: An IV-inversion routine recovers implied vol from an option mark (European SPX/SPXW), property-tested for monotonicity and round-trip accuracy.
- [x] **BSM-02**: A greeks routine computes delta/gamma/theta/vega from spot, strike, rate, IV, and DTE, validated against known reference values.
- [x] **BSM-03**: Computed (BSM) values are stored alongside vendor-raw values; reads prefer computed and fall back to raw.

### Calendar & Journal

- [x] **CAL-01**: A user can register an open calendar (underlying, strike, front/back expiry, qty, open debit) via the API.
- [x] **CAL-02**: The `snapshot-calendars` job writes one `calendar_snapshots` row per open calendar on the 30-min RTH cadence (net mark, per-leg marks, our IV + greeks, term slope, DTEs, open P&L).
- [x] **CAL-03**: `GET /api/journal/:calendarId` returns the ordered snapshot series for one calendar — the journal view.
- [x] **CAL-04**: `GET /api/calendars` lists open and closed calendars.
- [x] **CAL-05**: Jobs no-op gracefully outside RTH and on NYSE holidays (holiday calendar consulted).

### Derived Analytics

- [x] **ANLY-01**: A `compute-analytics` job writes skew observations (append-only, time-leading).
- [x] **ANLY-02**: The same job writes term-structure observations (back_iv − front_iv forward-vol signal).
- [x] **ANLY-03**: `GET /api/analytics/skew` and `GET /api/analytics/term-structure` return current + historical series.

### Jobs & Integrity

- [x] **JOB-01**: All jobs run behind a `JobQueue` port (pg-boss adapter) with deterministic dedupe keys and idempotent, Zod-parsed handlers.
- [x] **JOB-02**: The `refresh-tokens` job (04:00 ET) refreshes both Schwab apps independently and alerts on failure.
- [x] **JOB-03**: `compute-bsm-greeks` drains `leg_observations WHERE bsm_iv IS NULL` and upserts computed values.
- [x] **JRNL-01**: A `sync-fills` / rebuild path pairs Schwab fills into calendar OPEN/CLOSE events with net debit/credit/P&L — journal history is rebuilt from fills, never hand-written.

### Claude Code Surface

- [x] **MCP-01**: MCP tools `get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew`, `trigger_job` mirror their HTTP routes, sharing one Zod schema source from `contracts`.
- [x] **MCP-02**: Every new use-case ships both adapters (HTTP route + MCP tool) in the same change.

## v1.1 Requirements

Milestone v1.1 — Real-Time Schwab Streaming. A single Python schwab-py sidecar becomes the sole
Schwab boundary (REST + stream); live positions stop going stale; the journal is re-sourced through
it; COT + expanded FRED are added. Backend/data/contracts + live stream only — UI panels are a
separate UI-rebuild milestone. Reverses **D17** (streaming deferred) for account/position data.

### Gateway & Auth Migration

- [ ] **GW-01**: A Python schwab-py sidecar deploys as a third Railway service and is the sole process that authenticates to Schwab — OAuth plus token read/write against the existing `broker_tokens` row (no schema change, no token file).
- [ ] **GW-02**: The sidecar exposes a REST proxy (chain, positions, transactions, orders) behind the existing brokerage ports; TS adapters become thin HTTP clients to the sidecar, not Schwab directly.
- [ ] **GW-03**: The TS `refresh-tokens` job is retired and the sidecar is the only token refresher — exactly one process ever writes `broker_tokens` (no dual-refresher rotating-token race).
- [ ] **GW-04**: A Postgres advisory lock guarantees a single Schwab streamer session, so a redeploy or restart cannot open a second session and kill the first.
- [ ] **GW-05**: The sidecar is internal-only and never internet-reachable; only `apps/server` can reach it.

### Real-Time Streaming

- [ ] **STRM-01**: The sidecar streams live LEVELONE_OPTION data (mark, bid/ask, delta/gamma/theta/vega/rho, IV) for open position legs only.
- [ ] **STRM-02**: The sidecar streams ACCT_ACTIVITY fill events.
- [ ] **STRM-03**: `apps/server` fans the sidecar's single stream out to N browser clients over an authed `GET /api/stream`, with the Supabase JWT verified at the server edge.
- [ ] **STRM-04**: Stream data is display-only — no per-tick persistence; `sync-transactions` (REST) remains the authoritative fill source.
- [ ] **STRM-05**: On (re)connect and cold-start the sidecar reconciles current state via a REST pull so the live view and journal have no gaps.

### Journal Re-Sourcing

- [ ] **JRNL-02**: The chain-snapshot job sources the SPX chain through the sidecar (replacing direct Schwab REST), with CBOE retained as the no-auth fallback during the 7-day re-auth gap.

### COT Positioning

- [ ] **COT-01**: A weekly `fetch-cot` job pulls CFTC COT data (E-mini S&P 500, TFF report) behind a port into a `cot_observations` table, storing `as_of` (Tuesday) separately from `published_at` (Friday); no auth.
- [ ] **COT-02**: `GET /api/analytics/cot` and MCP `get_cot` return current and historical COT positioning series (MCP-02).

### FRED Macro

- [ ] **MAC-01**: The `fetch-rates` job is extended to an expanded FRED series set (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS) with the prod `FRED_API_KEY` set; VVIX is sourced via the existing CBOE adapter.
- [ ] **MAC-02**: `GET /api/analytics/macro` and MCP `get_macro` return the macro series (MCP-02).

### Re-Auth Smoothing

- [ ] **AUTH-05**: Status surfaces the Schwab refresh-token expiry and an alert fires at T-24h before the 7-day cutoff.
- [ ] **AUTH-06**: A one-click/operator re-auth flow (manual-flow → `token_write` to Postgres) restores Schwab auth without a redeploy.

### Docs

- [ ] **DOC-01**: `docs/architecture/stack-decisions.md` is updated before sidecar code — D16 (TS OAuth client) superseded, D17 (streaming deferred) lifted, and a new decision recorded for the Python sidecar as a third Railway service.

## v2 Requirements

Deferred to a future milestone. Tracked, not in the current roadmap.

### Web UI

- **UI-01**: React + Vite SPA on Vercel renders the live journal, greeks, vol, and skew/term views.
- **UI-02**: Status banner surfaces `AUTH_EXPIRED` and job failures.

### Advanced Data & Scale

- **STRM-01**: ~~Sub-minute streaming quotes behind a `ForStreamingQuotes` port.~~ → Realized in v1.1 (account/position streaming via the schwab-py sidecar).
- **SCALE-01**: Timescale hypertable migration when an observations table exceeds 10M rows or p95 journal query > 500ms.
- **MULTI-01**: Multi-user accounts + API auth beyond the single bearer token.

### Analytics depth

- **ANLY2-01**: Full-chain capture (~500 contracts) at snapshot cadence.
- **ANLY2-02**: GEX levels (Call/Put walls, HVL, flip) recomputed from collected chains.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Web UI in v1 | Backend + data layer first; UI is a later consumer of a stable API (D19) |
| Supabase Realtime / Auth / RLS | Vendor coupling raises swap cost; Supabase used as plain Postgres (D18) |
| Live trade advice / regime scoring | Owned by the separate `trade-advisor` plugin; Morai owns collected/historical data |
| Hand-edited journal entries | Journal is rebuilt from broker fills — source-of-truth discipline |
| Market-data websockets (full-chain) | Chain can't stream (~500-symbol cap); 30-min REST snapshot stays. **D17 lifted in v1.1** for account/position streaming (legs only) |
| Multi-user / public API versioning | Single user now; revisit at multi-user |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Complete |
| FND-02 | Phase 1 | Complete |
| FND-03 | Phase 1 | Complete |
| FND-04 | Phase 1 | Complete |
| FND-05 | Phase 1 | Complete |
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 1 | Complete |
| DEPLOY-01 | Phase 1 | Complete |
| DEPLOY-02 | Phase 1 | Complete |
| DEPLOY-03 | Phase 1 | Complete |
| MCP-02 | Phase 1 | Complete |
| MKT-01 | Phase 2 | Complete |
| MKT-02 | Phase 2 | Complete |
| MKT-03 | Phase 2 | Complete |
| BSM-01 | Phase 2 | Complete |
| BSM-02 | Phase 2 | Complete |
| BSM-03 | Phase 2 | Complete |
| CAL-01 | Phase 3 | Complete |
| CAL-02 | Phase 3 | Complete |
| CAL-03 | Phase 3 | Complete |
| CAL-04 | Phase 3 | Complete |
| CAL-05 | Phase 3 | Complete |
| MCP-01 | Phase 3 | Complete |
| AUTH-01 | Phase 4 | Complete |
| AUTH-02 | Phase 4 | Complete |
| AUTH-03 | Phase 4 | Complete |
| AUTH-04 | Phase 4 | Complete |
| BRK-01 | Phase 4 | Complete |
| BRK-02 | Phase 4 | Complete |
| JOB-01 | Phase 5 | Complete |
| JOB-02 | Phase 5 | Complete |
| JOB-03 | Phase 5 | Complete |
| JRNL-01 | Phase 5 | Complete |
| ANLY-01 | Phase 6 | Complete |
| ANLY-02 | Phase 6 | Complete |
| ANLY-03 | Phase 6 | Complete |
| BRK-03 | Phase 7 | Complete |
| BRK-04 | Phase 7 | Complete |
| DOC-01 | Phase 10 | Pending |
| GW-01 | Phase 11 | Pending |
| GW-02 | Phase 11 | Pending |
| GW-03 | Phase 11 | Pending |
| GW-04 | Phase 11 | Pending |
| GW-05 | Phase 11 | Pending |
| JRNL-02 | Phase 11 | Pending |
| STRM-01 | Phase 12 | Pending |
| STRM-02 | Phase 12 | Pending |
| STRM-03 | Phase 12 | Pending |
| STRM-04 | Phase 12 | Pending |
| STRM-05 | Phase 12 | Pending |
| COT-01 | Phase 13 | Pending |
| COT-02 | Phase 13 | Pending |
| MAC-01 | Phase 14 | Pending |
| MAC-02 | Phase 14 | Pending |
| AUTH-05 | Phase 15 | Pending |
| AUTH-06 | Phase 15 | Pending |

**Coverage:**

- v1 requirements: 38 total
- Mapped to phases: 38
- v1.1 requirements: 18 total (DOC-01, GW-01..05, STRM-01..05, JRNL-02, COT-01..02, MAC-01..02, AUTH-05..06)
- Mapped to phases: 18
- Unmapped: 0 — full coverage (both milestones)

---
*Requirements defined: 2026-06-07*
*Last updated: 2026-06-25 — v1.1 traceability (Phases 10-15) populated by gsd-roadmapper*

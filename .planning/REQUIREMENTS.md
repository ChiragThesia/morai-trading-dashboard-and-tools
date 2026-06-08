# Requirements: Morai — Trading Dashboard & Tools

**Defined:** 2026-06-07
**Core Value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.

> Scope note: v1 is the **backend + data layer**, driven by the HTTP API and MCP. No web UI (D19).
> "User" below means the trader operating via API/CLI/MCP, and Claude Code as an API consumer.

## v1 Requirements

Requirements for the initial backend release. Each maps to exactly one roadmap phase.

### Foundation

- [ ] **FND-01**: Bun-workspaces monorepo installs from one lockfile; `core` / `adapters` / `contracts` / `shared` packages resolve via tsconfig project references.
- [ ] **FND-02**: ESLint boundary rules fail the build when `core` imports an adapter, app, framework, or vendor SDK.
- [ ] **FND-03**: Strict TypeScript config (no `any`/`as`/`!`, exhaustive switches, no floating promises) fails the build on violation.
- [ ] **FND-04**: `shared` kernel provides `Result<T,E>`, `assertDefined`, and an `OccSymbol` parser/formatter, all unit-tested.
- [ ] **FND-05**: Root scripts `bun run dev | test | typecheck | lint | migrate` run across the workspace.

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

- [ ] **MKT-01**: A CBOE adapter fetches a delayed SPX option chain behind a `ForFetchingChain` port, Zod-parsing the response before it reaches core (no auth required).
- [ ] **MKT-02**: A FRED adapter fetches the DGS3MO risk-free rate behind a port, falling back to 4.5% when unreachable.
- [ ] **MKT-03**: Raw per-contract quotes land in `leg_observations` (append-only) with their source tagged.

### Schwab Auth & Brokerage

- [ ] **AUTH-01**: A vendored OAuth client authenticates both Schwab apps (trader + market) via authorization-code + refresh grant.
- [ ] **AUTH-02**: Tokens persist encrypted in Supabase `broker_tokens`; any service reads one source of truth.
- [ ] **AUTH-03**: An `auth` CLI exposes `setup | refresh | status | doctor` (doctor checks env completeness, callback-URL exact match, live refresh-grant).
- [ ] **AUTH-04**: On `invalid_grant`, Schwab-dependent jobs pause and status flags `AUTH_EXPIRED`; the other app keeps working.
- [ ] **BRK-01**: A Schwab market adapter fetches option chains and quotes behind the same market-data ports as CBOE.
- [ ] **BRK-02**: A Schwab trader adapter fetches positions, orders, and transactions behind their ports.

### BSM Analytics Engine

- [ ] **BSM-01**: An IV-inversion routine recovers implied vol from an option mark (European SPX/SPXW), property-tested for monotonicity and round-trip accuracy.
- [ ] **BSM-02**: A greeks routine computes delta/gamma/theta/vega from spot, strike, rate, IV, and DTE, validated against known reference values.
- [ ] **BSM-03**: Computed (BSM) values are stored alongside vendor-raw values; reads prefer computed and fall back to raw.

### Calendar & Journal

- [ ] **CAL-01**: A user can register an open calendar (underlying, strike, front/back expiry, qty, open debit) via the API.
- [ ] **CAL-02**: The `snapshot-calendars` job writes one `calendar_snapshots` row per open calendar on the 30-min RTH cadence (net mark, per-leg marks, our IV + greeks, term slope, DTEs, open P&L).
- [ ] **CAL-03**: `GET /api/journal/:calendarId` returns the ordered snapshot series for one calendar — the journal view.
- [ ] **CAL-04**: `GET /api/calendars` lists open and closed calendars.
- [ ] **CAL-05**: Jobs no-op gracefully outside RTH and on NYSE holidays (holiday calendar consulted).

### Derived Analytics

- [ ] **ANLY-01**: A `compute-analytics` job writes skew observations (append-only, time-leading).
- [ ] **ANLY-02**: The same job writes term-structure observations (back_iv − front_iv forward-vol signal).
- [ ] **ANLY-03**: `GET /api/analytics/skew` and `GET /api/analytics/term-structure` return current + historical series.

### Jobs & Integrity

- [ ] **JOB-01**: All jobs run behind a `JobQueue` port (pg-boss adapter) with deterministic dedupe keys and idempotent, Zod-parsed handlers.
- [ ] **JOB-02**: The `refresh-tokens` job (04:00 ET) refreshes both Schwab apps independently and alerts on failure.
- [ ] **JOB-03**: `compute-bsm-greeks` drains `leg_observations WHERE bsm_iv IS NULL` and upserts computed values.
- [ ] **JRNL-01**: A `sync-fills` / rebuild path pairs Schwab fills into calendar OPEN/CLOSE events with net debit/credit/P&L — journal history is rebuilt from fills, never hand-written.

### Claude Code Surface

- [ ] **MCP-01**: MCP tools `get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew`, `trigger_job` mirror their HTTP routes, sharing one Zod schema source from `contracts`.
- [ ] **MCP-02**: Every new use-case ships both adapters (HTTP route + MCP tool) in the same change.

## v2 Requirements

Deferred to a future milestone. Tracked, not in the current roadmap.

### Web UI
- **UI-01**: React + Vite SPA on Vercel renders the live journal, greeks, vol, and skew/term views.
- **UI-02**: Status banner surfaces `AUTH_EXPIRED` and job failures.

### Advanced Data & Scale
- **STRM-01**: Sub-minute streaming quotes behind a `ForStreamingQuotes` port.
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
| Market-data websockets | 30-min snapshot cadence covered by scheduled pulls (D17) |
| Multi-user / public API versioning | Single user now; revisit at multi-user |

## Traceability

Populated during roadmap creation (gsd-roadmapper).

| Requirement | Phase | Status |
|-------------|-------|--------|
| (pending roadmap) | — | Pending |

**Coverage:**
- v1 requirements: 32 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 32 ⚠️

---
*Requirements defined: 2026-06-07*
*Last updated: 2026-06-07 after initial definition*

# Phase 13: COT Adapter - Context

**Gathered:** 2026-06-28
**Status:** Ready for planning

<domain>
## Phase Boundary

A weekly `fetch-cot` job pulls CFTC Commitments of Traders (COT) positioning data for
E-mini S&P 500 into a `cot_observations` table, storing the Tuesday `as_of` date separately
from the Friday `published_at` date. `GET /api/analytics/cot` and MCP `get_cot` expose
current and historical COT positioning over a shared Zod contract.

**In scope:** CFTC fetch adapter + port, `cot_observations` table + migration, `fetch-cot`
worker job (cron), `cot` Zod contract, `GET /api/analytics/cot` route, `get_cot` MCP tool.
Read-only, no auth (public CFTC data). E-mini S&P 500 only.

**Out of scope:** UI panels (the Overview "what the big guys are doing" COT section consumes
`get_cot` in a later UI pass, not here). Other instruments. Historical backfill.

</domain>

<decisions>
## Implementation Decisions

### Data Source
- **D-01:** Pull directly from the **CFTC Socrata JSON API** (`publicreporting.cftc.gov`)
  via a TS adapter `packages/adapters/src/http/cftc.ts` behind a new `ForFetchingCotReport`
  core port. Mirror the existing FRED rate adapter (`packages/adapters/src/http/fred.ts`)
  pattern exactly. NO Python, NO sidecar coupling, NO `cot-reports` library.
- **D-02:** `fetch-cot` is a TS worker job (`apps/worker`), wired like `fetch-rates`. No auth.

### Report & Schema
- **D-03:** Use the **TFF (Traders in Financial Futures)** report for E-mini S&P 500.
- **D-04:** `cot_observations` stores **long + short** raw positions for each TFF trader
  class — **Dealer, Asset Manager, Leveraged Funds, Other Reportable, Non-Reportable** —
  plus `open_interest`, `as_of`, `published_at`. NET values are **derived at the API layer**
  (not stored), so the contract can expose net per class.
- **D-05:** Reconcile COT-02's illustrative legacy field names (`net_noncommercial` /
  `net_commercial`) to TFF classes: the API exposes `net_leveraged_funds`,
  `net_asset_manager`, `net_dealer`, etc. **Leveraged Funds is the primary "big guys"
  signal** for index futures (hedge funds / CTAs).

### History
- **D-06:** First run fetches **current week only**. History accrues one row per week going
  forward. No initial backfill.

### Refresh Timing & Idempotency
- **D-07:** Cron **Friday 17:00 ET** (after the ~15:30 ET CFTC release). `published_at` =
  fetch timestamp.
- **D-08:** `as_of` (the Tuesday report date) is read from the **report's own date field**
  (e.g. `report_date_as_yyyy_mm_dd`), NOT computed by subtracting days — handles
  holiday-shifted releases.
- **D-09:** Idempotency key = the `as_of` report week. A re-run for the same week inserts
  **0 duplicate rows** (COT-01). Use an upsert / unique constraint on the week.

### Cross-cutting (MCP-02)
- **D-10:** `get_cot` MCP tool and `GET /api/analytics/cot` ship in the **same change**,
  over a shared Zod contract `packages/contracts/src/cot.ts`. Mirror the
  skew / term-structure / gex contract+route+MCP trio.

### Claude's Discretion
- Exact migration column names/types, Socrata pagination + query params, fetch error/empty
  handling (return empty vs error — follow the FRED adapter's fallback convention), retry
  policy, and the in-memory twin shape. Decide consistent with existing adapter conventions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope
- `.planning/ROADMAP.md` §"Phase 13: COT Adapter" — goal, success criteria, research flag, MCP-02.
- `.planning/REQUIREMENTS.md` §"COT Positioning" — COT-01, COT-02.

### Analog code (mirror these patterns)
- `packages/adapters/src/http/fred.ts` — external-HTTP fetch behind a port + key/fallback handling (closest analog for `cftc.ts`).
- `packages/adapters/src/postgres/repos/rate-observations.ts` — observations repo + insert pattern (chunking, 65k-param limit).
- `packages/core/src/journal/application/fetchRate.ts` — `ForFetchingRate` port + `makeXxx(deps)` use-case (analog for `ForFetchingCotReport`).
- `apps/server/src/adapters/http/analytics.routes.ts` — analytics route pattern (skew/term-structure) → add `/api/analytics/cot`.
- `packages/contracts/src/gex.ts` — Zod contract + shared MCP/route schema pattern → new `cot.ts`.
- `apps/worker/src/schedule.ts` + `apps/worker/src/handlers/fetch-rates.ts` — cron registration + job-handler shape → `fetch-cot`.
- `apps/server/src/adapters/mcp/server.ts` — MCP tool registration pattern → `get_cot`.

### Architecture law
- `.claude/rules/architecture-boundaries.md` — dependency law, `ForVerbingNoun` ports, in-memory twin, route+MCP same PR.
- `docs/architecture/hexagonal-ddd.md` — layer + port conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- FRED adapter (`fred.ts`): the template for `cftc.ts` — Zod-parse the JSON response, filter
  sentinel/missing values, return `Result<T,E>`, static-warn + fallback on network/parse error.
- `rate-observations` repo: insert pattern incl. the 65,534-param limit (chunk at ≤2,000 rows).
- Analytics route + MCP trio (skew/term-structure/gex): route + MCP tool + shared contract land together.

### Established Patterns
- Driven port named `ForFetchingCotReport`; use-case factory `makeXxx(deps)`; ship the
  in-memory twin in `packages/adapters/memory/` in the same change.
- Parse-don't-cast: the Socrata response goes through Zod before use. No `any`/`as`/`!`.
- MCP-02: new route ⇒ matching MCP tool in the same change.

### Integration Points
- New migration `packages/adapters/src/postgres/migrations/0012_cot_observations.sql` (next after 0011).
- New contract `packages/contracts/src/cot.ts`.
- New worker job: queue + cron in `schedule.ts`, handler in `apps/worker/src/handlers/fetch-cot.ts`, wiring in `apps/worker/src/main.ts`.
- New route in `analytics.routes.ts` + MCP tool in the MCP server.

</code_context>

<specifics>
## Specific Ideas

- **Research flag (updated):** confirm the exact CFTC Socrata **dataset/resource ID** for the
  TFF report AND the exact **field names** (per-class long/short, open interest, report date)
  against a **LIVE Socrata pull** — not community examples and not the `cot-reports` library
  (we go direct API). This is the single biggest unknown for the schema.
- The downstream consumer is the Overview "what the big guys are doing" section — the data
  should make Leveraged-Funds net positioning trivially chartable.

</specifics>

<deferred>
## Deferred Ideas

- **Historical backfill** — current-week-only chosen; a one-shot multi-year backfill could be a
  later operator task if a positioning trend chart needs deep history.
- **Other instruments** (full S&P 500, Nasdaq, VIX futures COT) — E-mini S&P 500 only this phase.
- **Overview COT UI panel** — consumes `get_cot`; belongs in a later UI pass, not this backend phase.

</deferred>

---

*Phase: 13-cot-adapter*
*Context gathered: 2026-06-28*

# Phase 13: COT Adapter — Research

**Researched:** 2026-06-28
**Status:** Ready for planning
**Note:** The gsd-phase-researcher completed live CFTC Socrata validation but stalled before
writing this file; findings below were salvaged from its transcript (all field names/IDs were
observed in live `publicreporting.cftc.gov` pulls, not community examples — per the CONTEXT flag).

---

## 1. CONFIRMED — CFTC Socrata API (live-validated)

**Dataset (TFF, Futures-Only):** `https://publicreporting.cftc.gov/resource/gpe5-46if.json`
- This is the **Traders in Financial Futures — Futures Only** dataset (the TFF report, D-03).
- No auth required. Anonymous throttle: **~1000 requests / rolling hour** — vastly under a
  once-weekly job, so **no Socrata app token needed** (an `X-App-Token` header is optional).

**E-mini S&P 500 selector:** `cftc_contract_market_code = '13874A'`
- Confirmed via `market_and_exchange_names like '%E-MINI S&P 500%'` →
  "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE", code **`13874A`**.
- Prefer the **code** (`13874A`) over the name string for the `$where` filter (stable, exact).
- (`13874+` is a different/combined code; `13874A` is the TFF futures-only E-mini row.)

**Latest-week query:**
```
GET /resource/gpe5-46if.json
  ?$where=cftc_contract_market_code='13874A'
  &$order=report_date_as_yyyy_mm_dd DESC
  &$limit=1
```
(URL-encode the `$where`; `&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=1`.)

**Confirmed JSON field names** (observed in the live response):

| Field (Socrata) | Meaning |
|---|---|
| `report_date_as_yyyy_mm_dd` | report **as_of** date (the Tuesday) — floating ISO ts e.g. `"2026-06-23T00:00:00.000"` |
| `yyyy_report_week_ww` | report week number (secondary key) |
| `cftc_contract_market_code` | contract selector (`13874A`) |
| `open_interest_all` | total open interest |
| `dealer_positions_long_all` / `dealer_positions_short_all` | Dealer/Intermediary |
| `asset_mgr_positions_long_all` / `asset_mgr_positions_short_all` | Asset Manager/Institutional |
| `lev_money_positions_long_all` / `lev_money_positions_short_all` | **Leveraged Funds** (hedge funds — the "big guys" signal) |
| `other_rept_positions_long_all` / `other_rept_positions_short_all` | Other Reportables |
| `nonrept_positions_long_all` / `nonrept_positions_short_all` | Non-Reportables |
| `tot_rept_positions_long_all` / `tot_rept_positions_short_all` | Total Reportable (derivable; optional to store) |

Also present (optional): `*_positions_spread_all` for asset_mgr / lev_money / other_rept.

> **LANDMINE — Socrata returns ALL numeric fields as JSON STRINGS** (e.g. `"123456"`).
> The Zod parse MUST coerce: `z.coerce.number()` (or `z.string().transform(Number)`), not `z.number()`.

---

## 2. Schema — `cot_observations` (migration 0012)

Next migration after `0011_broker_tokens_token_json.sql` → `0012_cot_observations.sql`.

```sql
CREATE TABLE cot_observations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_code      text        NOT NULL,        -- '13874A'
  as_of              date        NOT NULL,        -- from report_date_as_yyyy_mm_dd (Tuesday)
  published_at       timestamptz NOT NULL,        -- fetch timestamp (Friday)
  open_interest      integer     NOT NULL,
  dealer_long        integer NOT NULL, dealer_short        integer NOT NULL,
  asset_mgr_long     integer NOT NULL, asset_mgr_short     integer NOT NULL,
  lev_money_long     integer NOT NULL, lev_money_short     integer NOT NULL,
  other_rept_long    integer NOT NULL, other_rept_short    integer NOT NULL,
  nonrept_long       integer NOT NULL, nonrept_short       integer NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_code, as_of)          -- idempotency key (COT-01)
);
```
- **Idempotency (COT-01):** `INSERT ... ON CONFLICT (contract_code, as_of) DO NOTHING` (or
  `DO UPDATE` if a late-revised report should overwrite). A second run for the same `as_of`
  week inserts **0 new rows**.
- NET is **derived in the API**, not stored (D-04): `net_dealer = dealer_long − dealer_short`, etc.
- One row/week → the 65,534-param chunk limit is irrelevant here, but keep the repo's
  insert shape consistent with `rate-observations.ts`.

---

## 3. Hexagonal wiring (mirror the FRED adapter)

**Port (core):** `ForFetchingCotReport` — `packages/core/src/journal/application/` next to `fetchRate.ts`.
```ts
// returns the latest TFF row for a contract, parsed to the domain shape
type ForFetchingCotReport = (contractCode: string) => Promise<Result<CotReport, FetchError>>;
```
- Domain `CotReport`: `{ asOf: Date; contractCode: string; openInterest; dealerLong; dealerShort; assetMgrLong; ...; nonreptShort }`.
- Use-case factory `makeFetchCot(deps: { fetchCotReport: ForFetchingCotReport; cotRepo })` returning the driver.

**Adapter (driven):** `packages/adapters/src/http/cftc.ts` — mirror `fred.ts`:
- Build the Socrata URL, `fetch`, Zod-parse the array (`z.array(CftcRowSchema).min(1)`), coerce string→number, map to `CotReport`.
- On network/non-2xx/parse error: static `console.warn` + return a `Result` error (NOT a throw) — same convention as `fred.ts`. (No silent fallback value — unlike FRED's rate fallback, a missing COT week should error, not fabricate.)
- Parse `as_of` from `report_date_as_yyyy_mm_dd` (take the date part).

**Repo (driven):** `packages/adapters/src/postgres/repos/cot-observations.ts` (+ memory twin in `packages/adapters/memory/`) — `insertCotObservation` (upsert) + `listCotObservations(limit?)`. Follow `rate-observations.ts`.

**Job (worker):** `apps/worker/src/handlers/fetch-cot.ts` + register in `schedule.ts`:
```
createQueue("fetch-cot"); schedule("fetch-cot", "0 17 * * 5", null, { tz: "America/New_York" }); work("fetch-cot", ...)
```
- Cron **`0 17 * * 5`** = Friday 17:00 ET (D-07). No RTH gate needed (weekly).
- Handler: call use-case → upsert. Idempotent. Wire in `apps/worker/src/main.ts` like `fetch-rates`.

**Contract (`packages/contracts/src/cot.ts`):**
```ts
export const cotSeriesEntry = z.object({
  asOf: z.string().date(),            // or .datetime()
  publishedAt: z.string().datetime(),
  openInterest: z.number().int(),
  netDealer: z.number().int(),
  netAssetManager: z.number().int(),
  netLeveraged: z.number().int(),     // the headline "big guys" series
  netOther: z.number().int(),
  netNonreportable: z.number().int(),
  // optionally raw long/short per class for the UI
});
export const cotResponse = z.array(cotSeriesEntry);
```
> **D-05 reconciliation:** COT-02's example field names (`net_noncommercial`/`net_commercial`)
> are LEGACY-report terms. The TFF contract exposes **net per TFF class** instead. The "…" in
> the success criterion covers this — surface `netLeveraged` / `netAssetManager` / `netDealer`.

**Route + MCP (MCP-02, same change):**
- `apps/server/src/adapters/http/analytics.routes.ts` → `GET /api/analytics/cot` → `cotResponse`.
- `apps/server/src/adapters/mcp/server.ts` → `get_cot` tool returning the same `cotResponse`.
- Mirror the skew / term-structure / gex route+MCP trio exactly.

---

## 4. Validation Architecture

- **Adapter (msw):** mock the Socrata endpoint with a real captured JSON fixture (strings-as-numbers).
  Assert: correct `$where` (contract `13874A`), Zod coercion of string numbers, `as_of` parsed from
  `report_date_as_yyyy_mm_dd`, error path on non-2xx (returns Result error, no throw).
- **Repo (testcontainers, real Postgres):** insert a week; **re-insert the same `as_of` → 0 duplicate rows**
  (COT-01 idempotency). SQL never mocked.
- **Contract (fast-check / example):** `cotResponse` round-trip; net = long − short invariant.
- **Route + MCP:** `GET /api/analytics/cot` returns the contract shape; `get_cot` returns identical payload.
- **Date correctness:** `as_of` (Tuesday) comes from the report's own date field, `published_at` from
  the fetch clock — assert they differ and `as_of` is the report date, not date-math.

---

## 5. Landmines

1. **Socrata numbers are strings** → `z.coerce.number()`. (#1 cause of a silent parse break.)
2. **Contract code:** use `13874A` (TFF futures-only E-mini). Don't grab `13874+`/combined.
3. **`report_date_as_yyyy_mm_dd`** is a floating ISO timestamp — take the date; it's the `as_of`, not `now()`.
4. **No fabricated fallback** (unlike FRED's 4.5% rate): a missing COT row → Result error, not a fake row.
5. **Legacy vs TFF naming** (D-05) — don't store `net_commercial`/`net_noncommercial`; store TFF classes.
6. **Idempotency** via `UNIQUE(contract_code, as_of)` + `ON CONFLICT` — the COT-01 acceptance test.
7. **No auth / no app token** needed; keep any optional token out of code/logs if ever added.

---

*Phase: 13-cot-adapter*
*Researched: 2026-06-28 (live CFTC Socrata validation, salvaged)*

# Phase 14: FRED Expansion - Research

**Researched:** 2026-07-01
**Domain:** External macro data ingestion (FRED API + CBOE index quote) into an existing single-series table, exposed as a new read API
**Confidence:** HIGH

No `14-CONTEXT.md` exists yet (this research ran standalone, ahead of `/gsd-discuss-phase 14`). No locked decisions to honor — the design below is a recommendation, not a constraint. Several points below are flagged as discretionary and should be confirmed in discuss-phase before the plan locks them in.

## Summary

Phase 14 extends the existing `fetch-rates` job from one FRED series (DGS3MO) to eight series total — seven from FRED (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS) plus VVIX from a new CBOE index-quote adapter — and exposes the accumulated history through `GET /api/analytics/macro` + MCP `get_macro`. The critical constraint governing every design choice here is that `rate_observations` already has a live, production-critical consumer: `computeBsmGreeks.ts` reads it via `ForReadingRate`/`readRate` to get the risk-free rate `r` for every BSM greek computation, and that read path was just patched (2026-07-01, RC#1 in the file's own header comment) to fix a real production timeout. This phase must not touch that path's behavior.

The roadmap's own success criterion (MAC-01) names `rate_observations` as the destination table for all eight series — so the design widens that table (add `series_id`, composite `(date, series_id)` PK) rather than introducing a parallel table, even though every other analytics feature in this codebase (skew, term-structure, GEX, COT) shipped as a brand-new table. The safe path through the widening is: touch the schema and the Postgres repo, but leave `fred.ts`'s existing DGS3MO fetch, its decimal-fraction (rate/100) convention, and the `ForReadingRate` port signature completely alone — pin the repo's SQL to `WHERE series_id = 'DGS3MO'` internally so `computeBsmGreeks.ts` and its wiring in `apps/worker/src/main.ts` need zero changes. The seven new series are additive: a new parameterized FRED adapter (no fallback — errors propagate, matching the COT precedent of never fabricating economic data) and a new CBOE index-quote adapter for VVIX (verified live during this research), feeding a new `getMacro` read use-case that groups rows by `series_id` into the map-of-arrays shape MAC-02 asks for.

**Primary recommendation:** Widen `rate_observations` additively (new `series_id` column, composite PK, default-backfilled for existing rows), keep the existing DGS3MO→BSM path byte-for-byte unchanged by pinning `readRate`'s SQL internally, add a parameterized no-fallback FRED adapter for the other six series, add a new CBOE quote adapter for VVIX (endpoint verified live: `https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json`), and mirror Phase 13's COT vertical slice exactly for the read side (`getMacro.ts` → `GET /api/analytics/macro` → `get_macro` MCP tool, one `z.record(z.string(), z.array(...))` contract).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MAC-01 | The `fetch-rates` job is extended to an expanded FRED series set (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS) with the prod `FRED_API_KEY` set; VVIX is sourced via the existing CBOE adapter. `rate_observations` gains rows for all 8 series; a second run for the same date is idempotent. | Widened `rate_observations` schema design (composite `(date, series_id)` PK, DGS3MO-pin for BSM safety), new parameterized FRED adapter + new CBOE VVIX adapter (endpoint verified live), `Promise.allSettled` per-series independence pattern, existing `onConflictDoUpdate` idempotency pattern extended to the composite key. See Architecture Patterns, Common Pitfalls #1/#2/#4/#5/#6, Code Examples. |
| MAC-02 | `GET /api/analytics/macro` and MCP `get_macro` return the macro series (MCP-02 — both adapters ship in the same change). | `getMacro.ts` use-case mirroring `getCot.ts` exactly; `z.record(z.string(), z.array(macroSeriesPoint))` contract (direct precedent: `status.ts`'s `lastJobRuns` map); route/MCP registration mirroring the COT vertical slice; confirmed the route inherits Supabase JWT auth by placement in `apiRouter`/`authReadGroup` — no new auth code needed. See Architecture Patterns (Pattern 4), Recommended Project Structure, Security Domain. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fetch 7 FRED series (HTTP + Zod parse) | Driven Adapter (`packages/adapters/src/http`) | — | External HTTP boundary; mirrors existing `fred.ts` |
| Fetch VVIX (CBOE HTTP + Zod parse) | Driven Adapter (`packages/adapters/src/http`) | — | External HTTP boundary; new adapter, mirrors `cboe.ts` shape |
| Persist 8-series rows (upsert) | Driven Adapter (Postgres repo) | Database/Storage (`rate_observations`) | Repo owns SQL; core never sees Drizzle |
| Orchestrate fetch→persist (per series, independent failure) | Application (`packages/core` use-case) | — | Pure orchestration; `Promise.allSettled` pattern, no I/O |
| BSM risk-free rate lookup (`readRate`) | Application (`packages/core` use-case, unchanged) | Driven Adapter (Postgres repo, SQL updated) | Existing consumer; contract frozen, only the repo SQL is series-aware internally |
| Read + group macro series for API | Application (`packages/core` use-case) | — | Mirrors `getCot.ts` exactly |
| `GET /api/analytics/macro` | Driving Adapter (`apps/server` HTTP route) | API/Backend | Same `apiRouter` chain as existing analytics routes — inherits Supabase JWT gate by placement, no new auth code |
| `get_macro` MCP tool | Driving Adapter (`apps/server` MCP) | API/Backend | Same `makeMcpRouter`, optional-param pattern (COT precedent) |
| Job scheduling (cron, holiday gate) | Driving Adapter (`apps/worker`) | — | Extends the existing `fetch-rates` handler; no new queue/cron entry |
| `FredCard` chart rendering | Browser/Client (`apps/web`) | — | **Out of scope this phase** — placeholder already exists in `Overview.tsx`, wiring is a follow-up |

## Standard Stack

### Core

No new dependencies. Everything this phase needs is already in the workspace:

| Library | Version (verified in repo) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | ^4.4.3 (`packages/contracts/package.json`) `[VERIFIED: codebase]` | Parse FRED/CBOE HTTP responses + define the macro contract | Existing project-wide boundary rule (typescript.md) |
| `drizzle-orm` / `drizzle-kit` | ^0.45.2 / ^0.31.10 `[VERIFIED: codebase]` | Schema + migration for the widened `rate_observations` table | Existing DB layer (D5/D6) |
| `msw` | already a devDependency (used by `fred.test.ts`, COT adapter tests) `[VERIFIED: codebase]` | Mock FRED + CBOE HTTP in adapter tests | Established external-HTTP test convention (tdd.md) |
| native `fetch` | Bun global | HTTP calls to FRED + CBOE | Same as every existing adapter (`fred.ts`, `cboe.ts`) — no HTTP client library used anywhere in this repo |
| `pg-boss` | existing | `fetch-rates` remains a cron job, no new queue | Job already registered; this phase adds series coverage, not a new job |

### Supporting

None needed beyond the above.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One `fetch` call per FRED series (7 calls/run) | `fred/v2/release/observations` (fetches all series on one "release" in one call) | Rejected: DFF/DGS*/SOFR/VIXCLS are NOT all on the same FRED release (Treasury H.15 vs NY Fed SOFR vs CBOE Market Statistics), so this would need multiple release IDs anyway — no simplification for a once-daily, 7-request job that's trivially inside the 120 req/min limit `[CITED: fred.stlouisfed.org/docs/api/fred/errors.html]` |
| Widening `rate_observations` | New `macro_observations` table (matches every prior analytics phase's "new capability = new table" precedent — skew, term-structure, GEX, COT all shipped as new tables) | Rejected as primary recommendation **only because MAC-01's literal wording names `rate_observations` as the destination table** — this is an explicit, already-approved roadmap criterion, not a free design choice. Documented here so the planner/user can override if MAC-01's wording was aspirational rather than binding. |
| `series_id`-leading composite PK `(series_id, date)` | Date-leading `(date, series_id)` | Rejected: REQUIREMENTS.md DATA-01 mandates "time-leading composite keys on observation tables" — every other observation table in this schema (`leg_observations`, `skew_observations`, `calendar_snapshots`, `term_structure_observations`, `risk_reversal_observations`) is time-leading. `(date, series_id)` is the only choice consistent with that stated project rule. |

**Installation:** None — no `npm install` / `bun add` needed for this phase.

**Version verification:** Confirmed directly from `package.json` files in this repo — no external registry lookup needed since no new packages are added.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new npm packages — it reuses `zod`, `drizzle-orm`, `msw`, and native `fetch`, all already present and already used by the exact adapters this phase mirrors (`fred.ts`, `cboe.ts`, `cftc.ts`). The Package Legitimacy Gate is skipped per its own trigger condition ("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │   pg-boss cron: fetch-rates              │
                    │   "0 9 * * 1-5" (09:00 ET Mon-Fri)       │
                    │   apps/worker/src/schedule.ts            │
                    └───────────────┬───────────────────────────┘
                                    │ NYSE holiday gate (existing, unchanged)
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │  makeFetchRatesHandler (extended)        │
                    │  apps/worker/src/handlers/fetch-rates.ts │
                    └───────┬───────────────────┬───────────────┘
                            │                    │
              (unchanged)   ▼                    ▼ (new)
        ┌──────────────────────────┐   ┌──────────────────────────────┐
        │ makeFetchRateUseCase      │   │ makeFetchMacroSeriesUseCase   │
        │ (DGS3MO only, fallback)   │   │ (7 FRED + VVIX, Promise      │
        │ packages/core             │   │  .allSettled — one series'   │
        └──────────┬────────────────┘   │  failure doesn't block others)│
                    │                    │ packages/core (new)           │
                    ▼                    └──────┬────────────┬───────────┘
        ┌──────────────────────┐                │            │
        │ makeFredRateAdapter   │      ┌─────────▼──┐   ┌─────▼──────────┐
        │ (unchanged)           │      │ FRED series │   │ CBOE VVIX quote │
        │ packages/adapters/    │      │ adapter     │   │ adapter (new)   │
        │ http/fred.ts          │      │ (new,       │   │ packages/       │
        └──────────┬────────────┘      │ parameter-  │   │ adapters/http/  │
                    │                   │ ized,       │   │ cboe-vvix.ts    │
                    │                   │ no fallback)│   └─────┬───────────┘
                    │                   └──────┬──────┘         │
                    │                          │                │
                    ▼                          ▼                ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  rate_observations (widened: date, series_id, rate)           │
        │  PK (date, series_id) — DGS3MO row is decimal-fraction        │
        │  (legacy, unchanged); other 7 rows store raw source value     │
        └───────────┬─────────────────────────────────┬─────────────────┘
                    │                                  │
     (unchanged)    ▼                                  ▼ (new)
    ┌────────────────────────┐          ┌──────────────────────────────┐
    │ readRate (BSM path)     │          │ getMacro use-case (new)       │
    │ WHERE series_id=        │          │ groups rows by series_id →    │
    │ 'DGS3MO' AND date<=?    │          │ { [seriesId]: [{time,value}] }│
    │ → computeBsmGreeks.ts   │          │ packages/core (mirrors        │
    │ (UNCHANGED consumer)    │          │ getCot.ts)                    │
    └────────────────────────┘          └──────────┬────────────────────┘
                                                     │
                                    ┌────────────────┴────────────────┐
                                    ▼                                 ▼
                    ┌───────────────────────────┐   ┌──────────────────────────┐
                    │ GET /api/analytics/macro   │   │ MCP get_macro tool        │
                    │ analytics.routes.ts         │   │ tools.ts + server.ts      │
                    │ (inherits Supabase JWT       │   │ (bearer-gated, existing   │
                    │  gate by apiRouter placement)│   │  /mcp/* middleware)       │
                    └───────────────────────────┘   └──────────────────────────┘
```

### Recommended Project Structure

New/changed files, mirroring the exact Phase 13 COT vertical slice:

```
packages/core/src/journal/application/
├── ports.ts                    # EXTEND: widen RateObservation (+seriesId), add
│                                #   ForFetchingFredSeries, ForFetchingVvixQuote,
│                                #   ForReadingMacroSeries (bulk read across series)
├── fetchRate.ts                 # UNCHANGED — DGS3MO path stays exactly as-is
├── fetchMacroSeries.ts           # NEW — loops 7 FRED + VVIX, Promise.allSettled,
│                                #   mirrors fetchCot.ts's single-fetch shape ×8
└── getMacro.ts                   # NEW — mirrors getCot.ts; groups rows by seriesId

packages/adapters/src/http/
├── fred.ts                      # EXTEND — add makeFredSeriesAdapter (parameterized,
│                                #   no fallback); extract shared fetch+parse+'.'-filter
│                                #   helper so DGS3MO adapter and the new one don't duplicate it
├── fred.test.ts                  # EXTEND
└── cboe-vvix.ts                  # NEW — mirrors cboe.ts's spot-resolution pattern
    cboe-vvix.test.ts             #   (current_price ?? close ?? prev_day_close), UTC timestamp parse

packages/adapters/src/postgres/
├── schema.ts                     # EXTEND — rateObservations: +seriesId text NOT NULL,
│                                 #   composite PK (date, seriesId)
├── repos/rate-observations.ts     # EXTEND — persistRate takes seriesId; readRate SQL
│                                 #   hardcodes WHERE series_id='DGS3MO' internally;
│                                 #   new readMacroSeries() bulk read
└── migrations/0013_rate_observations_series_id.sql   # NEW — hand-review required (see Pitfalls)

packages/adapters/src/memory/
└── rate.ts                        # EXTEND — twin mirrors the widened behavior

packages/adapters/src/__contract__/
└── rate-observations.contract.ts   # EXTEND — multi-series cases + DGS3MO-pin regression case

packages/contracts/src/
├── macro.ts                       # NEW — macroSeriesPoint {time, value}, macroResponse
│                                 #   = z.record(z.string(), z.array(macroSeriesPoint))
└── index.ts                       # EXTEND — barrel export

apps/worker/src/
├── handlers/fetch-rates.ts         # EXTEND — call both use-cases; unchanged holiday gate
├── handlers/fetch-rates.test.ts     # EXTEND
└── main.ts                         # EXTEND — wire new adapters + use-cases

apps/server/src/adapters/
├── http/analytics.routes.ts         # EXTEND — GET /analytics/macro (mirrors /analytics/cot)
├── mcp/tools.ts                     # EXTEND — registerGetMacroTool
└── mcp/server.ts                    # EXTEND — optional getMacro param (COT precedent)

apps/server/src/main.ts               # EXTEND — wire getMacro into both adapters

docs/architecture/
├── data-model.md                    # EXTEND (docs-before-code) — rate_observations section
└── jobs.md                          # EXTEND (docs-before-code) — fetch-rates entry;
                                     #   ALSO fix stale "0 7 * * 1-5" → actual "0 9 * * 1-5"
```

### Pattern 1: Parameterized adapter with a shared low-level fetch helper, two public factories

**What:** Extract the FRED HTTP-fetch + Zod-parse + `.`-filter logic in `fred.ts` into one internal helper, then expose two factories: `makeFredRateAdapter` (existing, DGS3MO-only, has a fallback) and `makeFredSeriesAdapter` (new, takes `seriesId` as a param, no fallback — errors propagate as `Result.err`).

**When to use:** When a new series needs the identical HTTP mechanics but different failure semantics (BSM needs a number no matter what; a macro display series should show nothing rather than a fabricated value, matching the COT adapter's documented "no fabricated fallback" rule).

**Example (existing pattern to mirror, from `packages/adapters/src/http/fred.ts`):**
```ts
// Source: packages/adapters/src/http/fred.ts (this repo, lines 58-114)
const url = new URL(FRED_BASE_URL);
url.searchParams.set("series_id", "DGS3MO");   // → becomes a parameter
url.searchParams.set("api_key", deps.apiKey);
url.searchParams.set("file_type", "json");
url.searchParams.set("sort_order", "desc");
url.searchParams.set("limit", "5");
// ... fetch, response.ok check, Zod parse, filter value !== ".", take first
```

### Pattern 2: Pin a widened table's existing read port to one series internally — zero call-site changes

**What:** `ForReadingRate`'s type signature (`(onOrBefore: string) => Promise<Result<string | null, StorageError>>`) does not change. Only the Postgres repo's SQL changes, adding `WHERE series_id = 'DGS3MO'` to the existing `WHERE date <= onOrBefore ORDER BY date DESC LIMIT 1` query.

**When to use:** Whenever an existing, tested, production-critical consumer (`computeBsmGreeks.ts` here) must survive a schema widening untouched. This is the highest-value pattern in this phase — it converts a risky schema change into a safe, additive one.

**Example:**
```ts
// packages/adapters/src/postgres/repos/rate-observations.ts — readRate, extended
const readRate: ForReadingRate = async (onOrBefore) => {
  const rows = await db
    .select({ rate: rateObservations.rate })
    .from(rateObservations)
    .where(and(eq(rateObservations.seriesId, "DGS3MO"), lte(rateObservations.date, onOrBefore)))
    .orderBy(desc(rateObservations.date))
    .limit(1);
  // ... unchanged from here
};
```

### Pattern 3: Per-item independent failure across a batch fetch

**What:** `Promise.allSettled` across the 8 fetches (7 FRED + 1 CBOE) so one series' network failure doesn't block the other 7 from persisting.

**When to use:** Directly established precedent in this codebase for exactly this shape of problem.

**Example (existing pattern to mirror, from refresh-tokens JOB-02, per `docs/architecture/jobs.md` "Per-app independence (D-13)"):**
```ts
// Both apps refreshed via Promise.allSettled; one failing does not block the other.
// Mirror this shape: settle all 8 series fetches, persist whichever succeeded,
// console.warn per failed series (no throw unless ALL 8 fail).
```

### Pattern 4: Map-keyed-by-ID contract, Zod v4 two-argument `z.record`

**What:** MAC-02 wants `GET /api/analytics/macro` to return `{ [seriesId]: Array<{time, value}> }`. This shape already has a direct precedent in this codebase.

**Example (existing pattern to mirror, from `packages/contracts/src/status.ts:44`):**
```ts
// Source: packages/contracts/src/status.ts (this repo)
lastJobRuns: z.union([
  z.literal("none yet"),
  z.record(z.string(), jobRunRecord),   // ← two-arg form; ONE-arg form is a TS2554 error in Zod v4
]),
```
```ts
// packages/contracts/src/macro.ts (new) — mirror the shape above
export const macroSeriesPoint = z.object({
  time: z.string().date(),   // YYYY-MM-DD — matches FRED's native granularity (see Open Questions)
  value: z.number(),
});
export const macroResponse = z.record(z.string(), z.array(macroSeriesPoint));
```

### Anti-Patterns to Avoid

- **Reusing `ForFetchingRate`/`RateObservation` unchanged for the 6 new series:** its doc comment explicitly scopes it to "the current DGS3MO 3-month risk-free rate... always returns ok." Forcing the other 6 series through the same type either breaks that documented contract or silently changes DGS3MO's fallback behavior. Widen the domain type (`RateObservation` +`seriesId`) but keep a distinct, no-fallback port for the new series.
- **Dividing every series by 100 like the existing DGS3MO logic does:** VIXCLS is an index level (≈18.9), not a percentage — the existing `ratePercent / 100` transform is DGS3MO-specific and must not apply to VIXCLS/VVIX. See Common Pitfalls #1.
- **Letting `drizzle-kit generate` apply blind to the PK change on a populated table:** see Common Pitfalls #2.
- **Adding a new JWT/auth check to the macro route:** unnecessary — placement inside the existing `apiRouter` chain (mounted under `authReadGroup` in `apps/server/src/main.ts`) already gates it behind Supabase Auth, exactly like `/analytics/cot` and `/analytics/skew` today. `[VERIFIED: codebase]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FRED HTTP fetch + Zod parse + `.`-sentinel filter for 6 more series | A second copy-pasted fetch function per series | Extract the existing `fred.ts` logic into one internal helper, parameterize by `seriesId` | The mechanics (URL params, `.` filter, "take first non-`.` since sort_order=desc") are identical across all 7 FRED series; only the fallback behavior and value transform differ |
| CBOE VVIX spot-value resolution | A new "pick the best available price" heuristic | The exact `current_price ?? close ?? prev_day_close` chain already in `cboe.ts` (lines 187-191) | The verified live VVIX quotes endpoint returns the *same* field names (`current_price`, `close`, `prev_day_close`) nested the *same* way (`{timestamp, data: {...}}`) as the existing SPX chain endpoint — this is a direct, exact-shape reuse, not just "similar" |
| Multi-series batch fetching | A hand-rolled request-queue/rate-limiter for FRED | Nothing — 7 sequential requests once daily is trivially inside FRED's 120 req/min limit `[CITED: fred.stlouisfed.org/docs/api/fred/errors.html]` | Building throttling infrastructure for 7 requests/day is pure overengineering |
| Per-series independent failure handling | A custom retry/circuit-breaker abstraction | `Promise.allSettled`, exactly as `refresh-tokens` (JOB-02) already does for two Schwab apps | Established, tested pattern one file away |

**Key insight:** Every mechanical piece this phase needs (HTTP fetch shape, Zod parse-at-boundary, `.`-sentinel handling, spot-value fallback chain, per-item independent-failure batching, map-keyed-by-ID contract shape, upsert-on-composite-key) already exists somewhere in this codebase, verified working in production. The work here is almost entirely "widen and parameterize," not "invent."

## Common Pitfalls

### Pitfall 1: The DGS3MO unit convention is not the right convention for the other 7 series
**What goes wrong:** The existing `fred.ts` divides the FRED value by 100 (`ratePercent / 100`) because `readRate`'s one consumer, `computeBsmGreeks.ts`, needs a decimal fraction (0.045, not 4.5). If that same `/100` transform is applied to VIXCLS, an index level of ~18.9 becomes 0.189 — silently wrong, and nothing in the type system catches it (both are just `number`).
**Why it happens:** Copy-pasting the existing adapter's value transform without checking that FRED's "Percent" unit convention doesn't apply to VIXCLS (an index level) the same way it applies to DFF/DGS*/SOFR/T10Y2Y/T10Y3M (yield percentages).
**How to avoid:** Store the raw source value for all 7 new series (no `/100`) — this is a display-only table now, there's no cross-series arithmetic requiring normalization. Leave DGS3MO's existing decimal-fraction convention untouched (it's the one row-shape with a real numeric consumer). Document this explicitly as a known unit inconsistency within the table (DGS3MO stored as `0.045`, DFF stored as `4.33`) — and consider normalizing at the `GET /api/analytics/macro` **route** layer only (multiply DGS3MO's stored value ×100 when building the response) so the public API contract is uniform even though internal storage keeps the one legacy exception.
**Warning signs:** A chart showing DFF and DGS3MO on the same axis where DGS3MO is ~100x smaller than every other rate series.

### Pitfall 2: Composite-PK migration on a populated table
**What goes wrong:** `rate_observations` currently has `date` as a single-column PK with live production data. Changing to a composite `(date, series_id)` PK requires dropping the old PK constraint and adding a new one — `drizzle-kit generate` on a PK-shape change can, depending on version/situation, emit a `DROP TABLE` + `CREATE TABLE` pair rather than a safe in-place `ALTER TABLE`, which would destroy existing DGS3MO history.
**Why it happens:** Drizzle-kit's diff algorithm doesn't always recognize "add a column + widen the PK" as non-destructive when the PK itself changes shape.
**How to avoid:** This repo has hand-reviewed every non-trivial migration so far (renamed `0003_famous_azazel`→`0003_broker_tokens`, hand-prepended `CREATE EXTENSION pgcrypto`, reconstructed a missing snapshot file for `0007`) — treat this migration the same way. Generate with drizzle-kit, then manually verify the SQL is an `ALTER TABLE rate_observations ADD COLUMN series_id text NOT NULL DEFAULT 'DGS3MO'` + `ALTER TABLE ... DROP CONSTRAINT <old_pk>` + `ALTER TABLE ... ADD PRIMARY KEY (date, series_id)` sequence — not a drop/recreate. Test against a testcontainers Postgres seeded with existing-shape rows before the live push. `[ASSUMED: exact drizzle-kit diff behavior for this specific PK-widening case not independently tested this session — verify the generated SQL directly before trusting it]`
**Warning signs:** The generated `.sql` file contains `DROP TABLE` or `CREATE TABLE rate_observations` instead of `ALTER TABLE`.

### Pitfall 3: `docs/architecture/jobs.md`'s documented cron is already stale
**What goes wrong:** `jobs.md` says `fetch-rates` runs `0 7 * * 1-5`. The actual registered cron in `apps/worker/src/schedule.ts:98` (and the handler's own comment in `fetch-rates.ts:21`) is `0 9 * * 1-5` (09:00 ET). `[VERIFIED: codebase]` — confirmed by direct grep of the registration call, not the doc.
**Why it happens:** Pre-existing drift, not introduced by this phase — the doc was never updated after the cron was set (or was changed).
**How to avoid:** Fix this as part of the Wave 1 docs-before-code pass this phase should open with (workflow.md requires docs-first for job changes anyway) — cheap to fix while already editing that section.
**Warning signs:** None needed — already confirmed, just needs the one-line doc fix.

### Pitfall 4: FRED's daily-frequency series are business-days-only, including DFF
**What goes wrong:** Assuming DFF (Federal Funds Effective Rate) has a value for every calendar day (including weekends) because it's a "daily" series. It does not.
**Why it happens:** "Daily" in FRED's frequency metadata means "one observation per business day," not "one observation per calendar day" — this applies uniformly to DFF, DGS1MO, DGS3MO, T10Y2Y, and T10Y3M. `[CITED: fred.stlouisfed.org/series/DFF, fred.stlouisfed.org/series/DGS3MO]` — corrects an initial assumption in the phase brief that DFF might include weekends.
**How to avoid:** The existing `.`-sentinel filter (skip rows where `value === "."`, take the most-recent non-`.` row) already handles this correctly for DGS3MO today — the same filter generalizes to all 7 series without modification. No special weekend-handling code needed.
**Warning signs:** N/A — the existing filter pattern is already correct; this is a "don't add unnecessary special-casing" pitfall, not a bug to fix.

### Pitfall 5: SOFR has a same-day-unavailable, T+1 publication lag
**What goes wrong:** Fetching SOFR at 09:00 ET expecting *today's* rate. SOFR for trading day T is published by the NY Fed at approximately 8:00 AM ET on T+1, not on T itself. `[CITED: newyorkfed.org/markets/reference-rates/sofr]`
**Why it happens:** SOFR reflects overnight repo transactions that need to be aggregated after the fact — unlike DGS*/DFF which are still same-day (published after market close for the day they reflect).
**How to avoid:** No code change needed — the existing "take the most-recent non-`.` value" pattern naturally returns the latest available SOFR print regardless of which calendar day it's dated. Just don't be surprised in testing that SOFR's `date` column value is one business day behind DGS3MO's for the same fetch run.
**Warning signs:** A test asserting all 8 series share an identical `date` value for a single fetch-rates run — they will NOT, by design, and that's correct behavior, not a bug.

### Pitfall 6: `data.last_trade_time` on the CBOE VVIX quote's timezone is unconfirmed
**What goes wrong:** The verified-live VVIX response includes `data.last_trade_time` (e.g., `"2026-07-01T16:15:01"`, no `Z` suffix) alongside a top-level `timestamp` field that — per this project's own established regression gate — is UTC (`"2026-07-02 01:00:55"` in the same response). `last_trade_time`'s offset from `timestamp` is consistent with it being ET-local (16:15 ET ≈ options/index settlement time, matching 01:00 UTC the next calendar day), but this codebase has never consumed this field before (the existing chain adapter only reads the top-level `timestamp`), so it is unverified against a second live sample.
**Why it happens:** New field, not exercised by any existing test or adapter.
**How to avoid:** Prefer deriving the `date` column for the VVIX row from the **job's own clock** (`America/New_York`, matching `fred.ts`'s existing `todayIso()` fallback-date helper pattern) rather than parsing `last_trade_time`, since `macro_observations`/`rate_observations` rows only need date granularity, not an intraday instant. If `last_trade_time` is used, verify its timezone empirically against a known live value before trusting it (compare to a known ET market-close print).
**Warning signs:** VVIX rows landing on the wrong calendar date relative to the other 7 series in the same fetch run.

### Pitfall 7: `bun run migrate` validates ALL worker env, not just the changed piece
**What goes wrong:** Running the migration locally fails with an unrelated env error (e.g., missing `SIDECAR_URL`) that has nothing to do with this phase.
**Why it happens:** Carried-forward gotcha from prior phases (see project memory) — `bun run migrate` boots the full worker config (Zod-parsed `workerConfigSchema`), which requires every field in `apps/worker/src/config.ts` including `SIDECAR_URL`, `TOKEN_ENCRYPTION_KEY`, `SCHWAB_TRADER_APP_KEY/SECRET` — none of which relate to this migration.
**Why it happens:** By design (DATA-04: config Zod-parsed once, fails loud) — but it means a `.env` with all required fields (even unrelated ones) must be present locally before `bun run migrate` will run at all.
**How to avoid:** Ensure the local `.env` has every `workerConfigSchema` field populated (a valid/dummy value is fine for fields unrelated to this migration) before attempting the migration step.
**Warning signs:** `bun run migrate` exits non-zero citing a config field this phase never touches.

## Code Examples

### FRED value-fetch-and-filter (existing, to be extracted into a shared helper)
```ts
// Source: packages/adapters/src/http/fred.ts (this repo)
const validObs = parsed.data.observations.filter((obs) => obs.value !== ".");
if (validObs.length === 0) return fallback();  // → for new series: return err(...) instead
const first = validObs[0];
const ratePercent = parseFloat(first.value);
// DGS3MO only: ratePercent / 100. New series: store ratePercent as-is (see Pitfall 1).
```

### CBOE spot-value resolution (existing, directly reusable for VVIX)
```ts
// Source: packages/adapters/src/http/cboe.ts, lines 187-191 (this repo)
const spot =
  payload.data.current_price ??
  payload.data.close ??
  payload.data.prev_day_close ??
  null;
if (spot === null || spot === 0) {
  return err({ kind: "fetch-error", message: "CBOE payload missing spot price" });
}
```
The verified-live VVIX response (`https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json`) has the identical `{timestamp, data: {current_price, close, prev_day_close, ...}}` shape — this exact fallback chain applies unchanged. `[VERIFIED: WebFetch live endpoint, cross-checked with a second targeted fetch for exact key names]`

### Existing composite-PK upsert pattern to mirror (from COT)
```ts
// Source: packages/adapters/src/postgres/repos/cot-observations.ts (this repo)
await db
  .insert(cotObservations)
  .values({ /* ... */ })
  .onConflictDoNothing({ target: [cotObservations.contractCode, cotObservations.asOf] });
```
For `rate_observations`, the existing single-column upsert already uses `onConflictDoUpdate` (last-write-wins, not do-nothing) — preserve that semantic (FRED sometimes revises preliminary values) but widen `target` to `[rateObservations.date, rateObservations.seriesId]`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `rate_observations`: one row per date, single implicit series (DGS3MO), decimal-fraction value | `rate_observations`: one row per `(date, series_id)`, 8 series, mostly raw source values (DGS3MO stays decimal-fraction for backward compat) | This phase | `readRate`'s SQL gains a `WHERE series_id='DGS3MO'` filter; no other BSM-path change |
| `fetch-rates` job fetches 1 series | `fetch-rates` job fetches 8 series (7 FRED + 1 CBOE), independently | This phase | Same cron, same job name, more work per run — still well under any rate limit |
| No macro read surface | `GET /api/analytics/macro` + MCP `get_macro`, mirroring the COT vertical slice | This phase | New contract file, new route, new MCP tool — zero new auth code (inherits placement-based Supabase JWT gate) |

**Deprecated/outdated:** None — this is a pure extension, nothing is being removed or replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `drizzle-kit generate` will need manual review/editing for the `rate_observations` PK-widening migration (may emit a destructive drop/recreate) | Common Pitfalls #2 | Low if the planner follows the stated "always hand-review generated SQL" practice already established in this repo; high (data loss on a live table) if the generated SQL is applied blind |
| A2 | `data.last_trade_time` on the CBOE VVIX response is ET-local (unconfirmed against a second live sample or CBOE docs) | Common Pitfalls #6, Code Examples | Low — the recommended design avoids depending on this field at all (uses the job's own clock for the date instead) |
| A3 | VIXCLS's exact daily publish time (commonly cited as ~4:15pm ET) was not independently confirmed via search this session | Environment/cadence reasoning | Low — the existing `.`-filter/most-recent-non-null pattern is robust to publish-time uncertainty regardless of the exact hour |
| A4 | Normalizing DGS3MO's stored decimal-fraction to "raw percent" at the `GET /api/analytics/macro` route layer (rather than leaving the API response inconsistent with the other 6 rate series) is the right call | Pitfall 1, Pattern discussion | Low — cosmetic API consistency choice, easy to change later without touching storage or BSM |
| A5 | Adding a `source` ('fred' \| 'cboe') column to the widened table is worthwhile but not required by MAC-01/MAC-02's literal wording | Architecture Patterns | None — purely additive/discretionary, safe either way |

**Recommendation:** A1 and A2 should be spot-checked once (a testcontainers migration dry-run for A1; one more live CBOE fetch compared against a known ET timestamp for A2) before the plan locks in the exact migration SQL and the VVIX date-derivation logic. Neither blocks planning — both are cheap Wave-0/Wave-1 verification steps.

## Open Questions

1. **Should `macroSeriesPoint.time` be a date string (`YYYY-MM-DD`) or a full ISO datetime?**
   - What we know: FRED's native granularity is date-only (no time-of-day). COT's `asOf` field uses `z.string().date()` for the same reason (a report date, not an instant). Term-structure/skew use `z.string().datetime()` because those are genuinely intraday (30-min snapshot cycles).
   - What's unclear: The phase brief's own wording ("time-ordered array of `{ time, value }` entries") doesn't specify format, and the task description says "check how skew/term-structure/cot contracts are shaped... for consistency" without resolving which of those two precedents applies here.
   - Recommendation: Use `z.string().date()` (matches COT's `asOf`, matches FRED's actual granularity) — but confirm in discuss-phase since it's a one-line contract decision with no technical risk either way.

2. **Should the widened `rate_observations` table also carry a `source` column?**
   - What we know: `leg_observations` and `calendar_snapshots` both tag their source vendor; `cot_observations` and the existing single-series `rate_observations` do not (single-source tables).
   - What's unclear: With 8 series from 2 vendors (FRED, CBOE) now sharing one table, a `source` column would help debugging/provenance but isn't required by either success criterion.
   - Recommendation: Add it — it's a cheap, low-risk addition consistent with the codebase's general provenance-tagging convention (Assumption A5), but flag as Claude's Discretion if the user wants a smaller diff.

3. **Does BSM's risk-free rate proxy stay pinned to DGS3MO specifically, or should it consider using SOFR now that it's available?**
   - What we know: `computeBsmGreeks.ts` currently reads whatever `ForReadingRate` returns, and that's always been DGS3MO (a 3-month T-bill yield, a conventional BSM risk-free proxy).
   - What's unclear: Nothing indicates a need to change this — it's out of scope for MAC-01/MAC-02, mentioned here only to explicitly rule it out so the planner doesn't accidentally conflate "more rate series are now available" with "the BSM engine's rate source should change."
   - Recommendation: Explicitly out of scope. `readRate` stays pinned to DGS3MO; changing BSM's rate proxy would be a separate, deliberate decision with its own regression-testing burden (BSM calibration fixtures would need re-verification).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `FRED_API_KEY` (worker env) | Fetching real FRED data (all 7 series) | ✗ in production (per STATE.md: "FRED_API_KEY unset in prod — must be set before Phase 14 can be verified live") | — | Already-optional in `workerConfigSchema`; existing DGS3MO adapter's 4.5% fallback covers BSM if absent. The 6 new series simply fetch nothing (no fallback, per design) until the key is set — an **operator step**, not a code change, tracked as a pre-existing blocker |
| `https://api.stlouisfed.org` (FRED API, network reachability) | All 7 FRED series | ✓ (public HTTPS endpoint, no VPN/firewall concerns for a Railway-hosted worker) | — | — |
| `https://cdn.cboe.com/.../quotes/_VVIX.json` (CBOE index quote) | VVIX | ✓ — verified live and reachable during this research session, no auth required | — | — |
| `bun run migrate` local prerequisite | Applying the schema migration locally before live push | ✓ if `.env` has all `workerConfigSchema` fields populated (see Pitfall 7) | — | — |

**Missing dependencies with no fallback:**
- `FRED_API_KEY` in production — required for the 7 FRED series to return real data; this is a carried-forward operator prerequisite (STATE.md blocker), not something this phase's code can resolve. The phase's success criteria (MAC-01/MAC-02) can be built, tested (msw), and merged without it; live verification is gated on the operator setting the key on Railway.

**Missing dependencies with fallback:**
- None beyond the above — VVIX/CBOE needs no key at all (verified live, public endpoint).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace mode, named projects) `[VERIFIED: codebase — package.json "test": "vitest run"]` |
| Config files | `packages/adapters/vitest.config.ts` (project `"packages/adapters"`), `apps/worker/vitest.config.ts` (project `"apps/worker"`), `apps/server/vitest.config.ts` (project `"server"`) `[VERIFIED: codebase]` |
| Quick run command | `bun run test -- --project packages/adapters` (adapter/HTTP/repo tests); `bun run test -- --project apps/worker` (handler tests); `bun run test -- --project server` (route/MCP tests) |
| Full suite command | `bun run test` (root — runs the whole workspace, including Postgres testcontainers tests which need Docker running) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAC-01 | FRED series adapter: fetch, parse, `.`-filter, no-fallback error propagation | unit (msw) | `bun run test -- --project packages/adapters` | ❌ Wave 0 (`fred.test.ts` extended, or new file) |
| MAC-01 | CBOE VVIX adapter: fetch, parse, spot-resolution fallback chain, UTC timestamp | unit (msw) | `bun run test -- --project packages/adapters` | ❌ Wave 0 (`cboe-vvix.test.ts`, new) |
| MAC-01 | `rate_observations` widened persist/read, DGS3MO-pin regression, multi-series upsert idempotency | contract (testcontainers, real Postgres) | `bun run test -- --project packages/adapters` (Docker required) | ❌ Wave 0 (extend `rate-observations.contract.ts`) |
| MAC-01 | `fetch-rates` handler: calls both use-cases, holiday gate still works, per-series independent failure | unit | `bun run test -- --project apps/worker` | ❌ Wave 0 (extend `fetch-rates.test.ts`) |
| MAC-02 | `getMacro` use-case: groups rows by seriesId correctly, empty-store → `{}` not an error | unit | `bun run test -- --project packages/adapters` or core's own project | ❌ Wave 0 (new `getMacro.test.ts`) |
| MAC-02 | `GET /api/analytics/macro` route: contract-shaped response, auth-gated (inherited) | integration | `bun run test -- --project server` | ❌ Wave 0 (extend `analytics.routes.test.ts` if it exists, else new) |
| MAC-02 | MCP `get_macro` returns identical payload to the HTTP route | integration | `bun run test -- --project server` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant project's quick-run command above.
- **Per wave merge:** `bun run test` (full suite, Docker running for testcontainers).
- **Phase gate:** Full suite green + `bun run typecheck` + `bun run lint` before `/gsd-verify-work 14`.

### Wave 0 Gaps
- [ ] `packages/adapters/src/http/cboe-vvix.test.ts` — new msw-based adapter test
- [ ] `packages/adapters/src/http/fred.test.ts` — extend for the new parameterized-series adapter
- [ ] `packages/adapters/src/__contract__/rate-observations.contract.ts` — extend for multi-series + DGS3MO-pin regression
- [ ] `packages/core/src/journal/application/getMacro.test.ts` — new
- [ ] `packages/core/src/journal/application/fetchMacroSeries.test.ts` — new
- [ ] `apps/worker/src/handlers/fetch-rates.test.ts` — extend
- [ ] Framework install: none — Vitest/msw already present workspace-wide

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (new code) | N/A — `GET /api/analytics/macro` inherits the existing Supabase JWT gate by placement inside `apiRouter`/`authReadGroup`; MCP `get_macro` inherits the existing bearer-token gate on `/mcp/*`. No new auth logic is written this phase. `[VERIFIED: codebase — apps/server/src/main.ts]` |
| V3 Session Management | No | Same as above — no new session handling |
| V4 Access Control | No | Same as above — single-user system (D-MULTI-01 out of scope), no per-resource ACL needed |
| V5 Input Validation | Yes | Zod at every boundary: FRED/CBOE HTTP responses parsed before core sees them (existing `.safeParse` pattern); `GET /api/analytics/macro` takes no user-controlled query input (mirrors `/analytics/cot`'s `T-13-06-INJ` no-input-surface pattern) — output is still contract-parsed before send |
| V6 Cryptography | No | `FRED_API_KEY` is a query-string API key, not a credential requiring hashing/encryption — same handling as the existing `apiKey` param in `fred.ts` (never logged, per `T-02-11`) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leakage in logs/errors | Information Disclosure | Existing `fred.ts` convention: never log `deps.apiKey`, only static warn messages on failure (`T-02-11`, `T-02-12`) — extend the same discipline to the new parameterized adapter |
| Malformed/malicious upstream payload (FRED or CBOE) reaching core unparsed | Tampering | Zod `.safeParse` at the adapter boundary before any value crosses into `packages/core`, exactly as `fred.ts`/`cboe.ts` already do |
| Internal error details (DB message, stack trace) leaking through the new route | Information Disclosure | Mirror `T-06-08`/`T-13-06-INJ`: map all repo/use-case errors to a flat `{error: "internal"}` 500 body, never the raw `StorageError.message` |

## Sources

### Primary (HIGH confidence — verified via direct codebase Read/grep this session)
- `packages/adapters/src/http/fred.ts`, `fred.test.ts` — existing FRED adapter, decimal-fraction convention, fallback pattern
- `packages/adapters/src/http/cboe.ts` — existing CBOE chain adapter, spot-resolution fallback chain, UTC timestamp parsing
- `packages/adapters/src/postgres/schema.ts` — full current schema, including `rateObservations` (lines 200-205) and `cotObservations` (lines 383-421) as the composite-PK/unique-constraint precedent
- `packages/adapters/src/postgres/repos/rate-observations.ts`, `cot-observations.ts` — repo implementation patterns
- `packages/adapters/src/memory/rate.ts`, `cot-observations.ts` — in-memory twin patterns
- `packages/core/src/journal/application/ports.ts`, `fetchRate.ts`, `computeBsmGreeks.ts`, `getCot.ts` — port definitions, the BSM `readRate` consumer (critical constraint), the COT read-use-case pattern to mirror
- `apps/worker/src/handlers/fetch-rates.ts`, `fetch-cot.ts`, `schedule.ts`, `config.ts`, `main.ts` — job registration, actual cron ground truth, config schema
- `apps/server/src/adapters/http/analytics.routes.ts`, `apps/server/src/adapters/mcp/server.ts`, `tools.ts`, `main.ts` — route/MCP registration pattern, `apiRouter`/`authReadGroup` auth-inheritance confirmation
- `packages/contracts/src/cot.ts`, `status.ts`, `index.ts` — contract shape precedents, the `z.record(z.string(), ...)` two-arg pattern
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` — MAC-01/MAC-02 exact wording, DATA-01 time-leading-PK rule, prod `FRED_API_KEY` blocker
- `docs/architecture/data-model.md`, `jobs.md`, `stack-decisions.md` — existing documented schema/job/decision state, including the confirmed stale-cron doc/code drift

### Secondary (MEDIUM confidence — WebSearch cross-checked against an official source)
- [St. Louis Fed Web Services: FRED API Errors](https://fred.stlouisfed.org/docs/api/fred/errors.html) — 120 requests/minute rate limit
- [St. Louis Fed: fred/series/observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html) — one series per request; `.` missing-value sentinel
- [FRED: DFF series page](https://fred.stlouisfed.org/series/DFF), [FRED: DGS3MO series page](https://fred.stlouisfed.org/series/DGS3MO) — both business-days-only frequency (corrects the phase brief's speculative "DFF incl weekends" note)
- [NY Fed: SOFR reference rates](https://www.newyorkfed.org/markets/reference-rates/sofr) — SOFR published ~8:00am ET, T+1 relative to the trading day it reflects

### Tertiary (LOW confidence — live-verified via WebFetch this session, flagged for a cheap spot-check before the plan locks the exact schema)
- `https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json` — verified live and reachable, exact top-level key structure confirmed via a second targeted fetch (`{timestamp, symbol, data: {current_price, close, prev_day_close, last_trade_time, ...}}`); recommend one direct `curl`/fetch spot-check at plan time to eliminate any WebFetch-summarization risk on the exact field list
- `https://cdn.cboe.com/api/global/us_indices/daily_prices/VVIX_History.csv` — bulk historical CSV (`DATE,VVIX`, back to 2006) confirmed reachable; noted as an optional future backfill path, not required for MAC-01/MAC-02

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every version confirmed directly from `package.json`
- Architecture: HIGH — the entire design is a direct extension of two already-shipped, tested vertical slices (FRED/DGS3MO from Phase 2, COT from Phase 13) in the same codebase
- Pitfalls: HIGH for codebase-sourced pitfalls (unit convention, migration risk, doc/code cron drift — all directly observed in this repo); MEDIUM for FRED-timing pitfalls (cross-checked against official FRED/NY Fed pages); LOW for the two flagged assumptions (CBOE `last_trade_time` timezone, exact VIXCLS publish hour) — both are non-blocking per the Assumptions Log

**Research date:** 2026-07-01
**Valid until:** ~2026-08-01 (30 days — stable government/exchange APIs, low change velocity; re-verify the CBOE VVIX endpoint shape at plan time given it was WebFetch-summarized rather than raw-inspected)

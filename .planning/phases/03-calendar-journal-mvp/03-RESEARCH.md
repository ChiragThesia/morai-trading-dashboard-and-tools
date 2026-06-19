# Phase 3: Calendar Journal (MVP) — Research

**Researched:** 2026-06-13
**Domain:** Calendar journal vertical slice — Drizzle/pg-boss/Hono/MCP on the Phase 2 hexagonal skeleton
**Confidence:** HIGH (all findings are sourced from the live codebase; zero assumptions about established patterns)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Add `option_type` enum column (`C`/`P`, NOT NULL) to `calendars` via Drizzle migration. Snapshot resolves each leg by `(underlying, strike, option_type, expiry)` → `contracts.occSymbol` → latest `leg_observations` row.
- **D-02:** Same-strike only (true calendar). Single `strike` column serves both legs.
- **D-03:** `snapshot-calendars` chains off `compute-bsm-greeks` completion via the `boss.send(...)` success-trigger pattern. Slot order: fetch → compute → snapshot.
- **D-04:** Targeted fetch extension. `fetch-cboe-chain` fetches UNION of (a) band/DTE filter AND (b) exact contracts of every open calendar, so the snapshot always has its legs even when a back leg exceeds the ≤90-DTE / ±10% filter.
- **D-05:** Net greeks are position-level: `net_greek = (back_greek − front_greek) × qty × 100`. `net_mark = back_mark − front_mark`. `term_slope = back_iv − front_iv`. `pnl_open = (net_mark − open_net_debit) × qty × 100`.
- **D-06:** NaN-leg handling: snapshot STILL writes the row, storing string `'NaN'` for affected IV/greek columns. Raw marks still populate. Row continuity over gaps.

### Claude's Discretion
- Exact port names (`ForRegisteringCalendar`, `ForSnapshottingCalendars`, etc.) and use-case factory wiring follow Phase 2 `ForVerbingNoun` + `makeXxx(deps)` conventions.
- Holiday list internal representation (Set of ISO dates vs array) — must be pure data in core domain.

### Deferred Ideas (OUT OF SCOPE)
- Diagonal spreads / per-leg strikes — future enhancement; v1 is same-strike only.
- NYSE early-close (13:00 ET half days) — v1 treats them as normal RTH days.
- `trigger_job` MCP tool — Phase 5 (D-08 ban holds).
- Multi-leg / non-calendar strategies — not in v1 requirements.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CAL-01 | `POST /api/calendars` registers an open calendar | § Targeted-fetch extension, § Snapshot leg-resolution join — calendar domain type needed |
| CAL-02 | `snapshot-calendars` writes one full journal row per open calendar per 30-min RTH slot | § Snapshot leg-resolution join, § Job chain trigger |
| CAL-03 | `GET /api/journal/:calendarId` returns the ordered snapshot series | § MCP tool registration (same contract pattern) |
| CAL-04 | `GET /api/calendars` lists open/closed; `POST /api/calendars/:id/close` closes | § Calendar domain type, § Standard Stack |
| CAL-05 | Jobs no-op outside RTH and on NYSE holidays | § NYSE Holiday Gating |
| MCP-01 | Six MCP tools registered: `get_status`, `list_calendars`, `get_journal`, `get_live_greeks`, `get_term_structure`, `get_skew` | § Six-tool MCP registration |
</phase_requirements>

---

## Summary

Phase 3 builds on a fully operational hexagonal skeleton (Phase 2). Every pattern needed — port naming, use-case factories, pg-boss job chaining, Drizzle repos with chunked inserts, MCP tool registration, and shared contracts — is already established and live in production. The research task is not "what stack should we use" but "exactly how does the existing stack work and where do the five new capabilities plug in."

The four genuinely new behaviors are: (1) extending `fetchChain` to target registered-leg OCC symbols unconditionally (D-04); (2) the snapshot job's leg-resolution join pattern (D-01/D-05/D-06); (3) the NYSE holiday gate alongside `isWithinRth()` in core domain; and (4) registering five new MCP tools following the exact `registerStatusTool` pattern, including typed-empty schemas for the Phase 6 tools.

The CBOE adapter fetches the entire `_SPX.json` payload (both SPX and SPXW chains) in one HTTP call, then filters client-side by DTE/strike band in `processChain`. The targeted-fetch extension (D-04) is a filter-bypass, not a new HTTP request: out-of-band OCC symbols are passed through as a "must-include" set that overrides `isInFilter`. No new CBOE endpoint or per-symbol fetch is needed.

**Primary recommendation:** Mirror every Phase 2 pattern exactly. Every deviation from the established convention will break the hexagon law or TDD discipline enforced by ESLint.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Calendar registration / close | API / Backend | — | Pure state mutation; no client involvement |
| Snapshot computation (greeks, marks, pnl) | Domain (core) | Worker adapter | Pure math in core; pg-boss handler is a thin adapter |
| NYSE holiday gate | Domain (core) | Worker adapter | Pure data + logic alongside `isWithinRth()` in `packages/core/src/journal/domain/` |
| Leg-resolution join | Application (core use-case) | Postgres adapter | Lookup by `(underlying, strike, option_type, expiry)` → `contracts` → `leg_observations` is application logic; Drizzle query in adapter |
| Targeted-fetch extension (D-04) | Application (core use-case) | CBOE adapter + worker composition root | `mustIncludeOccSymbols` set injected as a dep into `makeFetchChainUseCase`; adapter fetches the same URL |
| Journal read | API / Backend | — | `GET /api/journal/:calendarId` and MCP `get_journal` share one Zod schema from contracts |
| Six MCP tools | API / Backend (MCP adapter) | — | MCP is a driving adapter over core use-cases; zero business logic in tool handler |
| `compute-bsm-greeks` → `snapshot-calendars` chain trigger | Worker adapter | — | `boss.send` in `computeBsmGreeksHandler` after success |

---

## Standard Stack

All packages are already installed (Phase 1 scaffold). No new dependencies required for this phase.

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `drizzle-orm` | installed | ORM for Drizzle repos, chunked inserts, schema | In use — `packages/adapters/src/postgres/` |
| `pg-boss` | installed | Job queue, `createQueue`/`schedule`/`work`/`send` | In use — `apps/worker/src/main.ts` |
| `hono` | installed | HTTP routes, middleware | In use — `apps/server/src/` |
| `@modelcontextprotocol/sdk` | installed | `McpServer`, `WebStandardStreamableHTTPServerTransport` | In use — `apps/server/src/adapters/mcp/` |
| `zod` | installed | Schema validation, contracts | In use throughout |
| `vitest` | installed | Test runner | In use throughout |

### No New Dependencies
This phase installs zero new packages. Every capability is implemented by extending existing adapters and adding new core use-cases/domain files that import only `@morai/shared`.

**Package Legitimacy Audit:** NOT APPLICABLE — no new packages installed in this phase.

---

## Architecture Patterns

### System Architecture Diagram

```
POST /api/calendars
        │
        ▼
  HTTP route (adapter)
  Zod-parse body
        │
        ▼
  ForRegisteringCalendar (port)
  makeRegisterCalendarUseCase(deps)
        │
        ▼
  ForPersistingCalendar (port)
  Postgres calendars repo (insert + D-01 migration)
        │
        └──► 201 + UUID

─────────────────────────────────────────────

pg-boss cron (*/30 RTH, Mon–Fri ET)
        │
        ▼
  fetch-cboe-chain handler
  isWithinRth() + isNyseHoliday()  ← NEW: holiday gate
        │
        ▼
  makeFetchChainUseCase (EXTENDED for D-04)
  mustInclude: Set<OccSymbol> from open calendars
        │
        ▼
  leg_observations (all band + all registered legs written)
        │
  boss.send("compute-bsm-greeks")
        │
        ▼
  compute-bsm-greeks handler
        │
        ▼
  makeComputeBsmGreeksUseCase (unchanged)
        │
  [NEW] boss.send("snapshot-calendars")   ← D-03
        │
        ▼
  snapshot-calendars handler  ← NEW
  isWithinRth() + isNyseHoliday()
        │
        ▼
  makeSnapshotCalendarsUseCase (NEW)
  ForReadingOpenCalendars → get all open calendars
  ForResolvingLegSnapshot → per leg: (underlying,strike,option_type,expiry)
    → occSymbol → latest leg_observations row
  compute net greeks, pnl_open, term_slope, DTEs
  write calendar_snapshots row (composite PK idempotency)

─────────────────────────────────────────────

GET /api/journal/:calendarId         MCP get_journal
         │                                   │
         └─────────────────┬─────────────────┘
                           ▼
                  ForReadingJournal (port)
                  makeGetJournalUseCase(deps)
                           │
                           ▼
                  Postgres calendar_snapshots repo
                  SELECT WHERE calendar_id=? ORDER BY time ASC
                           │
                           ▼
                  journalResponse.parse(rows)    ← @morai/contracts
                  200 + array (or 404 / 200+[])
```

### Recommended Project Structure (additions to existing)

```
packages/core/src/journal/
├── application/
│   ├── ports.ts                    EXTEND: add ~8 new port types for calendar CRUD + snapshot
│   ├── registerCalendar.ts         NEW use-case
│   ├── listCalendars.ts            NEW use-case
│   ├── closeCalendar.ts            NEW use-case
│   ├── getJournal.ts               NEW use-case
│   ├── snapshotCalendars.ts        NEW use-case (the most complex)
│   ├── fetchChain.ts               EXTEND: mustInclude set (D-04)
│   └── getLiveGreeks.ts            NEW use-case (reads leg_observations, not recomputes)
├── domain/
│   ├── rth-window.ts               unchanged
│   └── nyse-holidays.ts            NEW pure data + isNyseHoliday(date) function
└── index.ts                        EXTEND: export new ports + factories

packages/adapters/src/postgres/repos/
├── calendars.ts                    EXTEND: add write methods (insert, update status)
├── calendar-snapshots.ts           NEW: ForPersistingSnapshot, ForReadingJournal
└── leg-observations.ts             EXTEND: add ForResolvingLegSnapshot (latest obs by OCC)

packages/adapters/src/memory/
├── calendars.ts                    EXTEND: add write methods
├── calendar-snapshots.ts           NEW: in-memory twin
└── leg-observations.ts             EXTEND: add resolution method

packages/contracts/src/
├── calendar.ts                     NEW: CalendarResponse, RegisterCalendarRequest
├── journal.ts                      NEW: JournalSnapshotResponse, JournalResponse
├── live-greeks.ts                  NEW: LiveGreeksResponse
├── analytics.ts                    NEW: typed-empty {observations:[]} for term-structure/skew
└── index.ts                        EXTEND: export all new schemas

apps/server/src/adapters/
├── http/calendar.routes.ts         NEW: POST /api/calendars, GET /api/calendars, POST /api/calendars/:id/close
├── http/journal.routes.ts          NEW: GET /api/journal/:calendarId
└── mcp/tools.ts                    EXTEND: register 5 new tools

apps/worker/src/
├── handlers/snapshot-calendars.ts  NEW: pg-boss job handler
└── main.ts                         EXTEND: createQueue, schedule, work for snapshot-calendars
                                    EXTEND: boss.send in compute handler
```

---

## Focus Area 1: Targeted-Fetch Extension (D-04, CAL-04)

### How the CBOE Adapter Works

The CBOE adapter (`packages/adapters/src/http/cboe.ts`) fetches ONE URL (`_SPX.json`) that contains all SPX and SPXW contracts. There is no per-symbol or per-expiry fetch API. The adapter does not filter by DTE or strike — it returns the full chain as `RawChain`. [VERIFIED: codebase read]

Client-side filtering happens in `processChain` inside `makeFetchChainUseCase` via `isInFilter(quote, now, spot, maxDte, strikeBandPct)`. This is where the targeted-fetch bypass must be applied.

### Key Insight: No New HTTP Call Required

Because the CBOE API returns all contracts in one payload, the targeted-fetch extension is purely a filter-bypass: OCC symbols belonging to open calendars must not be filtered out by `isInFilter`. The adapter change is zero; the use-case change is minimal. [VERIFIED: codebase read]

### Clean Port Shape for D-04

The hexagon law requires `packages/core` to never import adapters or repos. The fetch use-case must not directly query the calendars table. The correct pattern:

```typescript
// In packages/core/src/journal/application/ports.ts — NEW port
export type ForGettingOpenCalendarLegs = () => Promise<
  Result<ReadonlyArray<OccSymbol>, StorageError>
>;
```

This port is injected into `FetchChainDeps` as an optional (or always-present) dep:

```typescript
// Extend FetchChainDeps in fetchChain.ts
export type FetchChainDeps = {
  // ... existing deps ...
  /** D-04: OCC symbols for open calendar legs that must bypass the DTE/band filter */
  readonly getOpenCalendarLegs: ForGettingOpenCalendarLegs;
};
```

The use-case calls `getOpenCalendarLegs()` once per run (before processing chains), builds a `Set<string>` of must-include symbols, and passes it into `processChain` (or an extended version). In `isInFilter`, any symbol present in the must-include set returns `true` unconditionally.

The Postgres adapter implementing `ForGettingOpenCalendarLegs` queries `calendars` for open rows, constructs the front and back OCC symbol for each (using `formatOccSymbol` from `@morai/shared`), and returns the set. This requires the `option_type` column (D-01 migration) to be present.

**Landmine:** The `contracts` table may not yet have rows for back legs exceeding the filter if those contracts have never been fetched. The first run after a calendar registers with an out-of-band back leg will have the leg's OCC symbol in the must-include set, but `processChain` produces a `ContractRow` from the CBOE payload — so as long as the symbol exists in the CBOE chain response, the contract row and observation row are both inserted on the same run. No separate pre-seeding is needed. [VERIFIED: `processChain` in `fetchChain.ts` — it maps in-filter quotes to both `ObservationRow` and `ContractRow` simultaneously]

**Landmine:** The OCC symbol constructed from `(underlying, strike, option_type, expiry)` for the targeted-fetch set must use the same `formatOccSymbol` rounding as the CBOE adapter uses. Strike in `calendars` is stored as `×1000 int` (e.g. 7100000 for strike 7100). Converting back to points: `strike / 1000`. Then `formatOccSymbol({ root, expiry, type, strike: strikePoints })` round-trips correctly. [VERIFIED: `formatOccSymbol` in `packages/shared/src/occ-symbol.ts`]

---

## Focus Area 2: Six MCP Tool Registration (MCP-01)

### Established Pattern (from `tools.ts` + `status.ts`)

The exact mechanics from the live codebase: [VERIFIED: codebase read]

```typescript
// Pattern: registerXxxTool(server, useCase)
server.registerTool(
  "tool_name",
  {
    title: "Human readable title",
    description: "...",
    inputSchema: { /* Zod raw shape for params, or {} for no params */ },
  },
  async (args) => {
    // 1. Call use-case
    const result = await useCase(args.param);
    // 2. Guard result.ok (exactOptionalPropertyTypes requires this)
    if (!result.ok) {
      return { content: [{ type: "text" as const, text: "internal error" }] };
    }
    // 3. Parse through shared contracts schema
    const payload = contractSchema.parse(result.value);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    };
  },
);
```

Each tool registration lives in its own function `registerXxxTool(server, useCase)`, added to `tools.ts` and called from `makeMcpRouter` (in `server.ts`).

The MCP server uses `WebStandardStreamableHTTPServerTransport` (not the Node bridge). Each request creates a fresh `McpServer` + transport instance (stateless). `registerXxxTool` is called on each fresh instance before `server.connect(transport)`.

### MCP Tools with Parameters

`get_journal` and `get_live_greeks` take a `calendarId` parameter. The `inputSchema` uses Zod raw shape:

```typescript
inputSchema: {
  calendarId: z.string().uuid(),
},
```

The tool callback receives `args: { calendarId: string }` which must be Zod-re-parsed before passing to the use-case (adapter thin-adapter rule: Zod-parse input at the adapter boundary).

### Typed-Empty Pattern for Phase 6 Tools (`get_term_structure`, `get_skew`)

These tools must return a schema-valid, non-error response with empty data. The `analytics.ts` contract defines:

```typescript
// packages/contracts/src/analytics.ts
export const termStructureResponse = z.object({
  observations: z.array(z.unknown()), // typed-empty: always []
});

export const skewResponse = z.object({
  observations: z.array(z.unknown()), // typed-empty: always []
});
```

The tool handler returns `{ observations: [] }` parsed through this schema. The SPEC requires "never an error." This means: no `if (!result.ok)` early exit path — the tool simply calls `ok({ observations: [] })` directly without a backing use-case, or a trivial use-case that always returns `ok({ observations: [] })`. [CITED: 03-SPEC.md §7]

**Key insight:** The planner should wire `get_term_structure` and `get_skew` to a use-case that is a constant `async () => ok({ observations: [] })` — no port, no repo. This is a deliberate stub. Do not add a database round-trip.

### makeMcpRouter Signature Change

Currently: `makeMcpRouter(config, getStatus)`. Phase 3 expands to inject all use-cases. Follow the same approach: add explicit parameters for each use-case so wiring is visible and testable. Do not bundle use-cases into a map or object unless the Phase 2 pattern already does so (it does not). [VERIFIED: `server.ts`]

---

## Focus Area 3: NYSE Holiday Gating (CAL-05)

### Where the Gate Gets Called

Every job handler that currently calls `isWithinRth()` must also call `isNyseHoliday()`. From codebase reading: [VERIFIED: codebase read]

| Handler | Current RTH check | Gets holiday check? |
|---------|------------------|---------------------|
| `fetch-cboe-chain.ts` | `isWithinRth(deps.now())` | Yes — SPEC: "snapshot AND existing fetch jobs" |
| `compute-bsm-greeks.ts` | No (relies on cron schedule) | No RTH check today; SPEC says "snapshot AND existing fetch jobs" — only fetch jobs, not the compute job. Compute runs on chain-trigger (already RTH-gated) or hourly fallback cron (already gated by `0 10-16 * * 1-5`). Adding holiday check to compute is optional but consistent. The SPEC specifically names "snapshot-calendars (and the phase 2 fetch chain via the same gate)." |
| `fetch-rates.ts` | No RTH check | `fetch-rates` runs at `0 9 * * 1-5` (before RTH open); SPEC does not explicitly include it. V1 conservatively adds holiday gate to be safe — rates don't update on holidays. |
| `snapshot-calendars.ts` (new) | Must have `isWithinRth()` | Yes — is the primary job |

**Confirmed gate targets (minimum):** `fetch-cboe-chain` handler + `snapshot-calendars` handler.

### Domain Implementation

`isNyseHoliday(date: Date): boolean` lives in `packages/core/src/journal/domain/nyse-holidays.ts` alongside `rth-window.ts`. [CITED: 03-SPEC.md — "pure data in core domain"]

```typescript
// packages/core/src/journal/domain/nyse-holidays.ts
// Pure data — no I/O, no imports outside @morai/shared (none needed)

/** NYSE full-closure holidays 2026–2027. ISO date strings (YYYY-MM-DD) in ET. */
const NYSE_HOLIDAYS = new Set<string>([
  // 2026
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King, Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
  // 2027
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King, Jr. Day
  "2027-02-15", // Washington's Birthday
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving Day
  "2027-12-24", // Christmas Day (observed)
]);
```

**Holiday list count:** 9 dates in 2026 (July 4 is a Saturday in 2026; Friday July 3 is an EARLY CLOSE, not a full closure — v1 treats early closes as normal days per SPEC). 9 dates in 2027. [VERIFIED: ICE press release — the authoritative NYSE official source; `ir.theice.com`]

**Date extraction from a `Date` object:** Use the same `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` pattern as `isWithinRth()`, formatting to ISO date in ET, then looking up in the Set.

```typescript
export function isNyseHoliday(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return false;
  return NYSE_HOLIDAYS.has(`${year}-${month}-${day}`);
}
```

The gate in each handler becomes: `if (!isWithinRth(now) || isNyseHoliday(now)) { console.warn("...: skipping — outside RTH or NYSE holiday"); return; }` [ASSUMED — exact log message wording; planner's call, consistent with existing "outside RTH" warn in `fetch-cboe-chain.ts`]

---

## Focus Area 4: Snapshot Leg-Resolution Join (D-01, D-05, D-06)

### `calendar_snapshots` Column List (All 18 Columns)

From `packages/adapters/src/postgres/schema.ts` [VERIFIED: codebase read]:

| # | Drizzle field | DB column | Type | Notes |
|---|--------------|-----------|------|-------|
| 1 | `time` | `time` | `timestamp with tz` | Composite PK col 1 |
| 2 | `calendarId` | `calendar_id` | `uuid` | Composite PK col 2 |
| 3 | `spot` | `spot` | `numeric NOT NULL` | |
| 4 | `netMark` | `net_mark` | `numeric NOT NULL` | `back_mark − front_mark` |
| 5 | `frontMark` | `front_mark` | `numeric NOT NULL` | |
| 6 | `backMark` | `back_mark` | `numeric NOT NULL` | |
| 7 | `frontIv` | `front_iv` | `numeric NOT NULL` | BSM-inverted; string `'NaN'` if unsolvable |
| 8 | `backIv` | `back_iv` | `numeric NOT NULL` | BSM-inverted; string `'NaN'` if unsolvable |
| 9 | `frontIvRaw` | `front_iv_raw` | `numeric NOT NULL` | Vendor IV from leg_observations |
| 10 | `backIvRaw` | `back_iv_raw` | `numeric NOT NULL` | Vendor IV from leg_observations |
| 11 | `netDelta` | `net_delta` | `numeric NOT NULL` | Position-level; `'NaN'` if NaN leg |
| 12 | `netGamma` | `net_gamma` | `numeric NOT NULL` | Position-level; `'NaN'` if NaN leg |
| 13 | `netTheta` | `net_theta` | `numeric NOT NULL` | Position-level; `'NaN'` if NaN leg |
| 14 | `netVega` | `net_vega` | `numeric NOT NULL` | Position-level; `'NaN'` if NaN leg |
| 15 | `termSlope` | `term_slope` | `numeric NOT NULL` | `back_iv − front_iv`; `'NaN'` if either NaN |
| 16 | `dteFront` | `dte_front` | `integer NOT NULL` | Calendar days |
| 17 | `dteBack` | `dte_back` | `integer NOT NULL` | Calendar days |
| 18 | `pnlOpen` | `pnl_open` | `numeric NOT NULL` | `(net_mark − open_net_debit) × qty × 100` |
| — | `source` | `source` | `snapshot_source enum NOT NULL` | `"cboe"` for this phase |

### Leg-Resolution Join Pattern

The snapshot use-case must resolve two legs per calendar (front and back) from existing DB rows. The resolution path:

```
(underlying, strike/1000, option_type, expiry_date)
    ↓
contracts table (occ_symbol = lookup key)
    ↓
leg_observations WHERE contract = occ_symbol
    ORDER BY time DESC LIMIT 1
```

This is a two-step join:

**Step 1 — OCC symbol lookup:** Given `(underlying, strike_int, option_type, front_expiry_date)`, construct the OCC symbol using `formatOccSymbol`. The `calendars.strike` column stores the value `×1000` int, so the point value for `formatOccSymbol` is `calendars.strike / 1000`. The `root` can be inferred from the underlying (SPX → try both SPX and SPXW roots; but since the calendar register step records which OCC symbols were observed, better to look up in `contracts` by `(underlying, strike_int, expiration_date, contract_type)`). [VERIFIED: `schema.ts` — `contracts` table has `underlying`, `strike` (×1000 int), `expiration` (date), `contract_type` enum]

**Alternative resolution — query `contracts` by attributes:** Instead of constructing OCC symbol, query `contracts` directly: `WHERE underlying = ? AND strike = ? AND expiration = ? AND contract_type = ?`. This avoids needing to guess the root (SPX vs SPXW). Return `occSymbol` from that row.

**Step 2 — Latest leg_observation:** Given the `occSymbol`, query `leg_observations WHERE contract = occSymbol ORDER BY time DESC LIMIT 1`. The "latest" row has the freshest BSM greeks.

**Port shape for the snapshot use-case:**

```typescript
// In ports.ts — NEW
export type LegSnapshot = {
  readonly occSymbol: OccSymbol;
  readonly mark: number;        // from leg_observations.mark (numeric string → parseFloat)
  readonly iv: number | null;   // vendor iv; null if absent
  readonly bsmIv: string | null;    // 'NaN' | numeric string | null
  readonly bsmDelta: string | null;
  readonly bsmGamma: string | null;
  readonly bsmTheta: string | null;
  readonly bsmVega: string | null;
};

export type ForResolvingLegSnapshot = (query: {
  readonly underlying: string;
  readonly strike: number;       // ×1000 int
  readonly optionType: "C" | "P";
  readonly expiry: string;       // YYYY-MM-DD
}) => Promise<Result<LegSnapshot | null, StorageError>>;
// Returns null when no matching contract or no observations exist for the slot
```

The Postgres implementation joins `contracts` (by attributes) → `leg_observations` (latest by time DESC LIMIT 1). Since `leg_observations` may have multiple rows for one contract across time, the LIMIT 1 ORDER BY time DESC returns the most recent snapshot window's data.

**NaN Propagation (D-06):** The snapshot use-case checks `bsmIv === 'NaN'` (or `bsmIv === null` meaning compute hasn't run). Both cases cause the snapshot to write string `'NaN'` for that leg's IV and all net greeks that depend on it. Raw marks (`front_mark`, `back_mark`, `spot`) still populate from the observation row. `pnl_open` uses marks, not greeks, so it always populates.

**`numeric NOT NULL` constraint with `'NaN'`:** Postgres `numeric` type accepts the string literal `'NaN'` as a valid value (IEEE 754 NaN stored as a numeric). Drizzle's `numeric()` column maps to `string` in TypeScript — so `String(value)` or the literal `'NaN'` both insert cleanly. This is the same pattern used in `writeBsmResults` today (T-02-16). [VERIFIED: `leg-observations.ts` — `writeBsmResults` sends string `'NaN'` to numeric columns without error]

**Idempotency:** The composite PK `(time, calendar_id)` on `calendar_snapshots` with `onConflictDoNothing()` makes re-runs a no-op for a given slot. Mirror the pattern from `persistObservations`. [VERIFIED: `schema.ts`]

---

## Focus Area 5: Job Chain Trigger (D-03)

### Exact Success-Chain Pattern

From `apps/worker/src/handlers/fetch-cboe-chain.ts` [VERIFIED: codebase read]:

```typescript
// After use-case succeeds:
void deps.boss.send("compute-bsm-greeks", {}, {
  singletonKey: "triggered-by-chain",
}).catch((e: unknown) => {
  console.warn("fetch-cboe-chain: failed to enqueue compute-bsm-greeks", e);
});
```

- `void` + `.catch(...)` — fire-and-forget; failure to enqueue does not fail the upstream job.
- `singletonKey` — prevents duplicate enqueues if multiple chain jobs complete close together.

The `compute-bsm-greeks` handler (`apps/worker/src/handlers/compute-bsm-greeks.ts`) currently has no `boss` dep and no success-chain send. Phase 3 adds one. The handler's deps type gains `boss: BossForChainHandler` (the same minimal interface type already exported from `fetch-cboe-chain.ts`).

**After compute succeeds:**
```typescript
void deps.boss.send("snapshot-calendars", {}, {
  singletonKey: "triggered-by-compute",
}).catch((e: unknown) => {
  console.warn("compute-bsm-greeks: failed to enqueue snapshot-calendars", e);
});
```

### `createQueue` Requirement (pg-boss v12)

From `apps/worker/src/main.ts` comments and code [VERIFIED: codebase read]:

> pg-boss v12 requires the queue row to exist (FK on the schedule table) before `boss.schedule()` or `boss.work()`.

The worker composition root must add before any `schedule` or `work` call:

```typescript
await boss.createQueue("snapshot-calendars");
```

`createQueue` is idempotent — safe to call on every boot. The existing pattern calls it for all three current queues.

### Snapshot Job Schedule

The snapshot job is NOT independently scheduled on a cron — it is only triggered by the compute job's success chain (D-03). No `boss.schedule("snapshot-calendars", ...)` call. This ensures the snapshot always reads freshly computed greeks and cannot race a half-computed slot. [CITED: 03-CONTEXT.md D-03]

The worker only needs:
```typescript
await boss.createQueue("snapshot-calendars");
await boss.work("snapshot-calendars", { pollingIntervalSeconds: 30 }, snapshotHandler);
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OCC symbol construction | Custom string formatting | `formatOccSymbol` from `@morai/shared` | Already handles root padding, strike ×1000, zero-padding |
| OCC symbol parsing | Custom string slicing | `parseOccSymbol` from `@morai/shared` | Already handles all edge cases, returns `Result<OccSymbolParsed, OccError>` |
| NaN storage in Postgres numeric | Custom null/undefined workaround | String literal `'NaN'` via Drizzle numeric column | Postgres numeric natively accepts NaN; existing pattern in T-02-16 |
| pg-boss job deduplication | Manual lock table | `singletonKey` option in `boss.send` | Already used in fetch→compute chain |
| Snapshot idempotency | Explicit duplicate check | Composite PK `(time, calendar_id)` + `onConflictDoNothing()` | Schema already has this; mirror `persistObservations` |
| ET timezone handling for holidays | `Date.getDay()` / UTC arithmetic | `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` | DST-correct; same pattern as `isWithinRth()` |
| BSM greeks computation in snapshot | Re-run BSM in snapshot use-case | Read from `leg_observations.bsm_*` columns | Phase 2 already computed and stored these; snapshot reads, never recomputes |

---

## Common Pitfalls

### Pitfall 1: Schema NaN vs null vs undefined
**What goes wrong:** Writing JS `null` or `undefined` to a `numeric NOT NULL` column when a leg is unsolvable causes a constraint violation.
**Why it happens:** BSM IV inversion fails → developer reaches for `null` → Drizzle sends SQL NULL → Postgres rejects NOT NULL.
**How to avoid:** Always send the string `'NaN'` for unsolvable legs. Use a `NAN_STAMP = 'NaN'` constant. See `computeBsmGreeks.ts` line 36 for the established pattern.
**Warning signs:** `null value in column violates not-null constraint` Postgres error at snapshot insert time.

### Pitfall 2: pg-boss array handler undefined element
**What goes wrong:** Snapshot handler crashes on `jobs[0].id` when `jobs[0]` is `undefined`.
**Why it happens:** pg-boss v12 may pass an array with an undefined element (Pitfall 2 from Phase 2 research).
**How to avoid:** Always open with `const [job] = jobs; if (job === undefined) return;` — identical to the existing handlers.
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'id')` in the snapshot handler.

### Pitfall 3: OCC symbol `contracts` miss — leg never fetched
**What goes wrong:** `ForResolvingLegSnapshot` returns `null` for a calendar leg because no row exists in `contracts` for that symbol. This happens on the first snapshot run after a calendar is registered if the targeted-fetch extension (D-04) did not yet run for that leg.
**Why it happens:** Calendar registered between two fetch runs; fetch has not yet run with the targeted extension, so the back leg (if out-of-band) has never been fetched → no `contracts` row → no `leg_observations` row.
**How to avoid:** The snapshot use-case must write a `'NaN'`-populated row when either leg resolves to `null` (treat it the same as a NaN BSM result, per D-06: row continuity over gaps). Do not skip the row.
**Warning signs:** Snapshot job succeeds but calendar has zero rows in `calendar_snapshots` immediately after registration.

### Pitfall 4: `strike` unit mismatch in OCC resolution
**What goes wrong:** Strike resolves to wrong contract because the ×1000 integer is used as the point value or vice versa.
**Why it happens:** `calendars.strike` stores ×1000 int (e.g. `7100000`). `contracts.strike` also stores ×1000 int. `formatOccSymbol` takes strike in points (e.g. `7100`). Mixing these produces wrong OCC symbols.
**How to avoid:** When querying `contracts` by strike attribute, compare `contracts.strike = calendars.strike` (both ×1000). When calling `formatOccSymbol`, divide by 1000 first: `calendars.strike / 1000`.
**Warning signs:** Snapshot writes NaN rows for calendars that have matching leg observations at the correct strike.

### Pitfall 5: Duplicate cron + chain-trigger for snapshot-calendars
**What goes wrong:** Adding both a cron schedule and a chain-trigger causes the snapshot to run twice per slot — once on the cron, before greeks are computed; once on the chain, after.
**Why it happens:** Developer follows the pattern from the other three jobs (which all have cron schedules).
**How to avoid:** `snapshot-calendars` gets `createQueue` + `work` only; NO `boss.schedule`. It is exclusively chain-triggered (D-03). [CITED: 03-CONTEXT.md D-03]
**Warning signs:** Duplicate rows attempt on composite PK — `onConflictDoNothing` silently swallows them, but the first row (with un-computed greeks) is written with NaN for all BSM fields.

### Pitfall 6: MCP `inputSchema` type mismatch with `exactOptionalPropertyTypes`
**What goes wrong:** TypeScript error on the MCP tool callback because `args.calendarId` is typed as `string | undefined` instead of `string`.
**Why it happens:** `exactOptionalPropertyTypes` makes optional schema fields produce `T | undefined`; Zod `.uuid()` without `.optional()` should be required, but the `inputSchema` type inference can be tricky.
**How to avoid:** Use `z.string().uuid()` (not `.optional()`). Always re-parse `args` through the same Zod schema inside the tool callback before passing to use-case (thin-adapter Zod boundary rule).
**Warning signs:** TypeScript errors referencing `exactOptionalPropertyTypes` or `string | undefined` on tool callback args.

---

## Code Examples

### Registering an MCP Tool with Parameters (mirror of `registerStatusTool`)
```typescript
// Source: apps/server/src/adapters/mcp/tools.ts (established pattern)
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { journalResponse } from "@morai/contracts";  // NEW contract schema
import type { ForGettingJournal } from "@morai/core";

export function registerGetJournalTool(
  server: McpServer,
  getJournal: ForGettingJournal,
): void {
  server.registerTool(
    "get_journal",
    {
      title: "Get Journal",
      description: "Returns the ordered snapshot series for a calendar.",
      inputSchema: { calendarId: z.string().uuid() },
    },
    async (args) => {
      // Re-parse at adapter boundary (thin-adapter rule, typescript.md)
      const { calendarId } = z.object({ calendarId: z.string().uuid() }).parse(args);
      const result = await getJournal(calendarId);
      if (!result.ok) {
        return { content: [{ type: "text" as const, text: "internal error" }] };
      }
      const payload = journalResponse.parse(result.value);
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
```

### Typed-Empty Tool (Phase 6 stub)
```typescript
// Source: 03-SPEC.md §7 — "typed empty result, never an error"
export function registerGetTermStructureTool(server: McpServer): void {
  server.registerTool(
    "get_term_structure",
    {
      title: "Get Term Structure",
      description: "Returns term-structure observations (available Phase 6).",
      inputSchema: {},
    },
    async () => {
      // Intentionally stub — Phase 6 will add a real use-case
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ observations: [] }) }],
      };
    },
  );
}
```

### Success-Chain Trigger (mirror of fetch-cboe-chain.ts)
```typescript
// Source: apps/worker/src/handlers/fetch-cboe-chain.ts (D-07 pattern to mirror for D-03)
// In compute-bsm-greeks handler, after use-case succeeds:
void deps.boss.send("snapshot-calendars", {}, {
  singletonKey: "triggered-by-compute",
}).catch((e: unknown) => {
  console.warn("compute-bsm-greeks: failed to enqueue snapshot-calendars", e);
});
```

### Snapshot Insert (18-column, idempotent)
```typescript
// Source: packages/adapters/src/postgres/repos/leg-observations.ts (onConflictDoNothing pattern)
await db
  .insert(calendarSnapshots)
  .values({
    time: snapshot.time,
    calendarId: snapshot.calendarId,
    spot: String(snapshot.spot),
    netMark: String(snapshot.netMark),
    frontMark: String(snapshot.frontMark),
    backMark: String(snapshot.backMark),
    frontIv: snapshot.frontIv,        // already a string: numeric value or 'NaN'
    backIv: snapshot.backIv,
    frontIvRaw: snapshot.frontIvRaw,  // vendor IV as string; 'NaN' if null (leg_observations.iv)
    backIvRaw: snapshot.backIvRaw,
    netDelta: snapshot.netDelta,
    netGamma: snapshot.netGamma,
    netTheta: snapshot.netTheta,
    netVega: snapshot.netVega,
    termSlope: snapshot.termSlope,
    dteFront: snapshot.dteFront,
    dteBack: snapshot.dteBack,
    pnlOpen: String(snapshot.pnlOpen),
    source: "cboe",
  })
  .onConflictDoNothing();
```

### DTE Computation for Snapshot Columns
```typescript
// Source: packages/core/src/journal/domain/dte.ts — calendarDte helper
// Already used in fetchChain.ts (private); snapshot use-case can import computeT
// or use the simpler calendarDte (calendar days, not T-years).
// DTE columns in snapshot are integer calendar days, not T-years.
function calendarDte(now: Date, expiry: Date): number {
  const nowMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryMs = Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth(), expiry.getUTCDate());
  return Math.max(0, Math.floor((expiryMs - nowMs) / (1000 * 60 * 60 * 24)));
}
// NOTE: calendarDte is private to fetchChain.ts. Snapshot use-case must either
// re-implement this 3-line helper in its own domain file or the planner can export it
// from rth-window.ts / a new dte-helpers.ts. It does NOT need computeT (which returns T-years).
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Per-symbol CBOE API requests | One `_SPX.json` payload, client-side filter | No change in Phase 3 — targeted-fetch is still one HTTP call; bypass is filter-level only |
| `ForGettingOpenCalendars` only returns `{id, underlying, openedAt}` | Must expand to include `strike, optionType, frontExpiry, backExpiry` for D-04 targeted-fetch | The existing `Calendar` domain type in `ports.ts` is too minimal; new use-cases need more fields |

**The `Calendar` domain type gap:** `ports.ts` currently defines:
```typescript
export type Calendar = {
  readonly id: string;
  readonly underlying: string;
  readonly openedAt: Date;
};
```
This is insufficient for Phase 3. The snapshot use-case needs `strike`, `option_type` (D-01), `front_expiry`, `back_expiry`, `qty`, `open_net_debit` to compute the row. The `Calendar` type must be extended (or a new richer type `OpenCalendar` added). Similarly, `ForGettingOpenCalendars` currently only returns this minimal type — it was a placeholder for Phase 1's status check. Phase 3 is the first consumer that actually uses calendar fields. [VERIFIED: `ports.ts` + `calendars.ts`]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `compute-bsm-greeks` handler does not need a holiday check (relies on cron schedule and chain-trigger, both already RTH-gated) | Focus Area 3 | Low — worst case is an extra no-op compute run on a holiday; greeks are idempotent |
| A2 | `fetch-rates` handler should get the holiday gate for correctness (FRED rates don't update on holidays) | Focus Area 3 | Low — FRED fallback to 4.5% already handles stale/missing data |
| A3 | Exact log message wording for holiday skip ("outside RTH or NYSE holiday, skipping") | Focus Area 3 | Negligible — planner's call |

**If this table is small:** Most findings were verified directly from the live codebase — only minor wording/convention choices are assumed.

---

## Open Questions (RESOLVED)

1. **`calendarDte` helper export**
   - What we know: `calendarDte` is private inside `fetchChain.ts`. Snapshot use-case needs integer DTE (calendar days), not T-years.
   - What's unclear: Should the planner export `calendarDte` from the domain module, or re-implement it as a two-line helper inside the snapshot use-case?
   - Recommendation: Export it from `packages/core/src/journal/domain/dte.ts` alongside `computeT` and `isThirdFriday`. It is pure, tested-adjacent logic.

2. **`frontIvRaw` / `backIvRaw` when vendor IV is null**
   - What we know: `leg_observations.iv` is nullable (vendor IV not always reported by CBOE). `calendar_snapshots.front_iv_raw NOT NULL`.
   - What's unclear: What to store in `*_iv_raw` when the leg observation has `iv = null`?
   - Recommendation: Store string `'NaN'` (consistent with D-06 NaN-in-row policy). The `NOT NULL` constraint is satisfied; the value is visibly absent without breaking the time series.

---

## Environment Availability

Step 2.6: No new external tools or services in this phase. All dependencies (Postgres, pg-boss, CBOE HTTP, Bun runtime) were established in Phases 1–2 and are confirmed live in production.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (already installed + configured) |
| Config file | `vitest.config.ts` at workspace root (already exists) |
| Quick run command | `bun run test --project core` (in-memory, no Docker) |
| Full suite command | `bun run test` (includes testcontainers Postgres tests) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| CAL-01 | `POST /api/calendars` registers; 400 on invalid expiry order | Integration (testcontainers) | `bun run test --run calendars.contract` | Mirror `leg-observations.contract.test.ts` pattern |
| CAL-01 | HTTP route: 201 + UUID; 400 + field errors | Unit (Hono test) | `bun run test --run calendar.routes.test` | Mirror `status.routes.test.ts` |
| CAL-04 | `GET /api/calendars` list; `POST /:id/close` 404/409 | Integration (testcontainers) | `bun run test --run calendars.contract` | Same test file as CAL-01 |
| CAL-02 | Snapshot writes complete 18-column row; re-run idempotent; pnl_open formula exact | Integration (testcontainers) | `bun run test --run calendar-snapshots.contract` | Highest-risk test — new file |
| CAL-02 | Snapshot skips closed calendar | Integration (testcontainers) | `bun run test --run calendar-snapshots.contract` | Same file |
| CAL-02 | Snapshot use-case: NaN leg → row still written with NaN fields | Unit (in-memory ports) | `bun run test --run snapshotCalendars.test` | Core use-case test |
| CAL-03 | `GET /api/journal/:calendarId` ordered array; 404; empty 200 | Unit (Hono test) | `bun run test --run journal.routes.test` | |
| CAL-05 | `isNyseHoliday` returns true for 2026-07-03? No — it's an early close only | Unit | `bun run test --run nyse-holidays.test` | Test the 9 full closure dates |
| CAL-05 | `isNyseHoliday(2026-01-01)` → true; `isNyseHoliday(2026-07-03)` → false | Unit | `bun run test --run nyse-holidays.test` | |
| CAL-05 | `isNyseHoliday(2026-11-26)` (Thanksgiving) → true | Unit | `bun run test --run nyse-holidays.test` | |
| CAL-05 | Snapshot handler no-op on holiday: zero rows written | Integration | `bun run test --run snapshot-calendars.handler.test` | Inject mock `now` to a holiday |
| MCP-01 | All 6 tools reachable via MCP; term-structure/skew return `{observations:[]}` | Unit (McpServer direct) | `bun run test --run mcp.test` | Mirror existing `mcp.test.ts` |
| MCP-01 | Contract test: journalResponse schema validates a snapshot row | Unit | `bun run test --run journal.contract.test` | `packages/contracts/src/` |

### Highest-Risk Behaviors

1. **Snapshot idempotency under composite PK** — test: insert same (time, calendarId) twice via use-case; assert one row, no error.
2. **NaN-leg row continuity** — test: resolve a leg that has `bsmIv = 'NaN'` in `leg_observations`; assert snapshot row exists with `frontIv = 'NaN'` and `pnlOpen` populated (uses marks, not greeks).
3. **Out-of-band leg fetch (D-04)** — test: open calendar with back-leg strike outside ±10% band; run `fetchChainUseCase` with targeted-fetch extension; assert back leg appears in `leg_observations`.
4. **Holiday/RTH gating** — test: inject `now = 2026-01-01T14:00:00Z` (NYSE New Year's closure, 9am ET); assert snapshot handler returns without writing rows.
5. **`pnlOpen` formula precision** — property test: `pnlOpen = (net_mark − open_net_debit) × qty × 100`; use numeric string arithmetic to avoid floating-point drift in Postgres.

### Wave 0 Gaps (new test files needed)

- [ ] `packages/core/src/journal/domain/nyse-holidays.test.ts` — covers CAL-05 unit
- [ ] `packages/core/src/journal/application/snapshotCalendars.test.ts` — covers CAL-02 NaN path + pnlOpen formula
- [ ] `packages/adapters/src/postgres/repos/calendar-snapshots.contract.test.ts` — testcontainers idempotency
- [ ] `packages/adapters/src/__contract__/calendar-snapshots.contract.ts` — shared contract runner
- [ ] `packages/adapters/src/memory/calendar-snapshots.ts` — in-memory twin (required by architecture rule §8)
- [ ] `apps/server/src/adapters/http/calendar.routes.test.ts` — Hono route unit tests
- [ ] `apps/server/src/adapters/http/journal.routes.test.ts` — Hono route unit tests
- [ ] `packages/contracts/src/calendar.test.ts` — contract schema validation test

*(Existing `mcp.test.ts` expands — not a new file)*

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` per `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No new auth surface | Bearer token already gated on `/mcp` (Phase 1) |
| V3 Session Management | No | Stateless MCP (fresh server per request) |
| V4 Access Control | Partial | All routes are single-user; no per-calendar ownership check in v1 |
| V5 Input Validation | Yes | Zod at all HTTP and MCP boundaries; `calendars` insert uses Drizzle parameterized queries |
| V6 Cryptography | No | No new secrets or crypto in this phase |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| OCC symbol injection via calendar registration | Tampering | Zod schema validates `optionType: z.enum(['C','P'])`, strike as positive integer, expiry as ISO date; Drizzle parameterized INSERT never interpolates user input |
| `GET /api/journal/:calendarId` UUID enumeration | Information Disclosure | Drizzle parameterized WHERE clause; 404 on unknown ID (not 403 — single user, no multi-user in v1) |
| `POST /api/calendars/:id/close` on another user's calendar | Elevation of Privilege | Not applicable in v1 (single-user); no ownership model |
| Snapshot job writing wrong data if `ForResolvingLegSnapshot` returns stale row | Tampering | ORDER BY time DESC LIMIT 1 ensures latest row; composite PK makes re-runs idempotent |

---

## Sources

### Primary (HIGH confidence — verified from live codebase)
- `packages/core/src/journal/application/fetchChain.ts` — `isInFilter`, `processChain`, `FetchChainDeps` structure
- `apps/worker/src/handlers/fetch-cboe-chain.ts` — success-chain `boss.send` pattern
- `apps/worker/src/handlers/compute-bsm-greeks.ts` — handler structure; currently no boss dep
- `apps/worker/src/main.ts` — `createQueue` requirement, job composition pattern
- `packages/adapters/src/postgres/schema.ts` — 18-column `calendar_snapshots`, `calendars` (no `option_type` yet), `contracts`, `leg_observations`
- `packages/adapters/src/postgres/repos/leg-observations.ts` — chunked insert, `writeBsmResults` NaN string pattern, leg resolution query structure
- `packages/adapters/src/postgres/repos/calendars.ts` — existing `Calendar` type gap (missing strike/expiry/optionType)
- `apps/server/src/adapters/mcp/tools.ts` — `registerStatusTool` exact mechanics
- `apps/server/src/adapters/mcp/server.ts` — `makeMcpRouter`, `WebStandardStreamableHTTPServerTransport`, stateless per-request server
- `packages/contracts/src/status.ts` — route+tool-share-one-schema pattern
- `packages/core/src/journal/domain/rth-window.ts` — `isWithinRth()` Intl pattern to mirror for `isNyseHoliday()`
- `packages/core/src/journal/domain/dte.ts` — `calendarDte` logic (private), `computeT`
- `packages/shared/src/occ-symbol.ts` — `formatOccSymbol` strike×1000 rounding

### Primary (HIGH confidence — authoritative official source)
- [NYSE Group 2025–2027 Holiday Calendar (ICE press release)](https://ir.theice.com/press/news-details/2024/NYSE-Group-Announces-2025-2026-and-2027-Holiday-and-Early-Closings-Calendar/default.aspx) — 9 full closures 2026, 9 full closures 2027; July 3 2026 confirmed EARLY CLOSE not full closure [VERIFIED: authoritative source]

### Secondary (confirmed by both sources)
- [NYSE.com Holidays & Trading Hours](https://www.nyse.com/trade/hours-calendars) — corroborates July 3 2026 is early close only; page showed partial 2026 list (7 of 9 closures visible at fetch time, likely a rendering/pagination issue) — ICE press release is the definitive source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed and in use
- Architecture patterns: HIGH — verified from live production code
- Pitfalls: HIGH — derived from actual code gotchas observed in Phase 2 implementation (NaN string convention, pg-boss array-guard, etc.)
- NYSE holiday list: HIGH — sourced from official ICE/NYSE press release for 2025/2026/2027

**Research date:** 2026-06-13
**Valid until:** 2026-12-31 (holiday list is locked; stack is stable; only CBOE API changes would invalidate)

# Phase 14: FRED Expansion - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 20
**Analogs found:** 20 / 20

**IMPORTANT — CONTEXT overrides RESEARCH on storage design.** 14-RESEARCH.md
recommends widening `rate_observations`; 14-CONTEXT.md D-01 (locked, post-research
addendum) instead mandates a NEW `macro_observations` table modeled on
`cot_observations`, leaving `rate_observations`/`readRate`/BSM completely untouched
(D-02). All patterns below follow the COT vertical slice, NOT the research's
widen-table sections.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` | migration | CRUD | `packages/adapters/src/postgres/migrations/0012_cot_observations.sql` | exact |
| `packages/adapters/src/postgres/schema.ts` (add `macroObservations`) | model | CRUD | `cotObservations` def (same file, lines ~389-421) | exact |
| `packages/core/src/journal/application/ports.ts` (extend) | model/port | CRUD | `ForPersistingCotObservation`/`ForReadingCotObservations`/`CotObservationRow` port defs | exact |
| `packages/core/src/journal/application/fetchMacroSeries.ts` | service | event-driven/batch | `packages/core/src/journal/application/fetchCot.ts` | exact (per-item batch is new — see Pattern 3 in research, refresh-tokens precedent) |
| `packages/core/src/journal/application/getMacro.ts` | service | CRUD (read) | `packages/core/src/journal/application/getCot.ts` | exact |
| `packages/adapters/src/http/fred.ts` (extend: `makeFredSeriesAdapter`) | service (HTTP adapter) | request-response | same file, `makeFredRateAdapter` (existing) | exact — extract shared helper, add no-fallback factory |
| `packages/adapters/src/http/cboe-vvix.ts` | service (HTTP adapter) | request-response | `packages/adapters/src/http/cboe.ts` | exact — same `{timestamp, data:{current_price, close, prev_day_close}}` shape |
| `packages/adapters/src/postgres/repos/macro-observations.ts` | service (repo) | CRUD | `packages/adapters/src/postgres/repos/cot-observations.ts` | exact |
| `packages/adapters/src/memory/macro-observations.ts` | service (in-memory twin) | CRUD | `packages/adapters/src/memory/cot-observations.ts` | exact |
| `packages/adapters/src/__contract__/macro-observations.contract.ts` | test (contract) | CRUD | `packages/adapters/src/__contract__/cot-observations.contract.ts` | exact |
| `packages/contracts/src/macro.ts` | model (Zod contract) | request-response | `packages/contracts/src/cot.ts` | exact |
| `apps/worker/src/handlers/fetch-rates.ts` (extend) | route (job handler) | event-driven | same file (existing DGS3MO path) + `apps/worker/src/handlers/fetch-cot.ts` for the array-guard/throw pattern | exact |
| `apps/worker/src/schedule.ts` (extend cron to 2x daily) | config | event-driven | same file, `fetch-cot` registration block (lines ~71-97) | exact |
| `apps/server/src/adapters/http/analytics.routes.ts` (add `/analytics/macro`) | route (HTTP) | request-response | same file, `/analytics/cot` block (lines 91-103) | exact |
| `apps/server/src/adapters/mcp/tools.ts` (add `registerGetMacroTool`) | route (MCP) | request-response | same file, `registerGetCotTool` (lines 547-583) | exact |
| `apps/server/src/adapters/mcp/server.ts` (wire `getMacro`) | route (MCP wiring) | request-response | same file, `getCot`/`registerGetCotTool` wiring (lines 54-96) | exact |
| `apps/server/src/main.ts` / `apps/worker/src/main.ts` (composition wiring) | config | — | existing COT/rate wiring blocks | exact |
| `apps/web/src/hooks/useMacro.ts` | hook | request-response | `apps/web/src/hooks/useCot.ts` | exact |
| `apps/web/src/components/MacroCard.tsx` | component | request-response | `apps/web/src/components/CotCard.tsx` | exact |
| `apps/web/src/screens/Overview.tsx` (replace FRED-macro `ComingSoon` stub, ~line 438-443) | component | request-response | same file — `CotCard` mount point immediately preceding the stub | exact |

## Pattern Assignments

### `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` (migration)

**Analog:** `packages/adapters/src/postgres/migrations/0012_cot_observations.sql`

```sql
CREATE TABLE "cot_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contract_code" text NOT NULL,
  "as_of" date NOT NULL,
  ...
  CONSTRAINT "cot_observations_contract_code_as_of_unique" UNIQUE("contract_code","as_of")
);
--> statement-breakpoint
ALTER TABLE "cot_observations" ENABLE ROW LEVEL SECURITY;
```

**Deviation required by D-01:** `macro_observations` needs a true COMPOSITE PK
`(date, series_id)` (DATA-01 time-leading rule — see `RESEARCH.md`'s rejected
alternative note), NOT a uuid PK + unique constraint like `cot_observations`. Model
the composite-PK SQL shape after `schema.ts` lines 107/142/308/331 (`primaryKey({
columns: [...] })` sites — e.g. `term_structure_observations`), not after `cot_observations`
or `rate_observations` (both single-column PK). Columns per D-01/D-14: `series_id text
NOT NULL`, `date date NOT NULL`, `value numeric NOT NULL`, PK `(date, series_id)`
(time-leading), `ENABLE ROW LEVEL SECURITY` (mirror COT). Optional `source text` column
per Claude's Discretion (A5). **Hand-review the generated SQL** — this repo requires
manual verification of every non-trivial migration (see RESEARCH Pitfall 2, though that
pitfall is about the now-superseded widen-table path; the discipline still applies to
verify drizzle-kit emits a clean `CREATE TABLE`, not something destructive).

---

### `packages/adapters/src/postgres/schema.ts` — add `macroObservations` (model)

**Analog:** `cotObservations` def, same file (~line 389), and a composite-PK example
like `term_structure_observations` (line ~142: `primaryKey({ columns: [table.time,
table.contract] })`).

```ts
// cot_observations pattern (uuid PK + unique constraint) — do NOT copy PK shape
export const cotObservations = pgTable(
  "cot_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractCode: text("contract_code").notNull(),
    asOf: date("as_of").notNull(),
    ...
  },
);
```
```ts
// composite time-leading PK pattern to copy instead (e.g. term-structure table, line ~142)
{
  time: timestamp("time", { withTimezone: true }).notNull(),
  contract: text("contract").notNull(),
  ...
},
(table) => ({
  pk: primaryKey({ columns: [table.time, table.contract] }),
}),
```

Write `macroObservations` as: `date: date("date").notNull()`, `seriesId: text("series_id").notNull()`,
`value: numeric("value").notNull()`, composite `primaryKey({ columns: [table.date, table.seriesId] })`,
`.enableRLS()` (mirror `rateObservations`'s `.enableRLS()` call, same file line 205).

---

### `packages/core/src/journal/application/ports.ts` (extend)

**Analog:** Existing `ForPersistingCotObservation` / `ForReadingCotObservations` /
`CotObservationRow` port shapes in the same file (grep `CotObservationRow`). Add
parallel `MacroObservationRow` (`{ seriesId, date, value }`), `ForPersistingMacroObservation`,
`ForReadingMacroObservations` (bulk, unfiltered — grouping happens in `getMacro.ts`),
`ForFetchingFredSeries` (parameterized by `seriesId`, no-fallback — returns `Result<..,
FetchError>`), `ForFetchingVvixQuote` (no params). Do NOT touch `ForFetchingRate`/
`ForReadingRate`/`RateObservation` (D-02 — frozen).

---

### `packages/core/src/journal/application/fetchMacroSeries.ts` (service)

**Analog:** `packages/core/src/journal/application/fetchCot.ts` (single-fetch shape)
combined with the `Promise.allSettled` per-app-independence pattern already established
for `refresh-tokens` (JOB-02, per `docs/architecture/jobs.md` "Per-app independence
(D-13)" — cited in RESEARCH Pattern 3, no local file needed to copy since it's a
documented convention, not a code file to open).

Core shape to copy from `fetchCot.ts`: factory `makeFetchMacroSeriesUseCase(deps) =>
ForRunningFetchMacroSeries`, calling injected fetch ports then the persist port, and
returning `Result<void, ...>`. Extend with:
- Loop over the 8 series (7 FRED `seriesId`s + VVIX), `Promise.allSettled`.
- Persist every fulfilled+ok result independently (D-07: best-effort).
- Collect failed series names; if any failed, return `err({ kind: ..., message: "macro
  fetch failed for: DFF, SOFR" })` AFTER persisting all successes (fail-loud finish,
  D-07) — this is the one meaningful deviation from `fetchCot.ts`'s simpler single-series
  early-return.

---

### `packages/core/src/journal/application/getMacro.ts` (service, read)

**Analog:** `packages/core/src/journal/application/getCot.ts` (full file read, 119
lines) — copy directly, changing the shape:

```ts
// getCot.ts pattern (lines 82-118) — mirror exactly, replacing the per-row net-derivation
// (cotNet) with a groupBy-seriesId reduction instead:
export function makeGetCotUseCase(deps: {
  readonly readCotObservations: ForReadingCotObservations;
}): ForRunningGetCot {
  return async (): Promise<Result<ReadonlyArray<CotEntry>, StorageError>> => {
    const result = await deps.readCotObservations();
    if (!result.ok) { return result; }
    const entries = result.value.map((row) => ({ /* map + derive */ }));
    return ok(entries);
  };
}
```

For `getMacro.ts`: `deps.readMacroObservations()` → `Result<ReadonlyArray<MacroObservationRow>,
StorageError>` → reduce into `Record<string, Array<{ time: string; value: number }>>`
grouped by `seriesId`, each series' array sorted ascending by `date` (D-10: "time-ordered
ascending" — note this is the OPPOSITE order from COT's `desc(asOf)` repo read, so either
sort here or confirm the repo's `ORDER BY` is ascending). Empty store → `ok({})` (mirrors
COT's `ok([])` empty case, called out explicitly in the file's own header comment).
Apply the default 90-day window / optional `days`/`series` params (D-11) either here or at
the route layer — `getCot.ts` has no such params, so this is new; keep filtering logic in
the use-case (pure), leave Zod-validation of the query params at the route.

---

### `packages/adapters/src/http/fred.ts` (extend)

**Analog:** same file, `makeFredRateAdapter` (full file, 116 lines, already read).

```ts
// Existing pattern (lines 44-114) to extract into a shared helper + two factories:
const url = new URL(FRED_BASE_URL);
url.searchParams.set("series_id", "DGS3MO");   // → parameterize
url.searchParams.set("api_key", deps.apiKey);
url.searchParams.set("file_type", "json");
url.searchParams.set("sort_order", "desc");
url.searchParams.set("limit", "5");
// fetch → response.ok check → Zod parse (FredResponseSchema, lines 15-22, reusable as-is)
// → filter value !== "." → take validObs[0] → parseFloat
```

**Deviations for `makeFredSeriesAdapter` (new, per-series, no fallback):**
- No `deps.fallbackRate` — on any failure (missing key, network, non-2xx, parse fail,
  all-`.`), return `err({ kind: "fetch-error", message: ... })`, NOT `ok(fallback)`.
- D-09: missing `FRED_API_KEY` is a HARD failure for macro series (opposite of the
  DGS3MO adapter's D-13 silent-fallback — do not reuse that branch).
- D-14: NO `/100` division — return `ratePercent` (or raw parsed value) as-is.
- Never log `deps.apiKey` (keep the same static-warn-message discipline, lines 71-79).
- Extract the `FredResponseSchema`/`FredObservationSchema` Zod schemas (lines 15-22) as
  shared — reused unchanged by both factories.

---

### `packages/adapters/src/http/cboe-vvix.ts` (new)

**Analog:** `packages/adapters/src/http/cboe.ts` (spot-resolution chain, lines 186-205,
already read).

```ts
// Source: packages/adapters/src/http/cboe.ts, lines 186-205 — copy verbatim
const spot =
  payload.data.current_price ??
  payload.data.close ??
  payload.data.prev_day_close ??
  null;
if (spot === null || spot === 0) {
  return err({ kind: "fetch-error", message: "CBOE payload missing spot price" });
}
// CBOE timestamp is UTC — production-verified convention (line ~200-201):
const observedAt = new Date(payload.timestamp.replace(" ", "T") + "Z");
```

Point at `https://cdn.cboe.com/api/global/delayed_quotes/quotes/_VVIX.json` (D-15,
verified live). Derive the `date` column from `observedAt` (UTC timestamp → trade date),
NOT from the unverified `last_trade_time` field (RESEARCH Pitfall 6 — avoid it entirely).
Store raw value, no `/100` (D-14).

---

### `packages/adapters/src/postgres/repos/macro-observations.ts` (new)

**Analog:** `packages/adapters/src/postgres/repos/cot-observations.ts` (full file, 106
lines, already read).

```ts
// Insert pattern (lines 34-66) to mirror, changing onConflict target + strategy:
await db
  .insert(cotObservations)
  .values({ contractCode: row.contractCode, asOf: row.asOf, ... })
  .onConflictDoNothing({
    target: [cotObservations.contractCode, cotObservations.asOf],
  });
```

**Deviation:** D-05 requires idempotent UPSERT (second same-day run = no-op, but FRED
sometimes revises preliminary values — mirror `rate_observations`'s existing
`onConflictDoUpdate` semantic per RESEARCH's Code Examples section, NOT COT's
`onConflictDoNothing`). Target: `[macroObservations.date, macroObservations.seriesId]`.

Read pattern (lines 68-102) mirrors `listCotObservations` shape — `readMacroObservations`
returns all rows (no filtering; `getMacro.ts` groups/windows). Same try/catch → `err({
kind: "storage-error", message })` on exception.

---

### `packages/adapters/src/memory/macro-observations.ts` (new, in-memory twin)

**Analog:** `packages/adapters/src/memory/cot-observations.ts`. Mirror its in-memory
array + `onConflictDoUpdate`-equivalent replace-by-key logic (architecture-boundaries.md
rule 8 — ship the in-memory twin in the same PR as any driven-port change).

---

### `packages/contracts/src/macro.ts` (new)

**Analog:** `packages/contracts/src/cot.ts` (full file, 78 lines, already read) and the
two-arg `z.record` pattern from `packages/contracts/src/status.ts:44` (cited in RESEARCH
Pattern 4).

```ts
// status.ts:44 — two-arg z.record form (Zod v4; one-arg is a TS2554 error)
lastJobRuns: z.union([
  z.literal("none yet"),
  z.record(z.string(), jobRunRecord),
]),
```

```ts
// New file, mirroring cot.ts's header-comment + export shape:
export const macroSeriesPoint = z.object({
  time: z.string().date(),   // YYYY-MM-DD (D-10, matches COT's asOf precedent)
  value: z.number(),
});
export type MacroSeriesPoint = z.infer<typeof macroSeriesPoint>;

export const macroResponse = z.record(z.string(), z.array(macroSeriesPoint));
export type MacroResponse = z.infer<typeof macroResponse>;
```

Add optional request-params schema per D-11 (`days` max 1825, `series` CSV filter of
known series IDs) — no existing precedent for query-param Zod schemas in `cot.ts`;
check `skew.ts`/`term-structure.ts` contracts if they take params, else define fresh
with `z.coerce.number().max(1825).optional()` / `z.string().optional()` (CSV parsed at
the route).

Update `packages/contracts/src/index.ts` barrel export (mirror `cot.ts`'s existing
export line).

---

### `apps/worker/src/handlers/fetch-rates.ts` (extend)

**Analog:** same file (full file, 47 lines, already read) — the existing
`makeFetchRatesHandler` shape (array-guard → holiday check → call use-case → throw on
err), PLUS `apps/worker/src/handlers/fetch-cot.ts`'s simpler no-holiday-gate call
pattern (lines 22-36, already read) for the second use-case call.

```ts
// Existing pattern (fetch-rates.ts, lines 26-46) — extend, don't replace:
return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
  if (job === undefined) return;
  if (isNyseHoliday(deps.now())) {
    console.warn("fetch-rates: skipping — NYSE holiday");
    return;
  }
  const result = await deps.fetchRateUseCase();   // UNCHANGED (D-02)
  if (!result.ok) { throw new Error(result.error?.message ?? "fetchRate use-case failed"); }

  // NEW — same job run, additive (D-02):
  const macroResult = await deps.fetchMacroSeriesUseCase();
  if (!macroResult.ok) { throw new Error(macroResult.error?.message ?? "fetchMacroSeries use-case failed"); }
};
```

Keep the same NYSE-holiday gate for both calls (per D-06's cadence, still Mon-Fri only).
Add `fetchMacroSeriesUseCase` to `FetchRatesHandlerDeps`.

---

### `apps/worker/src/schedule.ts` (extend cron)

**Analog:** same file, `fetch-cot` cron registration block (already grepped, lines
71-97) — copy the `schedule(name, cron, data, opts)` call shape.

D-06: change `fetch-rates`'s single cron line to TWO `schedule("fetch-rates", ...)`
calls — `"0 9 * * 1-5"` (unchanged) and `"30 18 * * 1-5"` (18:30 ET), both `{ tz:
"America/New_York" }` (matching existing pattern — grep `tz:` in the same file for the
exact option shape). No new queue (`createQueue`/`work` stay single registration —
same handler serves both cron fires).

---

### `apps/server/src/adapters/http/analytics.routes.ts` (add route)

**Analog:** same file, `/analytics/cot` block (lines 91-103, already grepped).

```ts
// Pattern to copy, lines 95-103:
router.get("/analytics/cot", async (c) => {
  const result = await getCot();
  if (!result.ok) { /* map StorageError → 500 flat body, per T-06-08 */ }
  return c.json(cotResponse.parse(result.value));
});
```

For `/analytics/macro`: accept optional query params `days`/`series` (D-11) —
Zod-parse them before calling `getMacro(params)` (this route DOES take user input,
unlike COT's `T-13-06-INJ` no-input-surface note — validate against the known 8
series IDs, reject unknown ones). Parse response through `macroResponse` before
`c.json(...)`.

---

### `apps/server/src/adapters/mcp/tools.ts` + `server.ts` (MCP tool)

**Analog:** same files, `registerGetCotTool` (tools.ts lines 547-583) + its wiring in
`server.ts` (lines 54-96, both already grepped).

```ts
// tools.ts pattern (lines 561-583):
export function registerGetCotTool(server: McpServer, getCot: ForRunningGetCot): void {
  server.registerTool("get_cot", { ... }, async () => {
    const result = await getCot();
    if (!result.ok) { /* map to MCP error */ }
    const payload = cotResponse.parse(result.value);
    return { content: [{ type: "text", text: JSON.stringify(payload) }] };
  });
}
```

```ts
// server.ts wiring pattern (lines 66, 94-96):
getCot?: ForRunningGetCot,
...
if (getCot !== undefined) {
  registerGetCotTool(server, getCot);
}
```

For `get_macro`: accept `{ days?, series? }` params in the tool's Zod input schema
(D-10), pass through to `getMacro({ days, series })`, same optional-injection pattern
in `server.ts` for backward compat.

---

### `apps/web/src/hooks/useMacro.ts` (new)

**Analog:** `apps/web/src/hooks/useCot.ts` (full file, 45 lines, already read) — copy
directly, changing:

```ts
// Copy verbatim, changing queryKey/URL/schema:
export function useMacro() {
  return useQuery({
    queryKey: ["macro"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/macro");
      if (res.status === 401) { throw new UnauthorizedError(); }
      if (!res.ok) { throw new Error(`GET /api/analytics/macro failed: ${res.status}`); }
      return macroResponse.parse(await res.json());
    },
    refetchInterval: 3_600_000,   // reconsider: macro updates 2x/day (D-06) vs COT weekly —
    staleTime: 1_800_000,          // could tighten to e.g. 30min refetch / 15min stale
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}
```

Keep the same `UnauthorizedError` class shape (lines 6-12) — either import a shared one
if it exists across hooks, or redeclare locally matching the exact pattern.

---

### `apps/web/src/components/MacroCard.tsx` (new)

**Analog:** `apps/web/src/components/CotCard.tsx` (partial read, lines 1-50 — header,
imports, formatting helpers `fmtMag`/`fmtSigned`, `Panel`/`PanelHeading` from
`./system/index.tsx`).

```ts
import { useCot } from "../hooks/useCot.ts";
import { Panel, PanelHeading } from "./system/index.tsx";
import { cn } from "@/lib/utils";
```

Copy the import shape (`useMacro` instead of `useCot`), `Panel`/`PanelHeading` design-
system wrapper, and empty/loading state pattern ("run the job to populate", per the
file's own header comment). Layout is Claude's Discretion per CONTEXT (tiles vs
tiles+sparklines) — CotCard's proportional-bar + sign-color pattern is one visual
precedent but not mandatory to copy verbatim for a multi-series card; reuse `fmtSigned`/
`fmtMag`-style compact-number formatting helpers if displaying deltas.

---

### `apps/web/src/screens/Overview.tsx` (replace stub)

**Analog:** same file — `ComingSoon` stub block at line ~438-443 (already grepped),
immediately preceding/following the live `CotCard` mount (per the file's own header
comment at line 25: "+ FRED macro (\"needs feed\" stub until Phase 14 ships the
ingestion)").

```tsx
{/* CFTC COT (Phase 13 — live) + FRED macro (Phase 14 — still a stub) */}
...
<ComingSoon
  ...
  title="FRED macro"
  ...
/>
```

Replace the `<ComingSoon title="FRED macro" .../>` element with `<MacroCard />`, mirroring
however `<CotCard />` is mounted elsewhere in the same file (grep `<CotCard` for the exact
JSX wrapper/grid-cell pattern to match).

---

## Shared Patterns

### Zod parse-at-boundary
**Source:** `packages/adapters/src/http/fred.ts` (`FredResponseSchema.safeParse`),
`packages/adapters/src/http/cboe.ts` (payload schema)
**Apply to:** `fred.ts` extension, `cboe-vvix.ts` — every external HTTP response
parsed before crossing into core.

### Result<T, E> + no-throw core
**Source:** all `packages/core/src/journal/application/*.ts` use-cases (`fetchCot.ts`,
`getCot.ts`) and `packages/adapters/src/postgres/repos/cot-observations.ts`
**Apply to:** `fetchMacroSeries.ts`, `getMacro.ts`, `macro-observations.ts` repo —
`ok(...)`/`err({ kind, message })` from `@morai/shared`, never throw in core.

### Thin job handler: array-guard → gate → use-case → throw-on-err
**Source:** `apps/worker/src/handlers/fetch-rates.ts` (full file), `fetch-cot.ts`
**Apply to:** `fetch-rates.ts` extension — no business logic in the handler itself.

### Thin route/MCP: parse → use-case → contract-parse response
**Source:** `apps/server/src/adapters/http/analytics.routes.ts` (`/analytics/cot`),
`apps/server/src/adapters/mcp/tools.ts` (`registerGetCotTool`)
**Apply to:** new `/analytics/macro` route + `get_macro` tool — response always
`macroResponse.parse(...)`'d before send/return, matching MCP-02's shared-contract
requirement (D-10).

### Auth inheritance by placement (no new auth code)
**Source:** `apps/server/src/main.ts` — `apiRouter`/`authReadGroup` mounting (verified
in RESEARCH, not re-read here since RESEARCH already confirms it directly)
**Apply to:** `/analytics/macro` route — mount inside the same router group as
`/analytics/cot`, do not add new middleware.

### React Query hook shape (401-aware, non-retryable)
**Source:** `apps/web/src/hooks/useCot.ts` (full file)
**Apply to:** `useMacro.ts` — identical `UnauthorizedError` + `retry` callback shape.

## No Analog Found

None — every file in this phase has a direct, strong analog via the Phase 13 COT
vertical slice (as RESEARCH itself notes: "the entire design is a direct extension of
two already-shipped, tested vertical slices").

## Metadata

**Analog search scope:** `packages/core/src/journal/application/`,
`packages/adapters/src/{http,postgres/repos,postgres/migrations,memory,__contract__}/`,
`packages/contracts/src/`, `apps/worker/src/{handlers,schedule.ts}`,
`apps/server/src/adapters/{http,mcp}/`, `apps/web/src/{hooks,components,screens}/`
**Files scanned:** ~20 (COT vertical: migration, schema, ports, fetchCot, getCot, repo,
memory twin, contract test, contract, handler, schedule, route, MCP tools/server,
useCot, CotCard; plus fred.ts, cboe.ts, rateObservations schema, fetch-rates.ts,
Overview.tsx stub)
**Pattern extraction date:** 2026-07-01

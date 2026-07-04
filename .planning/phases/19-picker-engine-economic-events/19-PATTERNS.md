# Phase 19: Picker Engine + Economic Events - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 24 (new/modified)
**Analogs found:** 24 / 24 (all have strong analogs — this phase is disciplined porting, not invention)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/picker/domain/fwd-iv.ts` | utility (domain fn) | transform | `mockups/playground-v4.html` `fwdIV()` (lines 238-241) + `packages/core/src/journal/domain/iv-inversion.ts` (guard-result shape) | exact (logic) / role-match (Result-typing convention) |
| `packages/core/src/picker/domain/scoring.ts` | service (domain) | transform | `mockups/playground-v4.html` `buildCandidates()` score formula (267-271); `packages/core/src/analytics/domain/gex.ts` (pure fn domain-layer precedent) | exact |
| `packages/core/src/picker/domain/candidate-selection.ts` | service (domain) | transform | `packages/core/src/analytics/application/computeGexSnapshot.ts` steps 4-6 (spot-grid/strike iteration pattern); mockup's strike/expiry filters | role-match |
| `packages/core/src/picker/application/ports.ts` | model (ports/types) | — | `packages/core/src/analytics/application/ports.ts` | exact |
| `packages/core/src/picker/application/computePickerSnapshot.ts` | service (use-case) | CRUD (read-compute-persist) | `packages/core/src/analytics/application/computeGexSnapshot.ts` | exact |
| `packages/core/src/picker/application/getPicker.ts` | service (use-case) | CRUD (read) | `packages/core/src/analytics/application/getGex.ts` | exact |
| `packages/adapters/src/http/economic-events.ts` | service (HTTP adapter) | request-response (external fetch) | `packages/adapters/src/http/fred.ts` (`makeFredSeriesAdapter`) | exact |
| `packages/adapters/src/memory/economic-events.ts` | model (in-memory twin) | CRUD | `packages/adapters/src/memory/macro-observations.ts` | exact |
| `packages/adapters/src/memory/picker-snapshot.ts` | model (in-memory twin) | CRUD (append) | `packages/adapters/src/memory/macro-observations.ts` (adapt: Map keyed on cycleTime, append not upsert) | role-match |
| `packages/adapters/src/postgres/migrations/00XX_economic_events.sql` | migration | batch/DDL | `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` | exact |
| `packages/adapters/src/postgres/migrations/00XX_picker_snapshot.sql` | migration | batch/DDL | `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` (adapt: JSONB blob column + append-only, no composite update key) | role-match |
| `packages/adapters/src/postgres/repos/economic-events.ts` | model (Postgres repo) | CRUD | `packages/adapters/src/postgres/repos/macro-observations.ts` | exact |
| `packages/adapters/src/postgres/repos/picker-snapshot.ts` | model (Postgres repo) | CRUD (insert + read-latest) | `packages/adapters/src/postgres/repos/macro-observations.ts` (adapt: `insert` not `onConflictDoUpdate`; `readLatest` via `ORDER BY observed_at DESC LIMIT 1`) | role-match |
| `packages/adapters/src/http/economic-events.test.ts` | test (msw) | request-response | `packages/adapters/src/http/fred.test.ts` | exact |
| `packages/adapters/src/postgres/repos/economic-events.contract.test.ts` | test (testcontainers) | CRUD | `packages/adapters/src/postgres/repos/macro-observations.contract.test.ts` | exact |
| `packages/adapters/src/postgres/repos/picker-snapshot.contract.test.ts` | test (testcontainers) | CRUD (append) | `packages/adapters/src/postgres/repos/macro-observations.contract.test.ts` | role-match |
| `packages/adapters/src/__contract__/economic-events.contract.ts` | test (shared contract suite) | CRUD | `packages/adapters/src/__contract__/macro-observations.contract.ts` | exact |
| `apps/server/src/adapters/http/picker.routes.ts` | route/controller | request-response | `apps/server/src/adapters/http/gex.routes.ts` | exact |
| `apps/server/src/adapters/mcp/tools.ts` (+`get_picker_candidates`) | controller (MCP tool) | request-response | same file, `registerGetGexTool` (lines 480-547) | exact |
| `apps/worker/src/schedule.ts` (+`compute-picker`, +`fetch-economic-events`) | config (job wiring) | event-driven | same file — `compute-gex-snapshot` (chain-triggered, no cron) + `fetch-cot` (weekly cron) registrations | exact |
| `packages/contracts/src/picker.ts` (edit: +`source`, +context-status fields) | model (Zod contract) | transform | itself (additive edit) — pattern: RESEARCH.md Pattern 4 shows the exact diff | exact |
| `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` | test fixture | — | itself (edit to satisfy new required fields) | exact |
| `apps/web/src/hooks/usePicker.ts` | hook | request-response | `apps/web/src/hooks/useCot.ts` | exact |
| `apps/web/src/screens/Analyzer.tsx` (fixture→live swap) | component | request-response | itself + `useCot`/`useMacro` consumption pattern elsewhere in web screens | role-match |

## Pattern Assignments

### `packages/core/src/picker/domain/fwd-iv.ts` (domain utility, transform)

**Analog:** `mockups/playground-v4.html` lines 238-241 (logic) + `packages/core/src/journal/domain/iv-inversion.ts` (Result/guard typing convention)

**Core pattern to port** (mockup, verbatim math — do not "fix" `rad>0` to `>=0`):
```javascript
function fwdIV(tf,ivf,tb,ivb){ // criterion 1 — forward variance identity, T in DTE
  const rad=(tb*ivb*ivb - tf*ivf*ivf)/(tb-tf);
  return rad>0?Math.sqrt(rad):null; // guard: inverted structure
}
```

**Guard-typing convention to copy** (`iv-inversion.ts` lines 27-45):
```typescript
const VEGA_THRESHOLD = 1e-8; const MAX_ITER = 50; const NR_TOL = 1e-10;
export type IvError =
  | { readonly kind: "expired" }
  | { readonly kind: "below-intrinsic" }
  | { readonly kind: "above-bound" };
```
Port `fwdIV` as `computeFwdIv(tf, ivf, tb, ivb): { fwdIv: number; guard: "ok" } | { fwdIv: null; guard: "inverted" }` — this literal-tagged-union shape (not `IvError`, since there's only one guard case) matches `pickerCandidate.fwdIv`/`fwdIvGuard` already frozen in `packages/contracts/src/picker.ts` (lines 85-87). No I/O, imports only `@morai/shared` per hexagon law.

---

### `packages/core/src/picker/domain/scoring.ts` (domain service, transform)

**Analog:** `mockups/playground-v4.html` lines 267-271 (score weights, D-08 verbatim) + `packages/core/src/analytics/domain/gex.ts` (pure-domain-function-in-`domain/` precedent, not read here but same directory shape as `fwd-iv.ts`/`scoring.ts` siblings)

**Score formula to port as named constants** (mockup, D-08 — document as "not empirically calibrated"):
```javascript
const s = 40*Math.min(1,Math.max(0,slope/0.6))
        + 25*Math.min(1,Math.max(0,(fwdEdge+0.02)/0.04))
        + 15*gexFit
        + 10*Math.max(0,1-evtPenalty)
        + 10*Math.min(1,(K===7500?1:0.7));   // D-09: REPLACE with real beVsEm ratio
```
Weight/breakdown must produce `BreakdownEntry[]` matching the closed enum `z.enum(["slope","fwdEdge","gexFit","eventAdjustment","beVsEm"])` from `packages/contracts/src/picker.ts` lines 33-41 — never emit a REFUTED-criteria label.

**BE-vs-EM replacement (D-09) — numeric-solve pattern to copy** (`iv-inversion.ts` lines 1-32, Newton+bisection-with-guard shape): implement `findBreakevens(candidate): ReadonlyArray<number>` via bisection over the payoff-at-front-expiry function, mirroring `BISECT_LO/BISECT_HI/BISECT_STEPS` constants and hard-iteration-cap discipline — never an ad-hoc closed form.

---

### `packages/core/src/picker/domain/candidate-selection.ts` (domain service, transform)

**Analog:** `packages/core/src/analytics/application/computeGexSnapshot.ts` (grid/strike-iteration shape, lines 30-62) + mockup's DTE filters

**Strike-unit conversion boundary — copy this discipline** (`ports.ts` line 191-192 comment + Pitfall 1 in RESEARCH.md):
```typescript
// LegObsForGex.strike is ×1000 int (e.g. 7400000 = 7400).
// Convert ONCE at the candidate-selection boundary — domain never sees ×1000 form.
```

**DTE filter defaults to reuse from the mockup** (already-approved default grid, per Open Question 2):
```javascript
dte(fe) >= 21 && dte(fe) <= 36              // front DTE window
dte(be) - dte(fe) >= 21 && dte(be) <= 80     // back DTE beyond front
```

**Dedupe key — Pitfall 5 (must NOT reuse mockup's `K + "-" + fe` key)**: key on `(deltaRung, frontExpiry)` since strikes move run-to-run once delta-targeted.

---

### `packages/core/src/picker/application/ports.ts` (ports/types)

**Analog:** `packages/core/src/analytics/application/ports.ts` (verbatim structural template)

**Header convention to copy** (lines 1-14):
```typescript
// Picker bounded context — driven ports + row domain types.
// Hexagon law (architecture-boundaries §2): this file imports ONLY @morai/shared. No drizzle,
// no node builtins, no other context's domain.
import type { Result } from "@morai/shared";
export type StorageError = { readonly kind: "storage-error"; readonly message: string };
```

**Port-naming convention (`ForVerbingNoun`) — copy exactly from GEX's port set** (lines 236-267):
```typescript
export type ForReadingLegObsForGex = () => Promise<Result<ReadonlyArray<LegObsForGex>, StorageError>>;
export type ForReadingGexSnapshot = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
export type ForPersistingGexSnapshot = (row: GexSnapshotRow) => Promise<Result<void, StorageError>>;
export type ForRunningComputeGexSnapshot = () => Promise<Result<void, StorageError>>;
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
```
Picker needs the analogous set: `ForReadingChainForPicker` (reuse `LegObsForGex` shape), `ForReadingGexContext` (reuse existing `ForReadingGexSnapshot` — don't rebuild GEX read), `ForReadingEconomicEvents`, `ForPersistingPickerSnapshot`, `ForReadingPickerSnapshot` (latest-only), `ForRunningComputePicker`, `ForRunningGetPicker`.

---

### `packages/core/src/picker/application/getPicker.ts` (use-case, CRUD read)

**Analog:** `packages/core/src/analytics/application/getGex.ts` (copy near-verbatim)

**Full pattern to copy** (entire file, 29 lines):
```typescript
import type { ForReadingGexSnapshot, GexSnapshotRow, StorageError } from "./ports.ts";
import type { Result } from "@morai/shared";

export type GetGexDeps = { readonly readGexSnapshot: ForReadingGexSnapshot };
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;
export function makeGetGexUseCase(deps: GetGexDeps): ForRunningGetGex {
  return () => deps.readGexSnapshot();
}
```
`getPicker.ts` = rename `GexSnapshotRow`→`PickerSnapshotRow`, `readGexSnapshot`→`readPickerSnapshot`. Zero business logic — thin forwarder, per the file's own doc comment ("GEX is NEVER recomputed on read").

---

### `packages/core/src/picker/application/computePickerSnapshot.ts` (use-case, CRUD read-compute-persist)

**Analog:** `packages/core/src/analytics/application/computeGexSnapshot.ts` (structural template — read→guard-empty→compute→persist)

**Step shape to copy** (lines 76-193 overall structure — deps type, ok(undefined) on empty read, persist-then-return):
```typescript
export type ComputeGexSnapshotDeps = {
  readonly readLegObsForGex: ForReadingLegObsForGex;
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  readonly now: () => Date; // clock injection — bounds resolution ONLY, never persisted as cycleTime
};
export function makeComputeGexSnapshotUseCase(deps): () => Promise<Result<void, StorageError>> {
  return async () => {
    const readResult = await deps.readLegObsForGex();
    if (!readResult.ok) return err(readResult.error);
    const legs = readResult.value;
    if (legs.length === 0) return ok(undefined); // empty cohort → no row, no crash
    // ... compute ...
    const persistResult = await deps.persistGexSnapshot(row);
    if (!persistResult.ok) return err(persistResult.error);
    return ok(undefined);
  };
}
```
`computePickerSnapshot` deps add `readGexSnapshot` (existing `ForReadingGexSnapshot`, reuse) + `readEconomicEvents` (new) alongside `readLegObsForGex`/chain read; D-17's `gexContextStatus`/`eventsContextStatus` tagging is an additional step inserted before persist, using the same "never silent, tag stale/missing, contribute 0" idiom the fwdIv guard already establishes.

---

### `packages/adapters/src/http/economic-events.ts` (HTTP adapter, request-response)

**Analog:** `packages/adapters/src/http/fred.ts` `makeFredSeriesAdapter` (lines 134-178) — the no-fallback variant is the correct template (D-17 wants an honest `err`, not a fabricated fallback, mirroring `makeFredRateAdapter`'s opposite choice)

**Full pattern to copy:**
```typescript
const FredResponseSchema = z.object({ /* new: release_dates shape, NOT series/observations shape — see Pitfall 4 */ });

export function makeFredSeriesAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly apiKey: string | undefined;
}): ForFetchingFredSeries {
  return async (seriesId) => {
    if (deps.apiKey === undefined || deps.apiKey === "") {
      console.warn("FRED: missing API key, cannot fetch series"); // never log the key itself
      return err({ kind: "fetch-error", message: "FRED API key missing" });
    }
    // fetch → response.ok guard → Zod safeParse → map or err
  };
}
```
**Note (Pitfall 4):** `release/dates` returns `{release_dates: [{release_id, release_name?, date}]}`, a DIFFERENT shape than `series/observations`'s `{observations: [{date,value}]}` — do NOT reuse `FredResponseSchema` verbatim; write a new schema. Union FRED CPI/NFP rows with the FOMC seed rows inside this one adapter — never expose two read paths (Anti-Pattern in RESEARCH.md).

**Static-warn-never-log-key discipline to copy exactly:**
```typescript
console.warn(`FRED: ${result.reason}, no fallback for series fetch`); // apiKey value NEVER interpolated
```

---

### `packages/adapters/src/memory/economic-events.ts` / `picker-snapshot.ts` (in-memory twins, CRUD)

**Analog:** `packages/adapters/src/memory/macro-observations.ts` (full file, 51 lines — copy shape verbatim)

**Pattern:**
```typescript
export function makeMemoryMacroObservationsRepo(): MemoryMacroObservationsRepo {
  const store = new Map<string, MacroObservationRow>();
  const keyOf = (row) => `${row.date}|${row.seriesId}`;
  const insertMacroObservation: ForPersistingMacroObservation = async (row) => {
    store.set(keyOf(row), row); // onConflictDoUpdate: replace
    return ok(undefined);
  };
  const readMacroObservations: ForReadingMacroObservations = async () => ok([...store.values()]);
  return { insertMacroObservation, readMacroObservations };
}
```
`economic-events` memory twin: key on `(event_date, event_name)` composite, replace-on-conflict (matches D-13's Postgres composite PK). `picker-snapshot` memory twin: **append-only** (D-06 keeps history) — push to an array instead of `Map.set`, and add a `readLatest` that returns the array's last/max-`observedAt` element, `null` when empty (mirrors `ForReadingGexSnapshot`'s `ok(null)` no-snapshot case).

---

### `packages/adapters/src/postgres/migrations/00XX_economic_events.sql` / `00XX_picker_snapshot.sql` (migration, DDL)

**Analog:** `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` (full file, 8 lines)

**Full template to copy:**
```sql
CREATE TABLE "macro_observations" (
	"date" date NOT NULL,
	"series_id" text NOT NULL,
	"value" numeric NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "macro_observations_date_series_id_pk" PRIMARY KEY("date","series_id")
);
--> statement-breakpoint
ALTER TABLE "macro_observations" ENABLE ROW LEVEL SECURITY;
```
`economic_events`: `event_date date NOT NULL` (plain `date`, NEVER `timestamptz` — Pitfall 3), `event_name text NOT NULL`, `source text NOT NULL` (`fred`|`seed`), composite PK `(event_date, event_name)`, RLS enabled. `picker_snapshot`: `observed_at timestamptz NOT NULL` (this one IS an instant, not a calendar day), `snapshot jsonb NOT NULL` (D-05 whole-blob), primary key or unique index on `observed_at`, RLS enabled — append-only (no upsert conflict target needed beyond a uniqueness guard against exact-duplicate `observed_at`).

---

### `packages/adapters/src/postgres/repos/economic-events.ts` / `picker-snapshot.ts` (Postgres repo, CRUD)

**Analog:** `packages/adapters/src/postgres/repos/macro-observations.ts` (full file, 79 lines)

**Pattern to copy (insert + typed read, try/catch → StorageError):**
```typescript
const insertMacroObservation: ForPersistingMacroObservation = async (row) => {
  try {
    await db.insert(macroObservations).values({...}).onConflictDoUpdate({
      target: [macroObservations.date, macroObservations.seriesId],
      set: { value: String(row.value), source: row.source },
    });
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err<StorageError>({ kind: "storage-error", message });
  }
};
const readMacroObservations: ForReadingMacroObservations = async () => {
  try {
    const rows = await db.select().from(macroObservations);
    return ok(rows.map((r) => ({ /* typed narrow, e.g. source enum narrowing */ })));
  } catch (e) { /* same catch shape */ }
};
```
`economic-events` repo: same `onConflictDoUpdate` shape (FRED re-publishes with the same date/name — idempotent upsert). `picker-snapshot` repo: `insert` (no `onConflictDoUpdate` — D-06 append-history) + `readLatest` via `db.select().from(pickerSnapshot).orderBy(desc(pickerSnapshot.observedAt)).limit(1)`, returning `ok(rows[0] ?? null)`.

---

### `packages/adapters/src/postgres/repos/*.contract.test.ts` (testcontainers)

**Analog:** `packages/adapters/src/postgres/repos/macro-observations.contract.test.ts` (full file, 47 lines)

**Full pattern to copy:**
```typescript
const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;
describe.skipIf(shouldSkip)("postgres X adapter", () => {
  let db: ReturnType<typeof makeDb>;
  beforeAll(async () => { if (!dbUrl) return; db = makeDb(dbUrl); }); // migrations run in globalSetup
  beforeEach(async () => { if (!db) return; await db.delete(tableX); }); // truncate for isolation
  runXContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresXRepo(db);
    return { insertX: repo.insertX, readX: repo.readX };
  });
});
```
Requires a matching `packages/adapters/src/__contract__/economic-events.contract.ts` shared-suite file (analog: `macro-observations.contract.ts`, not read this session but same shape — a `runXContractTests(makeAdapter)` function exercising both memory and postgres implementations identically).

---

### `apps/server/src/adapters/http/picker.routes.ts` (route, request-response)

**Analog:** `apps/server/src/adapters/http/gex.routes.ts` (full file, 62 lines — copy near-verbatim)

**Full pattern to copy:**
```typescript
import { Hono } from "hono";
import { gexSnapshotResponse } from "@morai/contracts";
import type { ForRunningGetGex } from "@morai/core";

export function gexRoutes(getGex: ForRunningGetGex) {
  const router = new Hono();
  router.get("/gex", async (c) => {
    const result = await getGex();
    if (!result.ok) return c.json({ error: "internal" }, 500);
    if (result.value === null) return c.json({ error: "no-snapshot" }, 404);
    const row = result.value;
    return c.json(gexSnapshotResponse.parse({ /* map row → contract shape, Date→ISOString */ }));
  });
  return router;
}
```
`pickerRoutes(getPicker: ForRunningGetPicker)` mounts `GET /picker/candidates` (effective `GET /api/picker/candidates` per main.ts's `apiRouter.route(...)` convention). Since D-05 stores the whole `pickerSnapshotResponse` as one JSONB blob, the row→contract mapping here is likely a direct `pickerSnapshotResponse.parse(row.snapshot)` rather than gex's field-by-field reassembly.

---

### `apps/server/src/adapters/mcp/tools.ts` (+`get_picker_candidates`)

**Analog:** same file, `registerGetGexTool` (lines 480-547)

**Full pattern to copy:**
```typescript
export function registerGetGexTool(server: McpServer, getGex: ForRunningGetGex): void {
  server.registerTool(
    "get_gex",
    { title: "Get GEX", description: "...", inputSchema: {} },
    async () => {
      const result = await getGex();
      if (!result.ok) return { content: [{ type: "text" as const, text: "internal error" }] };
      if (result.value === null) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "no-snapshot" }) }] };
      }
      const payload = gexSnapshotResponse.parse({ /* same mapping as the HTTP route */ });
      return { content: [{ type: "text" as const, text: JSON.stringify(payload) }] };
    },
  );
}
```
`registerGetPickerCandidatesTool` mirrors this exactly (MCP-02: same schema as the HTTP route, no trimmed-summary variant per CONTEXT.md's discretion note). No input parameters (reads latest snapshot only, same as `get_gex`).

---

### `apps/worker/src/schedule.ts` (+`compute-picker`, +`fetch-economic-events`)

**Analog:** same file — `compute-gex-snapshot` (chain-triggered, D-04 precedent) + `fetch-cot` (weekly cron, D-14 precedent)

**Chain-triggered registration (no schedule call) — copy the queue-creation + comment discipline:**
```typescript
await boss.createQueue("compute-gex-snapshot"); // chain-triggered by compute-analytics; no cron (D-01)
// ... later, in Phase 3:
await boss.work("compute-gex-snapshot", POLLING_INTERVAL, handlers.computeGexSnapshot);
```
`compute-picker`: same shape, `createQueue("compute-picker")` + `work(...)`, NO `schedule()` call — comment: `// chain-triggered by compute-gex-snapshot; no cron (D-04)`.

**Weekly cron registration — copy exactly from `fetch-cot`:**
```typescript
await boss.createQueue("fetch-cot");
await boss.schedule(
  "fetch-cot",
  "0 17 * * 5", // weekly Friday 17:00 ET (after market close, D-07)
  null,
  { tz: "America/New_York" },
);
await boss.work("fetch-cot", POLLING_INTERVAL, handlers.fetchCot);
```
`fetch-economic-events`: identical cron string/tz (D-14 default), own queue name, own handler. **CR-01 warning to heed** (already documented in this file, lines 103-109): if ever scheduling twice with different times, distinct `key` values are required or the second call silently overwrites the first.

**`AllHandlers` type + `registerAllJobs` signature** — add `computePicker: PgBossHandler` and `fetchEconomicEvents: PgBossHandler` fields, following the existing 10-handler pattern (lines 55-66).

---

### `packages/contracts/src/picker.ts` (additive edit — +`source`, +context-status)

**Analog:** itself; pattern already spelled out in RESEARCH.md Pattern 4 (verified against the actual file read this session, lines 156-164)

**Current shape to edit (verbatim, lines 156-164):**
```typescript
export const pickerSnapshotResponse = z.object({
  asOf: z.string(),
  spot: z.number(),
  termStructure: z.array(termStructurePoint),
  gex: pickerGexContext,
  events: z.array(pickerEvent),
  candidates: z.array(pickerCandidate),
});
```
**Additive fields to insert** (D-15/D-17 — insert after `spot`, before `termStructure`, matching RESEARCH.md's suggested ordering):
```typescript
source: z.enum(["schwab", "cboe"]),
gexContextStatus: z.enum(["ok", "stale", "missing"]),
eventsContextStatus: z.enum(["ok", "stale", "missing"]),
```
Update `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` in the same PR to supply these newly-required fields (Analyzer.tsx's existing fixture import would otherwise fail typecheck — the project's own documented "one-sided field rename fails typecheck" discipline, referenced in `picker.ts`'s own header comment).

---

### `apps/web/src/hooks/usePicker.ts` (react-query hook)

**Analog:** `apps/web/src/hooks/useCot.ts` (full file, 45 lines — copy near-verbatim)

**Full pattern to copy:**
```typescript
import { useQuery } from "@tanstack/react-query";
import { cotResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super("UNAUTHORIZED"); this.name = "UnauthorizedError"; }
}

export function useCot() {
  return useQuery({
    queryKey: ["cot"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/cot");
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error(`GET /api/analytics/cot failed: ${res.status}`);
      return cotResponse.parse(await res.json());
    },
    refetchInterval: 3_600_000,
    staleTime: 1_800_000,
    retry: (failureCount, error) => (error instanceof UnauthorizedError ? false : failureCount < 3),
  });
}
```
`usePicker`: swap `cotResponse`/`/api/analytics/cot` → `pickerSnapshotResponse`/`/api/picker/candidates`, own `queryKey: ["picker"]`. D-19/RESEARCH.md recommends a shorter `staleTime` than COT's hourly one (picker updates ~13×/day RTH via chain trigger — e.g. match the ~30-min chain cadence) — exact tuning is planner's discretion, but the 401/retry/error-shape scaffold is copied verbatim.

---

### `apps/web/src/screens/Analyzer.tsx` (fixture→live swap)

**Analog:** itself (currently imports `pickerSnapshotFixture` synchronously) + the `useCot`/`useMacro` consumption idiom used elsewhere in `apps/web/src/screens/`

**Pattern:** swap the synchronous fixture import for `const { data, isLoading, isError } = usePicker();` and add the branches D-18/D-19 require:
- loading → skeleton in the ranked rail (mirror whatever loading-skeleton idiom `useCot`'s screen consumer already uses)
- error → error card + retry (react-query's `refetch` from the hook result)
- cold-start (`data.candidates.length === 0` on a fresh/never-computed 404) → `"Picker warming up — first scoring run pending."` (D-18)
- zero-candidates-after-filter (200 response, empty `candidates` array) → `"No put calendars meet net-θ>0 over the {asOf} snapshot."` (D-18)
- per-card: render `data.asOf` + `data.source` on every candidate card (D-16 — repeated per card, not a single header chip)

## Shared Patterns

### Result<T, StorageError> / Zod parse-don't-cast at every boundary
**Source:** `packages/core/src/analytics/application/ports.ts` (StorageError type), `packages/adapters/src/postgres/repos/macro-observations.ts` (try/catch → err mapping)
**Apply to:** every new port, use-case, and repo file in this phase — no exceptions, no `any`/`as`/`!` (typescript.md rule).
```typescript
export type StorageError = { readonly kind: "storage-error"; readonly message: string };
try { /* db op */ return ok(...); }
catch (e) { const message = e instanceof Error ? e.message : String(e); return err<StorageError>({ kind: "storage-error", message }); }
```

### Never-silent guard-tagging (fwdIvGuard precedent, extended by D-17)
**Source:** `packages/contracts/src/picker.ts` lines 85-87 (`fwdIv`/`fwdIvGuard`), extended per D-17 to `gexContextStatus`/`eventsContextStatus`
**Apply to:** `computePickerSnapshot.ts` (the use-case tags status + zeroes the affected term), `scoring.ts` (never fabricates a clean score), Analyzer.tsx (shows "unavailable" text, never a silently-missing term).

### Precompute-then-read (chain-triggered job, thin readers)
**Source:** `packages/core/src/analytics/application/computeGexSnapshot.ts` + `getGex.ts` + `apps/server/src/adapters/http/gex.routes.ts`
**Apply to:** `computePickerSnapshot.ts`/`getPicker.ts`/`picker.routes.ts`/`get_picker_candidates` MCP tool — routes and MCP NEVER recompute, only read the latest persisted row.

### Static-warn-text-only logging (never log secrets)
**Source:** `packages/adapters/src/http/fred.ts` lines 125, 166 (`console.warn(\`FRED: ${result.reason}...\`)`, apiKey never interpolated)
**Apply to:** `packages/adapters/src/http/economic-events.ts` — identical discipline for `FRED_API_KEY`.

### MCP-02 one-schema discipline
**Source:** `apps/server/src/adapters/mcp/tools.ts` `registerGetGexTool` + `apps/server/src/adapters/http/gex.routes.ts` (both parse through `gexSnapshotResponse`)
**Apply to:** `picker.routes.ts` + `registerGetPickerCandidatesTool` — both parse through the SAME `pickerSnapshotResponse`, no second inline schema, no trimmed-text-summary MCP variant.

### pg-boss idempotent registration (createQueue → schedule → work order)
**Source:** `apps/worker/src/schedule.ts` full file
**Apply to:** `compute-picker` (createQueue + work only, no schedule — chain-triggered) and `fetch-economic-events` (createQueue + schedule + work — weekly cron). CR-01 constraint: createQueue must precede schedule/work for ALL queues.

## No Analog Found

None — every file in this phase has a strong existing analog in the repo (see table above). This phase is explicitly scoped by CONTEXT.md/RESEARCH.md as "disciplined porting, not invention" (D-07 mockup port, D-13 macro_observations trio, D-04/D-19 precompute-then-read + hook mirrors).

## Metadata

**Analog search scope:** `packages/core/src/analytics/`, `packages/core/src/journal/domain/`, `packages/adapters/src/{http,memory,postgres}/`, `apps/{server,worker,web}/src/`, `packages/contracts/src/picker.ts`, `mockups/playground-v4.html`
**Files scanned/read directly this session:** `getGex.ts`, `computeGexSnapshot.ts`, `ports.ts` (analytics), `gex.routes.ts`, `useCot.ts`, `fred.ts`, `memory/macro-observations.ts`, `postgres/repos/macro-observations.ts`, `0013_macro_observations.sql`, `schedule.ts`, `picker.ts` (contract), `tools.ts` (get_gex tool section), `iv-inversion.ts`, `macro-observations.contract.test.ts`
**Pattern extraction date:** 2026-07-04

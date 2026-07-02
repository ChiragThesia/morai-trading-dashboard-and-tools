---
phase: 14-fred-expansion
reviewed: 2026-07-02T03:08:16Z
depth: standard
files_reviewed: 43
files_reviewed_list:
  - apps/server/src/adapters/http/analytics.routes.test.ts
  - apps/server/src/adapters/http/analytics.routes.ts
  - apps/server/src/adapters/mcp/mcp.test.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/main.ts
  - apps/web/src/components/MacroCard.test.tsx
  - apps/web/src/components/MacroCard.tsx
  - apps/web/src/hooks/useMacro.test.ts
  - apps/web/src/hooks/useMacro.ts
  - apps/web/src/screens/Overview.test.tsx
  - apps/web/src/screens/Overview.tsx
  - apps/worker/src/handlers/fetch-rates.test.ts
  - apps/worker/src/handlers/fetch-rates.ts
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.test.ts
  - apps/worker/src/schedule.ts
  - docs/architecture/data-model.md
  - docs/architecture/jobs.md
  - packages/adapters/src/__contract__/macro-observations.contract.ts
  - packages/adapters/src/http/cboe-vvix.test.ts
  - packages/adapters/src/http/cboe-vvix.ts
  - packages/adapters/src/http/fred.test.ts
  - packages/adapters/src/http/fred.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/macro-observations.contract.test.ts
  - packages/adapters/src/memory/macro-observations.ts
  - packages/adapters/src/postgres/migrations/0013_macro_observations.sql
  - packages/adapters/src/postgres/migrations/meta/_journal.json
  - packages/adapters/src/postgres/migrations/meta/0013_snapshot.json
  - packages/adapters/src/postgres/repos/macro-observations.contract.test.ts
  - packages/adapters/src/postgres/repos/macro-observations.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/macro.test.ts
  - packages/contracts/src/macro.ts
  - packages/core/src/index.ts
  - packages/core/src/journal/application/fetchMacroSeries.test.ts
  - packages/core/src/journal/application/fetchMacroSeries.ts
  - packages/core/src/journal/application/getMacro.test.ts
  - packages/core/src/journal/application/getMacro.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/index.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-07-02T03:08:16Z
**Depth:** standard
**Files Reviewed:** 43
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

Phase 14 (FRED macro expansion) is well-layered: the hexagonal boundaries hold (core imports
only shared; adapters implement ports; routes/MCP tools are thin Zod-parse → use-case →
contract-parse shells), the locked decisions are respected in the adapter code (D-02 DGS3MO
path untouched, D-09 no-fallback with hard-fail on missing key, D-14 raw units, D-07
per-series isolation with fail-loud finish), and test coverage is broad (msw at the network
layer, testcontainers contract tests, MCP handler extraction tests).

One BLOCKER survives all of that: the D-06 "fetch-rates twice daily" requirement is silently
broken in production. pg-boss v12 upserts schedules on `(name, key)` with `key` defaulting to
`''`, so the second `boss.schedule("fetch-rates", ...)` call **overwrites** the first — only
the 18:30 ET run will ever fire. The schedule test passes because its fake records calls
instead of modeling pg-boss's upsert semantics — the exact "green suite hides prod bug"
failure mode this project has hit twice before (Phase 5/6 lessons).

Three warnings follow: a docs-vs-code contradiction on gap self-healing (jobs.md claims
`max(date)+1` backfill that does not exist), a VVIX date-labeling edge that mislabels the
trading day on late-evening manual runs, and two new driven fetch ports shipped without
their in-memory twins (architecture-boundaries §8).

## Critical Issues

### CR-01: Second `fetch-rates` schedule silently overwrites the first — the 09:00 ET run never fires

**File:** `apps/worker/src/schedule.ts:98-112`
**Issue:** pg-boss v12 stores schedules keyed by `(name, key)` and `schedule()` is an upsert.
Verified against the installed `pg-boss@12.18.3`:

- `dist/timekeeper.js:165` — `const { tz = 'UTC', key = '', ...rest } = options;` (key defaults to `''`)
- `dist/plans.js:610-612` — `INSERT INTO ${schema}.schedule (name, key, cron, ...) ON CONFLICT (name, key) DO UPDATE SET ...`

Both `boss.schedule("fetch-rates", ...)` calls in `registerAllJobs` pass `{ tz: "America/New_York" }`
with no `key`, so both target the row `("fetch-rates", '')`. The second call (line 107,
`"30 18 * * 1-5"`) overwrites the first (line 98, `"0 9 * * 1-5"`). Net effect in production:

- **fetch-rates runs once daily at 18:30 ET, not twice** — D-06 is not delivered.
- The morning run whose stated purpose is "catches SOFR's T+1 lag" (line 100) never happens;
  SOFR (and the BSM DGS3MO rate refresh) is fetched only after market close.
- `docs/architecture/jobs.md` now documents "TWO daily runs" that do not exist.
- Every worker boot re-runs `registerAllJobs`, so the overwrite is deterministic — the last
  `schedule()` call always wins.

`schedule.test.ts:94-115` asserts two `schedule()` calls were *made*, but the fake boss
appends to an array instead of upserting by `(name, key)` — it cannot catch this. The test
is green while the behavior is wrong.

**Fix:** Give each cron a distinct schedule key and widen the `JobScheduler` type to carry it:

```ts
// schedule.ts — JobScheduler
schedule(name: string, cron: string, data: null, opts: { tz: string; key?: string }): Promise<unknown>;

// registerAllJobs
await boss.schedule("fetch-rates", "0 9 * * 1-5", null, { tz: "America/New_York", key: "morning" });
await boss.schedule("fetch-rates", "30 18 * * 1-5", null, { tz: "America/New_York", key: "evening" });
```

Note: the existing keyless `("fetch-rates", '')` row in the prod pgboss schema will remain
after the fix and still fire at whatever cron it last held — either `unschedule("fetch-rates")`
(keyless) once at boot before re-scheduling, or clean the row manually at deploy. Update
`schedule.test.ts` so the fake boss keys its store by `(name, key)` (mirroring the upsert)
and asserts TWO surviving schedules — that makes the regression test actually able to fail.

## Warnings

### WR-01: jobs.md documents gap self-healing (`max(date)+1` backfill) that the code does not implement

**File:** `docs/architecture/jobs.md` (fetch-rates section, added this phase); `packages/adapters/src/http/fred.ts:46-88`
**Issue:** The new doc section states: "The next run (twice-daily cadence) self-heals any gap
by fetching from `max(date)+1` per series (D-05)." The implementation does nothing of the
kind: `fetchFredSeries` requests `limit=5, sort_order=desc` and persists exactly ONE row per
series per run (the most recent non-`'.'` observation). If the worker or FRED is down for N
days — which has actually happened in this project (worker down 06-26→07-01) — the missed
daily observations are never backfilled; `macro_observations` acquires permanent holes that
the 90-day macro chart silently renders around. The upsert (D-05) makes re-runs *idempotent*,
not *gap-healing*. Per the workflow rule ("code that contradicts docs is a bug in one of
them — reconcile"), one side must change.
**Fix:** Either (a) correct jobs.md to state that each run persists only the latest
observation per series and gaps from missed runs are not backfilled, or (b) implement the
documented behavior: read `max(date)` per series from the repo and fetch FRED with
`observation_start=max(date)+1` (drop `limit=5`), persisting every returned non-`'.'` row.
(b) matches the doc's D-05 claim and closes the data-hole risk; (a) is the minimal honest fix.

### WR-02: VVIX observation is labeled with the UTC calendar day — late-evening ET runs store it under the wrong (next) date

**File:** `packages/adapters/src/http/cboe-vvix.ts:86-96`
**Issue:** `date` is derived as `observedAt.toISOString().slice(0, 10)` from the CBOE UTC
timestamp. Between 20:00 ET and midnight ET the UTC calendar day is already *tomorrow*, so a
fetch in that window stores the July-1 session's VVIX under `date = 2026-07-02`. The test
fixture enshrines exactly this: `cboe-vvix.test.ts:53-54` asserts timestamp
`"2026-07-02 01:00:55"` (= 21:00 ET July 1, July-1 session data) → `date: "2026-07-02"`.
The scheduled runs (09:00 / 18:30 ET) are safe, but manual `trigger_job` runs are a
first-class path here — the MacroCard empty state literally instructs "run the job to
populate". A night-time manual run makes VVIX the only series carrying a future-dated point:
MacroCard shows it as "latest", the `days` window treats it as a day newer than it is, and it
sits inconsistently beside the FRED series, which are dated by FRED's own observation date.
(The next real evening run self-corrects that date's value via upsert, but the mislabel is
live until then, and the prior actual trading day's slot stays empty.)
**Fix:** Derive the date from the timestamp in `America/New_York` rather than UTC, e.g.:

```ts
const etDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
}).format(observedAt); // "YYYY-MM-DD"
```

and update the test fixture so `"2026-07-02 01:00:55"` UTC maps to `"2026-07-01"`.

### WR-03: New driven fetch ports shipped without in-memory twins (architecture-boundaries §8)

**File:** `packages/adapters/src/memory/` (missing files); `packages/core/src/journal/application/ports.ts:618-627`
**Issue:** Phase 14 adds two driven fetch ports — `ForFetchingFredSeries` and
`ForFetchingVvixQuote` — but `packages/adapters/src/memory/` contains no twin for either.
The repo twin exists (`memory/macro-observations.ts`), and the project's own precedent
covers fetch ports too: `memory/rate.ts` twins `ForFetchingRate`, `memory/cot.ts` twins
`ForFetchingCotReport` (added in the same PR as their HTTP adapters). architecture-boundaries
§8 is explicit: "Every driven port change updates its implementation in
`packages/adapters/memory/` in the same PR." Core tests currently use inline lambdas, so
nothing fails — but the twin surface is now inconsistent, and any integration-style test or
dev composition that wants a no-network macro fetch has nothing to wire.
**Fix:** Add `memory/fred-series.ts` (`makeMemoryFredSeriesAdapter(rowsBySeriesId)`) and
`memory/vvix.ts` (`makeMemoryVvixAdapter(row)`) mirroring `memory/rate.ts` / `memory/cot.ts`
(seedable success value + optional err mode), export them from `packages/adapters/src/index.ts`.

## Info

### IN-01: Postgres repo silently coerces unknown `source` values to `"fred"`

**File:** `packages/adapters/src/postgres/repos/macro-observations.ts:61-62`
**Issue:** `const source = r.source === "cboe" ? "cboe" : "fred";` — any unexpected value in
the `source` text column (no CHECK constraint exists on it) is silently relabeled `"fred"`
instead of surfacing as a parse error. This is narrowing-by-default rather than
parse-don't-cast; provenance mislabeling would be invisible.
**Fix:** Treat unknown values as a storage error (or add a CHECK constraint
`source IN ('fred','cboe')` in a follow-up migration) so bad provenance fails loud.

### IN-02: MacroCard shows the "run the job to populate" empty state for fetch errors

**File:** `apps/web/src/components/MacroCard.tsx:89-101`
**Issue:** The component destructures only `{ data, isPending }` from `useMacro()`. When the
query errors (401 after token expiry, 5xx after 3 retries), `data === undefined && !isPending`
renders "Macro data unavailable — run the job to populate," which misdirects the operator —
the job may have run fine while the API call failed. Sibling cards share this pattern, so
this is informational, but the copy actively suggests the wrong remediation.
**Fix:** Read `isError` from the hook and render a distinct "failed to load" message for the
error case.

### IN-03: fetch-rates handler re-declares use-case types structurally instead of importing the driver port

**File:** `apps/worker/src/handlers/fetch-rates.ts:5-9`
**Issue:** `FetchMacroSeriesUseCase` (and the pre-existing `FetchRateUseCase`) are local
structural clones of `ForRunningFetchMacroSeries` from `@morai/core`. Because the handler
never references the real port type, a future change to the `Result` error shape (e.g.
renaming `message`) would typecheck here while silently breaking the `result.error?.message`
extraction at line 63 (it would just always fall back to the generic string).
**Fix:** `import type { ForRunningFetchMacroSeries } from "@morai/core"` and use it for the
dep type; same for the rate use-case when next touched.

---

_Reviewed: 2026-07-02T03:08:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

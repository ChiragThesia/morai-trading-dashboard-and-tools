---
phase: 02-market-data-bsm-engine
reviewed: 2026-06-11T17:09:53Z
depth: standard
files_reviewed: 58
files_reviewed_list:
  - apps/server/src/adapters/http/status.routes.test.ts
  - apps/server/src/adapters/mcp/mcp.test.ts
  - apps/server/src/config.ts
  - apps/server/src/main.ts
  - apps/worker/package.json
  - apps/worker/src/config.ts
  - apps/worker/src/handlers/compute-bsm-greeks.ts
  - apps/worker/src/handlers/fetch-cboe-chain.test.ts
  - apps/worker/src/handlers/fetch-cboe-chain.ts
  - apps/worker/src/handlers/fetch-rates.ts
  - apps/worker/src/main.ts
  - apps/worker/vitest.config.ts
  - packages/adapters/package.json
  - packages/adapters/src/__contract__/chain.contract.ts
  - packages/adapters/src/__contract__/leg-observations.contract.ts
  - packages/adapters/src/__contract__/rate-observations.contract.ts
  - packages/adapters/src/__contract__/rate.contract.ts
  - packages/adapters/src/http/cboe.contract.test.ts
  - packages/adapters/src/http/cboe.test.ts
  - packages/adapters/src/http/cboe.ts
  - packages/adapters/src/http/fred.contract.test.ts
  - packages/adapters/src/http/fred.test.ts
  - packages/adapters/src/http/fred.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/chain.contract.test.ts
  - packages/adapters/src/memory/chain.ts
  - packages/adapters/src/memory/rate.contract.test.ts
  - packages/adapters/src/memory/rate.ts
  - packages/adapters/src/postgres/repos/job-runs.contract.test.ts
  - packages/adapters/src/postgres/repos/job-runs.ts
  - packages/adapters/src/postgres/repos/leg-observations.contract.test.ts
  - packages/adapters/src/postgres/repos/leg-observations.ts
  - packages/adapters/src/postgres/repos/rate-observations.contract.test.ts
  - packages/adapters/src/postgres/repos/rate-observations.ts
  - packages/adapters/test/fixtures/cboe-spx.fixture.json
  - packages/adapters/test/fixtures/cboe-spxw.fixture.json
  - packages/adapters/test/fixtures/README.md
  - packages/contracts/src/status.test.ts
  - packages/contracts/src/status.ts
  - packages/core/src/index.ts
  - packages/core/src/journal/application/computeBsmGreeks.test.ts
  - packages/core/src/journal/application/computeBsmGreeks.ts
  - packages/core/src/journal/application/fetchChain.test.ts
  - packages/core/src/journal/application/fetchChain.ts
  - packages/core/src/journal/application/fetchRate.test.ts
  - packages/core/src/journal/application/fetchRate.ts
  - packages/core/src/journal/application/getStatus.test.ts
  - packages/core/src/journal/application/getStatus.ts
  - packages/core/src/journal/application/ports.ts
  - packages/core/src/journal/domain/bsm.test.ts
  - packages/core/src/journal/domain/bsm.ts
  - packages/core/src/journal/domain/dte.test.ts
  - packages/core/src/journal/domain/dte.ts
  - packages/core/src/journal/domain/iv-inversion.test.ts
  - packages/core/src/journal/domain/iv-inversion.ts
  - packages/core/src/journal/domain/rth-window.test.ts
  - packages/core/src/journal/domain/rth-window.ts
findings:
  critical: 3
  warning: 11
  info: 9
  total: 23
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-06-11T17:09:53Z
**Depth:** standard
**Files Reviewed:** 58
**Status:** issues_found

## Summary

Reviewed the Phase 2 market-data + BSM engine implementation: BSM pricing/greeks,
IV inversion, settlement-aware DTE, RTH gating, CBOE/FRED HTTP adapters, Postgres
repos, three pg-boss job handlers, and both composition roots. The domain math
(bsmPrice/bsmGreeks) is well calibrated against fixtures and property tests, and
the hexagonal boundaries are respected throughout.

Three blockers were found. (1) The worker cannot boot against a fresh database:
pg-boss v12 requires `createQueue()` before `schedule()`/`send()`, and it is never
called — verified against the installed pg-boss 12.18.3 dist, where `schedule()`
throws `Queue <name> not found` on the missing FK. (2) `computeBsmGreeks` computes
time-to-expiry from the job's wall clock instead of the observation timestamp,
which permanently NaN-stamps every 0DTE row from the final daily snapshot and
biases IV/greeks on all stale rows. (3) The IV-inversion intrinsic guard uses
American intrinsic instead of the European no-arbitrage bound — deep-ITM SPX puts
(which legitimately trade below intrinsic) get permanently NaN-stamped, and the
symmetric call-side gap lets unsolvable marks through to a junk-IV path.

## Narrative Findings (AI reviewer)

No `<structural_findings>` block was provided; all findings below are from direct
adversarial review.

## Critical Issues

### CR-01: Worker crashes at boot — pg-boss v12 queues are never created

**File:** `apps/worker/src/main.ts:107-129`
**Issue:** pg-boss v12 requires queues to exist before `schedule()` or `send()`.
Verified against the installed `pg-boss@12.18.3`: `Timekeeper.schedule()` inserts
into the schedule table with an FK to the queue table and remaps the FK violation
to `Queue <name> not found`, then **throws** (`dist/timekeeper.js:164-179`);
`Manager.send()` throws `Queue <name> does not exist` (`dist/manager.js:263`).
No file in the repo calls `boss.createQueue()` (grep confirms zero hits). On a
fresh deploy, `await boss.schedule("fetch-cboe-chain", ...)` at line 107 throws,
the worker process dies, and Railway restart-loops. Even if scheduling were
somehow seeded, the chain handler's `boss.send("compute-bsm-greeks", ...)`
(`apps/worker/src/handlers/fetch-cboe-chain.ts:56`) would reject for the same
reason. The line-105 comment "boss.schedule is idempotent — safe to call on every
boot" is true only after the queue exists.
**Fix:**
```ts
// apps/worker/src/main.ts — after boss.start(), before any schedule/work:
await boss.createQueue("fetch-cboe-chain");
await boss.createQueue("fetch-rates");
await boss.createQueue("compute-bsm-greeks");
```
(`createQueue` is idempotent in v12 — safe on every boot.)

### CR-02: computeBsmGreeks uses job wall-clock for T instead of observation time — final daily 0DTE snapshot is permanently NaN-stamped

**File:** `packages/core/src/journal/application/computeBsmGreeks.ts:70,107`
**Issue:** `T = computeT(now, obs.expiry, obs.root)` uses `deps.now()` captured at
job-run time, but the mark being inverted was observed at `obs.time` (CBOE quotes
are additionally ~15 min delayed). Consequences, all provable from the code:

1. **Permanent data loss every trading day:** the 16:00 ET snapshot of same-day
   (0DTE SPXW) contracts is observed at the PM cutoff. The chained compute job
   runs seconds-to-minutes later, so `computeT` returns 0, `invertIv` returns
   `err({kind:"expired"})` (`iv-inversion.ts:73-75`), and the row is NaN-stamped.
   Per T-02-15 the NaN stamp removes the row from the partial index — it can
   never be recomputed. Valid observations are destroyed by design, daily.
2. **Systematic IV bias on every row:** any lag between observation and compute
   (15-min vendor delay, 30-s polling, hourly fallback schedule, worker downtime
   backlog) shrinks T below its true value, inflating recovered IV — worst for
   the short-DTE contracts this journal exists to track.
3. **Internal inconsistency:** the risk-free rate for the same row IS keyed to
   the observation date (`obs.time.toISOString().slice(0,10)`, line 87), so the
   row mixes observation-date r with compute-time T.
**Fix:**
```ts
// Step 3: compute T as of the observation instant, not the job run
const T = computeT(obs.time, obs.expiry, obs.root);
```
`deps.now` then becomes unused and can be removed from the deps type, or kept
only if needed elsewhere. Add a regression test: row observed at 15:30 ET on its
expiry day, use-case run at 16:30 ET, must produce numeric (non-NaN) bsm_* values.

### CR-03: invertIv intrinsic guard uses American intrinsic, not the European no-arb bound — valid deep-ITM SPX put marks are rejected and NaN-stamped

**File:** `packages/core/src/journal/domain/iv-inversion.ts:77-82`
**Issue:** The lower-bound guard rejects `mark < max(K−S,0) − 0.5` (puts) /
`max(S−K,0) − 0.5` (calls). SPX/SPXW options are European (the codebase itself
stamps `exerciseStyle: "european"`). The correct European lower bounds are
`K·e^(−rT) − S·e^(−qT)` (put) and `S·e^(−qT) − K·e^(−rT)` (call), not raw
intrinsic. With r=4.5%, q=1.3%:

- **Puts (false rejection → permanent NaN stamp):** deep-ITM European puts
  routinely trade below intrinsic. Example inside the operational filter
  (±10% band, ≤90 DTE): S=7000, K=7700, T=90/365 → intrinsic = 700, but
  `K·e^(−rT) − S·e^(−qT)` ≈ 7615.5 − 6977.6 ≈ 637.9. Every legitimate mark in
  [637.9, 699.5) is rejected as `below-intrinsic`, NaN-stamped, and (per
  T-02-15) excluded from recompute forever. BSM itself prices this put below
  intrinsic at low sigma, so the solver would have succeeded.
- **Calls (false acceptance → junk IV stored as valid):** the true call lower
  bound is ABOVE intrinsic when r>q (S=7300, K=7000, T=0.25: bound ≈ 354.6 vs
  intrinsic 300). A stale mark in [299.5, 354.6) passes the guard, is
  unsolvable, and falls into the bisection "closest endpoint" branch
  (lines 149-155) which returns `ok(0.001)` — fabricated IV ≈ 0.1% written to
  the journal as a real value (see WR-01).
**Fix:**
```ts
const lowerBound =
  type === "C"
    ? Math.max(S * Math.exp(-q * T) - K * Math.exp(-r * T), 0)
    : Math.max(K * Math.exp(-r * T) - S * Math.exp(-q * T), 0);
if (mark < lowerBound - 0.5) {
  return err<IvError>({ kind: "below-intrinsic" });
}
```
Add example tests with a deep-ITM European put mark below raw intrinsic but above
the discounted bound (must return ok and round-trip).

## Warnings

### WR-01: invertIv returns ok() without verifying the residual — unsolvable or non-converged marks yield fabricated IV

**File:** `packages/core/src/journal/domain/iv-inversion.ts:149-155,106-132,183-187`
**Issue:** Two ok-paths can return a sigma that does not reprice to the mark:
(1) the bisection "mark outside [price(lo), price(hi)]" branch returns the
closest endpoint (`sigma = 0.001` or `5.0`) as `ok`; (2) the Newton loop can
exhaust MAX_ITER while oscillating inside bounds and return the last iterate
with no convergence check. D-09 says unsolvable marks must become NaN stamps;
instead they become plausible-looking numeric IV/greeks in the journal. The
round-trip property test never catches this because its marks are always
generated from real sigmas in [0.05, 3].
**Fix:** After the solve, recompute the price and require
`Math.abs(bsmPrice(S,K,T,sigma,r,q,type) - mark) <= tolerance` (e.g. 1e-6
absolute or a relative bound); otherwise return
`err({kind:"below-intrinsic"})` or a new `{kind:"no-convergence"}` variant.

### WR-02: `void boss.send(...)` without rejection handling — a failed enqueue is either an unhandled rejection (process risk) or silently lost

**File:** `apps/worker/src/handlers/fetch-cboe-chain.ts:56-58`
**Issue:** `boss.send` returns a promise that rejects (e.g. queue missing — see
CR-01 — or transient DB failure). `void` detaches it with no `.catch`, producing
an unhandled rejection (default runtime behavior: crash) and, at best, silently
dropping the D-07 chain trigger with no log. The comment says "failure does not
fail the chain job," but the code does not actually implement that containment.
**Fix:**
```ts
void deps.boss
  .send("compute-bsm-greeks", {}, { singletonKey: "triggered-by-chain" })
  .catch((e: unknown) => {
    console.warn("fetch-cboe-chain: failed to enqueue compute-bsm-greeks", e);
  });
```

### WR-03: job-runs DISTINCT ON returns only the latest row — lastSuccessAt and lastErrorAt can never both be populated

**File:** `packages/adapters/src/postgres/repos/job-runs.ts:71-104`
**Issue:** `SELECT DISTINCT ON (name) ... ORDER BY name, completed_on DESC`
yields exactly one row per job. The record then sets `lastSuccessAt` only if
that single latest row is `completed`, else `lastErrorAt`. The port contract
(`ports.ts:201-206`, "most recent success/error per job") and the
`JobRunRecord` shape (both timestamps nullable independently) promise both. As
implemented, one failure after months of successes makes `lastSuccessAt: null`
— the status endpoint reports the job as never-succeeded.
**Fix:** Take the most recent row per (name, state) pair and merge:
```sql
SELECT DISTINCT ON (name, state) name, state, completed_on, output
FROM pgboss.job
WHERE name IN (...) AND state IN ('completed','failed')
ORDER BY name, state, completed_on DESC NULLS LAST
```
then fold the ≤2 rows per job into one `JobRunRecord`.

### WR-04: job-runs catch heuristic masks unrelated SQL errors as ok({})

**File:** `packages/adapters/src/postgres/repos/job-runs.ts:110-118`
**Issue:** Any error whose message contains `"does not exist"` is swallowed and
reported as the healthy first-deploy state. Postgres uses that exact phrase for
missing columns (`column "completed_on" does not exist`), missing functions,
and missing roles — e.g. a pg-boss major upgrade that renames a column would
make /status permanently show `lastJobRuns: "none yet"` with zero signal.
**Fix:** Match the specific relation/schema error instead: check the Postgres
error code (`42P01` undefined_table / `3F000` invalid_schema_name) via a typed
guard on `e`, or at minimum require the message to reference `pgboss` (drop the
bare `"does not exist"` and `"no such table"` arms — the latter is SQLite
phrasing and can never match Postgres).

### WR-05: CBOE timestamp is not format-validated — a malformed timestamp produces an Invalid Date that propagates to the DB write

**File:** `packages/adapters/src/http/cboe.ts:37-40,98-118`
**Issue:** The Zod schema validates `timestamp` only as `z.string()`. If CBOE
ever changes the format, `etToUtc` builds `new Date("...Z")` → Invalid Date →
`getUTCFullYear()` is NaN → `isDstInET` returns false via NaN comparisons →
the final `new Date(...)` is Invalid. The Invalid Date becomes
`RawChain.observedAt` and flows into `persistObservations`, failing deep inside
Drizzle with an opaque error (or worse, driver-dependent garbage) instead of a
clean `fetch-error` at the boundary — defeating the T-02-07 parse-at-receipt
guarantee. Secondary: `isDstInET` is day-granular, so timestamps between
00:00-02:00 ET on the two DST transition Sundays get the wrong offset (benign
for RTH data, but the function is not constrained to RTH input).
**Fix:** Validate the shape in Zod
(`timestamp: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)`) and
add an explicit `Number.isNaN(observedAt.getTime())` check in `fetchChain` that
returns `err({kind:"fetch-error", message:"CBOE timestamp unparseable"})`.

### WR-06: fetchChain downloads the same _SPX.json twice and can split one snapshot across two inconsistent observations

**File:** `packages/core/src/journal/application/fetchChain.ts:185-188`, `packages/adapters/src/http/cboe.ts:216-231`
**Issue:** Both SPX and SPXW quotes live in the single `_SPX.json` payload (per
the adapter's own header comment and fixtures README), yet the use-case issues
two concurrent `fetchChain` calls, each downloading the full ~14 MB document.
Beyond the waste, this is a correctness issue: the CDN can serve two different
revisions between the two requests, so the SPX and SPXW halves of the "same"
30-minute snapshot get different `observedAt` (different time-slot PKs) and
different `spot` (`underlyingPrice`) — corrupting cross-root term-structure
comparisons, which is the core purpose of the journal.
**Fix:** Fetch once and split by root: either have the adapter fetch/parse a
single payload and expose both roots (e.g. `ForFetchingChain` takes no root and
returns both chains), or add per-call memoization keyed by fetch cycle in the
adapter. Both roots must share one `observedAt` and one `spot`.

### WR-07: getStatus calls Date.now() in core — breaks the codebase's clock-injection rule

**File:** `packages/core/src/journal/application/getStatus.ts:59`
**Issue:** Every other use-case in core injects `now: () => Date` and the domain
files document "never call Date.now() in core" as a hexagon-purity rule. The
uptime computation reads the ambient clock directly, making the use-case
non-deterministic and the uptime untestable (the test at
`getStatus.test.ts:141-156` can only assert `>= 4`).
**Fix:** Add `readonly now: () => Date` to the deps and compute
`(deps.now().getTime() - deps.startedAt.getTime()) / 1000`; pass
`() => new Date()` from `apps/server/src/main.ts`.

### WR-08: fetch-rates and compute-bsm-greeks handlers duck-type the use-case result, discarding the Result discriminated union

**File:** `apps/worker/src/handlers/fetch-rates.ts:3-4`, `apps/worker/src/handlers/compute-bsm-greeks.ts:3-4`
**Issue:** Both handlers define
`type ...UseCase = () => Promise<{ ok: boolean; error?: { message: string } }>`
instead of importing the real types from `@morai/core` (the comment above each
even says "Import via @morai/core" but doesn't). This widens `ok` to `boolean`
(losing narrowing — hence the `result.error?.message ?? ...` fallback that
should be unrepresentable), silently accepts any structurally similar function,
and will not flag a breaking change to the core Result shape at typecheck time.
The sibling `fetch-cboe-chain.ts` does it correctly via `ForRunningFetchChain`.
**Fix:** Export `ForRunningFetchRate` / `ForRunningComputeBsmGreeks` (return
types of the factories) from core, import them in the handlers, and delete the
local structural types.

### WR-09: Observations persisted before contracts — on contract-upsert failure, rows become invisible permanent "pending" orphans

**File:** `packages/core/src/journal/application/fetchChain.ts:227-237`, `packages/adapters/src/postgres/repos/leg-observations.ts:134-136`
**Issue:** `persistObservations` runs first; if `upsertContracts` then fails,
the job errors but the observation rows are already committed (no transaction
spans the two calls). `readPendingObs` silently `continue`s rows whose contract
metadata is missing ("shouldn't happen in practice" — this is exactly how it
happens). The rows match the pending partial index forever, are rescanned on
every compute run, and are never computed nor NaN-stamped. For a contract never
seen again (e.g. an expiring 0DTE in the day's last snapshot), this never
self-heals.
**Fix:** Swap the order — upsert contracts before persisting observations (no
FK exists, but metadata-first guarantees `readPendingObs` can always resolve a
persisted row). Additionally, count and `console.warn` skipped meta-less rows
in `readPendingObs` instead of silently dropping them.

### WR-10: CBOE bid=0 (no-bid sentinel) is treated as a live quote — fictitious marks recorded and fed to IV inversion

**File:** `packages/adapters/src/http/cboe.ts:157-159`, `packages/core/src/journal/application/fetchChain.ts:84-88`
**Issue:** CBOE's delayed-quotes feed reports `bid: 0` for quotes with no
resting bid (numeric 0, not an absent field). The mark computation
`(bid + ask) / 2` only skips `null`, so a no-bid quote with ask 0.30 produces
mark 0.15 — a fabricated mid persisted as `mark` and later inverted to a junk
IV. Inside the ±10% band this hits short-dated wings near the band edge.
**Fix:** Treat `bid === 0 && ask > 0` (and `ask === 0`) as having no valid
two-sided market: either skip the row in `quoteToObservationRow` or persist
bid/ask but null the mark so the BSM pipeline never picks it up
(`mark IS NOT NULL` gate). Decide and document the chosen vendor-sentinel rule.

### WR-11: MCP "tool handler" test never invokes the registered tool — MCP-02 path unverified

**File:** `apps/server/src/adapters/mcp/mcp.test.ts:104-123`
**Issue:** The test named "get_status tool handler returns statusResponse-valid
content" registers the tool on an `McpServer`, then calls the **test double**
(`healthyGetStatus`) directly and validates that — the registered tool handler
(its argument mapping, content envelope, error mapping) is never executed. The
test passes even if `registerStatusTool` serializes garbage. This gives false
confidence on the MCP-02 "one schema, both adapters" acceptance criterion.
**Fix:** Drive the tool through the transport (POST a `tools/call` JSON-RPC
request through `makeMcpRouter` with the bearer header) or invoke the
registered handler via the SDK's in-memory transport, then
`statusResponse.parse` the tool's returned content payload.

## Info

### IN-01: cboe-spxw.fixture.json is dead — referenced by no test

**File:** `packages/adapters/test/fixtures/cboe-spxw.fixture.json`
**Issue:** 19.7 KB fixture referenced only by the fixtures README; both cboe
test files import only `cboe-spx.fixture.json` (grep confirms).
**Fix:** Delete it, or add the SPXW-subset test it was captured for.

### IN-02: Unused repos constructed in worker composition root

**File:** `apps/worker/src/main.ts:48-49`
**Issue:** `_calendarsRepo` and `_jobRunsRepo` are built and never used —
dead wiring (the status use-case lives in the server, not the worker).
**Fix:** Delete both lines and the corresponding imports.

### IN-03: bsmGreeks has no T<=0 guard — division by zero yields NaN/Infinity greeks

**File:** `packages/core/src/journal/domain/bsm.ts:116-146`
**Issue:** `bsmPrice` guards `T <= 0` (intrinsic) but the exported `bsmGreeks`
divides by `sigma * sqrt(T)` unguarded; `T=0` returns NaN/±Infinity. The
current pipeline is protected only because `invertIv` errs first; any future
direct caller hits it.
**Fix:** Guard `T <= 0` (and `sigma <= 0`, `S <= 0`) returning expiry-limit
greeks or document-and-assert; at minimum mirror the docstring's "must be > 0"
with a runtime check.

### IN-04: TZ config field is parsed but never applied; calendarDte/computeT mix UTC and local date getters

**File:** `apps/worker/src/config.ts:11`, `packages/core/src/journal/application/fetchChain.ts:38-50`, `packages/core/src/journal/domain/dte.ts:101-103`
**Issue:** The Zod default `TZ: "America/New_York"` does not set the process
timezone (the runtime reads the real env var at startup); the parsed value is
never used. Meanwhile `calendarDte` reads `getUTC*()` of expiry Dates that were
constructed via local-time `new Date(y, m, d)`, while `computeT` reads local
getters of the same Dates. This is only correct on hosts at UTC or west of it
(Railway = UTC, so currently benign) — a host east of UTC shifts DTE by one day.
**Fix:** Drop the no-op TZ config field or actually document/verify the host
TZ assumption; standardize expiry Dates on one convention (UTC-noon
construction is the usual safe choice).

### IN-05: No graceful shutdown in worker — SIGTERM kills in-flight jobs

**File:** `apps/worker/src/main.ts`
**Issue:** No `SIGTERM`/`SIGINT` handler calling `await boss.stop()`. Railway
redeploys SIGTERM the container mid-job; pg-boss then waits for
expiration/retry instead of completing cleanly.
**Fix:** `process.on("SIGTERM", () => { void boss.stop({ graceful: true }).then(() => process.exit(0)); });`

### IN-06: Server version hardcoded "0.0.1" in composition root

**File:** `apps/server/src/main.ts:28`
**Issue:** Magic string duplicating package.json; /status will report a stale
version after the first bump.
**Fix:** Read from package.json or an injected env/build variable.

### IN-07: mapCboeOption re-parses fields out of the OCC string it just built

**File:** `packages/adapters/src/http/cboe.ts:153-176`
**Issue:** `osiToOcc` already parsed expiry/type/strike from the OSI symbol;
`mapCboeOption` then slices and re-parses the same fields back out of the
formatted 21-char OCC string (duplicated parsing logic, two places to get the
offsets wrong).
**Fix:** Have `osiToOcc` return `{occ, expiry, strike, type}` (or return the
`OccSymbolParsed` plus the branded symbol) and use those directly.

### IN-08: FRED fallback observation is dated with the UTC day, not the ET business day

**File:** `packages/adapters/src/http/fred.ts:26-28`
**Issue:** `todayIso()` slices the UTC ISO string. The fetch-rates job runs at
09:00 ET (13:00 UTC — same day, so the scheduled path is fine), but any
off-schedule run after 20:00/19:00 ET would record the fallback rate under
tomorrow's date. `readRate`'s `lte` lookup still finds it, but the stored date
no longer means "rate as of this business day".
**Fix:** Derive the date in `America/New_York`
(`Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(...)`).

### IN-09: completed_on string passthrough can fail the strict datetime contract

**File:** `packages/adapters/src/postgres/repos/job-runs.ts:39-43`, `packages/contracts/src/status.ts:9-10`
**Issue:** `extractCompletedOn` passes a raw driver string through unchanged.
postgres.js normally returns `Date` for timestamptz (toISOString path — fine),
but if a custom type parser or pooler returns the Postgres text form
(`2026-06-15 14:00:00.123+00`), `z.string().datetime()` rejects it and the
status route's `statusResponse.parse` throws → 500 on /status.
**Fix:** In the string branch, parse and re-serialize:
`const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d.toISOString();`

---

_Reviewed: 2026-06-11T17:09:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

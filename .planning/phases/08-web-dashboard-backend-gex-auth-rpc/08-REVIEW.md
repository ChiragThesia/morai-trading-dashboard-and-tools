---
phase: 08-web-dashboard-backend-gex-auth-rpc
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - apps/server/src/adapters/http/gex.routes.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/config.ts
  - apps/server/src/main.ts
  - apps/worker/src/handlers/compute-gex-snapshot.ts
  - apps/worker/src/handlers/compute-analytics.ts
  - apps/worker/src/schedule.ts
  - apps/worker/src/main.ts
  - packages/adapters/src/postgres/gex-snapshot.repo.ts
  - packages/adapters/src/postgres/migrations/0008_gex_snapshot.sql
  - packages/adapters/src/postgres/schema.ts
  - packages/adapters/src/memory/gex-snapshot.ts
  - packages/contracts/src/gex.ts
  - packages/core/src/analytics/domain/gex.ts
  - packages/core/src/analytics/application/computeGexSnapshot.ts
  - packages/core/src/analytics/application/getGex.ts
  - packages/core/src/analytics/application/ports.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the GEX backend slice (domain math, compute use-case, repo, contracts), the
Supabase-Auth/CORS security boundary in `main.ts`, the MCP `get_gex` tool, and the job
chain wiring. The auth + CORS ordering is correct and the idempotency design is sound.

However the **GEX domain math has a correctness defect** (`netGammaAtSpot` is computed
from per-strike aggregates, not the spot-grid profile — it does not match the oracle and
ships a wrong scalar to the dashboard), and **`computedAt` is silently lost on every
write** (the column does not exist; the repo substitutes `cycleTime` on read, so the
contract's `computedAt` is fabricated). Both are masked by a green suite — the existing
tests assert only `typeof === "number"` / structural shape, never the numeric values.
This is the exact "green suite hid a prod bug" failure mode flagged in project memory.

A `flip` strike-vs-spot-grid sign-convention quirk and several robustness gaps round out
the warnings.

## Critical Issues

### CR-01: `netGammaAtSpot` computed from per-strike GEX, not the spot-grid profile — wrong value shipped

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:138,203-221`
**Issue:**
`netGammaAtSpot` is the net dealer gamma evaluated *at the current spot across all
contracts* — i.e. the profile's value at `S = spot`. The oracle confirms this:
`gex.test.ts:9-11` documents `netGammaAtSpot ≈ -47` and explicitly says it is "the profile
at s=7380 is -47.43". But the use-case derives it via `computeNetGammaAtSpot(strikeEntries, spot)`,
which scans the **per-strike GEX aggregate** (`strikeGex` output) and returns the `gex` of
the *strike closest to spot*. That is the gamma *concentrated at one strike*, a completely
different quantity and magnitude from "total net gamma evaluated at spot". The values it
produces will not match the oracle and the dashboard's headline GEX number will be wrong.

The correct source already exists in scope: `buildProfile` is called at line 142 to build
`profile`. The spot-at-grid value should come from the profile (the grid point nearest
`spot`, or a direct `buildProfile(legs, [spot])` evaluation), not from `strikeEntries`.

The reason this passed review/tests: `computeGexSnapshot.test.ts:118` asserts only
`expect(typeof row.netGammaAtSpot).toBe("number")` — it never checks the value against the
documented oracle (-47). Green suite, wrong number.

**Fix:**
```ts
// Evaluate the profile directly at spot (same units as buildProfile output, $Bn/1%).
const [spotPoint] = buildProfile(legs, [spot]);
const netGammaAtSpot = spotPoint?.gamma ?? 0;
// Delete computeNetGammaAtSpot + dollarGammaContrib (now unused).
```
Add a value-level test asserting `netGammaAtSpot` against the mockup oracle so the
regression cannot reappear.

### CR-02: `computedAt` is never persisted — the contract field is fabricated on read (data loss)

**File:** `packages/adapters/src/postgres/gex-snapshot.repo.ts:103-121,149-160`; `packages/adapters/src/postgres/migrations/0008_gex_snapshot.sql:1-11`; `packages/adapters/src/postgres/schema.ts:355-369`
**Issue:**
The domain row carries `computedAt: deps.now()` (`computeGexSnapshot.ts:181`) and the
contract requires `computedAt` (`gex.ts:50`, `z.string().datetime()`). But there is **no
`computed_at` column** in the migration or the Drizzle schema, and `persistGexSnapshot`
never writes it. On read the repo sets `computedAt: row.cycleTime` (line 160) with a
comment "computedAt is NOT stored in the DB — cycleTime used as a stable proxy".

Consequences:
1. The actual compute timestamp is silently discarded on every write — irrecoverable.
2. The API/MCP `computedAt` is a **lie**: it reports the snapped 30-min data-cycle time
   (which can be many minutes/hours before the row was actually computed), not when the
   snapshot was produced. For a "freshness" field on a trading dashboard this is a
   correctness/trust defect, not cosmetic.
3. `cycleTime` is already exposed implicitly; conflating the two collapses two distinct
   concepts (data instant vs compute instant) that the rest of the codebase (skew/RR,
   06-06 CR-01) deliberately keeps separate.

The mismatch slipped through because the contract only enforces *shape* (a datetime
string), and `cycleTime` happens to be a valid datetime — so `gexSnapshotResponse.parse`
never throws.

**Fix:** Add the column and persist/read it honestly:
```sql
-- 0008 migration
"computed_at" timestamp with time zone NOT NULL,
```
```ts
// schema.ts
computedAt: timestamp("computed_at", { withTimezone: true }).notNull(),
// repo persist .values({ ..., computedAt: row.computedAt })
// repo read     computedAt: row.computedAt,  // not row.cycleTime
```
(If a deliberate decision was made to not store `computedAt`, then remove it from the
contract and domain row rather than fabricating it — but that should be an explicit doc
decision, not a silent proxy.)

## Warnings

### WR-01: `flip` is interpolated over the SPOT GRID but typed/treated as a strike

**File:** `packages/core/src/analytics/domain/gex.ts:135-163`, `computeGexSnapshot.ts:142-145`
**Issue:** `findFlip` receives `buildProfile`'s output where `strike` is actually the
*grid spot price* (line 231: `profile.push({ strike: S, ... })`). So the returned "flip
strike" is really a grid-spot value, and its resolution is bounded by `GRID_STEP = 20`.
This works for the oracle but the naming (`strike`) is misleading and the 20-point grid
caps flip precision. Confirm the dashboard treats `flip` as a price level, not an option
strike. Consider naming the profile field `spot`/`s` to avoid the conflation that already
produced CR-01.
**Fix:** Rename `buildProfile`'s `{ strike, gamma }` to `{ spot, gamma }` and update
`findFlip`'s param type, so a future reader cannot mistake grid spots for strikes.

### WR-02: `buildProfile` reuses a private `dollarGamma` copy in the use-case (drift risk)

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:193-196`
**Issue:** `dollarGammaContrib` duplicates the exact formula of the exported
`dollarGamma` (`gex.ts:42-44`). Two copies of the same financial constant chain
(`× 100 × spot² × 0.01 / 1e9`) will drift; if one is corrected the other silently won't be.
This is only used by the `byExpiry` loop, which after CR-01's fix is the sole remaining
caller.
**Fix:** Import and call the domain `dollarGamma` instead of redefining it.

### WR-03: `spot` taken from `legs[0]` only, contradicting the documented "average"

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:104-109`
**Issue:** The step comment says "Extract spot (average underlyingPrice across the
cohort)" but the code uses `legs[0].underlyingPrice`. If the cohort spans rows with
slightly differing `underlyingPrice` (e.g. quotes captured a few ms apart, or a NaN/0 in
the first row), `spot` is whatever the first JOIN row happened to be — non-deterministic
across query orderings since the repo query has no `ORDER BY`. Spot feeds every downstream
number (profile grid, dollar gamma, netGammaAtSpot), so a bad first row poisons the whole
snapshot.
**Fix:** Either compute the documented average, or pick deterministically (e.g. max/most
common) and validate `spot > 0` before computing; bail to `ok(undefined)` if not finite.

### WR-04: `callWall`/`putWall` are `integer` columns but domain values are unvalidated floats

**File:** `packages/adapters/src/postgres/schema.ts:361-362`, `migrations/0008_gex_snapshot.sql:5-6`, `computeGexSnapshot.ts:120-134`
**Issue:** `callWall`/`putWall` are persisted into `integer` columns and the contract is
`z.number().int()`. They are assigned `entry.k` where `k = leg.strike / 1000`
(`gex.ts:95`). For SPX ×1000-convention strikes this is integral *today*, but nothing
enforces it — a non-multiple-of-1000 strike (or any future underlying with finer strikes)
yields a fractional `k`, which Postgres `integer` will silently truncate/round on insert
and `z.number().int()` will reject before that. There is no guard. A truncated wall on a
trading dashboard is a silent data corruption.
**Fix:** Either store `numeric` (matching `flip`/`spot`) and relax the contract to
`z.number()`, or assert/validate that wall strikes are integral before persist and fail
loudly otherwise.

### WR-05: `putWall` selected by absolute argmin including positive GEX — can mislabel

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:130-134`
**Issue:** `callWall` is correctly gated on `entry.gex > 0`, but `putWall` is the global
argmin with no `entry.gex < 0` gate. If every strike has positive net GEX (all-call-heavy
chain — uncommon but possible for short-dated cohorts), `putWall` is set to the
*least positive* strike, i.e. a "put wall" that is actually positive GEX. The contract
documents putWall as "highest net negative GEX" (`gex.ts:39`), so this violates its own
spec. The oracle path never exercises the all-positive case, so tests pass.
**Fix:** Gate `putWall` on `entry.gex < 0` and leave it `null` when no negative strike
exists (mirroring the `callWall` treatment).

### WR-06: `getGex` use-case has no `byExpiry`/`profile` integrity guard at the read boundary

**File:** `packages/adapters/src/postgres/gex-snapshot.repo.ts:157-159`
**Issue:** The read path trusts `row.profile`, `row.strikes`, `row.byExpiry` JSONB blobs
verbatim via the Drizzle `$type<>` annotation and forwards them straight into the contract
parse at the route (`gex.routes.ts:44`). `$type<>` is a compile-time assertion, not a
runtime check — if a malformed/legacy JSONB blob exists (manual edit, older writer,
partial migration), the route's `gexSnapshotResponse.parse` will throw and surface as a
flat 500 with no diagnostics, rather than being caught/logged at the storage seam. Given
the project rule "parse, don't cast", the JSONB shapes crossing the storage boundary are
exactly external input that should be Zod-validated, not `$type`-cast.
**Fix:** Validate the JSONB blobs with a Zod schema in the repo read (or accept the
documented risk explicitly). At minimum, ensure the route's parse failure is logged
distinctly from a DB error so a bad row is diagnosable.

## Info

### IN-01: Dead `_now` and dead `void k` in compute use-case

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:81,163`
**Issue:** `const _now = deps.now()` (line 81) is computed and never used (the comment
even says now() is unused for cycle time). `void k` (line 163) computes `k = leg.strike/1000`
then discards it with an explanatory `void`. Both are noise; `_now` in particular reads as
if it bounds resolution but does nothing.
**Fix:** Remove `_now` (keep `deps.now()` only at line 181 where `computedAt` uses it).
Remove the unused `k`/`void k` from the `byExpiry` loop.

### IN-02: `buildSpotGrid` can drop the upper bound for non-multiple spots

**File:** `packages/core/src/analytics/application/computeGexSnapshot.ts:54-62`
**Issue:** `start = Math.round(spot - 600)`, `end = Math.round(spot + 600)`, step 20.
Because `end - start = 1200` is divisible by 20 only when `Math.round` doesn't shift
parity, the final `s <= end` point can be `end - something`; the grid is not guaranteed
symmetric about `spot` and may not include `spot` itself as a grid node. Minor (profile is
for charting), but it means `netGammaAtSpot` (after CR-01 fix via grid) could interpolate
rather than land on spot.
**Fix:** Center the grid on `spot` explicitly (`spot + i*STEP` for i in [-30..30]) so spot
is always a node.

### IN-03: MCP `get_gex` injected as optional, silently registering nothing if unwired

**File:** `apps/server/src/adapters/mcp/server.ts:61,86-88`
**Issue:** `getGex?` is optional and the tool is only registered when defined. `main.ts`
does pass it, so it works today, but an optional security/feature-surface arg means a
wiring regression (dropping the arg) degrades silently to "tool missing" with no error.
The same pattern applies to positions/transactions/orders/enqueueJob.
**Fix:** Make `getGex` required now that it is always wired, or add a boot-time assertion
that the expected tool set registered.

### IN-04: Repo `readLegObsForGex` JOIN has no `ORDER BY` — non-deterministic `legs[0]`

**File:** `packages/adapters/src/postgres/gex-snapshot.repo.ts:58-78`
**Issue:** The Step-2 JOIN returns rows in unspecified order. `computeGexSnapshot` relies
on `legs[0]` for spot (WR-03). Without an `ORDER BY`, two runs on the same cycle can pick
different first rows. Pair this fix with WR-03.
**Fix:** Add a deterministic `ORDER BY` (e.g. strike, contract_type) to the JOIN query.

---

## Notes on items checked and found OK

- **CORS-first ordering (main.ts:184-214):** correct — `cors` is the first `app.use` over
  `/*`, applied before the JWT group, with exact `WEB_ORIGIN` origin and `credentials:true`
  (never `*`). Preflight OPTIONS resolves before the JWT gate. Security boundary sound.
- **JWT HS256 offline verify (main.ts:208-214):** read routes correctly wrapped; `/api/jobs/*`
  (bearer) and `/mcp` (bearer) correctly excluded from the Supabase JWT group per D-02.
- **Idempotency (repo:103-121, memory:49-58):** `onConflictDoNothing` on the `cycle_time`
  PK and the memory twin's `has(key)` guard match; cycle_time derives from data time
  (`snapCycleTime(latestTime)`), not now() — SC-2/CR-01 honored.
- **RLS-enabled-no-policy (0008:13):** consistent with the established project pattern
  (app connects as table owner, bypassing RLS); not a new defect.
- **Job chain (compute-analytics.ts:51-55, schedule.ts:75):** compute-gex-snapshot is
  chain-triggered (no cron), fire-and-forget enqueue with singletonKey; terminal handler
  has RTH/holiday gate before compute. Wiring correct.

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

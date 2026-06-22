---
phase: 06-derived-analytics
reviewed: 2026-06-22T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/server/src/adapters/http/analytics.routes.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/main.ts
  - apps/worker/src/handlers/compute-analytics.ts
  - apps/worker/src/handlers/snapshot-calendars.ts
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.ts
  - packages/adapters/src/memory/calendar-snapshots.ts
  - packages/adapters/src/memory/leg-observations.ts
  - packages/adapters/src/memory/risk-reversal-observations.ts
  - packages/adapters/src/memory/skew-observations.ts
  - packages/adapters/src/memory/term-structure-observations.ts
  - packages/adapters/src/postgres/migrations/0007_analytics_observations.sql
  - packages/adapters/src/postgres/repos/calendar-snapshots.ts
  - packages/adapters/src/postgres/repos/leg-observations.ts
  - packages/adapters/src/postgres/repos/risk-reversal-observations.ts
  - packages/adapters/src/postgres/repos/skew-observations.ts
  - packages/adapters/src/postgres/repos/term-structure-observations.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/contracts/src/analytics.ts
  - packages/core/src/analytics/application/computeAnalytics.ts
  - packages/core/src/analytics/application/getSkew.ts
  - packages/core/src/analytics/application/getTermStructure.ts
  - packages/core/src/analytics/application/ports.ts
  - packages/core/src/analytics/domain/percentile-rank.ts
  - packages/core/src/analytics/domain/risk-reversal.ts
findings:
  critical: 2
  warning: 4
  info: 2
  total: 8
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-06-22
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Phase 6 ships the analytics context end-to-end. The numeric core (`risk-reversal.ts`
linear-in-delta interpolation, `percentile-rank.ts` inclusive trailing percentile) is
mathematically sound: the put/call split relies on signed BSM delta (verified — puts get
`eqT * (ncdf(d1) - 1)` < 0 in `computeBsmGreeks`), bracketing never extrapolates, and
unbracketable wings return null per R2. Term-structure passthrough (R3) is correct: the
value is read straight from `calendar_snapshots.term_slope` and never recomputed. Migration
0007 grains and the 0007 meta snapshot are consistent.

**However, the skew/RR half is broken at the seam between the use-case and its data source.**
`computeAnalytics` reads the smile and stamps skew/RR rows with `cycle = now()`, but
`readSmile` matches `leg_observations.time` by **exact equality**. In production `now()` is a
fresh wall-clock instant that never equals a stored chain-observed `time`, so the smile read
returns empty and R1/R2 silently produce zero rows. The same `now()`-as-snapshot-time choice
also breaks RR idempotency (re-run at a different instant = new PK) and desynchronizes the
skew/RR `snapshot_time` from the term-structure `snapshot_time` written in the same cycle.
This is the dominant defect and matches the warning that Phase 5's first green suite hid real
economic bugs — the in-memory twin's `getTime()` equality made the tests pass while the
Postgres path is unreachable in production. Two BLOCKERs and four WARNINGs below.

## Critical Issues

### CR-01: Skew/RR half reads the smile by exact `now()` equality — returns empty in production

**File:** `packages/core/src/analytics/application/computeAnalytics.ts:65,89` and
`packages/adapters/src/postgres/repos/leg-observations.ts:325`

**Issue:** The use-case sets `const cycle = deps.now()` (worker wires `now: () => new Date()`)
and calls `deps.readSmile(cycle)`. The Postgres `readSmile` filters
`eq(legObservations.time, snapshotTime)` — exact match. But `leg_observations.time` is
`chain.observedAt` (the broker/CBOE chain timestamp set in `fetchChain.ts:99`), a distinct
earlier instant from the compute-analytics `now()`. The term-structure half avoids this by
using `readSnapshotsForCycle` ("latest snapshot ≤ now"), but the smile half has no such
resolution. In production `readSmile(now())` returns `[]`, so:
- R1 writes **0** skew rows (acceptance "writes exactly N×M smile rows" fails on real DB).
- R2 writes RR rows with `riskReversal: null` for nothing (no groups), i.e. 0 rows.
The in-memory twin (`memory/leg-observations.ts:111`) compares `getTime() === getTime()`, so
tests that seed `snapshotTime = the same now()` pass — masking the production failure.

**Fix:** Resolve the smile cycle the same way term-structure does — derive the snapshot time
from data, not from `now()`. Add a `ForReadingLatestSmileTime` (or have `readSmile` accept a
"≤ time, pick max" semantics) and use that single resolved instant for BOTH halves:
```ts
// computeAnalytics.ts — resolve ONE cycle time from the data, used for term + skew + RR.
const snapsResult = await deps.readSnapshots(deps.now());
if (!snapsResult.ok) return err(snapsResult.error);
const cycle = snapsResult.value[0]?.snapshotTime ?? null;
if (cycle === null) return ok(undefined); // nothing to compute this cycle
// ...read the smile for that exact resolved cycle time:
const smileResult = await deps.readSmile(cycle);
// stamp skew/RR rows with `cycle` (the resolved snapshot instant), not now().
```
Equivalently, change the Postgres `readSmile` to select the max `time ≤ snapshotTime` band
and return rows at that instant, mirroring `readSnapshotsForCycle`. Either way the smile and
the snapshots must agree on one resolved instant, and skew/RR `snapshot_time` must equal that
instant (not `now()`).

### CR-02: RR/skew idempotency and cross-table snapshot_time both keyed on `now()`

**File:** `packages/core/src/analytics/application/computeAnalytics.ts:94-95,135`

**Issue:** Even if CR-01 were fixed at the read, the **write** still stamps
`snapshotTime: cycle` where `cycle = now()`. The RR PK is `(snapshot_time, underlying,
expiration)` and the skew PK is `(snapshot_time, underlying, expiration, strike)`. SPEC R2/R4
and R1 require "re-running for the same snapshot time adds 0 rows." A re-run of
compute-analytics (pg-boss retry, or two chain triggers) calls `now()` again and gets a
different instant, so `onConflictDoNothing` never fires — every re-run inserts a full new set
of skew + RR rows. This is a data-integrity defect: the headline RR series will contain
duplicate-but-slightly-offset timestamps for the same economic cycle, and the trailing-rank
window (`readRrHistory`, `lte snapshot_time`) will then double-count those near-duplicate
values, corrupting `rr_rank` (R2). Note the term-structure half is NOT affected — it stamps
`snap.snapshotTime` from the source row, so term rows for the same cycle stay idempotent;
this asymmetry also means skew/RR `snapshot_time` ≠ term `snapshot_time` for the same cycle,
breaking the "one cycle" invariant the SPEC assumes.

**Fix:** Subsumed by CR-01 — stamp all three tables with the single resolved cycle instant
read from the data (`snap.snapshotTime`), never `now()`. After the fix, verify with a
testcontainer that runs the handler twice at two different wall-clock `now()` values over the
same seeded chain/snapshot and asserts 0 new rows on the second run (the current memory test
cannot catch this because it reuses the same `now()` Date object).

## Warnings

### WR-01: `percentileRank` returns 100 for empty history — first-ever RR ranks at the top

**File:** `packages/core/src/analytics/domain/percentile-rank.ts:19`

**Issue:** Empty history → `return 100`. The use-case (`computeAnalytics.ts:131`) writes that
100 directly as `rr_rank` for the first observation of any (underlying, expiration). A lone
first value sitting at the 100th percentile is economically misleading — a fresh series with
no history has an undefined rank, and "100" reads as "richest skew ever seen" to any consumer
(the whole point of the rank per `volatility_skew.md` is mean-reversion timing). The SPEC
edge table only commits to "trailing window OR all-available-if-shorter," not to a sentinel.

**Fix:** Return `null` for empty history and let the caller persist `rr_rank = null` until at
least one prior value exists (the column is already nullable, and R2 already allows null
rank). If a numeric sentinel is genuinely wanted, 50 (median) is less misleading than 100 —
but null is the honest answer and matches the "never emit a wrong number" spirit of R2.
```ts
export function percentileRank(value: number, history: ReadonlyArray<number>): number | null {
  const n = history.length;
  if (n === 0) return null;
  // ...
}
```

### WR-02: `interpolateRiskReversal` silently uses ITM-side points to bracket ±25Δ

**File:** `packages/core/src/analytics/domain/risk-reversal.ts:32-52,61-72`

**Issue:** `interpAtDelta` brackets `target` with the tightest pair spanning it, but does not
require the bracket to straddle the OTM region. For the call wing (target +0.25) with deltas
[0.20, 0.60] it interpolates across a 0.40-wide gap that jumps over the entire near-the-money
region; for the put wing (target −0.25) with [−0.10, −0.70] it interpolates across a
0.60-wide span. Linear-in-delta interpolation across such a wide, non-adjacent bracket can
produce an IV far from the true 25Δ vol, yet it is reported as a real number, not null. SPEC
R2's intent ("never emit a wrong number") is about fabrication when unbracketable, but a
bracket that spans most of the smile is a quiet accuracy hazard the tolerance test may not
expose if the fixture happens to have tight strikes.

**Fix:** Either (a) accept this as documented linear interpolation (current behavior) and add
a property/example test with sparse, wide-gap deltas asserting the interpolated value stays
within tolerance of a known curve; or (b) gate on a maximum bracket width (e.g. reject when
`upper.delta - lower.delta` exceeds a configured span) and return null, so a too-sparse smile
is treated as unbracketable rather than guessed. Document whichever is chosen next to
`PUT_TARGET_DELTA`.

### WR-03: `moneyness` is never populated — written and returned as constant null

**File:** `packages/adapters/src/postgres/repos/leg-observations.ts:338` (and
`memory/leg-observations.ts:119`), surfaced via `computeAnalytics.ts:101` and
`contracts/src/analytics.ts:22`

**Issue:** `readSmile` hardcodes `moneyness: null` ("moneyness has no source column → null"),
so every `skew_observations.moneyness` row is null and the contract's `moneyness` field is
always null on the smile-detail surface. R1 asks for "iv, delta, and strike/moneyness."
`strike` is present so the requirement is technically met, but shipping a permanently-null
column is dead schema surface and will mislead the future smile-chart consumer.

**Fix:** Either compute moneyness at the smile read (`strike / (spot × 1000)` or `ln(K/F)`;
`leg_observations.underlying_price` is available on the joined row) and populate it, or drop
the `moneyness` column from `skew_observations` and the `skewSmileEntry` contract until a real
source exists. Do not persist a column that is structurally always null.

### WR-04: Smile read applies no strike-band / sanity filter — relies entirely on upstream

**File:** `packages/adapters/src/postgres/repos/leg-observations.ts:309-345`

**Issue:** `readSmile` returns every BSM-solved strike for the snapshot instant with no band
or delta-sanity guard. The smile feeds `interpolateRiskReversal`, which trusts `delta < 0`
vs `delta > 0` to separate puts/calls. If any contract carries a mis-signed or out-of-range
BSM delta (e.g. a numerically unstable deep-ITM solve), it can land in the wrong wing and
distort the ±25Δ bracket without any null guard. The band is enforced upstream in `fetchChain`
(`isInFilter`), so this is defense-in-depth rather than a live bug, but the analytics layer
has no protection if upstream filtering changes.

**Fix:** Add a cheap sanity filter in `interpolateRiskReversal` (drop points with
`|delta| >= 1` as non-physical) and/or document the upstream-band dependency explicitly in
`readSmile`. A one-line guard in `usablePoints` (`if (Math.abs(delta) >= 1) continue;`) is
sufficient and keeps the domain self-protecting.

## Info

### IN-01: Stale "7 queues / 5 crons" comments after the 9-queue/6-cron refactor

**File:** `apps/worker/src/main.ts:402` and `apps/worker/src/schedule.ts:26,45`

**Issue:** Comments say "Register all 7 queues, 5 crons, and 7 work handlers" and
"Handler type shared by all 7 job queues" / "typed handler map for all 7 queues," but the
code now registers 9 queues and 6 crons (the `console.warn` at `main.ts:416` is correct).
Misleading comments only; no behavioral impact.

**Fix:** Update the three comments to "9 queues, 6 crons, 9 work handlers."

### IN-02: `getSkew`/`getTermStructure` JSDoc claims "ordered series" but ordering lives only in the repo

**File:** `packages/core/src/analytics/application/getSkew.ts:9` and `getTermStructure.ts:7`

**Issue:** Both thin forwarders document "ok([...rows]) → ordered risk-reversal/term series,"
but the ordering guarantee is implemented in the Postgres repos (`asc(snapshot_time)`) and the
memory twins (`.sort`). The use-case itself is order-agnostic. If a future adapter forgets the
`orderBy`, the contract-level "ordered" promise silently breaks with no test at the use-case
boundary.

**Fix:** Move the ordering guarantee into a contract test (assert series is sorted by `time`
ascending through the read use-case), or restate the JSDoc to say ordering is the adapter's
responsibility. Low priority — both current adapters order correctly.

---

_Reviewed: 2026-06-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

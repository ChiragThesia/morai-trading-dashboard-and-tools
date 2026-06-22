---
phase: 06-derived-analytics
plan: 08
subsystem: analytics
tags: [percentile-rank, risk-reversal, moneyness, skew, zod, drizzle, testcontainers, fast-check]

# Dependency graph
requires:
  - phase: 06-derived-analytics (06-06)
    provides: bounded "latest leg cycle ≤ anchor" smile read + data-anchored cycle resolution in computeAnalytics, leg-observations (both adapters), smile-source contract
provides:
  - percentileRank returns number | null; empty history -> null (no fabricated 100 sentinel)
  - first-ever risk-reversal persists rr_rank = null, carried through skewResponse contract
  - moneyness = K/S populated on both smile reads (postgres + memory) + contract, null only when spot non-finite-positive
  - corrected worker queue/cron comments (9 queues / 6 crons / 9 handlers)
affects: [analytics-read-surfaces, http-analytics-routes, mcp-get-skew, future-skew-consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Honest-null over numeric sentinel: a derived metric returns null when there is no defined value (no prior distribution), never a misleading number"
    - "Shared pure adapter helper (computeMoneyness) used by both driven adapters so memory twin and Postgres compute identical math, proven by the shared contract suite"

key-files:
  created:
    - packages/adapters/src/smile-moneyness.ts
  modified:
    - packages/core/src/analytics/domain/percentile-rank.ts
    - packages/core/src/analytics/domain/percentile-rank.test.ts
    - packages/core/src/analytics/domain/percentile-rank.property.test.ts
    - packages/core/src/analytics/application/computeAnalytics.test.ts
    - packages/contracts/src/analytics.test.ts
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/memory/leg-observations.ts
    - packages/adapters/src/__contract__/smile-source.contract.ts
    - packages/adapters/src/memory/smile-source.contract.test.ts
    - packages/adapters/src/postgres/repos/smile-source.contract.test.ts
    - apps/worker/src/main.ts
    - apps/worker/src/schedule.ts

key-decisions:
  - "percentileRank empty history -> null (not 100): no prior distribution means no defined rank; returning a number would make the first-ever observation read as a real percentile (WR-01)"
  - "moneyness: POPULATE (not drop) — the smile read has spot via leg_observations.underlying_price; dropping a SPEC-named field is scope reduction (WR-03 / 06-GAPS W4)"
  - "Shared computeMoneyness helper in adapters (not core, not duplicated per-adapter): pure K/S math belongs in adapters; one source guarantees both twins agree"
  - "No migration: skew_observations.moneyness stays nullable numeric; populated, not altered"

patterns-established:
  - "Honest-null: derived analytics emit null rather than a wrong number when the input has no defined answer"
  - "Finite-positive guard before division: computeMoneyness returns null for spot <= 0 / non-finite so Infinity/NaN is never persisted"

requirements-completed: [ANLY-01, ANLY-03, MCP-02]

# Metrics
duration: 8min
completed: 2026-06-22
status: complete
---

# Phase 6 Plan 08: Derived-Analytics Gap Closure (WR-01 / WR-03 / IN-01) Summary

**percentileRank now returns null for empty history (carried through use-case + skewResponse), moneyness = K/S is populated on both smile reads + contract, and the stale worker queue/cron comments read 9/6/9.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-22T18:04:00Z
- **Completed:** 2026-06-22T18:12:16Z
- **Tasks:** 3
- **Files modified:** 12 (1 created)

## Accomplishments
- WR-01: `percentileRank` returns `number | null`; empty history -> null. The first-ever risk-reversal of any (underlying, expiration) now persists `rr_rank = null` instead of the misleading 100th-percentile sentinel. Null flows through `computeAnalytics` (assignment unchanged — already typed `number | null`) and the already-nullable `skewResponse.rrRank` contract, with explicit contract coverage.
- WR-03: `moneyness = (strike / 1000) / spot` (spot = `leg_observations.underlying_price`) computed on BOTH the Postgres and memory smile reads via a shared `computeMoneyness` helper; null only when spot is non-finite/non-positive. Proven equal on both adapters by the shared smile-source contract (Postgres against a real testcontainer). No migration.
- IN-01: worker comments corrected to 9 queues / 6 crons / 9 handlers, verified against `registerAllJobs` (9 createQueue, 6 schedule, 9 handler-map entries).

## Task Commits

Each task was committed atomically (TDD red→green for Tasks 1 & 2):

1. **Task 1: percentileRank empty -> null carry-through (WR-01)** - `3a836dc` (fix)
2. **Task 2: populate moneyness = K/S on both smile reads + contract (WR-03)** - `990019a` (feat)
3. **Task 3: correct stale worker queue/cron comments (IN-01)** - `fbf7a70` (docs)

_RED was confirmed before each impl: empty→100 failed `toBeNull()` (Task 1); moneyness null→NaN failed `toBeCloseTo(0.981818)` (Task 2). GREEN followed for each._

## Files Created/Modified
- `packages/adapters/src/smile-moneyness.ts` - NEW: pure `computeMoneyness(strikeX1000, spot)` helper shared by both adapters; null on non-finite-positive spot
- `packages/core/src/analytics/domain/percentile-rank.ts` - empty history returns null; return type `number | null`; JSDoc rewritten
- `packages/core/src/analytics/domain/percentile-rank.test.ts` - flipped empty→100 case to empty→null
- `packages/core/src/analytics/domain/percentile-rank.property.test.ts` - new empty→null property; bounds/monotonicity over non-empty history only
- `packages/core/src/analytics/application/computeAnalytics.test.ts` - new case: non-null RR with empty history -> rr_rank null
- `packages/contracts/src/analytics.test.ts` - assert skewResponse carries real value + null rrRank
- `packages/adapters/src/postgres/repos/leg-observations.ts` - readSmile selects underlying_price, computes moneyness
- `packages/adapters/src/memory/leg-observations.ts` - SeededSmileLeg gains optional underlyingPrice; computes same moneyness
- `packages/adapters/src/__contract__/smile-source.contract.ts` - seedLeg gains optional spot; moneyness populate + null-fallback cases
- `packages/adapters/src/memory/smile-source.contract.test.ts` - threads spot through the memory seeder
- `packages/adapters/src/postgres/repos/smile-source.contract.test.ts` - threads spot (default '0') into the leg_observations insert
- `apps/worker/src/main.ts` - "all 9 queues, 6 crons, and 9 work handlers"
- `apps/worker/src/schedule.ts` - handler-type / map comments say 9 queues; "New Phase 5 crons" reworded to avoid a false "5 crons" grep match

## Decisions Made
- **Honest-null over sentinel (WR-01):** empty history -> null is the correct contract; a numeric sentinel for the first-ever observation is economically misleading.
- **Populate, not drop, moneyness (WR-03):** spot is available at the smile read; dropping a SPEC-named field would reduce scope.
- **Shared adapter helper:** one `computeMoneyness` keeps both twins bit-identical; pure math lives in adapters (core stays Drizzle/spot-free).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded "New Phase 5 crons" comment to clear the verify gate**
- **Found during:** Task 3 (worker comment fix)
- **Issue:** The Task 3 `<done>` grep pattern (`5 crons`) matched the legitimate section header `// New Phase 5 crons:` ("Phase 5" the milestone), so the gate returned 1, not 0.
- **Fix:** Reworded to `// Crons added in Phase 5:` — preserves meaning, removes the accidental substring; verified the 6 actual cron count is unchanged.
- **Files modified:** apps/worker/src/schedule.ts
- **Verification:** `grep '7 queues|5 crons|all 7'` now returns 0; counts confirmed (9 createQueue / 6 schedule / 9 handlers).
- **Committed in:** fbf7a70 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cosmetic comment reword required to satisfy the plan's own verify gate. No behavior change, no scope creep.

## Issues Encountered
- Plan verify commands used `bun run test --filter @morai/core -- <name>`, but the root `vitest run` script does not accept `--filter`. Used `bunx vitest run <path>` to target files instead; full-suite verification used `bun run test`. No code impact.

## Known Stubs
None. moneyness is now a computed real value (null only on the genuine spot-absent edge); the percentileRank null is an intentional honest-null, not a stub.

## Threat Flags
None — no new security surface. Mitigations from the plan's threat register are in place: T-06-27 (null rank for first-ever RR), T-06-28 (finite-positive spot guard → null, never Infinity/NaN), T-06-29 (corrected operator comments).

## Next Phase Readiness
- All Phase 6 derived-analytics gap items (WR-01, WR-03, IN-01) closed; this was the final fix plan in the gap round.
- Full workspace suite green (102 files, 945 tests) with Postgres testcontainer; typecheck + lint clean.

## Self-Check: PASSED
- FOUND: packages/adapters/src/smile-moneyness.ts
- FOUND: 06-08-SUMMARY.md
- FOUND commits: 3a836dc, 990019a, fbf7a70

---
*Phase: 06-derived-analytics*
*Completed: 2026-06-22*

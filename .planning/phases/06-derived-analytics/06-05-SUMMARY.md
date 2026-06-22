---
phase: 06-derived-analytics
plan: 05
subsystem: analytics
tags: [skew, risk-reversal, percentile-rank, vertical-slice, mcp, hexagonal, testcontainers, idempotency]

# Dependency graph
requires:
  - phase: 06-03
    provides: interpolateRiskReversal + percentileRank domain functions + analytics ports
  - phase: 06-04
    provides: computeAnalytics use-case (term-structure half) + worker main.ts inert skew placeholders to replace
provides:
  - "skew_observations repo (per-strike smile) + in-memory twin over a shared testcontainer contract (idempotent onConflictDoNothing; nullable delta/moneyness round-trip)"
  - "risk_reversal_observations repo + twin: nullable risk_reversal/rr_rank round-trip as null; readRiskReversalHistory trailing NON-NULL window (<=252) for rank"
  - "leg_observations ForReadingSmileSource read (bsm_iv->iv, bsm_delta->delta, excludes NaN-stamped + unsolved rows) on postgres + memory twin"
  - "computeAnalytics skew/RR half: full N×M smile write (idempotent) + 25Δ risk-reversal (null when unbracketable) + trailing-window percentile rank"
  - "getSkew read use-case (thin forwarder over the headline risk-reversal series)"
  - "GET /api/analytics/skew + MCP get_skew over the ONE skewResponse contract (value=risk_reversal + rr_rank)"
affects: [analytics-read-surface]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "headline-vs-detail split: skewResponse = derived 25Δ risk-reversal (value field, SPEC R5); skewSmileResponse = per-strike smile detail"
    - "use-case groups smile by (underlying, expiration), calls 06-03 domain (interpolateRiskReversal/percentileRank) — never reimplements numerics"
    - "null risk_reversal -> null rr_rank, excluded from history/rank (R2 never-fabricate, enforced at use-case)"
    - "smile-source read joins leg_observations × contracts; excludes bsm_iv = 'NaN'::numeric and bsm_iv IS NULL"

key-files:
  created:
    - packages/adapters/src/postgres/repos/skew-observations.ts
    - packages/adapters/src/memory/skew-observations.ts
    - packages/adapters/src/__contract__/skew-observations.contract.ts
    - packages/adapters/src/memory/skew-observations.contract.test.ts
    - packages/adapters/src/postgres/repos/skew-observations.contract.test.ts
    - packages/adapters/src/postgres/repos/risk-reversal-observations.ts
    - packages/adapters/src/memory/risk-reversal-observations.ts
    - packages/adapters/src/__contract__/risk-reversal-observations.contract.ts
    - packages/adapters/src/memory/risk-reversal-observations.contract.test.ts
    - packages/adapters/src/postgres/repos/risk-reversal-observations.contract.test.ts
    - packages/adapters/src/__contract__/smile-source.contract.ts
    - packages/adapters/src/memory/smile-source.contract.test.ts
    - packages/adapters/src/postgres/repos/smile-source.contract.test.ts
    - packages/core/src/analytics/application/getSkew.ts
    - packages/core/src/analytics/application/getSkew.test.ts
  modified:
    - packages/adapters/src/postgres/repos/leg-observations.ts
    - packages/adapters/src/memory/leg-observations.ts
    - packages/adapters/src/index.ts
    - packages/core/src/analytics/application/ports.ts
    - packages/core/src/analytics/application/computeAnalytics.ts
    - packages/core/src/analytics/application/computeAnalytics.test.ts
    - packages/core/src/analytics/index.ts
    - packages/core/src/index.ts
    - packages/contracts/src/analytics.ts
    - packages/contracts/src/analytics.test.ts
    - packages/contracts/src/index.ts
    - apps/worker/src/main.ts
    - apps/server/src/adapters/http/analytics.routes.ts
    - apps/server/src/adapters/http/analytics.routes.test.ts
    - apps/server/src/adapters/mcp/tools.ts
    - apps/server/src/adapters/mcp/server.ts
    - apps/server/src/adapters/mcp/mcp.test.ts
    - apps/server/src/main.ts

key-decisions:
  - "skewResponse REPURPOSED to the headline 25Δ risk-reversal shape (time, underlying, expiration, value=risk_reversal, rrRank) per SPEC R5/L39; the per-strike smile contract renamed to skewSmileResponse. SPEC explicitly says GET /api/analytics/skew returns {time, value=risk_reversal, …}, which contradicted the prior smile-shaped skewResponse — reconciled here (the contract was prior-plan scaffolding with no consumers)."
  - "new ForReadingSkewSmileDetail port for the optional smile-detail read (returns SkewObservationRow[]); ForReadingSkewSeries stays the headline RR read (returns RiskReversalObservationRow[]) consumed by getSkew."
  - "smile-source read is its own shared contract suite (smile-source.contract.ts) run on both adapters — the existing leg-observations contract had no memory twin, so a dedicated seedLeg-based suite gives memory+postgres parity without retrofitting the whole leg suite."
  - "memory leg twin gains a seedSmileLeg test helper + smileStore so readSmile has data without the full ObservationRow×contracts join."

patterns-established:
  - "headline (derived scalar) vs detail (raw smile) contract split for an analytics read surface"

requirements-completed: [ANLY-01, ANLY-03, MCP-02]

# Metrics
duration: ~16min
completed: 2026-06-22
status: complete
---

# Phase 6 Plan 05: Skew Vertical Slice Summary

**The second end-to-end analytics slice: compute-analytics now writes the full per-strike smile (skew_observations) and the derived 25Δ risk-reversal scalar + trailing-window percentile rank (risk_reversal_observations), and the headline series is readable via GET /api/analytics/skew and MCP get_skew over one shared skewResponse contract.**

## Performance
- **Duration:** ~16 min
- **Started:** 2026-06-22T16:56:23Z
- **Completed:** 2026-06-22T17:13:15Z
- **Tasks:** 3 (Tasks 1-2 TDD red→green; Task 3 wiring + route/tool tests)
- **Files:** 33 (15 created, 18 modified)

## Accomplishments
- **Skew + risk-reversal repos + twins (ANLY-01):** `makePostgresSkewObservationsRepo` (per-strike smile, idempotent onConflictDoNothing on (snapshot_time, underlying, expiration, strike); nullable delta/moneyness round-trip) and `makePostgresRiskReversalObservationsRepo` (nullable risk_reversal/rr_rank round-trip as NULL — never coerced to 0; `readRiskReversalHistory` returns the trailing NON-NULL window capped at 252, oldest→newest). Both have Map-keyed in-memory twins, and both pass the SAME shared contract suites — memory in workspace mode, Postgres under testcontainers (real Postgres 16, migration chain incl. skew/RR tables).
- **leg_observations smile-source read (ForReadingSmileSource):** joins leg_observations × contracts to return per-(underlying, expiration, strike) smile points mapping bsm_iv→iv and bsm_delta→delta, excluding NaN-stamped (`bsm_iv = 'NaN'::numeric`) and unsolved (`bsm_iv IS NULL`) rows. Implemented on postgres + memory twin (with a `seedSmileLeg` test helper), proven by a shared smile-source contract suite on both adapters.
- **computeAnalytics skew/RR half (R1+R2):** reads the smile, writes the full N×M smile (idempotent), groups by (underlying, expiration), computes risk_reversal via `interpolateRiskReversal` (null when ±25Δ unbracketable — never fabricated), and rr_rank via `percentileRank` over the trailing `readRrHistory` window. Null RR → null rr_rank and excluded from rank. The use-case calls the 06-03 domain functions; it does not reimplement interpolation/rank. Term-structure half unchanged (no regression).
- **getSkew use-case (ANLY-03):** thin forwarder over the headline risk-reversal series (`ForReadingSkewSeries`); ok([]) on no data; optional underlying/expiration filter.
- **Read surface over one contract (R5 / MCP-02):** `GET /api/analytics/skew` and MCP `get_skew` both import and parse through the single `skewResponse` schema (value = risk_reversal, with rrRank + underlying/expiration). Empty array (not error) on no data; flat `{error:"internal"}` on storage error. A one-sided field change fails `bun run typecheck`.
- **Worker placeholders replaced:** the inert skew/RR ports 06-04 left in `apps/worker/src/main.ts` (`readSmile`/`writeSkew`/`writeRr`/`readRrHistory` returning ok-empty) are now wired to the real skew + risk-reversal + leg-observations adapters. compute-analytics writes skew + RR alongside term-structure.

## Task Commits
1. **Task 1: skew + risk-reversal repos + twins + smile-source read** — `f2f852a` (feat). RED: memory contract tests failed module-not-found (right reason); GREEN: 44 contract tests pass (memory + Postgres testcontainers, real Postgres 16).
2. **Task 2: computeAnalytics skew/RR half + getSkew** — `682d38c` (feat). RED: 5 skew/RR assertions failed on the un-extended use-case (4 term-structure tests still green — no regression); GREEN: 16/16 analytics application tests, worked RR ≈ 0.06, null RR + null rank when unbracketable, rank = expected trailing percentile.
3. **Task 3: wire skew into job + GET /api/analytics/skew + MCP get_skew** — `5f5ada8` (feat). Grep checks pass (`/skew` in route, `skewResponse` in tools); route + mcp tests green (32/32); typecheck + lint clean.

_TDD note (per the documented Phase 3 lesson): Tasks 1-2 proved RED inline (module-not-found / assertion failure at the right point) then committed once at green; Task 3 is wiring + adapter tests (TDD-exempt composition roots, but the route, MCP tool, and contract behaviors all have failing-first assertions added)._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Repurposed `skewResponse` to the headline risk-reversal shape; renamed the smile detail to `skewSmileResponse`**
- **Found during:** Task 3 (wiring the /skew route + MCP tool)
- **Issue:** The plan's must_haves and SPEC R5/L39 require `GET /api/analytics/skew` to return `{time, value=risk_reversal, rrRank, underlying, expiration}` and the verify step greps `skewResponse` in tools.ts. But the prior-plan `skewResponse` contract was the per-strike *smile* shape (strike/iv/delta/moneyness), which does not match. A one-sided choice would have either failed the SPEC (smile shape) or failed the grep (using `riskReversalResponse`).
- **Fix:** Redefined `skewResponse`/`skewEntry` to the headline shape (value = risk_reversal, nullable; rrRank, nullable; underlying/expiration). Moved the per-strike smile to `skewSmileResponse`/`skewSmileEntry`. The old parallel `riskReversalResponse`/`riskReversalEntry` (unused by any adapter) were folded into `skewResponse` to avoid two redundant headline schemas. `packages/contracts/src/analytics.ts` was NOT in the plan's files_modified, but the contract as-written contradicted the plan's own route contract — reconciled here.
- **Files modified:** packages/contracts/src/analytics.ts, analytics.test.ts, index.ts
- **Committed in:** `5f5ada8`

**2. [Rule 3 - Blocking] Added `ForReadingSkewSmileDetail` port for the smile-detail read**
- **Found during:** Task 1
- **Issue:** `ForReadingSkewSeries` returns `RiskReversalObservationRow[]` (the headline). The skew table's smile-detail read returns `SkewObservationRow[]` — a different type — so it could not reuse `ForReadingSkewSeries`.
- **Fix:** Added a dedicated `ForReadingSkewSmileDetail` port (returns `SkewObservationRow[]`) and exported it from both core barrels. The skew repo's `readSkewSmileDetail` implements it; the risk-reversal repo's `readRiskReversalSeries` implements `ForReadingSkewSeries` (the headline).
- **Files modified:** packages/core/src/analytics/application/ports.ts, analytics/index.ts, core/src/index.ts
- **Committed in:** `f2f852a`

**Total deviations:** 2 (both Rule-3 blocking design reconciliations forced by the headline-vs-detail distinction). No architectural (Rule 4) decisions required; no bugs auto-fixed beyond a fixture nullish-coalescing pitfall caught during RED→GREEN (explicit-null overrides eaten by `??`, fixed with `in`).

## Known Stubs
None. The worker main.ts inert placeholders from 06-04 are now replaced with real adapters — the only stub this plan was tasked to remove is removed.

## Threat Surface
- **T-06-11 (Tampering — fabricated risk_reversal):** mitigated — `interpolateRiskReversal` returns null when ±25Δ cannot be bracketed; the use-case writes null risk_reversal AND null rr_rank, excluded from history/rank. Asserted by the unbracketable-smile use-case test (no fabricated number).
- **T-06-12 (Tampering — HTTP/MCP schema divergence):** mitigated — both the route and MCP tool import and parse through the single `skewResponse`; a one-sided rename fails `bun run typecheck`.
- **T-06-13 (Info disclosure on route error):** mitigated — flat `{error:"internal"}` body, no stack/SQL (asserted).
- **T-06-14 (malformed underlying/expiration/tool args):** mitigated — optional params parsed at the route; safeParse at the MCP boundary; invalid → empty/typed response, never throws.
- **T-06-15 (DoS — unbounded series read):** mitigated — rank history capped at ≤252 (both adapters); series reads filterable by underlying/expiration; single-user v1.
No new threat surface beyond the plan's register.

## Self-Check: PASSED

All 15 created files verified present; all 3 feature commits (`f2f852a`, `682d38c`, `5f5ada8`) verified in git history. Full workspace suite: 914 tests / 101 files green (testcontainer ran against real Postgres 16, not skipped); typecheck + lint clean. The last RED scaffold (the 06-04 computeAnalytics.test.ts skew/RR assertions) is now GREEN.

---
*Phase: 06-derived-analytics*
*Completed: 2026-06-22*

---
phase: 02-market-data-bsm-engine
verified: 2026-06-11T18:00:00Z
status: gaps_found
score: 4/6 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A tested BSM engine can invert IV and compute greeks for any stored observation"
    status: failed
    reason: "CR-02: computeBsmGreeks passes job wall-clock to computeT instead of obs.time. 0DTE rows observed at 15:30 ET and computed at 16:05 ET get T=0, causing invertIv to return err({kind:'expired'}) and NaN-stamp valid observations permanently. CR-03: invertIv uses American intrinsic (max(K-S,0)) as the lower-bound guard instead of the European no-arb bound (K*e^(-rT) - S*e^(-qT)). Deep ITM SPX puts that trade below raw intrinsic but above the discounted bound are permanently NaN-stamped, and the call-side gap allows unsolvable marks to return ok(0.001) — fabricated IV stored as valid. Together these violate 'any stored observation'."
    artifacts:
      - path: "packages/core/src/journal/application/computeBsmGreeks.ts"
        issue: "Line 70: const now = deps.now() (job run time). Line 107: computeT(now, obs.expiry, obs.root) uses wall-clock T, not observation time. Fix: computeT(obs.time, obs.expiry, obs.root)."
      - path: "packages/core/src/journal/domain/iv-inversion.ts"
        issue: "Lines 78-81: intrinsic guard uses max(K-S,0) (American). SPX/SPXW are European; lower bound must be K*exp(-r*T) - S*exp(-q*T) (put) / S*exp(-q*T) - K*exp(-r*T) (call). Also: bisection lines 149-155 return ok(endpoint) for marks outside [price(lo), price(hi)] without a residual check — fabricated IV written as valid (WR-01)."
    missing:
      - "Fix computeBsmGreeks.ts: replace computeT(now, obs.expiry, obs.root) with computeT(obs.time, obs.expiry, obs.root)"
      - "Fix iv-inversion.ts: replace American intrinsic guard with European no-arb lower bound"
      - "Fix iv-inversion.ts: add post-solve residual check before returning ok(sigma) to prevent fabricated IV from bisection endpoint fallback"
      - "Add regression test: row observed at 15:30 ET on expiry day, use-case run at 16:30 ET, must produce numeric (non-NaN) bsm_* values"
      - "Add test: deep ITM European put mark below American intrinsic but above discounted bound must return ok and round-trip"
  - truth: "Worker schedules three pg-boss jobs on boot and the pipeline runs end-to-end"
    status: failed
    reason: "CR-01: pg-boss v12 requires boss.createQueue() before boss.schedule(). apps/worker/src/main.ts calls boss.schedule() at lines 107-124 with no preceding createQueue() calls. Grep confirms zero hits for createQueue in the entire codebase. On a fresh deploy the worker throws 'Queue <name> not found' and Railway restart-loops. The chain handler's boss.send('compute-bsm-greeks',...) (fetch-cboe-chain.ts:56) would fail for the same reason on first run. The pipeline never runs in production."
    artifacts:
      - path: "apps/worker/src/main.ts"
        issue: "Lines 107-124: boss.schedule() called for all three jobs with no boss.createQueue() calls before them. pg-boss v12 dist/timekeeper.js:164-179 throws on missing FK."
      - path: "apps/worker/src/handlers/fetch-cboe-chain.ts"
        issue: "Line 56: void deps.boss.send('compute-bsm-greeks', {}, {singletonKey: 'triggered-by-chain'}) — no .catch() handler. An unhandled rejection crashes the process or silently loses the D-07 chain trigger (WR-02)."
    missing:
      - "Add boss.createQueue('fetch-cboe-chain'), boss.createQueue('fetch-rates'), boss.createQueue('compute-bsm-greeks') after boss.start() and before any boss.schedule() calls (createQueue is idempotent in v12)"
      - "Add .catch() handler to boss.send() in fetch-cboe-chain.ts to contain unhandled rejection"
---

# Phase 02: Market Data + BSM Engine Verification Report

**Phase Goal:** A delayed SPX option chain flows from CBOE through Zod parsing into `leg_observations`, and a tested BSM engine can invert IV and compute greeks for any stored observation — giving the journal job real computed values to write.
**Verified:** 2026-06-11T18:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CBOE adapter fetches delayed SPX/SPXW chain via Zod parse into leg_observations | VERIFIED | `packages/adapters/src/http/cboe.ts` (296 lines): CboeResponseSchema.safeParse at receipt, OSI→OCC conversion, Result-not-throw. `packages/core/src/journal/application/fetchChain.ts` (241 lines): DTE/strike filter + append-only persistence. Commits 1398abd + 6e26785 confirmed. |
| 2 | FRED adapter fetches DGS3MO rate with 4.5% fallback when unreachable/keyless | VERIFIED | `packages/adapters/src/http/fred.ts`: keyless → immediate fallback; HTTP non-2xx → console.warn + fallback. Commit 688d180 confirmed. |
| 3 | Raw per-contract quotes land in leg_observations source='cboe' with bsm_iv NULL | VERIFIED | `packages/adapters/src/postgres/repos/leg-observations.ts`: persistObservations with onConflictDoNothing on (time, contract) composite PK. ObservationRow.source hardcoded 'cboe'. bsm_* columns not in ObservationRow. Contract-tested via testcontainers. |
| 4 | BSM engine (bsmPrice, bsmGreeks, bsmVega) computes European greeks in TOS units | VERIFIED | `packages/core/src/journal/domain/bsm.ts` (174 lines, >60 min): 3 calibration fixtures at <=1e-4, 1000+ fast-check runs. bsmPrice/bsmGreeks/bsmVega/BsmGreeks exported. Commits 6825601 (RED) + 1bffd15 (GREEN) confirmed. |
| 5 | BSM engine inverts IV from any stored observation (0DTE and deep ITM included) | FAILED | **CR-02:** computeBsmGreeks.ts:107 calls computeT(now, obs.expiry, obs.root) where `now` is the job wall-clock (captured at line 70 via deps.now()). 0DTE rows observed at 15:30 ET and computed post-16:00 ET get T=0 → invertIv returns err({kind:'expired'}) → permanent NaN stamp. **CR-03:** iv-inversion.ts:78-81 guards with American intrinsic max(K-S,0); SPX/SPXW are European, so valid deep ITM puts below raw intrinsic are rejected. Also: bisection lines 149-155 return ok(BISECT_LO) for marks outside the solvable range — fabricated IV 0.001 stored as real value. |
| 6 | Worker boots on a fresh DB and runs the three-job pipeline on schedule | FAILED | **CR-01:** apps/worker/src/main.ts:107-124 calls boss.schedule() for all three jobs with no preceding boss.createQueue() calls. pg-boss v12 requires queues to exist before schedule() (FK constraint). Grep confirms zero createQueue calls in entire codebase. Worker throws on first deploy and Railway restart-loops. |

**Score:** 4/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/journal/domain/bsm.ts` | BSM price + greeks (>60 lines) | VERIFIED | 174 lines; exports bsmPrice, bsmGreeks, bsmVega, BsmGreeks |
| `packages/core/src/journal/domain/iv-inversion.ts` | Newton-Raphson + bisection IV solver (>40 lines) | STUB (logic error) | 189 lines; exists and is substantive, but American intrinsic guard is incorrect for European options (CR-03) |
| `packages/core/src/journal/domain/dte.ts` | Settlement-aware computeT (D-04) | VERIFIED | Exists; isThirdFriday + computeT exported |
| `packages/core/src/journal/application/computeBsmGreeks.ts` | Batch use-case (>40 lines) | STUB (logic error) | 154 lines; exists and is substantive, but uses wall-clock T instead of obs.time for computeT (CR-02) |
| `packages/core/src/journal/application/fetchChain.ts` | fetchChain use-case | VERIFIED | 241 lines; makeFetchChainUseCase exported |
| `packages/adapters/src/http/cboe.ts` | CBOE adapter (>50 lines) | VERIFIED | 296 lines; makeCboeChainAdapter exported; Zod parse at receipt |
| `packages/adapters/src/postgres/repos/leg-observations.ts` | Persistence repo | VERIFIED | 8.2K; persistObservations, upsertContracts, readPendingObs, writeBsmResults |
| `packages/adapters/src/http/fred.ts` | FRED adapter (>40 lines) | VERIFIED | 4.4K; 4.5% fallback on keyless/unreachable |
| `apps/worker/src/main.ts` | pg-boss boot + 3 scheduled jobs | STUB (missing createQueue) | File exists; boss.schedule() called but no boss.createQueue() — worker crashes on fresh DB (CR-01) |
| `packages/adapters/test/fixtures/cboe-spx.fixture.json` | CBOE SPX fixture (<100KB) | VERIFIED | 8.5KB; 31 contracts |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `fetchChain.ts` | ForFetchingChain + ForPersistingObservations ports | dependency-injected | VERIFIED | ports.ts exports all three port types; makeFetchChainUseCase receives them as deps |
| `computeBsmGreeks.ts` | invertIv + bsmGreeks + ForReadingPendingObs | domain calls + injected ports | PARTIAL | imports verified; but T passed to invertIv/bsmGreeks is wrong (obs wall-clock not obs.time) |
| `iv-inversion.ts` | bsm.ts bsmPrice + bsmVega | imports | VERIFIED | line 22: import { bsmPrice, bsmVega } from "./bsm.ts" |
| `apps/worker/src/main.ts` | makeFetchChainUseCase + makeFetchRateUseCase + makeComputeBsmGreeksUseCase | composition-root wiring | PARTIAL | wiring code exists but boss.createQueue() missing — worker never boots |
| `packages/adapters/src/http/cboe.ts` | formatOccSymbol from @morai/shared | OSI→OCC bridge | VERIFIED | line 2: import { ok, err, formatOccSymbol } from "@morai/shared" |
| `leg-observations.ts` partial index | Drizzle isNull(bsmIv) + isNotNull(mark) | pending-scan query | VERIFIED | Contract test asserts pending scan drains to zero after compute |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `computeBsmGreeks.ts` | pending (PendingObs[]) | readPendingObs() → leg_observations partial index | Yes (Drizzle WHERE isNull(bsmIv) AND isNotNull(mark)) | FLOWING to read; HOLLOW at compute (T uses wrong timestamp — CR-02) |
| `computeBsmGreeks.ts` | T (time-to-expiry) | computeT(now, obs.expiry, obs.root) | No — now = job clock, not obs.time | DISCONNECTED for 0DTE rows |
| `iv-inversion.ts` | sigma (implied vol) | Newton-Raphson + bisection on mark | Partial — returns ok(BISECT_LO=0.001) for marks outside solvable range | STATIC (fabricated IV on non-converged cases, WR-01) |

### Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable entry point without a live database and CBOE connectivity. The tests cover behavior programmatically.

### Probe Execution

Step 7c: No probe scripts declared in PLAN files or found in scripts/. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|------------|-------------|--------|----------|
| MKT-01 | 02-04 | CBOE adapter fetches delayed SPX chain behind ForFetchingChain, Zod-parsing before core | SATISFIED | cboe.ts with CboeResponseSchema.safeParse; chain contract tests green |
| MKT-02 | 02-05 | FRED adapter fetches DGS3MO rate, falling back to 4.5% when unreachable | SATISFIED | fred.ts; fallback tested with msw 500 + keyless path |
| MKT-03 | 02-04 | Raw per-contract quotes land in leg_observations append-only, source tagged | SATISFIED | leg-observations.ts persistObservations onConflictDoNothing; source='cboe' hardcoded |
| BSM-01 | 02-03 | IV-inversion routine recovers implied vol, property-tested for monotonicity and round-trip | PARTIALLY SATISFIED | Round-trip 1e-6 over 1000 inputs: SATISFIED. But CR-03 (American intrinsic guard) causes valid European put marks to return below-intrinsic error, and WR-01 (no post-solve residual check) allows bisection endpoint to return fabricated IV. Property tests don't catch these because marks are always generated from valid sigmas. |
| BSM-02 | 02-02 | Greeks routine computes delta/gamma/theta/vega, validated against reference values | SATISFIED | bsm.ts passes 3 calibration fixtures at <=1e-4; fast-check sanity passes 1000+ runs |
| BSM-03 | 02-06 | Computed BSM values stored alongside vendor-raw values; reads prefer computed | BLOCKED | compute-bsm-greeks use-case exists, but CR-02 (wall-clock T) NaN-stamps all 0DTE rows permanently. CR-01 (missing createQueue) means the job never runs in production. The pipeline cannot deliver "real computed values" for all observations as required. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/core/src/journal/application/computeBsmGreeks.ts` | 70, 107 | Wall-clock now used for T computation; obs.time not used | BLOCKER | 0DTE rows permanently NaN-stamped on every trading day; T biased on all backlogged rows |
| `packages/core/src/journal/domain/iv-inversion.ts` | 78-81 | American intrinsic guard applied to European options | BLOCKER | Valid deep ITM SPX puts (mark < American intrinsic but > European bound) permanently NaN-stamped |
| `packages/core/src/journal/domain/iv-inversion.ts` | 149-155 | Bisection returns ok(endpoint) without residual check | WARNING | Fabricated IV (0.001 or 5.0) stored as real value in journal |
| `apps/worker/src/main.ts` | 107-124 | boss.schedule() called without preceding boss.createQueue() | BLOCKER | Worker crashes on fresh DB (pg-boss v12 FK requirement) |
| `apps/worker/src/handlers/fetch-cboe-chain.ts` | 56 | void boss.send(...) with no .catch() | WARNING | Unhandled rejection risk; D-07 chain trigger silently lost on queue-not-found |
| `apps/worker/src/handlers/fetch-rates.ts` | 3-4 | Duck-typed use-case type instead of real ForRunningFetchRate | WARNING | Breaking change to core Result shape not caught at typecheck time |
| `apps/worker/src/handlers/compute-bsm-greeks.ts` | 3-4 | Duck-typed use-case type instead of real return type | WARNING | Same as above for compute handler |
| `packages/adapters/src/postgres/repos/job-runs.ts` | 110-118 | Error catch matches any message containing "does not exist" | WARNING | Masks unrelated SQL errors (wrong column names, etc.) as healthy first-deploy state |

No TBD/FIXME/XXX markers found in modified files (deferred-items.md references pre-existing issues, not unresolved debt markers).

### Human Verification Required

#### 1. Production pipeline end-to-end after gap closure

**Test:** After fixing CR-01 (createQueue) and CR-02 (obs.time for T), deploy worker to Railway and wait for an RTH 30-minute slot.
**Expected:** `curl /api/status` shows `fetch-cboe-chain.lastSuccessAt` populated; `SELECT count(*) FROM leg_observations WHERE source='cboe'` > 0; `SELECT count(*) FROM leg_observations WHERE bsm_iv IS NOT NULL` > 0 after compute runs.
**Why human:** Requires live Railway deployment and waiting for a market-hours slot; cannot be verified programmatically.

#### 2. 0DTE observation computes to non-NaN after CR-02 fix

**Test:** After applying the `computeT(obs.time, ...)` fix, seed a leg_observation row with obs.time = 15:30 ET today, expiry = today (0DTE), a valid mark, then run the compute use-case.
**Expected:** bsm_iv is a finite numeric string (not 'NaN'); bsm_delta, bsm_gamma, bsm_theta, bsm_vega all non-NaN.
**Why human:** Requires a controlled testcontainers integration run with a specifically crafted observation time — the automated test suite does not currently include this regression test.

#### 3. Deep ITM European put persists after CR-03 fix

**Test:** After applying the European no-arb lower bound fix, feed invertIv with S=7000, K=7700, T=90/365, r=0.045, q=0.013, mark=650 (below American intrinsic 700 but above European bound ~638).
**Expected:** invertIv returns ok with a finite sigma; bsmPrice(S,K,T,sigma,r,q,'P') ≈ 650 within 1e-4.
**Why human:** This specific test case is not in the existing fast-check suite (which generates marks from valid sigmas and cannot hit below-intrinsic territory). A new targeted test is needed.

## Gaps Summary

Three blockers prevent the phase goal from being achieved:

**CR-01 — Worker cannot boot on a fresh database.** `apps/worker/src/main.ts` calls `boss.schedule()` for all three jobs without first calling `boss.createQueue()`. pg-boss v12 enforces a foreign-key constraint on the schedule table that requires the queue to exist. The fix is three idempotent `boss.createQueue()` calls after `boss.start()` and before the first `boss.schedule()`.

**CR-02 — 0DTE and stale rows are permanently NaN-stamped.** `computeBsmGreeks.ts` captures `deps.now()` once at job run time and passes this wall-clock timestamp to `computeT()` for every pending observation. Any same-day expiry row observed before 16:00 ET but computed after 16:00 ET gets T=0 → `invertIv` returns `err({kind:'expired'})` → NaN stamp. The fix is `computeT(obs.time, obs.expiry, obs.root)` — use the observation timestamp, not the job's start time.

**CR-03 — European put lower bound is wrong; valid marks are rejected.** `invertIv` guards against `mark < max(K-S,0) - 0.5` (American intrinsic). SPX/SPXW options are European. The correct lower bound for a European put is `K*exp(-r*T) - S*exp(-q*T)`, which is strictly below American intrinsic. Valid deep ITM put marks in the operational window are permanently NaN-stamped and cannot be recomputed. The call-side also permits unsolvable marks that fall into bisection's endpoint return path (WR-01 fabricated IV).

These three gaps are root causes. The other warnings (WR-02 through WR-11) are real but do not individually block the stated phase goal — they should be addressed in a follow-on fix pass.

---

_Verified: 2026-06-11T18:00:00Z_
_Verifier: Claude (gsd-verifier)_

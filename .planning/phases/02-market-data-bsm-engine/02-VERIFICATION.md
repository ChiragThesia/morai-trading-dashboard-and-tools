---
phase: 02-market-data-bsm-engine
verified: 2026-06-11T21:15:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/6
  gaps_closed:
    - "A tested BSM engine can invert IV and compute greeks for any stored observation (CR-02, CR-03, WR-01)"
    - "Worker schedules three pg-boss jobs on boot and the pipeline runs end-to-end (CR-01, WR-02)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "After gap closure, deploy worker to Railway against a fresh database and wait for an RTH 30-minute slot."
    expected: "Process boots without 'Queue <name> not found'; curl /api/status shows fetch-cboe-chain.lastSuccessAt populated; SELECT count(*) FROM leg_observations WHERE source='cboe' > 0; SELECT count(*) FROM leg_observations WHERE bsm_iv IS NOT NULL > 0 after compute runs."
    why_human: "Requires live Railway deployment and waiting for a market-hours slot. Cannot verify pg-boss v12 fresh-DB FK behavior programmatically without a real Postgres instance running pg-boss schema."
---

# Phase 02: Market Data + BSM Engine Verification Report

**Phase Goal:** A delayed SPX option chain flows from CBOE through Zod parsing into `leg_observations`, and a tested BSM engine can invert IV and compute greeks for any stored observation — giving the journal job real computed values to write.
**Verified:** 2026-06-11T21:15:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plans 02-08 and 02-09)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CBOE adapter fetches delayed SPX/SPXW chain via Zod parse into leg_observations | VERIFIED | `packages/adapters/src/http/cboe.ts` (296 lines): CboeResponseSchema.safeParse at receipt, OSI→OCC conversion, Result-not-throw. `packages/core/src/journal/application/fetchChain.ts` (241 lines): DTE/strike filter + append-only persistence. Commits 1398abd + 6e26785 confirmed. Unchanged by gap closure. |
| 2 | FRED adapter fetches DGS3MO rate with 4.5% fallback when unreachable/keyless | VERIFIED | `packages/adapters/src/http/fred.ts`: keyless → immediate fallback; HTTP non-2xx → console.warn + fallback. Commit 688d180 confirmed. Unchanged by gap closure. |
| 3 | Raw per-contract quotes land in leg_observations source='cboe' with bsm_iv NULL | VERIFIED | `packages/adapters/src/postgres/repos/leg-observations.ts`: persistObservations with onConflictDoNothing on (time, contract) composite PK. ObservationRow.source hardcoded 'cboe'. bsm_* columns not in ObservationRow. Contract-tested via testcontainers. Unchanged by gap closure. |
| 4 | BSM engine (bsmPrice, bsmGreeks, bsmVega) computes European greeks in TOS units | VERIFIED | `packages/core/src/journal/domain/bsm.ts` (174 lines): 3 calibration fixtures at <=1e-4, 1000+ fast-check runs. bsmPrice/bsmGreeks/bsmVega/BsmGreeks exported. Unchanged by gap closure. |
| 5 | BSM engine inverts IV from any stored observation (0DTE and deep ITM included) | VERIFIED | **CR-02 fixed:** `computeBsmGreeks.ts` line 114 now reads `computeT(obs.time, obs.expiry, obs.root)` — T is measured from each observation's own timestamp, not the job wall-clock. Commit e0c13ca confirmed. **CR-03 fixed:** `iv-inversion.ts` lines 84-91 use European no-arb bound: put `max(K*e^(-rT) - S*e^(-qT), 0)`, call `max(S*e^(-qT) - K*e^(-rT), 0)`. Commit 5431ceb confirmed. **WR-01 fixed:** lines 203-205 add post-solve residual check `|bsmPrice(sigma) - mark| > 1e-4 → err(below-intrinsic)`. Regression tests CR-03a, CR-03b, CR-03c, WR-01 property all pass in 17-test suite. 0DTE regression in computeBsmGreeks.test.ts passes. 218/218 tests green. |
| 6 | Worker boots on a fresh DB and schedules three pg-boss jobs | VERIFIED (automated gate) | **CR-01 fixed:** `apps/worker/src/main.ts` lines 108-110 contain three `await boss.createQueue()` calls in source order: after `await boss.start()` (line 41) and before the first `await boss.schedule()` (line 115). Exact queue names match schedule/work targets and chain handler boss.send target. Commit 7a6749a confirmed. **WR-02 fixed:** `fetch-cboe-chain.ts` lines 56-60 chain `.catch((e: unknown) => { console.warn(...) })` on boss.send. Commit 820158d. New containment test (one of 5 passing in handler suite) verified rejection path: handler resolves, console.warn called. 218/218 tests green. Fresh-DB boot behavior requires human Railway validation (see Human Verification). |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/journal/domain/bsm.ts` | BSM price + greeks (>60 lines) | VERIFIED | 174 lines; exports bsmPrice, bsmGreeks, bsmVega, BsmGreeks. Unchanged. |
| `packages/core/src/journal/domain/iv-inversion.ts` | Newton-Raphson + bisection IV solver with European bound | VERIFIED | 209 lines; European no-arb lower bound at lines 84-91; post-solve residual check at lines 203-206; IvError union unchanged (3 members). Commits 5431ceb. |
| `packages/core/src/journal/domain/dte.ts` | Settlement-aware computeT (D-04) | VERIFIED | Exists; isThirdFriday + computeT exported. Unchanged. |
| `packages/core/src/journal/application/computeBsmGreeks.ts` | Batch use-case with per-row obs.time T | VERIFIED | 160 lines; line 114: `computeT(obs.time, obs.expiry, obs.root)`; factory deps type retains `now` key for worker composition root compatibility. Commit e0c13ca. |
| `packages/core/src/journal/application/fetchChain.ts` | fetchChain use-case | VERIFIED | 241 lines; makeFetchChainUseCase exported. Unchanged. |
| `packages/adapters/src/http/cboe.ts` | CBOE adapter (>50 lines) | VERIFIED | 296 lines; makeCboeChainAdapter exported; Zod parse at receipt. Unchanged. |
| `packages/adapters/src/postgres/repos/leg-observations.ts` | Persistence repo | VERIFIED | persistObservations, upsertContracts, readPendingObs, writeBsmResults. Unchanged. |
| `packages/adapters/src/http/fred.ts` | FRED adapter (>40 lines) | VERIFIED | 4.5% fallback on keyless/unreachable. Unchanged. |
| `apps/worker/src/main.ts` | pg-boss boot + createQueue + 3 scheduled jobs | VERIFIED | 142 lines; lines 108-110: three `boss.createQueue()` calls after `boss.start()` (line 41) and before first `boss.schedule()` (line 115). Commit 7a6749a. |
| `apps/worker/src/handlers/fetch-cboe-chain.ts` | Chain handler with caught boss.send | VERIFIED | 62 lines; lines 56-60: `void deps.boss.send(...).catch((e: unknown) => console.warn(...))`. Commit 820158d. |
| `packages/adapters/test/fixtures/cboe-spx.fixture.json` | CBOE SPX fixture (<100KB) | VERIFIED | 8.5KB; 31 contracts. Unchanged. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `fetchChain.ts` | ForFetchingChain + ForPersistingObservations ports | dependency-injected | VERIFIED | ports.ts exports all three port types; makeFetchChainUseCase receives them as deps. |
| `computeBsmGreeks.ts` | `dte.ts computeT` | `computeT(obs.time, obs.expiry, obs.root)` | VERIFIED | Line 114 confirmed via grep; T now derived from observation instant, not job wall-clock. |
| `iv-inversion.ts` | `bsm.ts bsmPrice` | post-solve residual recompute | VERIFIED | Lines 203-205: `bsmPrice(S, K, T, sigma, r, q, type)` called before final `return ok(sigma)`; delta > 1e-4 → err. |
| `iv-inversion.ts` | `bsm.ts bsmPrice + bsmVega` | imports | VERIFIED | Line 22: `import { bsmPrice, bsmVega } from "./bsm.ts"`. |
| `apps/worker/src/main.ts` | pgboss queue table | `boss.createQueue(name)` x3 before schedule/work | VERIFIED | Lines 108-110 confirmed; source order: start()→createQueue x3→schedule x3→work x3. |
| `apps/worker/src/handlers/fetch-cboe-chain.ts` | compute-bsm-greeks queue | `boss.send(...).catch(console.warn)` | VERIFIED | Lines 56-60 confirmed; `void` retained for explicit fire-and-forget; catch variable typed `unknown`. |
| `leg-observations.ts` partial index | Drizzle isNull(bsmIv) + isNotNull(mark) | pending-scan query | VERIFIED | Contract test asserts pending scan drains to zero after compute. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `computeBsmGreeks.ts` | `pending (PendingObs[])` | `readPendingObs()` → leg_observations partial index | Yes (Drizzle WHERE isNull(bsmIv) AND isNotNull(mark)) | FLOWING |
| `computeBsmGreeks.ts` | `T (time-to-expiry)` | `computeT(obs.time, obs.expiry, obs.root)` | Yes — obs.time is the persisted observation instant | FLOWING (CR-02 closed) |
| `iv-inversion.ts` | `sigma (implied vol)` | Newton-Raphson + bisection; post-solve residual check | Yes — `ok(sigma)` only when `|bsmPrice(sigma)-mark| <= 1e-4` | FLOWING (WR-01 closed) |

### Behavioral Spot-Checks

Step 7b: SKIPPED — no runnable entry point without a live database and CBOE connectivity. Tests cover behavior programmatically (218/218 pass).

### Probe Execution

Step 7c: No probe scripts declared in PLAN files or found in scripts/. SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|------------|-------------|--------|----------|
| MKT-01 | 02-04 | CBOE adapter fetches delayed SPX chain behind ForFetchingChain, Zod-parsing before core | SATISFIED | cboe.ts with CboeResponseSchema.safeParse; chain contract tests green. Unchanged. |
| MKT-02 | 02-05 | FRED adapter fetches DGS3MO rate, falling back to 4.5% when unreachable | SATISFIED | fred.ts; fallback tested with msw 500 + keyless path. Unchanged. |
| MKT-03 | 02-04 | Raw per-contract quotes land in leg_observations append-only, source tagged | SATISFIED | leg-observations.ts persistObservations onConflictDoNothing; source='cboe' hardcoded. Unchanged. |
| BSM-01 | 02-03 | IV-inversion routine recovers implied vol, property-tested for monotonicity and round-trip | SATISFIED | Round-trip 1e-6 over 1000 inputs passes. CR-03 regression: deep-ITM European put (S=7000,K=7700,T=90/365,sigma=0.15) inverts and round-trips within 1e-4. WR-01 property: every ok result satisfies |bsmPrice(sigma)-mark| ≤ 1e-4 over 1000 runs. 17/17 iv-inversion tests green. |
| BSM-02 | 02-02 | Greeks routine computes delta/gamma/theta/vega, validated against reference values | SATISFIED | bsm.ts passes 3 calibration fixtures at <=1e-4; fast-check sanity passes 1000+ runs. Unchanged. |
| BSM-03 | 02-06 | Computed BSM values stored alongside vendor-raw values; reads prefer computed | SATISFIED | computeBsmGreeks.ts line 114 uses obs.time for T (CR-02 closed). Worker main.ts creates queues before scheduling (CR-01 closed). 9/9 computeBsmGreeks tests green including CR-02 regression. 218/218 total tests green. Production pipeline requires human Railway verification. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `apps/worker/src/handlers/fetch-rates.ts` | 3-4 | Duck-typed use-case type instead of real ForRunningFetchRate | WARNING | Breaking change to core Result shape not caught at typecheck time. Pre-existing; not introduced by gap closure. |
| `apps/worker/src/handlers/compute-bsm-greeks.ts` | 3-4 | Duck-typed use-case type instead of real return type | WARNING | Same as above for compute handler. Pre-existing; not introduced by gap closure. |
| `packages/adapters/src/postgres/repos/job-runs.ts` | 110-118 | Error catch matches any message containing "does not exist" | WARNING | Masks unrelated SQL errors. Pre-existing. |

No TBD/FIXME/XXX markers found in any file modified by gap closure plans (02-08, 02-09). The pre-existing warnings are real but do not block the phase goal — they should be addressed in a follow-on pass.

### Human Verification Required

#### 1. Production pipeline end-to-end on a fresh Railway database

**Test:** Deploy the worker to Railway against a fresh Supabase database. Wait for one RTH 30-minute slot (any weekday between 09:30 and 16:00 ET).
**Expected:** Process boots without "Queue fetch-cboe-chain not found" (or similar pg-boss FK error). After the slot: `curl /api/status` shows `fetch-cboe-chain.lastSuccessAt` populated; `SELECT count(*) FROM leg_observations WHERE source='cboe'` returns > 0; after the compute job fires, `SELECT count(*) FROM leg_observations WHERE bsm_iv IS NOT NULL` returns > 0.
**Why human:** Requires a live Railway deployment and real-time waiting for a market-hours slot. The `boss.createQueue()` → `boss.schedule()` ordering is confirmed in source, but the pg-boss v12 FK constraint behavior on a genuinely fresh Postgres schema (no pre-existing pgboss.queue table) cannot be exercised without a real deployment.

## Gaps Summary

No gaps remain. All six truths are verified at the code level.

The one remaining human verification item (Railway fresh-DB boot) is a production smoke test, not a code gap — the fix (three `boss.createQueue()` calls in correct source order) is confirmed in the codebase and exercised by the unit test for the related handler.

---

_Verified: 2026-06-11T21:15:00Z_
_Re-verified after gap closure plans 02-08 (commits 5431ceb, e0c13ca) and 02-09 (commits 7a6749a, 18a7fb1, 820158d)_
_Verifier: Claude (gsd-verifier)_

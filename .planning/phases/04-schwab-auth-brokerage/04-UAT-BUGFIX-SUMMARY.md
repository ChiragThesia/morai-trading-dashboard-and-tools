---
phase: 04-schwab-auth-brokerage
plan: UAT-bugfix
subsystem: adapters, auth
tags: [bugfix, tdd, sc2, sc3, chain-adapter, doctor]
dependency_graph:
  requires: [04-06-SUMMARY.md]
  provides: [scoped-schwab-chain-request, real-doctor-refresh-probe]
  affects: [packages/adapters/src/schwab/market/chain-adapter.ts, apps/auth/src/doctor.ts]
tech_stack:
  added: []
  patterns: [TDD red→green, makeRefreshTokenUseCase, msw request capture]
key_files:
  created: []
  modified:
    - packages/adapters/src/schwab/market/chain-adapter.ts
    - packages/adapters/src/schwab/market/chain-adapter.test.ts
    - packages/adapters/src/schwab/market/chain-adapter.contract.test.ts
    - apps/worker/src/main.ts
    - apps/auth/src/doctor.ts
    - apps/auth/src/doctor.test.ts
decisions:
  - SC3: scoping params (strikeCount/range/fromDate/toDate) injected via deps — tunable, not hardcoded
  - SC3: worker composition root uses strikeCount=50, range=NTM, today + today+90d sliding window
  - SC2: runDoctorCommand mirrors runRefresh pattern exactly (makeRefreshTokenUseCase with real repo)
  - SC2: refreshFn signature unchanged; _repo param renamed to repo (was unused, now used)
metrics:
  duration: ~15min
  completed: 2026-06-21
  tasks_completed: 4
  files_modified: 6
---

# Phase 04 UAT Bugfix Summary

Two major bugs found in live UAT (04-UAT.md Gaps), fixed with TDD red→green.

## Bugs Fixed

### SC3 — Schwab chain adapter HTTP 502 body overflow

**Root cause:** `makeSchwabChainAdapter` sent `symbol=$SPX&contractType=ALL` with no
strike or expiration narrowing. The full SPX chain (all expirations × all strikes) exceeds
Schwab's API gateway buffer limit → deterministic HTTP 502 "Body buffer overflow" → adapter
maps 502 to fetch-error → `selectChainSource` silently falls back to CBOE → Schwab-sourced
chain data never lands in production.

**Fix:** Added four scoping params to the adapter deps:
- `strikeCount` — strikes around ATM (worker: 50)
- `range` — Schwab range filter (worker: "NTM" near-the-money)
- `fromDate` — start expiration date YYYY-MM-DD (worker: today)
- `toDate` — end expiration date YYYY-MM-DD (worker: today+90d, covers near-term + calendar back months)

All four are injected via `deps` — no magic numbers in the adapter. The worker composition
root computes `fromDate`/`toDate` dynamically at boot so the window slides correctly.

**Files:**
- `packages/adapters/src/schwab/market/chain-adapter.ts` — added 4 required deps, set params on URL
- `packages/adapters/src/schwab/market/chain-adapter.test.ts` — 4 new scoping tests + 1 502 regression test
- `packages/adapters/src/schwab/market/chain-adapter.contract.test.ts` — updated factory call
- `apps/worker/src/main.ts` — composition root passes strikeCount=50, range=NTM, sliding dates

### SC2 — doctor live-refresh probe always returns NETWORK_ERROR

**Root cause:** `runDoctorCommand` in `apps/auth/src/doctor.ts` called
`refreshTokensFn("__doctor_probe__")` with a hardcoded dummy token and completely ignored
the real stored refresh token (the `_repo` param was unused). The dummy token caused the
OAuth client to return a network/parse error → `checkLiveRefresh` classified it as
`network-error` → doctor always reported `live refresh: NETWORK_ERROR` even when a real
refresh succeeded.

**Fix:** Rewired `runDoctorCommand` to mirror `runRefresh` exactly:
1. Build `makeRefreshTokenUseCase({ readTokens, writeTokens, refreshTokens })` from the repo + oauth client
2. Call `refreshUseCase("trader")` — reads the real stored token, calls Schwab OAuth, persists rotated token
3. Result maps directly to `checkLiveRefresh` classification: ok → OK, auth-expired → AUTH_EXPIRED, storage → NETWORK_ERROR

**Files:**
- `apps/auth/src/doctor.ts` — removed dummy token; builds real use-case from repo; imports `makeRefreshTokenUseCase` + types
- `apps/auth/src/doctor.test.ts` — 2 new integration tests for `runDoctorCommand` real wiring

## Deviations from Plan

None — plan executed exactly as specified.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 15bbf44 | test(04) RED | chain-adapter scoping params absent (SC3 regression) |
| af1c5bf | fix(04) | add request scoping params to Schwab chain adapter (SC3) |
| 92b7463 | test(04) RED | runDoctorCommand uses dummy token instead of real stored token (SC2) |
| 3f1c699 | fix(04) | wire real refresh use-case in runDoctorCommand (SC2) |

## Verification Gates

- vitest: 569 tests passed (59 test files) — full suite green
- typecheck: `tsc --build --force` exit 0 — no type errors
- lint: `eslint .` exit 0 — 0 errors (pre-existing boundary warnings only)

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- `packages/adapters/src/schwab/market/chain-adapter.ts` — exists, scoping params present
- `apps/auth/src/doctor.ts` — exists, makeRefreshTokenUseCase wired
- Commits 15bbf44, af1c5bf, 92b7463, 3f1c699 — all present in git log

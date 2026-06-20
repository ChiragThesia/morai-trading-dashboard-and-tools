---
phase: 04-schwab-auth-brokerage
plan: "06"
subsystem: brokerage
tags: [auth, tdd, worker, schwab, cboe-fallback, AUTH-04, D-07, D-08, D-09, T-04-26]
dependency_graph:
  requires:
    - "04-02 (status contract + getStatus per-app freshness — already delivered)"
    - "04-04 (selectChainSource, makeSchwabChainAdapter)"
    - "04-05 (brokerTokensRepo in server main.ts)"
  provides:
    - "fetch-schwab-chain handler: Schwab-primary chain job with CBOE-fallback logging (AUTH-04, D-07/D-08)"
    - "worker composition root wired with Schwab-primary selectChainSource chain job"
    - "AUTH-04 end-to-end: per-app AUTH_EXPIRED in /api/status; Schwab jobs pause; CBOE/others run"
  affects:
    - "apps/worker/src/handlers/fetch-schwab-chain.ts (created)"
    - "apps/worker/src/handlers/fetch-schwab-chain.test.ts (created)"
    - "apps/worker/src/main.ts (Schwab-primary wiring)"
    - "apps/server/src/adapters/http/brokerage.routes.test.ts (pre-existing lint fix)"
tech_stack:
  added: []
  patterns:
    - "Schwab-primary / CBOE-fallback via selectChainSource in composition root"
    - "T-04-26 logging: readTokenFreshness checked in handler for AUTH_EXPIRED warning"
    - "fetch-schwab-chain mirrors fetch-cboe-chain (array guard, RTH, boss.send)"
key_files:
  created:
    - "apps/worker/src/handlers/fetch-schwab-chain.ts"
    - "apps/worker/src/handlers/fetch-schwab-chain.test.ts"
  modified:
    - "apps/worker/src/main.ts"
    - "apps/server/src/adapters/http/brokerage.routes.test.ts"
decisions:
  - "fetchChainUseCase pre-wired with selectChainSource in composition root — handler stays thin (architecture law §3)"
  - "readTokenFreshness + logAuthExpiredFallback optional deps on handler for T-04-26 logging only — selection logic lives in selectChainSource"
  - "fetch-cboe-chain queue replaced by fetch-schwab-chain — D-07 Schwab-primary; existing CBOE fallback is transparent"
  - "fetch-rates, compute-bsm-greeks, snapshot-calendars schedules untouched — non-Schwab jobs continue on AUTH_EXPIRED (D-09)"
metrics:
  duration_minutes: 10
  completed_date: "2026-06-20"
  tasks_completed: 3
  tasks_deferred: 0
  files_changed: 4
---

# Phase 04 Plan 06: AUTH-04 Degradation Loop — Per-App Status + Worker Job Guard Summary

**One-liner:** Schwab-primary chain job handler with CBOE-fallback (T-04-26 logged), closing the AUTH-04 degradation loop; per-app status contract + getStatus freshness confirmed already delivered in wave 2 (04-02).

## Tasks Completed

| # | Task | Commit | Key Artifacts |
|---|------|--------|---------------|
| Idempotency check | Verified status contract + getStatus already green from 04-02 | — | 24/24 tests pass; no duplication |
| RED | Failing tests for fetch-schwab-chain handler | 9d3c249 | fetch-schwab-chain.test.ts — 7 behaviors |
| GREEN | fetch-schwab-chain impl + worker Schwab-primary wiring + lint fix | 00b12b5 | fetch-schwab-chain.ts, worker/main.ts, brokerage.routes.test.ts |

## Already Delivered in Wave 2 (04-02) — Not Duplicated

The following scope from the 04-06 PLAN was fully delivered in wave 04-02:

| Item | Status |
|------|--------|
| `packages/contracts/src/status.ts` — appTokenStatus + tokenFreshnessMap + union tokenFreshness | DONE (04-02, commit af4850f) |
| `packages/contracts/src/status.test.ts` — both union arms (backward compat + per-app map) | DONE (04-02) |
| `packages/core/src/journal/application/getStatus.ts` — readTokenFreshness dep, absorb to "none yet" | DONE (04-02, commit af4850f) |
| `packages/core/src/journal/application/getStatus.test.ts` — per-app AUTH_EXPIRED + absorb tests | DONE (04-02, 12/12 tests) |
| `apps/server/src/main.ts` — readTokenFreshness: brokerTokensRepo.readTokenFreshness wired | DONE (04-02, commit af4850f) |

Verified green: `bun vitest run packages/contracts/src/status.test.ts packages/core/src/journal/application/getStatus.test.ts` — 24/24 passed.

## Genuine Remaining Gap — Implemented This Wave

### fetch-schwab-chain.ts (new)

Schwab-primary chain job handler. Mirrors `fetch-cboe-chain.ts` shape exactly:
- Array guard (Pitfall 2 — pg-boss v12)
- RTH + NYSE holiday self-check (D-06 / CAL-05)
- Optional AUTH_EXPIRED fallback warning: when `readTokenFreshness` + `logAuthExpiredFallback: true` are injected, checks freshness and logs the T-04-26 operator-visible warning on `AUTH_EXPIRED`
- Calls `fetchChainUseCase` (pre-wired with `selectChainSource` in main.ts — handler stays thin per architecture-boundaries.md §3)
- On success: `boss.send("compute-bsm-greeks", ...)` with singletonKey (D-07, WR-02 catch)

### apps/worker/src/main.ts (updated)

- `makePostgresBrokerTokensRepo` built with `TOKEN_ENCRYPTION_KEY` (AUTH-04)
- `makeSchwabChainAdapter` built with `marketGetAccessToken` closure + `$SPX` symbol (D-05)
- `fetchChainUseCase` now uses `selectChainSource` at call time (not at boot): `schwabFetchChain` when market is fresh/stale (D-07); `cboeFetchChain` on AUTH_EXPIRED/none_yet/err (D-08)
- Queue renamed `fetch-cboe-chain` → `fetch-schwab-chain`; schedule + work registrations updated
- `fetch-rates`, `compute-bsm-greeks`, `snapshot-calendars` untouched — non-Schwab jobs keep running (D-09)

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | 9d3c249 — `test(04-06): add failing tests for fetch-schwab-chain handler` | PASS — failed with `Cannot find module './fetch-schwab-chain.ts'` |
| GREEN | 00b12b5 — `feat(04-06): implement fetch-schwab-chain handler + worker Schwab-primary wiring` | PASS — 7/7 new tests + 558/558 full suite |

## AUTH-04 End-to-End State

| Success Criterion | Status |
|-------------------|--------|
| On invalid_grant: GET /api/status reports per-app tokenFreshness AUTH_EXPIRED | DONE (04-02 + brokerTokensRepo wired in server main.ts) |
| On invalid_grant: MCP get_status reports per-app AUTH_EXPIRED | DONE (04-02 + same getStatus use-case) |
| Schwab-dependent jobs pause (CBOE fallback, logged) when market AUTH_EXPIRED | DONE (this wave — fetch-schwab-chain + selectChainSource) |
| CBOE + non-Schwab jobs keep running | DONE (this wave — fetch-rates/compute-bsm-greeks/snapshot unchanged) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 6 pre-existing as-cast lint errors in brokerage.routes.test.ts**

- **Found during:** `bun run lint` gate check (pre-existing from wave 04-05)
- **Issue:** `(body as { paused?: boolean }).paused` pattern — forbidden by `@typescript-eslint/consistent-type-assertions`; 6 occurrences across 3 AUTH_EXPIRED test cases (positions, transactions, orders)
- **Fix:** Imported `brokerageAuthExpiredPayload` from `@morai/contracts`; replaced `as` casts with `brokerageAuthExpiredPayload.parse(body)` — Zod parse-don't-cast pattern
- **Files modified:** `apps/server/src/adapters/http/brokerage.routes.test.ts`
- **Commit:** 00b12b5

**2. [Design] fetchChainUseCase built with selectChainSource closure vs per-call injection**

- **Context:** Plan described handler calling `selectChainSource(deps)` directly. After reading the test shape (handler receives a single `fetchChainUseCase`), the cleaner pattern is to build a closure in main.ts that calls selectChainSource at execution time (not at boot). Handler stays thin.
- **Impact:** Handler behavior is identical; tests pass; architecture-boundaries §3 preserved.

## Known Stubs

None — all fields wired. `selectChainSource` picks the real Schwab or CBOE adapter at job execution time.

## Threat Flags

| Flag | File | Disposition |
|------|------|-------------|
| T-04-23 (mitigated) | status.ts | tokenFreshness exposes only enum + timestamps, never token values |
| T-04-24 (mitigated) | fetch-schwab-chain.ts + worker/main.ts | market AUTH_EXPIRED → CBOE fallback; non-expired app unaffected; non-Schwab jobs continue |
| T-04-25 (mitigated) | selectChainSource.ts | AUTH_EXPIRED/none_yet/err → CBOE; never silently calls expired app |
| T-04-26 (mitigated) | fetch-schwab-chain.ts | console.warn names market app + AUTH_EXPIRED reason; visible in worker logs + /api/status |

## Self-Check

| Check | Result |
|-------|--------|
| apps/worker/src/handlers/fetch-schwab-chain.ts | FOUND |
| apps/worker/src/handlers/fetch-schwab-chain.test.ts | FOUND |
| RED commit 9d3c249 | FOUND |
| GREEN commit 00b12b5 | FOUND |
| bun vitest run (3 plan-specific files): 31/31 | PASS |
| bun run test (full suite): 558/558 | PASS |
| bun run typecheck: exit 0 | PASS |
| bun run lint: no errors | PASS |

---
phase: 05-jobs-fill-rebuild-integrity
plan: 05
subsystem: refresh-tokens-job
tags: [pg-boss, tdd, jrnl-02, job-02, schwab-auth, token-freshness, sc2]
dependency_graph:
  requires:
    - phase: 05-04
      provides: registerAllJobs handler slot for refreshTokens (schedule.ts)
    - phase: 04-02
      provides: broker-tokens repo (makePostgresBrokerTokensRepo, makeRefreshTokenUseCase)
    - phase: 04-01
      provides: broker_tokens table (base schema with timestamp columns)
  provides:
    - isNearExpiry pure function: proactive 7-day expiry warning at day 6 (D-14)
    - makeRefreshTokensUseCase: per-app independence via Promise.allSettled (D-13)
    - ForRecordingRefreshOutcome port: per-app refresh failure flag writer
    - makeRefreshTokensHandler: no RTH gate; no throw on failure; records per-app outcome
    - broker_tokens.last_refresh_error: persisted per-app failure flag (D-14)
    - GET /api/status: tokenFreshness.{appId}.lastRefreshError surfaced (SC2)
    - 0005_broker_tokens_refresh_error.sql: additive nullable column migration
  affects:
    - apps/server: appTokenStatus Zod schema now includes lastRefreshError (GET /api/status)
    - apps/auth: SchwabTokenRow extended with lastRefreshError (construction sites updated)
    - 05-07 (sync-fills): no direct dependency
    - 05-08 (rebuild-journal): no direct dependency
tech_stack:
  added: []
  patterns:
    - "Promise.allSettled for per-app independence: both apps always attempted (D-13)"
    - "ForRecordingRefreshOutcome: bound $N UPDATE of last_refresh_error (T-05-14 — no sql.raw)"
    - "lastRefreshError carried through toAppTokenStatus from row into AppTokenStatus (read model)"
    - "recordRefreshOutcome: null clears the flag (recovery); non-null persists failure (D-14)"
    - "No RTH gate on refresh-tokens handler: runs at 04:00 ET outside market hours (Pitfall 5)"
key-files:
  created:
    - packages/adapters/src/postgres/migrations/0005_broker_tokens_refresh_error.sql
  modified:
    - packages/core/src/brokerage/domain/token-freshness.ts (isNearExpiry added; toAppTokenStatus carries lastRefreshError)
    - packages/core/src/brokerage/domain/token-freshness.test.ts (5 new isNearExpiry tests)
    - packages/core/src/brokerage/application/refreshTokens.ts (full implementation: Promise.allSettled, warnExpirySoon)
    - packages/core/src/brokerage/application/refreshTokens.test.ts (pre-existing RED stubs — now GREEN)
    - packages/core/src/brokerage/application/ports.ts (ForRecordingRefreshOutcome added; AppTokenStatus + SchwabTokenRow extended)
    - packages/core/src/brokerage/index.ts (isNearExpiry, ForRecordingRefreshOutcome exported)
    - packages/core/src/index.ts (isNearExpiry, ForRecordingRefreshOutcome exported)
    - packages/contracts/src/status.ts (appTokenStatus + lastRefreshError: z.string().nullable())
    - packages/adapters/src/postgres/schema.ts (brokerTokens: lastRefreshError text nullable)
    - packages/adapters/src/postgres/repos/broker-tokens.ts (recordRefreshOutcome; readTokenFreshness reads lastRefreshError; readTokens reads lastRefreshError)
    - packages/adapters/src/memory/broker-tokens.ts (recordRefreshOutcome + readTokenFreshness carries lastRefreshError)
    - packages/adapters/src/__contract__/broker-tokens.contract.ts (makeRow updated with lastRefreshError: null)
    - apps/worker/src/handlers/refresh-tokens.ts (full implementation: no RTH gate, recordRefreshOutcome, warn on failure)
    - apps/worker/src/handlers/refresh-tokens.test.ts (SC2 status surface test added)
    - apps/worker/src/main.ts (real makeRefreshTokensUseCase + recordRefreshOutcome wired)
    - apps/auth/src/doctor.test.ts (TRADER_TOKEN: lastRefreshError: null)
    - apps/auth/src/setup.ts (tokenRow: lastRefreshError: null)
    - packages/core/src/brokerage/application/refreshToken.ts (rotatedRow: lastRefreshError preserved from currentTokens)
    - packages/core/src/brokerage/application/refreshToken.test.ts (makeStoredRow: lastRefreshError: null)
key-decisions:
  - "isNearExpiry threshold: age >= REFRESH_TTL - WARN_THRESHOLD = 7d - 1d = 6d (D-14 Pattern 5)"
  - "lastRefreshError persisted on broker_tokens (not in-memory map) — worker and server are separate processes; an in-memory map is not readable by getStatus"
  - "ForRecordingRefreshOutcome: null = success clears flag; non-null = failure persists; writeTokens does NOT reset the flag"
  - "refreshToken.ts rotatedRow preserves existing lastRefreshError — only recordRefreshOutcome owns that column"
  - "SC2 resolved via option (a): persisted nullable column on existing broker_tokens — no new table (D-14 / RESEARCH A4)"
  - "makeRefreshTokensHandler: recordRefreshOutcome is optional dep for backward compat (stub usage in 05-04)"
metrics:
  duration: 22
  completed: "2026-06-21"
  tasks: 2
  files: 19
---

# Phase 5 Plan 05: Refresh-Tokens Job Summary

**JOB-02 (SC2) vertical slice: isNearExpiry domain function + makeRefreshTokensUseCase (Promise.allSettled per-app independence) + makeRefreshTokensHandler (no RTH gate) + ForRecordingRefreshOutcome port + broker_tokens.last_refresh_error persisted column + GET /api/status tokenFreshness.{appId}.lastRefreshError observable**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-06-21T17:20:00Z
- **Completed:** 2026-06-21T17:42:00Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments

- `isNearExpiry(refreshIssuedAt, now): boolean` pure domain function: true when age >= 6 days (REFRESH_TTL=7d, WARN=1d). 5 tests GREEN.
- `makeRefreshTokensUseCase`: Promise.allSettled guarantees D-13 per-app independence. Both apps always attempted even when one fails. warnExpirySoon computed from readTokenFreshness + isNearExpiry. Always returns ok(). 5 tests GREEN.
- `ForRecordingRefreshOutcome` driven port: bound $N UPDATE of last_refresh_error. null = clears flag on success; non-null = persists failure. T-05-14 compliant.
- `AppTokenStatus` and `SchwabTokenRow` extended with `lastRefreshError: string | null`. `toAppTokenStatus` carries it from row into status. All construction sites updated.
- `appTokenStatus` Zod schema in contracts/status.ts includes `lastRefreshError: z.string().nullable()` — the flag is part of the GET /api/status body.
- `0005_broker_tokens_refresh_error.sql` generated: additive nullable `ALTER TABLE broker_tokens ADD COLUMN last_refresh_error text` — no DROP, no RENAME, non-destructive.
- `makePostgresBrokerTokensRepo` + `makeMemoryBrokerTokensRepo` extended with `recordRefreshOutcome`; `readTokenFreshness` reads `lastRefreshError` into freshness map.
- `makeRefreshTokensHandler`: no RTH gate, no holiday gate; per-app console.warn on failure (appId only — never token values); recordRefreshOutcome called per app; does NOT throw on per-app failure (D-13).
- SC2 verified end-to-end: after trader-fail/market-ok run, `readTokenFreshness()` returns `trader.lastRefreshError` non-null and `market.lastRefreshError` null.
- `main.ts` rewired: real `makeRefreshTokensUseCase` with trader + market OAuth clients (per-app `makeSchwabOAuthClient`); `recordRefreshOutcome` injected into handler.

## TDD Gate Compliance

Both tasks followed RED → GREEN:

| Task | RED commit | GREEN commit |
|------|-----------|-------------|
| 1: isNearExpiry + makeRefreshTokensUseCase | 928fafe (test) | e4daf15 (feat) |
| 2: handler + status surface + migration | 6c3f239 (test) | 0b2f61e (feat) |

**Task 1 RED:** 5 isNearExpiry tests fail with "isNearExpiry is not a function". Existing 8 token-freshness tests still GREEN.

**Task 1 GREEN:** 13/13 token-freshness tests GREEN; 5/5 refreshTokens use-case tests GREEN (18 total).

**Task 2 RED:** SC2 status surface test added to handler suite. All 5 handler tests fail with "not implemented".

**Task 2 GREEN:** 6/6 handler tests GREEN (including SC2). All 24 plan tests GREEN.

## Task Commits

1. **Task 1 RED: isNearExpiry tests** - `928fafe` (test)
2. **Task 1 GREEN: isNearExpiry + makeRefreshTokensUseCase** - `e4daf15` (feat)
3. **Task 2 RED: SC2 status surface + handler suite** - `6c3f239` (test)
4. **Task 2 GREEN: handler + migration + ports + adapters + main.ts wiring** - `0b2f61e` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] SchwabTokenRow extended with lastRefreshError**
- **Found during:** Task 2 (implementing toAppTokenStatus carry-through)
- **Issue:** The plan specifies `toAppTokenStatus` carries `lastRefreshError` from the row, but `SchwabTokenRow` didn't have the field. Without it, the domain function couldn't read the value from the row.
- **Fix:** Added `lastRefreshError: string | null` to `SchwabTokenRow`. Updated all construction sites: `refreshToken.ts` rotatedRow, `refreshToken.test.ts` makeStoredRow, `doctor.test.ts` TRADER_TOKEN, `setup.ts` tokenRow, `broker-tokens.contract.ts` makeRow.
- **Files modified:** ports.ts, refreshToken.ts, refreshToken.test.ts, doctor.test.ts, setup.ts, broker-tokens.contract.ts
- **Committed in:** 0b2f61e (Task 2 GREEN commit)

**2. [Rule 2 - Missing Critical] recordRefreshOutcome declared optional in handler deps**
- **Found during:** Task 2 (writing makeRefreshTokensHandler)
- **Issue:** The plan 05-04 stub `refreshTokensHandler` was created with `{ refreshTokensUseCase, now }` deps (no `recordRefreshOutcome`). Making it required would break the existing stub call site in main.ts before the rewrite.
- **Fix:** `recordRefreshOutcome` is optional in `RefreshTokensHandlerDeps`. The handler skips recording when not provided. main.ts is rewired in the same commit to inject the real port.
- **Files modified:** apps/worker/src/handlers/refresh-tokens.ts
- **Committed in:** 0b2f61e (Task 2 GREEN commit)

## Known Stubs

None — all handler behavior is implemented. The `syncFills` and `rebuildJournal` handler stubs in main.ts are pre-existing (plans 05-07 and 05-08 respectively) and are out of scope for this plan.

## Threat Flags

None — no new network endpoints introduced. The refresh endpoint is an outbound call to Schwab OAuth (existing threat surface from Phase 4). The `last_refresh_error` column is a plain text field written with bound parameters only (T-05-14 compliant).

## Self-Check

### Files exist:
- packages/core/src/brokerage/domain/token-freshness.ts — FOUND
- packages/core/src/brokerage/application/refreshTokens.ts — FOUND
- apps/worker/src/handlers/refresh-tokens.ts — FOUND
- packages/adapters/src/postgres/migrations/0005_broker_tokens_refresh_error.sql — FOUND

### Commits exist:
- 928fafe (RED Task 1) — FOUND
- e4daf15 (GREEN Task 1) — FOUND
- 6c3f239 (RED Task 2) — FOUND
- 0b2f61e (GREEN Task 2) — FOUND

## Self-Check: PASSED

All files created, all commits present, all 24 plan tests GREEN, migration generated (not applied).

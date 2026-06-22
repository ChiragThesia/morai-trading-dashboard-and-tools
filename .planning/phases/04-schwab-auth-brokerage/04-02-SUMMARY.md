---
phase: 04-schwab-auth-brokerage
plan: "02"
subsystem: brokerage
tags: [oauth, pgcrypto, tdd, msw, testcontainers, brokerage-repo, token-refresh, status-contract]
dependency_graph:
  requires:
    - "04-01 (brokerage ports, broker_tokens schema, memory twin)"
  provides:
    - "makeSchwabOAuthClient: buildAuthUrl, exchangeCode, refreshTokens (AUTH-01)"
    - "makePostgresBrokerTokensRepo: readTokens, writeTokens, readTokenFreshness via pgcrypto (AUTH-02)"
    - "makeRefreshTokenUseCase: on-demand token rotation (AUTH-01)"
    - "runBrokerTokensContractTests harness for pgcrypto round-trip"
    - "statusResponse contract extended to union tokenFreshness with per-app map (AUTH-04)"
    - "getStatus use-case wired with readTokenFreshness dep"
  affects:
    - "packages/contracts/src/status.ts (tokenFreshness breaking change)"
    - "packages/core/src/journal/application/getStatus.ts (new dep)"
    - "packages/adapters/src/index.ts (new exports)"
    - "packages/core/src/brokerage/index.ts (new use-case exports)"
    - "packages/core/src/index.ts (new use-case exports)"
    - "apps/server/src/main.ts (broker-tokens repo wired)"
tech_stack:
  added: []
  patterns:
    - "MSW setupServer for Schwab OAuth token endpoint mocking"
    - "testcontainers Postgres 16 + pgcrypto for broker_tokens round-trip"
    - "Drizzle sql`` bound params for pgp_sym_encrypt/decrypt (D-03)"
    - "isAppId type guard to narrow Drizzle text → AppId without as cast"
    - "TDD RED→GREEN per feature unit; three commit pairs"
key_files:
  created:
    - "packages/adapters/src/schwab/auth/oauth-client.ts"
    - "packages/adapters/src/schwab/auth/oauth-client.test.ts"
    - "packages/adapters/src/postgres/repos/broker-tokens.ts"
    - "packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts"
    - "packages/adapters/src/__contract__/broker-tokens.contract.ts"
    - "packages/core/src/brokerage/application/refreshToken.ts"
    - "packages/core/src/brokerage/application/refreshToken.test.ts"
  modified:
    - "packages/contracts/src/status.ts"
    - "packages/contracts/src/status.test.ts"
    - "packages/core/src/journal/application/getStatus.ts"
    - "packages/core/src/journal/application/getStatus.test.ts"
    - "packages/core/src/brokerage/index.ts"
    - "packages/core/src/index.ts"
    - "packages/adapters/src/index.ts"
    - "apps/server/src/main.ts"
decisions:
  - "readTokenFreshness is optional in makeGetStatusUseCase deps — backward compat for tests that don't inject it"
  - "isAppId(value) type guard instead of as cast — narrows Drizzle text column to AppId union (no-as rule)"
  - "refreshIssuedAt preserved from original stored row on token rotation — 7-day TTL anchored to first auth-code exchange, not refresh"
  - "Network/parse OAuth errors map to err({kind:auth-expired}) in use-case — safe degradation over leaking internal error codes"
  - "OAuthError and SchwabTokens defined in refreshToken.ts (core) to avoid core importing from adapters"
  - "statusResponse tokenFreshness: z.union([z.literal('none yet'), tokenFreshnessMap]) — backward compat preserved"
metrics:
  duration_minutes: 20
  completed_date: "2026-06-20"
  tasks_completed: 4
  tasks_deferred: 0
  files_changed: 15
---

# Phase 04 Plan 02: Schwab OAuth Client + pgcrypto Broker Tokens Repo + Refresh Use-Case — Summary

Vendored Schwab OAuth client (Basic-auth, Zod-parsed, msw-tested), Postgres broker-tokens repo with pgcrypto encryption at rest (key as bound parameter, testcontainers round-trip), and on-demand refresh use-case; plus the status contract evolution to surface per-app token freshness.

## Tasks Completed

| # | Task | Commit | Key Artifacts |
|---|------|--------|---------------|
| 1 (RED) | Failing OAuth client tests | 3607262 | oauth-client.test.ts — 14 behaviors (exchange, refresh, errors, headers) |
| 1 (GREEN) | Schwab OAuth client impl | f874dc4 | oauth-client.ts — makeSchwabOAuthClient, SchwabTokens, OAuthError |
| 2 (RED) | Failing broker-tokens contract tests | e1199c6 | broker-tokens.contract.ts harness + contract.test.ts |
| 2 (GREEN) | Postgres broker-tokens repo | 0fa33b2 | broker-tokens.ts — pgcrypto bound params, isAppId guard, readTokenFreshness |
| 3 (RED) | Failing refreshToken use-case tests | de6c51a | refreshToken.test.ts — 7 behaviors |
| 3 (GREEN) | RefreshToken use-case impl | 0b1de33 | refreshToken.ts — makeRefreshTokenUseCase, ForRefreshingToken |
| 4 (WIRING) | Status contract + barrel exports + server wiring | af4850f | status.ts, getStatus.ts, main.ts, index barrels |

## TDD Gate Compliance

RED gate: Three test commits preceding implementation in order:
- `test(04-02): add failing tests for Schwab OAuth client` — commit `3607262`
- `test(04-02): add failing contract tests for broker-tokens pgcrypto repo` — commit `e1199c6`
- `test(04-02): add failing tests for refreshToken use-case` — commit `de6c51a`

GREEN gate: Three implementation commits following each RED:
- `feat(04-02): implement Schwab OAuth client` — commit `f874dc4`
- `feat(04-02): implement Postgres broker-tokens repo with pgcrypto encryption` — commit `0fa33b2`
- `feat(04-02): implement refreshToken use-case` — commit `0b1de33`

## pgcrypto Security Assertions (T-04-04/T-04-05)

Verified by testcontainers contract test (`broker-tokens.contract.test.ts`):
- `writeTokens` then `rawReadAccessToken` → stored bytes are NOT equal to plaintext
- `pgp_sym_encrypt` output length exceeds plaintext length (PGP header overhead)
- Key passed via Drizzle `sql`` template — becomes `$N` bound parameter in Postgres wire protocol; never inlined via `sql.raw()`
- `readTokens` decrypts back to original plaintext via `pgp_sym_decrypt(col, key)` as bound param

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Correctness] isAppId type guard instead of as cast**

- **Found during:** Lint check after broker-tokens.ts implementation
- **Issue:** Drizzle returns `appId: string` (text column); plan implied `as AppId` cast — forbidden by TypeScript rule (no-as)
- **Fix:** Added `isAppId(value: string): value is AppId` type guard; returns `err({kind:storage-error})` for unexpected DB values
- **Files modified:** `packages/adapters/src/postgres/repos/broker-tokens.ts`
- **Commit:** af4850f (bundled in wiring commit)

**2. [Rule 1 - Bug] refreshToken.test.ts needed kind narrowing before appId access**

- **Found during:** Typecheck after wiring commit
- **Issue:** `result.error` typed as `StorageError | AuthExpiredError`; accessing `.appId` without narrowing fails typecheck
- **Fix:** Added `if (result.error.kind !== "auth-expired") return;` narrowing before `.appId` access in 2 test cases
- **Files modified:** `packages/core/src/brokerage/application/refreshToken.test.ts`
- **Commit:** af4850f

**3. [Rule 2 - Missing] readTokenFreshness is optional in makeGetStatusUseCase**

- **Found during:** getStatus.test.ts existing tests — they don't inject readTokenFreshness
- **Issue:** Making readTokenFreshness required would break all existing getStatus tests and mcp.test.ts
- **Fix:** Made readTokenFreshness optional (`readonly readTokenFreshness?: ForReadingTokenFreshness`); falls back to "none yet" if undefined
- **Files modified:** `packages/core/src/journal/application/getStatus.ts`
- **Commit:** af4850f

**4. [Rule 1 - Bug] getStatus.test.ts used as TokenFreshnessMap assertion (lint error)**

- **Found during:** Lint check
- **Issue:** `const freshness = result.value.tokenFreshness as TokenFreshnessMap` — forbidden as-cast
- **Fix:** Replaced with `if (freshness === "none yet") return;` narrowing (discriminated by string literal)
- **Files modified:** `packages/core/src/journal/application/getStatus.test.ts`
- **Commit:** af4850f

## Known Stubs

None — all three artifacts fully implemented with real logic. The broker-tokens repo reads/writes to the real Postgres schema (via testcontainers in tests). The OAuth client makes real HTTP POSTs (via msw in tests).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-04-04 (mitigated) | broker-tokens.ts | Key + tokens never passed to console.*; catch maps to {kind,message} only |
| T-04-05 (mitigated) | broker-tokens.ts | pgp_sym_encrypt/decrypt key bound as $N via Drizzle sql`` — never sql.raw |
| T-04-06 (mitigated) | oauth-client.ts | Authorization: Basic base64(appKey:appSecret) on all token calls; precomputed once, never logged |
| T-04-07 (mitigated) | oauth-client.ts | Error body parsed to typed code; only kind/code/message surfaced; refresh token never echoed |
| T-04-08 (mitigated) | refreshToken.ts | On invalid_grant/invalid_client: zero writes (no half-state); proven by test asserting writeCallCount=0 |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| packages/adapters/src/schwab/auth/oauth-client.ts | FOUND |
| packages/adapters/src/schwab/auth/oauth-client.test.ts | FOUND |
| packages/adapters/src/postgres/repos/broker-tokens.ts | FOUND |
| packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts | FOUND |
| packages/adapters/src/__contract__/broker-tokens.contract.ts | FOUND |
| packages/core/src/brokerage/application/refreshToken.ts | FOUND |
| packages/core/src/brokerage/application/refreshToken.test.ts | FOUND |
| commit 3607262 (oauth-client RED) | FOUND |
| commit f874dc4 (oauth-client GREEN) | FOUND |
| commit e1199c6 (broker-tokens contract RED) | FOUND |
| commit 0fa33b2 (broker-tokens GREEN) | FOUND |
| commit de6c51a (refreshToken RED) | FOUND |
| commit 0b1de33 (refreshToken GREEN) | FOUND |
| commit af4850f (wiring + contract) | FOUND |
| typecheck: bun run typecheck | PASS |
| lint: bun run lint | PASS |
| oauth-client.test.ts: 14/14 | PASS |
| broker-tokens.contract.test.ts: 6/6 (testcontainers + pgcrypto) | PASS |
| refreshToken.test.ts: 7/7 | PASS |
| status.test.ts: updated for AUTH-04 union | PASS |
| getStatus.test.ts: 12/12 (including 4 new AUTH-04 tests) | PASS |

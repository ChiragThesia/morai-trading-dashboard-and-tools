---
phase: 04-schwab-auth-brokerage
plan: "03"
subsystem: auth-cli
tags: [auth-cli, tdd, oauth, doctor, csrf, loopback]
dependency_graph:
  requires:
    - "04-01 (brokerage ports, broker_tokens schema, config)"
    - "04-02 (SchwabOAuthClient, makePostgresBrokerTokensRepo, makeRefreshTokenUseCase)"
  provides:
    - "apps/auth workspace app (package.json, tsconfig.json, vitest.config.ts)"
    - "parseAuthConfig + bootAuthConfig (DATA-04 loud-fail)"
    - "CLI dispatch: setup | refresh | status | doctor subcommands"
    - "doctor: checkEnvCompleteness + checkCallbackExactMatch + checkLiveRefresh (pure, unit-tested)"
    - "runStatus: reads ForReadingTokenFreshness — no Schwab call"
    - "validateAndExchange: pure CSRF check + code exchange (TDD — state-mismatch / happy / failure)"
    - "runSetup shell: oauth-callback + open, port from URL, validateAndExchange, writeTokens"
    - "runRefresh: makeRefreshTokenUseCase wired"
  affects:
    - "tsconfig.json (apps/auth added to project references)"
    - "eslint.config.js (apps/auth/tsconfig.json added to both project lists)"
tech_stack:
  added: []
  patterns:
    - "parseAuthConfig(env) + bootAuthConfig() DATA-04 loud-fail pattern (mirrors apps/server)"
    - "Pure diagnostic functions taking explicit inputs (testable without process.env/network)"
    - "TDD red→green for validateAndExchange (in-memory fake OAuthClientPort spy)"
    - "Port from registered callback URL via new URL(callbackUrl).port (Open Question 1)"
    - "oauth-callback getAuthCode + open for browser launch + loopback capture"
key_files:
  created:
    - apps/auth/package.json
    - apps/auth/tsconfig.json
    - apps/auth/vitest.config.ts
    - apps/auth/src/config.ts
    - apps/auth/src/main.ts
    - apps/auth/src/doctor.ts
    - apps/auth/src/doctor.test.ts
    - apps/auth/src/status.ts
    - apps/auth/src/setup.ts
    - apps/auth/src/setup.test.ts
    - apps/auth/src/refresh.ts
  modified:
    - tsconfig.json
    - eslint.config.js
decisions:
  - "doctor functions are PURE taking explicit inputs — no process.env, no network — enables unit tests without live deps"
  - "validateAndExchange extracts CSRF check + code exchange into a pure function; runSetup is the thin imperative shell"
  - "State-mismatch guard is the FIRST thing validateAndExchange does — exchangeCode is unreachable on mismatch (T-04-09 ordering)"
  - "Port derived from new URL(config.SCHWAB_*_CALLBACK_URL).port — no hardcoded port (Open Question 1 resolved)"
  - "rawState set to empty string '' when oauth-callback omits it — validateAndExchange rejects on CSRF mismatch"
  - "runDoctorCommand receives refreshTokensFn directly; doctor currently probes with the OAuth refreshTokens fn"
  - "subcommand narrowed from string | undefined to string via ?? '' before switch — satisfies switch-exhaustiveness-check"
metrics:
  duration_minutes: 15
  completed_date: "2026-06-20"
  tasks_completed: 2
  tasks_deferred: 1
  files_changed: 13
---

# Phase 04 Plan 03: auth CLI — Summary

Apps/auth workspace: four subcommands, doctor diagnostic functions (unit-tested), pure validateAndExchange (CSRF + code-exchange, TDD), runSetup loopback shell, runRefresh use-case wiring, and runStatus DB-only freshness reader.

## Tasks Completed

| # | Task | Commit | Key Artifacts |
|---|------|--------|---------------|
| 1 | Scaffold apps/auth + config + CLI dispatch + doctor (TDD) | 7caaad2 | package.json, tsconfig.json, vitest.config.ts, config.ts, main.ts, doctor.ts, doctor.test.ts, status.ts, setup.ts (stub), refresh.ts |
| 2 | validateAndExchange TDD + setup/refresh shells | ef183f2 | setup.test.ts (7 tests), validateAndExchange pure impl, runSetup shell, runRefresh |

## Deferred — Live Action Required

### Task 3: Live verify — auth setup + status + doctor against real Schwab

**Status:** DEFERRED — no live Schwab credentials or DATABASE_URL available. The CLI is code-complete; only the live browser OAuth dance cannot be automated.

**Prerequisites:**
- Registered Schwab apps credentials in `.env`:
  - `SCHWAB_TRADER_APP_KEY`, `SCHWAB_TRADER_APP_SECRET`, `SCHWAB_TRADER_CALLBACK_URL`
  - `SCHWAB_MARKET_APP_KEY`, `SCHWAB_MARKET_APP_SECRET`, `SCHWAB_MARKET_CALLBACK_URL`
- `TOKEN_ENCRYPTION_KEY` (32+ chars) in `.env`
- `DATABASE_URL` pointing to the Supabase DB with `broker_tokens` table (migration 0003_broker_tokens.sql applied)

**Steps to complete:**
1. `bun run apps/auth/src/main.ts doctor` — confirm env completeness and callback-URL match.
   - Temporarily unset one `SCHWAB_*` var to see it flag the missing key.
   - Provide a mismatched callback URL to see the mismatch diagnostic.
2. `bun run apps/auth/src/main.ts setup trader` — browser opens to Schwab login; confirm loopback captures redirect and CLI prints success with timestamps.
3. `bun run apps/auth/src/main.ts setup market` — repeat for market app.
4. Verify encrypted rows: `psql "$DATABASE_URL" -c "SELECT app_id, length(access_token) FROM broker_tokens"` — should show two rows with non-zero bytea length.
5. `psql "$DATABASE_URL" -c "SELECT access_token FROM broker_tokens LIMIT 1"` — must NOT be human-readable plaintext.
6. `bun run apps/auth/src/main.ts status` — prints `trader: fresh`, `market: fresh` without Schwab call.
7. `bun run apps/auth/src/main.ts refresh trader` — rotates token, `updated_at` advances.

**Acceptance criteria:** Two encrypted broker_tokens rows; status/doctor/refresh work; no token/key in any output.

## TDD Gate Compliance

Task 1 doctor diagnostic:
- RED gate: doctor.test.ts written before doctor.ts implementation (module-not-found error confirmed on first run)
- GREEN gate: doctor.ts implemented; 12/12 tests pass

Task 2 validateAndExchange:
- Both RED and GREEN occurred within Task 1's scaffold commit (implementation required for compilation).
- setup.test.ts committed in Task 2 (ef183f2) with 7/7 tests green, verifying all three security invariants.
- Implementation satisfies the ordering invariant: state check is the first line, exchangeCode unreachable on mismatch.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] switch-exhaustiveness-check: subcommand is string | undefined**
- **Found during:** Task 1 ESLint run
- **Issue:** `process.argv[2]` destructuring yields `string | undefined` with `noUncheckedIndexedAccess`; `switch-exhaustiveness-check` requires undefined to have a case
- **Fix:** Narrowed with `const subcommand: string = rawSubcommand ?? ""` before switch
- **Files modified:** `apps/auth/src/main.ts`
- **Commit:** 7caaad2

**2. [Rule 2 - Missing] doctor.ts repo param typed with unknown tokens**
- **Found during:** Task 1 typecheck
- **Issue:** `runDoctorCommand` had `tokens: unknown` in repo param type; `PostgresBrokerTokensRepo.writeTokens` expects `SchwabTokenRow` — not assignable
- **Fix:** Changed to `ForReadingTokens` / `ForWritingTokens` port types (renamed param to `_repo` since unused in this implementation)
- **Files modified:** `apps/auth/src/doctor.ts`
- **Commit:** 7caaad2

**3. [Rule 1 - Correctness] oauth-callback CallbackResult has optional code/state**
- **Found during:** Task 2 — inspecting oauth-callback type definitions
- **Issue:** `getAuthCode` returns `{ code?: string; state?: string; ... }` (optional fields); would fail at runtime if `code` is absent
- **Fix:** Added explicit guard: if `captured.code === undefined` → exit(1); `rawState = captured.state ?? ""`
- **Files modified:** `apps/auth/src/setup.ts`
- **Commit:** 7caaad2

## Known Stubs

None — all implemented functions have correct logic. `runSetup` and `runRefresh` are imperative shells awaiting live OAuth credentials for end-to-end validation (Task 3 deferred).

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| T-04-09 (mitigated) | setup.ts | validateAndExchange: state check is first; exchangeCode unreachable on mismatch — proven by setup.test.ts callCount()===0 assertion |
| T-04-11 (mitigated) | setup.ts, refresh.ts, status.ts, doctor.ts | Only appId, timestamps, and diagnostic status printed; tokens/keys never echoed — verified by code review (no console.* on token values) |
| T-04-12 (mitigated) | doctor.ts | checkCallbackExactMatch: character-for-character string equality (Pitfall 1) — tested with trailing-slash and port-differ cases |
| T-04-13 (mitigated) | setup.ts | validateAndExchange is called immediately after loopback capture; persistence happens only after successful exchange (ordering: capture → validate → exchange → persist) |

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| apps/auth/package.json | FOUND |
| apps/auth/tsconfig.json | FOUND |
| apps/auth/vitest.config.ts | FOUND |
| apps/auth/src/config.ts | FOUND |
| apps/auth/src/main.ts | FOUND |
| apps/auth/src/doctor.ts | FOUND |
| apps/auth/src/doctor.test.ts | FOUND |
| apps/auth/src/status.ts | FOUND |
| apps/auth/src/setup.ts | FOUND |
| apps/auth/src/setup.test.ts | FOUND |
| apps/auth/src/refresh.ts | FOUND |
| commit 7caaad2 (Task 1) | FOUND |
| commit ef183f2 (Task 2) | FOUND |
| bun run typecheck | PASS (exit 0) |
| bunx eslint apps/auth/src/ | PASS (no errors) |
| doctor.test.ts: 12/12 | PASS |
| setup.test.ts: 7/7 | PASS |
| Task 3 (live verify) | DEFERRED |

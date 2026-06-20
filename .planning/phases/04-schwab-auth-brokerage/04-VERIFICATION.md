---
phase: 04-schwab-auth-brokerage
verified: 2026-06-20T13:52:00Z
status: human_needed
score: 5/5 success criteria verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "SC3: fetchChain.ts and snapshotCalendars.ts no longer hardcode source='cboe'; source provenance now flows RawChain.source → ObservationRow.source → LegSnapshot.source → SnapshotRow.source"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run bun run apps/auth/src/main.ts setup trader with live Schwab credentials"
    expected: "Browser opens to Schwab authorization page; loopback captures redirect; CLI prints success with timestamps; broker_tokens table gains a trader row with non-readable bytea columns"
    why_human: "Requires live Schwab OAuth dance in a browser — cannot be automated; live DATABASE_URL and Schwab app credentials required (deferred per 04-03 Task 3)"
  - test: "Run bun run apps/auth/src/main.ts setup market, then auth status, then auth refresh trader"
    expected: "market row written; status prints trader: fresh, market: fresh without any Schwab call; refresh rotates the trader token and advances updated_at"
    why_human: "End-to-end OAuth loopback flow; live credentials required (deferred per 04-03 Task 3)"
  - test: "Confirm bun run migrate against production Supabase creates broker_tokens table with pgcrypto"
    expected: "psql SELECT 1 FROM pg_extension WHERE extname='pgcrypto' returns 1 row; \\d broker_tokens shows access_token / refresh_token as bytea; second migrate run is a no-op"
    why_human: "Live DATABASE_URL required; production DB push deferred per 04-01 Task 5"
---

# Phase 04: Schwab Auth & Brokerage — Verification Report

**Phase Goal:** The Schwab OAuth two-app flow is implemented with tokens persisted in Supabase; Schwab option chains are available behind the same market-data port as CBOE; positions, orders, and transactions are fetchable; and AUTH_EXPIRED degrades gracefully.
**Verified:** 2026-06-20T13:52:00Z
**Status:** human_needed — all 5 success criteria code-verified; 2 live actions pending human execution
**Re-verification:** Yes — SC3 gap closure confirmed (commits 063a8f1 RED + f7454c0 GREEN)

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| SC1 | `auth setup` walks OAuth flow + writes ENCRYPTED tokens to `broker_tokens`; `auth status` reports freshness without hitting Schwab | PASS-code-pending-live | Code complete: `validateAndExchange` pure fn + CSRF guard (setup.ts); `runStatus` reads `ForReadingTokenFreshness` port, no OAuth call (status.ts). pgcrypto write/read round-trip verified by testcontainers (broker-tokens.contract.test.ts 6/6). Live browser dance deferred per plan 04-03 Task 3. |
| SC2 | `auth doctor` detects 3 conditions: missing env vars, callback-URL mismatch, live refresh-grant failure | PASS | `checkEnvCompleteness` / `checkCallbackExactMatch` / `checkLiveRefresh` are pure functions with 12 unit tests in doctor.test.ts, all green. All 3 diagnostic branches exercised with in-memory fakes. |
| SC3 | Schwab market adapter fetches SPX chain via same `ForFetchingChain` port as CBOE; upserts `leg_observations` tagged `source='schwab_chain'` | PASS | Fix confirmed (f7454c0): `RawChain.source: "cboe" \| "schwab_chain"` field in ports.ts:62; `chain-adapter.ts:226` sets `source: "schwab_chain"`; `cboe.ts:233` sets `source: "cboe"`; `fetchChain.ts:90` passes `source: RawChain["source"]` to `quoteToObservationRow`; `snapshotCalendars.ts:103-104` propagates leg source to `SnapshotRow.source`. Regression tests: `fetchChain.test.ts` "SC3 regression: Schwab-sourced chain → source='schwab_chain'" PASS; "CBOE-sourced chain → source='cboe'" PASS; `snapshotCalendars.test.ts` "SC3 regression: leg source='schwab_chain' → snapshot source='schwab_chain'" PASS; "leg source='cboe' → snapshot source='cboe'" PASS. Full suite 562/562. |
| SC4 | On `invalid_grant`, `GET /api/status` reports `tokenFreshness: AUTH_EXPIRED` per-app; Schwab-dependent jobs pause (logged); CBOE + non-Schwab jobs keep running | PASS-code-pending-live | Status contract: `tokenFreshnessMap` with per-app `AppTokenStatus` in `packages/contracts/src/status.ts`. `getStatus.ts` wires `readTokenFreshness` (optional, AUTH-04 path). `getStatus.test.ts` 12/12 including `market: {status: "AUTH_EXPIRED"}` fixture. `fetch-schwab-chain.ts` handler: RTH guard → freshness check → selectChainSource (transparent CBOE fallback) → use-case. `fetch-rates`, `compute-bsm-greeks`, `snapshot-calendars` untouched in worker main.ts. Live `invalid_grant` path deferred with live tokens. |
| SC5 | Schwab trader adapter returns positions + transactions behind their ports; Zod-parsed before core; failed parse → typed `Result.err`, not a throw | PASS | `positions-adapter.ts`, `transactions-adapter.ts`, `orders-adapter.ts`: each calls `PositionsResponseSchema.safeParse` / `TransactionsResponseSchema.safeParse` / `OrdersResponseSchema.safeParse` before any domain mapping; failed parse returns `err({kind:'fetch-error', message})` — never throws. `getPositions.ts`, `getTransactions.ts`, `getOrders.ts` use-cases + brokerage.routes.ts wired. `trader-adapter.test.ts` 23/23. `brokerage.routes.test.ts` 9/9. |

**Score: 5/5 truths PASS** (SC1 + SC4 are PASS-code-pending-live per explicit user decision; SC3 gap closed by fix commits)

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/brokerage/domain/token-freshness.ts` | Pure token-freshness domain | VERIFIED | `isTokenExpired`, `isTokenStale`, `toAppTokenStatus` — real logic, 8 tests green |
| `packages/core/src/brokerage/application/ports.ts` | AppId, SchwabTokenRow, ForReadingTokens, ForWritingTokens, ForReadingTokenFreshness, ForFetchingPositions/Transactions/Orders | VERIFIED | All types present; `ObservationRow.source: "cboe" \| "schwab_chain"` correctly widened |
| `packages/core/src/journal/application/ports.ts` | `RawChain.source`, `ObservationRow.source`, `LegSnapshot.source`, `SnapshotRow.source` | VERIFIED | All four types carry `source: "cboe" \| "schwab_chain"` — provenance field flows end-to-end (ports.ts lines 62, 80, 172, 209) |
| `packages/adapters/src/schwab/auth/oauth-client.ts` | Vendored Schwab OAuth client (exchangeCode, refreshTokens) | VERIFIED | Real HTTP POST with Basic auth, Zod-parsed, never logs token; 14/14 msw tests green |
| `packages/adapters/src/postgres/repos/broker-tokens.ts` | pgcrypto encrypt/decrypt via Drizzle `sql`` bound params | VERIFIED | `pgp_sym_encrypt`/`pgp_sym_decrypt` key as `$N` bound param; `isAppId` type guard; testcontainers 6/6 |
| `packages/adapters/src/postgres/migrations/0003_broker_tokens.sql` | `CREATE EXTENSION IF NOT EXISTS pgcrypto` + `broker_tokens` table with `bytea` columns | VERIFIED | File exists, exact SQL confirmed; live push deferred |
| `apps/auth/src/doctor.ts` | 3 pure diagnostic functions | VERIFIED | `checkEnvCompleteness`, `checkCallbackExactMatch`, `checkLiveRefresh` pure; 12/12 unit tests |
| `apps/auth/src/setup.ts` | `validateAndExchange` CSRF check + code exchange | VERIFIED | Pure fn, state-mismatch guard first, 7/7 tests; `runSetup` shell for live run |
| `apps/auth/src/status.ts` | Reads freshness from DB, no Schwab call | VERIFIED | Calls `readTokenFreshness` port only; no OAuthClient import |
| `packages/adapters/src/schwab/market/chain-adapter.ts` | `makeSchwabChainAdapter` implementing `ForFetchingChain`; sets `source: "schwab_chain"` | VERIFIED | Auth-check-first, Zod safeParse, flattens callExpDateMap+putExpDateMap; `source: "schwab_chain"` at line 226; 15/15 tests + 3/3 contract |
| `packages/adapters/src/http/cboe.ts` | `makeCboeChainAdapter` sets `source: "cboe"` | VERIFIED | `source: "cboe"` at line 233; no regression |
| `packages/core/src/brokerage/application/selectChainSource.ts` | Schwab-primary / CBOE-fallback selector | VERIFIED | All 6 freshness branches covered; 8/8 tests |
| `packages/adapters/src/schwab/trader/positions-adapter.ts` | `makeSchwabPositionsAdapter` implementing `ForFetchingPositions` | VERIFIED | Zod safeParse, AUTH_EXPIRED short-circuit, real URL |
| `packages/adapters/src/schwab/trader/transactions-adapter.ts` | `makeSchwabTransactionsAdapter` implementing `ForFetchingTransactions` | VERIFIED | Zod safeParse, positionEffect mapping, legs extraction |
| `packages/adapters/src/schwab/trader/orders-adapter.ts` | `makeSchwabOrdersAdapter` implementing `ForFetchingOrders` (GET-only) | VERIFIED | No write endpoints; Zod safeParse |
| `packages/core/src/brokerage/application/getPositions.ts` | `makeGetPositionsUseCase` | VERIFIED | 4/4 tests |
| `packages/core/src/brokerage/application/getTransactions.ts` | `makeGetTransactionsUseCase` | VERIFIED | 8/8 tests |
| `packages/core/src/brokerage/application/refreshToken.ts` | `makeRefreshTokenUseCase` | VERIFIED | 7/7 tests; `invalid_grant` → zero writes confirmed |
| `apps/server/src/adapters/http/brokerage.routes.ts` | GET /api/positions, /api/transactions, /api/orders | VERIFIED | D-09: AUTH_EXPIRED → 200 + `brokerageAuthExpiredPayload`; 9/9 route tests |
| `apps/worker/src/handlers/fetch-schwab-chain.ts` | Schwab-primary chain job with CBOE-fallback logging (T-04-26) | VERIFIED | Array guard + RTH + selectChainSource + boss.send; 7/7 tests |
| `packages/contracts/src/status.ts` | `tokenFreshnessMap` with per-app `appTokenStatus` | VERIFIED | `AUTH_EXPIRED` enum value; backward-compat union with `"none yet"` |
| `packages/contracts/src/brokerage.ts` | `positionsResponse`, `transactionsResponse`, `ordersResponse`, `brokerageAuthExpiredPayload` | VERIFIED | MCP-02: shared schemas between HTTP routes and MCP tools |

---

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `selectChainSource.ts` | `ForReadingTokenFreshness` + `schwab/cboeFetchChain` | freshness status → adapter selection | WIRED | worker `main.ts:99` builds closure; handler receives pre-wired use-case |
| `fetch-schwab-chain handler` | `fetchChainUseCase` (selectChainSource) | composition root closure in `main.ts` | WIRED | `main.ts:95-99` builds `fetchChainUseCase` via `selectChainSource` at call time |
| `getStatus use-case` | `brokerTokensRepo.readTokenFreshness` | `main.ts:66` | WIRED | server `main.ts:66`: `readTokenFreshness: brokerTokensRepo.readTokenFreshness` |
| `broker-tokens.ts` | pgcrypto `pgp_sym_encrypt` / `pgp_sym_decrypt` | Drizzle `sql\`\`` bound param | WIRED | Key is `$N` in wire protocol; testcontainers confirms ciphertext != plaintext |
| `brokerage.routes.ts` | `getPositions/Transactions/Orders` use-cases | `main.ts` composition root | WIRED | `main.ts:98-102` builds trader adapters; routes registered via `brokerageRoutes(app, deps)` |
| `chain-adapter.ts` | `parseSchwabSymbol` → `formatOccSymbol` | symbol conversion | WIRED | `schwab-symbol.ts` returns `OccSymbolParsed`; `formatOccSymbol` produces canonical OCC string |
| `chain-adapter.ts` | `RawChain.source = "schwab_chain"` | line 226 in adapter | WIRED | Fix confirmed: `source: "schwab_chain"` literal in the returned `RawChain` object |
| `cboe.ts` | `RawChain.source = "cboe"` | line 233 in adapter | WIRED | `source: "cboe"` literal in returned `RawChain` object |
| `fetchChain.ts:quoteToObservationRow` | `ObservationRow.source` from `chain.source` | parameter propagation | WIRED | Function signature `source: RawChain["source"]`; called with `chain.source` at line 172; `source,` at line 112 |
| `snapshotCalendars.ts:buildSnapshotRow` | `SnapshotRow.source` from `LegSnapshot.source` | `front?.source ?? back?.source` | WIRED | Lines 103-104: derives source from leg, maps `schwab_chain` explicitly, falls back `"cboe"` |
| MCP tools (positions, transactions, orders) | `@morai/contracts` Zod schemas | `tools.ts` → `server.ts` | WIRED | `registerGetPositionsTool`, `registerGetTransactionsTool`, `registerGetOrdersTool` all import from `@morai/contracts` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `broker-tokens.ts` `readTokens` | `accessToken` / `refreshToken` | `pgp_sym_decrypt(col, key)` Drizzle query | Yes — testcontainers proves round-trip | FLOWING |
| `broker-tokens.ts` `readTokenFreshness` | `TokenFreshnessMap` | timestamp columns + `toAppTokenStatus` domain fn | Yes — real Postgres timestamps | FLOWING |
| `chain-adapter.ts` `fetchChain` | `RawChain` (incl. `source: "schwab_chain"`) | Schwab `https://api.schwabapi.com/marketdata/v1/chains` | Yes — real HTTP (msw in tests); `source` set by adapter before return | FLOWING |
| `cboe.ts` `fetchChain` | `RawChain` (incl. `source: "cboe"`) | CBOE `https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json` | Yes — real HTTP (msw in tests); `source` set by adapter | FLOWING |
| `fetchChain.ts` `ObservationRow.source` | `chain.source` | propagated from `RawChain.source` via `quoteToObservationRow` parameter | Yes — Schwab adapter → `"schwab_chain"`, CBOE adapter → `"cboe"` | FLOWING |
| `snapshotCalendars.ts` `SnapshotRow.source` | `front?.source ?? back?.source` | propagated from `LegSnapshot.source` (which reads `ObservationRow.source`) | Yes — provenance flows adapter → observation → leg → snapshot | FLOWING |
| `positions-adapter.ts` `fetchPositions` | `BrokerPosition[]` | Schwab `https://api.schwabapi.com/trader/v1/accounts/{hash}/?fields=positions` | Yes — real HTTP (msw in tests) | FLOWING |
| `getStatus` use-case | `tokenFreshness` | `brokerTokensRepo.readTokenFreshness()` | Yes — wired in server main.ts | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Token-freshness domain: 8 behaviors | `bunx vitest run packages/core/src/brokerage/domain/token-freshness.test.ts` | 8/8 PASS | PASS |
| Auth doctor: 12 behaviors (3 diagnostic conditions) | `bunx vitest run apps/auth/src/doctor.test.ts` | 12/12 PASS | PASS |
| setup.test.ts: validateAndExchange CSRF + exchange | `bunx vitest run apps/auth/src/setup.test.ts` | 7/7 PASS | PASS |
| OAuth client (msw): 14 behaviors | `bunx vitest run packages/adapters/src/schwab/auth/oauth-client.test.ts` | 14/14 PASS | PASS |
| pgcrypto round-trip (testcontainers Postgres 16) | `bunx vitest run packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` | 6/6 PASS | PASS |
| refreshToken use-case: 7 behaviors | `bunx vitest run packages/core/src/brokerage/application/refreshToken.test.ts` | 7/7 PASS | PASS |
| Schwab chain adapter + symbol (msw + contract) | `bunx vitest run packages/adapters/src/schwab/market/chain-adapter.test.ts chain-adapter.contract.test.ts schwab-symbol.test.ts` | 9+15+3=27 PASS | PASS |
| selectChainSource: 8 behaviors | `bunx vitest run packages/core/src/brokerage/application/selectChainSource.test.ts` | 8/8 PASS | PASS |
| Trader adapters (msw): 23 behaviors | `bunx vitest run packages/adapters/src/schwab/trader/trader-adapter.test.ts` | 23/23 PASS | PASS |
| getPositions + getTransactions use-cases | `bunx vitest run packages/core/src/brokerage/application/getPositions.test.ts getTransactions.test.ts` | 12/12 PASS | PASS |
| brokerage routes (AUTH_EXPIRED D-09 shape) | `bunx vitest run apps/server/src/adapters/http/brokerage.routes.test.ts` | 9/9 PASS | PASS |
| getStatus AUTH-04 (per-app tokenFreshness) | `bunx vitest run packages/core/src/journal/application/getStatus.test.ts` | 12/12 PASS | PASS |
| status contract (AUTH-04 union) | `bunx vitest run packages/contracts/src/status.test.ts` | All PASS | PASS |
| fetch-schwab-chain handler: 7 behaviors | `bunx vitest run apps/worker/src/handlers/fetch-schwab-chain.test.ts` | 7/7 PASS | PASS |
| **SC3 regression — fetchChain source provenance** | `bunx vitest run packages/core/src/journal/application/fetchChain` | **10/10 PASS** (incl. 2 SC3 regression tests) | **PASS** |
| **SC3 regression — snapshotCalendars source propagation** | `bunx vitest run packages/core/src/journal/application/snapshotCalendars` | **17/17 PASS** (incl. 2 SC3 regression tests) | **PASS** |
| Full workspace suite | `bun run test` | **562/562 PASS** (59 files) | PASS |
| Typecheck | `bun run typecheck` | exit 0 — no errors | PASS |
| Lint | `bun run lint` | exit 0 — config deprecation warnings only, zero lint errors | PASS |

---

## Requirements Coverage

| Requirement | Plans | Description | Status | Evidence |
|---|---|---|---|---|
| AUTH-01 | 04-02, 04-03 | Vendored OAuth client for both apps (auth code + refresh grant) | SATISFIED | `makeSchwabOAuthClient` in `oauth-client.ts`; 14 msw tests; `validateAndExchange` in setup.ts |
| AUTH-02 | 04-01, 04-02 | Tokens encrypted in Supabase `broker_tokens`; one source of truth | SATISFIED (code) / PENDING (live push) | pgcrypto `bytea` schema; testcontainers round-trip 6/6; live migration deferred |
| AUTH-03 | 04-03 | `auth` CLI: `setup \| refresh \| status \| doctor` | SATISFIED (code) / PENDING (live run) | All 4 subcommands implemented; doctor 12/12 + setup 7/7; live OAuth dance deferred |
| AUTH-04 | 04-02, 04-06 | On `invalid_grant`, jobs pause, status flags AUTH_EXPIRED per-app | SATISFIED | `tokenFreshnessMap` in contracts; `getStatus` wired; `fetch-schwab-chain` + `selectChainSource` fallback; 04-06 7/7 |
| BRK-01 | 04-04 | Schwab market adapter behind same `ForFetchingChain` port as CBOE; observations tagged `source='schwab_chain'` | SATISFIED | Adapter verified; source selector verified; SC3 fix (f7454c0) confirmed: `source` flows adapter → `RawChain` → `ObservationRow` → `SnapshotRow`; 4 SC3 regression tests green |
| BRK-02 | 04-05 | Schwab trader adapter (positions, orders, transactions) behind ports | SATISFIED | All 3 adapters + use-cases + routes + MCP tools verified; 23+12+9 tests |

---

## Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| _(none after fix)_ | _(no hardcoded source values in use-case layer)_ | — | — |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 04 source files.
No placeholder component stubs found.
No empty implementations found.
No hardcoded source tags in use-case layer (SC3 fix applied).

---

## Pending Live Verification

These items are code-complete and unit/integration tested. They require live credentials and external services to execute. Both are deferred by explicit user decision documented in the phase objective.

### 1. Live migration push to production Supabase

**Test:** With production `DATABASE_URL`, run `bun run migrate`
**Expected:** `SELECT 1 FROM pg_extension WHERE extname='pgcrypto'` returns 1 row; `\d broker_tokens` shows `access_token`/`refresh_token` as `bytea`; second `migrate` run is a no-op
**Why deferred:** Requires live `DATABASE_URL` to production Supabase (deferred from 04-01 Task 5)
**Code evidence:** `packages/adapters/src/postgres/migrations/0003_broker_tokens.sql` — `CREATE EXTENSION IF NOT EXISTS pgcrypto`, `broker_tokens` table with `bytea` columns; testcontainers round-trip 6/6

### 2. Live `auth` CLI OAuth dance

**Test:** With `.env` populated (`SCHWAB_*`, `TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`), run in sequence:
1. `bun run apps/auth/src/main.ts doctor` — should report all 3 conditions green
2. `bun run apps/auth/src/main.ts setup trader` — browser opens to Schwab login, loopback captures code, CLI prints success
3. `bun run apps/auth/src/main.ts setup market` — market app row written
4. `bun run apps/auth/src/main.ts status` — prints `trader: fresh`, `market: fresh` (no Schwab call)
5. `bun run apps/auth/src/main.ts refresh trader` — `updated_at` advances; `SELECT app_id, length(access_token) FROM broker_tokens` → 2 rows with non-zero bytea length; raw `access_token` column NOT human-readable
**Why deferred:** Requires live Schwab app credentials and browser OAuth interaction (deferred from 04-03 Task 3)
**Code evidence:** `apps/auth/src/setup.ts` (`validateAndExchange` CSRF + code exchange, 7/7 tests); `apps/auth/src/doctor.ts` (3 pure diagnostic fns, 12/12 tests); `apps/auth/src/status.ts` (reads `readTokenFreshness` port only)

---

_Verified: 2026-06-20T13:52:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: SC3 gap closed — fix commits 063a8f1 (RED) + f7454c0 (GREEN) confirmed_

---
status: partial
phase: 04-schwab-auth-brokerage
source: [04-01-SUMMARY.md, 04-02-SUMMARY.md, 04-03-SUMMARY.md, 04-04-SUMMARY.md, 04-05-SUMMARY.md, 04-06-SUMMARY.md]
started: 2026-06-21T01:53:04Z
updated: 2026-06-21T02:07:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold start — migration applies cleanly
expected: Run `bun run migrate`. pgcrypto extension enabled + `broker_tokens` table created with bytea token columns; a second run is an idempotent no-op (notices, no error).
result: pass

### 2. auth setup writes encrypted tokens (both apps)
expected: `bun run apps/auth/src/main.ts setup market` and `… setup trader` each open the browser → Schwab login → after the cert warning, "Authenticated" → terminal prints "<app> authenticated successfully" with issuedAt/expiresAt (30-min gap) and writes an encrypted row to broker_tokens. Process exits back to the prompt.
result: pass

### 3. auth status reports freshness without hitting Schwab
expected: `bun run apps/auth/src/main.ts status` returns near-instantly (~0.3s) reporting per-app freshness (e.g. `trader: fresh`, `market: fresh`) read from the DB — no network call to Schwab.
result: pass

### 4. auth doctor reports the three diagnostic conditions
expected: `bun run apps/auth/src/main.ts doctor` checks and reports three distinct things: env-var completeness, callback-URL exact match (per app), and a live refresh-grant probe — each as its own line.
result: issue
reported: "doctor prints all 3 lines, but the live-refresh probe always reports NETWORK_ERROR even when a real refresh works (auth refresh trader → 'token rotated successfully'). Root cause: runDoctorCommand probes with a hardcoded dummy token '__doctor_probe__' instead of the real stored refresh token."
severity: major

### 5. Tokens encrypted at rest (not plaintext)
expected: In broker_tokens, access_token/refresh_token are pgcrypto-encrypted bytea (OpenPGP packet, not readable text). The correct TOKEN_ENCRYPTION_KEY decrypts them; a wrong key is rejected ("Wrong key or corrupt data"). The key lives only in .env, never in the DB.
result: pass

### 6. Schwab SPX chain upserts observations tagged source='schwab_chain'
expected: With the market app authed, a Schwab chain fetch lands rows in leg_observations tagged `source='schwab_chain'` (CBOE-sourced rows stay `source='cboe'`). Needs the market app fresh + (for a live pull) RTH market hours.
result: issue
reported: "Live probe with the market token: $SPX&contractType=ALL → HTTP 502 'Body buffer overflow' (full chain too large for Schwab's gateway). Token authorizes (no 401), but the unscoped request can never succeed → adapter maps 502 to fetch-error → silent CBOE fallback. Schwab-sourced chain never lands in production. ($SPX is the correct symbol; SPX/$SPX.X → 400.)"
severity: major

### 7. AUTH_EXPIRED degrades gracefully
expected: When an app's refresh token is expired (>7 days / simulated), `GET /api/status` flags that app `AUTH_EXPIRED`; Schwab chain pulls fall back to CBOE (journal keeps filling); the other app and non-Schwab jobs keep running. Needs the server/worker running.
result: blocked
blocked_by: server
reason: "Needs server + worker running to observe /api/status AUTH_EXPIRED + live CBOE job fallback end-to-end; not exercisable from the CLI alone. Underlying logic (getStatus per-app freshness, selectChainSource CBOE fallback, fetch-schwab-chain guard) is unit-tested and verifier-passed; per-app independence partially confirmed live via `auth status` (one app fresh while the other was none_yet)."

### 8. Trader positions & transactions fetchable
expected: With the trader app authed, `GET /api/positions` and `GET /api/transactions` (and their MCP tools) return Zod-parsed data; a malformed response surfaces a typed error, not a crash. Read-only — no order placement. Needs the server running + a funded account.
result: pass
note: "Live trader-API probe with the trader token: accountNumbers HTTP 200 (1 account, 64-char hashValue — account-hash landmine handled, not raw number); positions HTTP 200 (valid securitiesAccount shape, 0 open positions); transactions HTTP 200. Token authorizes (no 401). Caveat: per-position field-level Zod parsing not exercised (account is flat — no positions to parse). HTTP-route/MCP layer not hit (server not running), but the adapter→Schwab path is validated."

## Summary

total: 8
passed: 5
issues: 2
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "auth doctor performs a REAL live refresh-grant probe and reports its true result (SC2)"
  status: failed
  reason: "Live UAT: doctor reports 'live refresh: NETWORK_ERROR' even though a real refresh succeeds (`auth refresh trader` → 'token rotated successfully'). Root cause: runDoctorCommand (apps/auth/src/doctor.ts:~256) builds the probe with a hardcoded dummy token `refreshTokensFn(\"__doctor_probe__\")` and ignores the real stored refresh token (the `_repo` param is unused). The probe can never succeed; checkLiveRefresh maps the dummy-token failure to network-error. The 12/12 doctor unit tests passed because they inject a fake refreshFn, never exercising the real wiring."
  severity: major
  test: 4
  artifacts: ["apps/auth/src/doctor.ts (runDoctorCommand)", "apps/auth/src/refresh.ts (runRefresh — working reference using makeRefreshTokenUseCase)"]
  missing: ["real refresh-use-case wiring in doctor's live-refresh probe (read+pass the actual stored trader refresh token, mirror runRefresh)"]

- truth: "Schwab market adapter can fetch a live SPX option chain (BRK-01 / SC3)"
  status: failed
  reason: "Live UAT with the market token: the Schwab chains endpoint returns HTTP 502 'Body buffer overflow' for the only valid index symbol $SPX. Root cause: chain-adapter.ts requests symbol=$SPX&contractType=ALL with NO strike/expiration narrowing — the full SPX chain (all expirations × all strikes) exceeds Schwab's API-gateway response buffer, so it 502s deterministically (size-based, NOT market-hours). The adapter maps 502 → fetch-error → selectChainSource silently falls back to CBOE, so the journal never gets schwab_chain data in production. msw fixture tests passed because the fixture is a tiny hand-crafted chain. ALSO RESOLVED (research A3): the correct index symbol is $SPX — SPX and $SPX.X both return HTTP 400 'Check Param Values'."
  severity: major
  test: 6
  artifacts: ["packages/adapters/src/schwab/market/chain-adapter.ts (~L165-167: symbol + contractType=ALL, no narrowing)", "packages/core/src/brokerage/application/selectChainSource.ts (masks the failure via CBOE fallback)"]
  missing: ["chain-request scoping params (strikeCount + range=NTM, or fromDate/toDate scoped to the journal's tracked expirations) to keep the response under the gateway limit", "validated $SPX symbol"]

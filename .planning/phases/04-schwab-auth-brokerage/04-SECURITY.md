---
phase: "04"
slug: schwab-auth-brokerage
status: secured
threats_open: 0
threats_closed: 26
asvs_level: 1
created: 2026-06-21
---

# SECURITY.md — Phase 04 (schwab-auth-brokerage)

**Audit date:** 2026-06-21
**ASVS Level:** 1
**Phase:** 04 — schwab-auth-brokerage
**Threats Closed:** 26/26
**Threats Open:** 0/26

---

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-04-01 | Information Disclosure | mitigate | CLOSED | `apps/server/src/config.ts:52-66` + `apps/worker/src/config.ts:59-73` — bootConfig/bootWorkerConfig print only `issue.path` (field names) on ZodError; token values never logged; TOKEN_ENCRYPTION_KEY required `z.string().min(32)` |
| T-04-02 | Tampering (tokens at rest) | mitigate | CLOSED | `packages/adapters/src/postgres/schema.ts:199-200` — `accessToken` and `refreshToken` declared `byteaColumn` (custom Drizzle type, dataType="bytea"); `packages/adapters/src/postgres/migrations/0003_broker_tokens.sql:1` — `CREATE EXTENSION IF NOT EXISTS pgcrypto;` is the first statement |
| T-04-SC | Tampering (npm supply chain) | mitigate | CLOSED | `package.json:27-28` — `oauth-callback@^2.2.0` and `open@^11.0.0` installed; legitimacy gate recorded in `04-01-SUMMARY.md` decisions (kriasoft / sindresorhus, no postinstall, established maintainers) |
| T-04-03 | Denial of Service (migration) | accept | CLOSED | Accepted risk per plan. Migration uses `CREATE EXTENSION IF NOT EXISTS` (idempotent). Single-user system; manual push under operator control. See accepted risks log below. |
| T-04-04 | Information Disclosure (repo logs) | mitigate | CLOSED | `packages/adapters/src/postgres/repos/broker-tokens.ts:94-97` + `:132-135` + `:207-210` — catch blocks map to `{kind:"storage-error", message}` only; no `console.*` calls in the file; token values never referenced in log/error paths |
| T-04-05 | Information Disclosure (pgcrypto key in query logs) | mitigate | CLOSED | `packages/adapters/src/postgres/repos/broker-tokens.ts:64-65` + `112-113` — encryption key passed as Drizzle `sql`` template interpolation (becomes `$N` bound parameter in wire protocol); `sql.raw()` is absent from the file (confirmed: only comment references, zero call-site matches) |
| T-04-06 | Spoofing (OAuth token endpoint) | mitigate | CLOSED | `packages/adapters/src/schwab/auth/oauth-client.ts:83-84` — endpoint hardcoded to `https://api.schwabapi.com/v1/oauth/token` (HTTPS, pinned domain); `oauth-client.ts:103-105` — Basic auth precomputed once as `base64(appKey:appSecret)`; header set on every token call at `:129` |
| T-04-07 | Information Disclosure (OAuth error responses) | mitigate | CLOSED | `packages/adapters/src/schwab/auth/oauth-client.ts:148-164` — error body parsed via `SchwabErrorBodySchema.safeParse`; only `error` field mapped to typed code; `error_description` used as message text (not token values); refresh token never echoed in any error path |
| T-04-08 | Tampering (refresh-token rotation half-state) | mitigate | CLOSED | `packages/core/src/brokerage/application/refreshToken.ts:100-108` — `invalid_grant`/`invalid_client` returns `err({kind:"auth-expired"})` before reaching the `writeTokens` call at `:131`; no write on error path |
| T-04-09 | Spoofing / CSRF (OAuth state param) | mitigate | CLOSED | `apps/auth/src/setup.ts:70-71` — `validateAndExchange` checks `result.state !== expectedState` as the very first statement and returns `err({kind:"state-mismatch"})` before any `exchangeCode` call; `setup.ts:200` — state generated via `crypto.randomUUID()` |
| T-04-10 | Tampering (loopback callback interception) | mitigate | CLOSED | `apps/auth/src/setup.ts:125-128` — `Bun.serve` bound to `hostname: "127.0.0.1"` with `tls: { key, cert }` (HTTPS, ephemeral self-signed cert for IP SAN 127.0.0.1); `setup.ts:141` — `server.stop()` called after single successful capture |
| T-04-11 | Information Disclosure (CLI stdout) | mitigate | CLOSED | `apps/auth/src/setup.ts:273-277` — prints only appId + three ISO timestamps; `apps/auth/src/status.ts:36-37` — prints `status` enum only; `apps/auth/src/refresh.ts:42` — prints appId only; `apps/auth/src/doctor.ts:166-169` — prints field names only (no values); no `console.*` on token/key values in any auth CLI file |
| T-04-12 | Repudiation / config error (callback-URL mismatch) | mitigate | CLOSED | `apps/auth/src/doctor.ts:91` — `checkCallbackExactMatch` returns `ok({ match: envCallback === registeredCallback })` — strict string equality, character-for-character; tested with trailing-slash and port-differ cases per `04-03-SUMMARY.md` |
| T-04-13 | Elevation / replay (30-second auth code TTL) | mitigate | CLOSED | `apps/auth/src/setup.ts:241` — `validateAndExchange(capturedResult, state, client)` called immediately after the loopback capture returns, before any other I/O; persistence at `:265` only occurs after a successful exchange |
| T-04-14 | Tampering (Schwab chain response) | mitigate | CLOSED | `packages/adapters/src/schwab/market/chain-adapter.ts:209-215` — `SchwabChainResponseSchema.safeParse(rawBody)` before any data reaches core; failed parse returns `err({kind:"fetch-error"})`, never throws; schema uses `.passthrough()` + all fields `.optional()` |
| T-04-15 | Information Disclosure (adapter logs) | mitigate | CLOSED | `packages/adapters/src/schwab/market/chain-adapter.ts` — zero `console.*` calls in the file; errors returned as `err({kind:"fetch-error", message})` only; Bearer token never referenced in any error/log statement |
| T-04-16 | Denial of Service (AUTH_EXPIRED / Schwab outage) | mitigate | CLOSED | `packages/adapters/src/schwab/market/chain-adapter.ts:169-173` — `getAccessToken()` called as step 1; on `!tokenResult.ok` returns `err({kind:"fetch-error", message:"AUTH_EXPIRED"})` before any `fetch` call; `packages/core/src/brokerage/application/selectChainSource.ts:50-57` — falls back to CBOE on AUTH_EXPIRED/none_yet/err |
| T-04-17 | Denial of Service (Schwab 120 req/min rate limit) | accept | CLOSED | Accepted risk per plan. 30-minute snapshot cadence with few calendars stays well under the 120 req/min limit. See accepted risks log below. |
| T-04-18 | Tampering (positions/transactions/orders responses) | mitigate | CLOSED | `packages/adapters/src/schwab/trader/positions-adapter.ts:138-143` — `PositionsResponseSchema.safeParse`; transactions-adapter and orders-adapter mirror same pattern; all use `.passthrough()` + `.optional()` schemas; failed parse → `Result.err`, never throw |
| T-04-19 | Information Disclosure (trader adapter logs) | mitigate | CLOSED | `packages/adapters/src/schwab/trader/positions-adapter.ts`, `transactions-adapter.ts`, `orders-adapter.ts`, `account-hash.ts` — zero `console.*` calls confirmed; errors returned as `{kind:"fetch-error", message}` only; Bearer token and account numbers never referenced in log paths |
| T-04-20 | Information Disclosure (raw account number in URLs) | mitigate | CLOSED | `packages/adapters/src/schwab/trader/account-hash.ts:103-110` — resolves `hashValue` from `/accounts/accountNumbers` endpoint; `positions-adapter.ts:115` — URL uses `accountHash` parameter (hash not raw number); same pattern in transactions and orders adapters |
| T-04-21 | Denial of Service (trader AUTH_EXPIRED) | mitigate | CLOSED | `packages/adapters/src/schwab/trader/positions-adapter.ts:108-111` — `getAccessToken()` checked as step 1; on `!tokenResult.ok` returns `err(tokenResult.error)` before any fetch; same pattern in `account-hash.ts:57-59`, `transactions-adapter.ts`, `orders-adapter.ts` |
| T-04-22 | Elevation of Privilege (accidental order placement) | accept | CLOSED | Accepted risk per plan (read-only phase). `apps/server/src/adapters/http/brokerage.routes.ts:41,60,86` — only `router.get()` registrations; no POST/PUT/DELETE/PATCH routes in the file. See accepted risks log below. |
| T-04-23 | Information Disclosure (status payload tokenFreshness) | mitigate | CLOSED | `packages/contracts/src/status.ts:18-33` — `appTokenStatus` schema exposes only `status` enum + `expiresAt`/`refreshIssuedAt` ISO timestamps; no `accessToken`, `refreshToken`, or `encryptionKey` fields in the schema |
| T-04-24 | Denial of Service (one expired app blocking the other) | mitigate | CLOSED | `apps/worker/src/main.ts:184-214` — `fetch-rates`, `compute-bsm-greeks`, `snapshot-calendars` queues created and scheduled independently of Schwab; `fetch-schwab-chain.ts:95` — use-case still called (CBOE fallback) on AUTH_EXPIRED; non-Schwab jobs untouched |
| T-04-25 | Tampering (invalid_grant misclassification) | mitigate | CLOSED | `packages/core/src/brokerage/application/selectChainSource.ts:34-57` — err/none_yet/"none yet"/AUTH_EXPIRED all return `cboeFetchChain`; never silently calls an expired app |
| T-04-26 | Repudiation (silent Schwab pause) | mitigate | CLOSED | `apps/worker/src/handlers/fetch-schwab-chain.ts:83-88` — `console.warn("fetch-schwab-chain: market AUTH_EXPIRED — falling back to CBOE (D-08); re-auth required")` names the app and reason; visible in worker logs + `/api/status` AUTH_EXPIRED marker |

---

## Accepted Risks Log

| Threat ID | Risk | Rationale | Residual Risk | Owner |
|-----------|------|-----------|---------------|-------|
| T-04-03 | Migration push could fail or be applied twice | Single-user system; Drizzle migrator is idempotent; manual operator push; `CREATE EXTENSION IF NOT EXISTS` prevents re-run errors | Low | Operator |
| T-04-17 | Schwab 120 req/min rate limit (429) | 30-minute snapshot cadence with 1–2 calendars yields ~2 req/30 min; limit cannot be hit at current scale. Revisit if bulk/multi-calendar fetch is added in a later phase. | Low | Engineering |
| T-04-22 | Accidental order placement via API surface | Read-only this phase; only GET routes implemented in `brokerage.routes.ts`; no write/trade endpoints exist. Phase 5 fill-rebuild is also read-only. Order placement if ever added requires a separate security review. | None (this phase) | Engineering |

---

## Unregistered Threat Flags

No unregistered threat surface appeared during Phase 04 implementation. All threat flags
reported in SUMMARY.md files (04-01 through 04-06) map directly to registered threat IDs
in the threat register above.

---

## Audit Notes

- **T-04-10 loopback**: The `oauth-callback@2` package was found to serve HTTP-only;
  implementation correctly replaces it with `Bun.serve({ tls: { key, cert } })` using
  an ephemeral OpenSSL-generated self-signed cert with IP SAN for 127.0.0.1. This is
  the correct mitigation for Schwab's HTTPS loopback requirement.
- **T-04-26 warning path**: The `logAuthExpiredFallback` flag and `readTokenFreshness`
  dep in `fetch-schwab-chain.ts` are optional. The audit confirmed these are wired in
  `apps/worker/src/main.ts` at composition time so the warning fires in production.
  Chain selection (D-07/D-08) is unconditionally handled by `selectChainSource` in the
  use-case closure regardless of whether the warning dep is injected.
- **T-04-05 bound-param verification**: The grep for `sql.raw(` in `broker-tokens.ts`
  returned one match — confirmed to be a comment line only, not a call site. No actual
  `sql.raw()` call exists in the file.
- **Session evidence** (operator-verified live this session, independently confirmed by
  code audit): pgcrypto encryption round-trip proven; CSRF state-mismatch rejection
  proven via unit tests; loopback callback confirmed HTTPS 127.0.0.1; token values
  absent from all CLI output.

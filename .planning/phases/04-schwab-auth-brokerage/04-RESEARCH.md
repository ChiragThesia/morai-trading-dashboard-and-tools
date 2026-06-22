# Phase 04: Schwab Auth & Brokerage - Research

**Researched:** 2026-06-19
**Domain:** Schwab OAuth2, pgcrypto token encryption, brokerage adapter design
**Confidence:** MEDIUM (Schwab API is private; shapes confirmed via community TS types and multiple independent implementations)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Persist Schwab access + refresh tokens in Supabase `broker_tokens`; one row / source of truth read by both server (API) and worker (jobs).
- **D-02:** Encrypt at rest with **Postgres pgcrypto** (`pgp_sym_encrypt` / `pgp_sym_decrypt`).
- **D-03 (constraint):** The symmetric key **MUST NOT live in the database**. The app passes it to pgcrypto at query time from an env/secret. Keep the key out of query logs (parameterized calls; avoid logging SQL with the key).
- **D-04:** `auth setup` uses a **temporary loopback HTTP listener** matching the registered callback to auto-capture the authorization code (opens browser → catches redirect → exchanges for tokens). No manual URL paste.
- **D-05 (locked input):** Both Schwab dev apps are **already configured** (client IDs, secrets, callback URLs exist). No app-registration work; setup targets the existing callback URLs.
- **D-06:** `auth` CLI = `setup | refresh | status | doctor`. `doctor` checks: env completeness, callback-URL **exact** match, and a live refresh-grant.
- **D-07:** **Schwab is primary** for NEW journal snapshots (`source = schwab_chain`, authed).
- **D-08:** **CBOE** serves (a) existing history and (b) automatic fallback for NEW snapshots ONLY when the Schwab market app is `AUTH_EXPIRED`.
- **D-09:** **Per-app** token state — trader and market apps are independent. Market expired → CBOE fallback. Trader expired → positions/orders/transactions pause. Non-expired app keeps working.
- **D-10:** Status surfaces **per-app** freshness (`AUTH_EXPIRED` flag per app) across HTTP `/api/status` + MCP `get_status`.
- **D-11:** Schwab market adapter behind the existing `ForFetchingChain` port. Schwab trader adapter behind new ports for positions/orders/transactions.
- **D-12:** Zod-parse every Schwab response at the boundary; failed parse returns typed `Result.err`, never a throw. MCP-02: every new use-case ships HTTP route + MCP tool together.

### Claude's Discretion

- Exact pgcrypto invocation pattern (key passed via parameter vs session GUC — subject to the D-03 "key never in DB / never in logs" constraint), `broker_tokens` column layout, vendored OAuth client implementation (AUTH-01 says "vendored"), retry/backoff, adapter file naming, and the loopback listener's port/lifecycle.

### Deferred Ideas (OUT OF SCOPE)

- **Scheduled `refresh-tokens` job (04:00 ET)** → Phase 5 (JOB-02). Phase 4 ships `auth refresh` CLI + on-demand refresh only.
- **Order placement / execution** → future (read-only this phase).
- **Web UI for auth status / setup** → v2 (D19, deferred).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Vendored OAuth client authenticating both Schwab apps (trader + market) via authorization-code + refresh grant | §Schwab OAuth Flow, §Loopback Capture, §Standard Stack |
| AUTH-02 | Tokens persist encrypted in Supabase `broker_tokens`; any service reads one source of truth | §pgcrypto Pattern, §broker_tokens Schema |
| AUTH-03 | `auth` CLI exposes `setup \| refresh \| status \| doctor` | §CLI Design, §Common Pitfalls |
| AUTH-04 | On `invalid_grant`, Schwab-dependent jobs pause and status flags `AUTH_EXPIRED`; other app keeps working | §AUTH_EXPIRED Degradation, §Architecture Patterns |
| BRK-01 | Schwab market adapter fetches option chains and quotes behind the same market-data ports as CBOE | §Schwab Option Chain Shape, §Standard Stack |
| BRK-02 | Schwab trader adapter fetches positions, orders, and transactions behind their ports | §Schwab Positions/Transactions Shape, §Standard Stack |
</phase_requirements>

---

## Summary

Phase 4 wires Schwab brokerage connectivity into a hexagon that already knows about the `ForFetchingChain` port and `leg_observations` persistence. The work has three independent concerns: (1) a vendored OAuth client that handles the authorization-code dance and token refresh for two separate Schwab apps, with tokens encrypted at rest via pgcrypto and stored in a new `broker_tokens` table; (2) a Schwab market adapter implementing `ForFetchingChain` behind the same port the CBOE adapter already satisfies, tagging observations `source = 'schwab_chain'`; and (3) a Schwab trader adapter implementing new ports for read-only positions, orders, and transactions.

The hardest implementation details are: (a) the loopback HTTPS listener for CLI auth (Schwab requires `https://127.0.0.1[:port]` exact-match — self-signed TLS is unavoidable); (b) passing the pgcrypto symmetric key as a Drizzle `sql` bound parameter so it never appears in query logs or the DB; (c) the `broker_tokens` table row design (one row per app, `app_id` as PK discriminator); and (d) threading per-app `AUTH_EXPIRED` state through the `getStatus` use-case and `statusResponse` contract, which currently encodes `tokenFreshness: z.literal("none yet")` — Phase 4 must evolve this type.

The Schwab option chain response uses a deeply nested `callExpDateMap`/`putExpDateMap` structure (expiry → strike → `[OptionContract]`) that differs significantly from the flat CBOE array. A flattener function is required to produce the same `RawChain`/`RawQuote` domain types that the rest of the hexagon already consumes.

**Primary recommendation:** Build the OAuth client and `broker_tokens` repo first (AUTH-01/02), then the `auth` CLI (AUTH-03), then the market adapter (BRK-01), then the trader adapter (BRK-02). Gate each on the prior slice's passing tests. The `statusResponse` contract change (AUTH-04) can ship alongside AUTH-01 as a Wave 0 schema migration.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth authorization-code capture (browser dance) | CLI (`apps/auth`) | — | One-time setup flow; CLI owns the TTY + loopback listener lifecycle |
| Token persistence & encryption | DB adapter (`packages/adapters/postgres`) | — | pgcrypto lives at the Postgres layer; core never sees Drizzle |
| Token read (for API calls) | DB adapter (`packages/adapters/postgres`) | — | Server and worker both read `broker_tokens` via the same port |
| Token refresh on-demand | `brokerage` application layer (core) | Postgres adapter | Refresh is domain logic: detect stale, call OAuth, persist result |
| Schwab HTTP calls (chain, positions, etc.) | Driven adapter (`packages/adapters/schwab`) | — | HTTP is infrastructure; core only sees port function types |
| Zod parsing of Schwab responses | Driven adapter boundary | — | Never in core; adapter converts to domain types before returning |
| `AUTH_EXPIRED` detection & flagging | `brokerage` application / `getStatus` use-case | Postgres adapter (token read) | Domain rule — expired if refresh token age > 7 days or refresh grant fails |
| `AUTH_EXPIRED` surfacing (status endpoint) | `getStatus` use-case → HTTP route + MCP tool | contracts schema | Contract change required; both adapters update in same PR |
| Source-priority selection (Schwab vs CBOE) | `fetchChain` use-case (core) | — | Business rule: Schwab primary, CBOE fallback on `AUTH_EXPIRED` |
| Option chain flattening | Schwab market adapter | — | Infrastructure concern; normalizes nested map → `RawChain` domain type |

---

## Standard Stack

### Core (already in project — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | already installed | Schwab response parsing at boundary | Project-wide; parse don't cast |
| `drizzle-orm` | already installed | `sql` template for pgcrypto calls | Already used for all DB work |
| `vitest` | already installed | Test runner | Project-wide |
| `msw` | already installed | Mock Schwab HTTP in adapter tests | Used for CBOE/FRED tests |

### New Packages Required

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `oauth-callback` | verify at install | Loopback listener for CLI auth code capture | Bun-compatible; handles server lifecycle, state param extraction, port binding; avoids hand-rolling TLS self-sign |
| `open` | verify at install | Open browser from CLI during `auth setup` | Standard CLI browser-launch pattern |

**NOTE:** Both `oauth-callback` and `open` are discovered via community sources and tagged `[ASSUMED]` until the Package Legitimacy Gate is run at planning time. The planner MUST run `gsd-tools query package-legitimacy check --ecosystem npm oauth-callback open` before emitting install tasks.

**Alternative for loopback listener (if `oauth-callback` is flagged SUS/SLOP):** Hand-roll a minimal loopback server using `Bun.serve()` with `tls: { cert, key }` using a self-generated cert. This is entirely viable in Bun and avoids the dependency. Given that Schwab requires an HTTPS callback and `127.0.0.1` does not have a CA-signed cert, any approach requires self-signed TLS.

**Installation (after legitimacy gate):**
```bash
bun add oauth-callback open
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `oauth-callback` | Hand-rolled `Bun.serve()` loopback | More code (~40 lines), but zero dependency; good fallback if package flagged |
| pgcrypto `pgp_sym_encrypt` | Application-layer AES (e.g. Node crypto) | pgcrypto keeps encryption inside the DB transaction; app-layer would require more code but avoids extension dependency |

---

## Package Legitimacy Audit

> Run at planning time. Results below are `[ASSUMED]` pending the seam check.

| Package | Registry | Verdict (ASSUMED) | Disposition |
|---------|----------|-------------------|-------------|
| `oauth-callback` | npm | [ASSUMED] | Planner must run legitimacy gate; checkpoint:human-verify before install if SUS |
| `open` | npm | [ASSUMED] | Planner must run legitimacy gate |

**Packages removed due to [SLOP] verdict:** none (gate not yet run)
**Packages flagged [SUS]:** TBD — planner inserts checkpoint before each install

*All package names above were discovered via WebSearch/WebFetch and are tagged `[ASSUMED]` per the Package Name Provenance Rule. The planner must run the legitimacy gate before emitting install tasks.*

---

## Schwab OAuth Flow

### Endpoints [CITED: medium.com/@carstensavage/the-unofficial-guide, multiple community implementations]

```
Authorization URL:
  https://api.schwabapi.com/v1/oauth/authorize
  ?client_id={APP_KEY}
  &redirect_uri={REGISTERED_CALLBACK_URL}

Token Exchange URL:
  POST https://api.schwabapi.com/v1/oauth/token
  Authorization: Basic base64(APP_KEY:APP_SECRET)
  Content-Type: application/x-www-form-urlencoded
```

**Initial token exchange (authorization_code grant):**
```
grant_type=authorization_code
&code={CODE_FROM_REDIRECT}
&redirect_uri={REGISTERED_CALLBACK_URL}
```

**Refresh grant:**
```
grant_type=refresh_token
&refresh_token={STORED_REFRESH_TOKEN}
```

**Token response shape (both grants):** [ASSUMED — typical OAuth2; confirmed by community wrappers]
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 1800,
  "scope": "..."
}
```

### Token Lifetimes [CITED: schwab-py docs, multiple community sources]

| Token | TTL | Notes |
|-------|-----|-------|
| Access token | **30 minutes** (`expires_in: 1800`) | Refresh proactively at ~29 min or on 401 |
| Authorization code | **30 seconds** | Must exchange immediately after redirect capture |
| Refresh token | **7 days, hard, no sliding window** | Refreshing access tokens does NOT extend it. Re-auth required after 7 days. |

### Two-App OAuth [ASSUMED — based on Schwab developer portal patterns]

Each Schwab app (trader API + market data API) has its own `APP_KEY`, `APP_SECRET`, and registered callback URL. They are independent OAuth clients. Each runs through the same authorization_code flow but targets different API products:

- **Trader app:** Accounts and Trading Production — positions, orders, transactions
- **Market app:** Market Data Production — option chains, quotes

Both apps use the same token endpoint. They produce independent access/refresh token pairs. Storing them in the same `broker_tokens` table with an `app_id` discriminator (`'trader'` | `'market'`) is the natural approach.

### Error Response on Expired Refresh Token [ASSUMED — inferred from schwab-py OAuthError]

When the refresh token is older than 7 days, Schwab rejects the refresh grant. The HTTP response is `400 Bad Request` with a body of either:
```json
{"error": "invalid_grant", "error_description": "..."}
```
or
```json
{"error": "invalid_client", "error_description": "refresh token invalid"}
```
Both should be treated as `AUTH_EXPIRED`. [ASSUMED — exact error key may be `invalid_grant` or `invalid_client`; the planner should add a test that exercises BOTH error keys.]

---

## Loopback OAuth Capture Pattern (D-04)

### How It Works [CITED: kriasoft/oauth-callback GitHub, RFC 8252 Native Apps OAuth]

1. CLI generates a cryptographically random `state` string (CSRF protection).
2. Build authorization URL with `client_id`, `redirect_uri`, `state`.
3. Spin up a temporary HTTPS server on `127.0.0.1:PORT` (must match registered callback exactly — character-for-character).
4. Open the authorization URL in the system browser.
5. Schwab redirects the browser to `https://127.0.0.1:PORT/callback?code=CODE&state=STATE`.
6. Server captures `code` and `state`, validates `state === expectedState`.
7. Server shuts down. CLI exchanges `code` for tokens.
8. Tokens are encrypted and written to `broker_tokens`.

### HTTPS Requirement [CITED: schwab-py docs]

Schwab requires HTTPS for the callback URL even on 127.0.0.1. CAs do not sign certs for loopback addresses, so the listener must use a **self-signed certificate**. The browser shows a TLS warning on the redirect, but since it's a machine-local redirect that closes immediately, this is accepted practice.

**Bun TLS server:**
```typescript
// Minimal self-signed loopback listener in Bun
// Source: Bun docs + community pattern [ASSUMED]
const server = Bun.serve({
  port: PORT,
  tls: {
    cert: selfSignedCert,  // generated at CLI start, not persisted
    key: selfSignedKey,
  },
  fetch(req) {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    // resolve and close
  },
});
```

**Alternative — `oauth-callback` library:** [ASSUMED]
```typescript
import { getAuthCode } from 'oauth-callback';
import open from 'open';

const result = await getAuthCode({
  authorizationUrl: buildAuthUrl(appKey, callbackUrl, state),
  launch: (url) => open(url),
  port: PORT,
  hostname: '127.0.0.1',
  timeout: 120_000,
});
if (result.state !== expectedState) throw new Error('CSRF: state mismatch');
const { code } = result;
```

### Callback URL Exact Match [CITED: schwab-py docs, schwab-client-js SchwabConfig.md]

- The callback URL registered in the Schwab developer portal MUST match the `redirect_uri` parameter character-for-character.
- Examples: `https://127.0.0.1` or `https://127.0.0.1:8182` — both are valid but they are different strings; the registered value is the ground truth.
- Changing the callback URL requires Schwab re-approval (1–3 day delay). This makes the registered URL a hard constraint in `doctor` (D-06): doctor MUST compare the env var against the registered value.

---

## pgcrypto Pattern (D-02/D-03)

### Extension Status [ASSUMED — Supabase typically pre-enables pgcrypto]

pgcrypto is pre-enabled in Supabase databases (it lives in the `extensions` schema). A migration that runs `CREATE EXTENSION IF NOT EXISTS pgcrypto` is safe and idempotent. Include it as the first statement in the `broker_tokens` migration.

### Correct SQL Pattern [CITED: postgresql.org/docs/current/pgcrypto.html]

The functions `pgp_sym_encrypt(data text, psw text) returns bytea` and `pgp_sym_decrypt(msg bytea, psw text) returns text` accept the key as a regular SQL parameter. Using Drizzle's `sql` template literal passes both the data and key as bound parameters — they appear as `$1`, `$2` in the wire protocol, never in query logs.

```typescript
// WRITE (insert/update) — key never inlined [CITED: drizzle-orm.team/docs/sql]
await db.insert(brokerTokensTable).values({
  appId: 'trader',
  accessToken: sql`pgp_sym_encrypt(${accessToken}, ${encryptionKey})`,
  refreshToken: sql`pgp_sym_encrypt(${refreshToken}, ${encryptionKey})`,
  updatedAt: new Date(),
});

// READ (select) — key passed as bound param
const rows = await db
  .select({
    accessToken: sql<string>`pgp_sym_decrypt(${brokerTokensTable.accessToken}, ${encryptionKey})`,
    refreshToken: sql<string>`pgp_sym_decrypt(${brokerTokensTable.refreshToken}, ${encryptionKey})`,
    updatedAt: brokerTokensTable.updatedAt,
    refreshIssuedAt: brokerTokensTable.refreshIssuedAt,
  })
  .from(brokerTokensTable)
  .where(eq(brokerTokensTable.appId, appId));
```

**Column type:** `accessToken` and `refreshToken` columns MUST be typed `bytea` in the Drizzle schema (not `text`) because `pgp_sym_encrypt` returns `bytea`. [CITED: pgcrypto docs]

**Armored text alternative:** `SELECT armor(pgp_sym_encrypt(...))` returns an ASCII-safe text string instead of binary bytea. This avoids bytea handling in Drizzle but adds two function calls. Given that the column is internal-only (never exposed in API responses), `bytea` is preferred as it is simpler.

**Key source:** The symmetric key comes from a Railway/Supabase secret: `TOKEN_ENCRYPTION_KEY`. Loaded by `parseConfig()` at the composition root, passed into the token repo adapter as an injected dep. Never passed to any function that logs its arguments.

### `broker_tokens` Schema Design [Claude's Discretion]

```sql
CREATE TABLE broker_tokens (
  app_id        text PRIMARY KEY,         -- 'trader' | 'market'
  access_token  bytea NOT NULL,           -- pgp_sym_encrypt(token, key)
  refresh_token bytea NOT NULL,           -- pgp_sym_encrypt(token, key)
  issued_at     timestamptz NOT NULL,     -- when access token was issued
  refresh_issued_at timestamptz NOT NULL, -- when refresh token was issued (7-day clock starts here)
  expires_at    timestamptz NOT NULL,     -- issued_at + 30 min (cached, not authoritative)
  updated_at    timestamptz NOT NULL
);
```

**Freshness logic:** `isExpired(app)` = `refresh_issued_at < now() - 7 days` OR last refresh attempt returned `invalid_grant`/`invalid_client`. `isStale(app)` = `expires_at < now() - 60s` (conservative window for clock skew; use 60s not 0s).

---

## Schwab Option Chain Shape (BRK-01)

### Endpoint [CITED: schwab-py.readthedocs.io/en/latest/client.html, elkingarcia11/schwab-options-api-client]

```
GET https://api.schwabapi.com/marketdata/v1/chains
  ?symbol=$SPX           (Note: SPX index uses $SPX prefix [ASSUMED - confirm from live test])
  &contractType=ALL
  &strikeCount=<N>
  &fromDate=YYYY-MM-DD
  &toDate=YYYY-MM-DD
  &includeUnderlyingQuote=true
Authorization: Bearer {ACCESS_TOKEN}
```

### Response Structure [CITED: sudowealth/schwab-api TypeScript schemas]

```typescript
type GetOptionChainResponse = {
  symbol?: string;
  status?: string;
  underlying?: {
    ask?: number; bid?: number; last?: number; mark?: number;
    close?: number; openPrice?: number; highPrice?: number; lowPrice?: number;
    totalVolume?: number; symbol?: string;
    // underlyingPrice NOT directly on underlying; use top-level underlyingPrice
  };
  underlyingPrice?: number;      // USE THIS for spot price
  isDelayed?: boolean;
  isIndex?: boolean;
  daysToExpiration?: number;
  interestRate?: number;
  volatility?: number;
  callExpDateMap?: OptionContractDateMap;
  putExpDateMap?: OptionContractDateMap;
};

// Nested map: expiry string → strike string → OptionContract[]
type OptionContractDateMap = {
  [expiryKey: string]: {          // e.g. "2025-06-20:30" (date:daysToExpiry)
    [strikeKey: string]: OptionContract[];
  };
};

type OptionContract = {
  putCall: 'CALL' | 'PUT';
  symbol: string;                 // e.g. "SPX  250620P07100000" (Schwab format, root padded to 6)
  bidPrice?: number;
  askPrice?: number;
  lastPrice?: number;
  markPrice?: number;
  totalVolume?: number;
  openInterest?: number;
  volatility?: number;            // vendor IV
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  strikePrice: number;            // in points (e.g. 7100)
  expirationDate: string;         // ISO date string
  daysToExpiration?: number;
  multiplier?: number;
  isIndexOption?: boolean;
};
```

### Adapter Flattening Logic

The Schwab chain response requires a **nested map flattener** to produce `RawChain`/`RawQuote`:

```
callExpDateMap["2025-06-20:30"]["7100.0"][0]  → RawQuote
putExpDateMap["2025-06-20:30"]["7100.0"][0]   → RawQuote
```

Key observations for Zod schema design:
- `bidPrice`/`askPrice`/`markPrice` (not `bid`/`ask`/`mark`) — field names differ from CBOE
- `totalVolume` (not `volume`)
- `strikePrice` is already in points (no ÷1000 needed)
- `symbol` is Schwab's padded format ("SPX  250620P07100000") — need conversion to OCC format for `occSymbol` field
- `underlyingPrice` at the top level provides spot (same role as CBOE's `current_price`)
- Expiry key format is `"YYYY-MM-DD:DTE"` — parse the date part only

### Schwab Symbol → OCC Conversion

Schwab option symbol format: `"SPX  250620P07100000"` (root left-padded to 6 chars, YYMMDD, P/C, strike 8 digits ×1000).

This is structurally identical to OCC 21-char format. The existing `formatOccSymbol` from `@morai/shared` should accept the parsed components and produce the canonical OCC symbol. The adapter can use the same parse logic as the CBOE adapter but input from Schwab's symbol string.

### Source Tag

Observations from the Schwab market adapter are tagged `source = 'schwab_chain'` on `ObservationRow`. The `observationSourceEnum` enum in `schema.ts` already includes `'schwab_chain'`. The `ForPersistingObservations` port accepts `ObservationRow` with `source: "cboe"` currently — the type must be widened to `source: "cboe" | "schwab_chain"`.

---

## Schwab Positions/Transactions Shape (BRK-02)

### Positions Endpoint [CITED: sudowealth/schwab-api TypeScript schemas, schwab-py docs]

```
GET https://api.schwabapi.com/trader/v1/accounts/{accountHash}/
  ?fields=positions
Authorization: Bearer {ACCESS_TOKEN}
```

Account hash is obtained from:
```
GET https://api.schwabapi.com/trader/v1/accounts/accountNumbers
```
which returns an array of `{ accountNumber, hashValue }`. Use `hashValue` for all subsequent calls.

**Position object (option instrument):**
```typescript
type Position = {
  shortQuantity?: number;
  longQuantity?: number;
  averagePrice?: number;
  marketValue?: number;
  currentDayProfitLoss?: number;
  instrument: {
    assetType: 'OPTION';
    symbol: string;           // Schwab padded symbol
    putCall?: 'PUT' | 'CALL' | 'UNKNOWN';
    optionMultiplier?: number;
    underlyingSymbol?: string;
    description?: string;
  };
};
```

### Transactions Endpoint [CITED: sudowealth/schwab-api TypeScript schemas]

```
GET https://api.schwabapi.com/trader/v1/accounts/{accountHash}/transactions
  ?startDate=ISO8601
  &endDate=ISO8601
  &types=TRADE
Authorization: Bearer {ACCESS_TOKEN}
```

**Transaction object:**
```typescript
type Transaction = {
  activityId: number;
  time: string;                 // ISO 8601 timestamp
  accountNumber: string;
  type: 'TRADE' | 'RECEIVE_AND_DELIVER' | ...;
  tradeDate?: string;
  settlementDate?: string;
  netAmount: number;
  orderId?: number;
  activityType?: 'EXECUTION' | 'ORDER_ACTION' | ...;
  transferItems?: Array<{
    instrument: { assetType: string; symbol: string; putCall?: string; ... };
    amount: number;
    cost: number;
    price: number;
    feeType?: string;
    positionEffect?: string;    // 'OPENING' | 'CLOSING'
  }>;
};
```

### New Ports Required (BRK-02)

Define in `packages/core/src/brokerage/application/ports.ts` (new bounded context):

```typescript
// Domain types
export type BrokerPosition = {
  readonly occSymbol: OccSymbol;
  readonly putCall: 'C' | 'P';
  readonly longQty: number;
  readonly shortQty: number;
  readonly averagePrice: number | null;
  readonly marketValue: number | null;
  readonly underlyingSymbol: string;
};

export type BrokerTransaction = {
  readonly activityId: number;
  readonly tradeDate: string;       // YYYY-MM-DD
  readonly netAmount: number;
  readonly orderId: number | null;
  readonly legs: ReadonlyArray<{
    readonly occSymbol: OccSymbol;
    readonly qty: number;
    readonly price: number;
    readonly positionEffect: 'OPENING' | 'CLOSING' | 'UNKNOWN';
  }>;
};

// Driven ports
export type ForFetchingPositions = (
  accountHash: string,
) => Promise<Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>>;

export type ForFetchingTransactions = (
  accountHash: string,
  from: string,   // YYYY-MM-DD
  to: string,
) => Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>>;
```

---

## AUTH_EXPIRED Degradation Wiring (AUTH-04)

### Current Status Contract State

`packages/contracts/src/status.ts` currently has:
```typescript
tokenFreshness: z.literal("none yet"),
```

Phase 4 MUST evolve this to represent per-app token state. Required contract change:

```typescript
// New shape for tokenFreshness
export const appTokenStatus = z.object({
  status: z.enum(['fresh', 'stale', 'AUTH_EXPIRED', 'none_yet']),
  expiresAt: z.string().datetime().nullable(),
  refreshIssuedAt: z.string().datetime().nullable(),
});

export const tokenFreshnessMap = z.object({
  trader: appTokenStatus,
  market: appTokenStatus,
});

// Updated statusResponse
export const statusResponse = z.object({
  db: z.enum(['ok', 'down']),
  tokenFreshness: z.union([z.literal('none yet'), tokenFreshnessMap]),
  lastJobRuns: z.union([z.literal('none yet'), z.record(z.string(), jobRunRecord)]),
  version: z.string(),
  uptime: z.number(),
});
```

This is a BREAKING CHANGE to the contract. Both the `getStatus` use-case (`packages/core`) and both adapters (HTTP route, MCP tool) must update in the same PR. Tests in `status.test.ts` must be updated.

### Per-App State in getStatus Use-Case

The `getStatus` use-case needs a new port:

```typescript
// New driven port
export type ForReadingTokenFreshness = () => Promise<
  Result<TokenFreshnessMap | 'none yet', StorageError>
>;

// TokenFreshnessMap (core domain type — no Zod in core)
export type TokenFreshnessMap = {
  trader: AppTokenStatus;
  market: AppTokenStatus;
};

export type AppTokenStatus = {
  status: 'fresh' | 'stale' | 'AUTH_EXPIRED' | 'none_yet';
  expiresAt: Date | null;
  refreshIssuedAt: Date | null;
};
```

### Job-Level AUTH_EXPIRED Guard

Schwab-dependent job handlers (snapshot-calendars when using Schwab source, future positions sync) must check token freshness before calling the adapter:

```typescript
// Pattern: check freshness before calling adapter
const freshness = await readTokenFreshness();
if (freshness.ok && freshness.value !== 'none yet') {
  if (freshness.value.market.status === 'AUTH_EXPIRED') {
    logger.warn('Schwab market token AUTH_EXPIRED — falling back to CBOE');
    // Use CBOE adapter instead
  }
}
```

The `snapshotCalendars` use-case (already in core) needs to accept either a Schwab chain fetcher or a CBOE chain fetcher based on token state. This is the source-priority decision (D-07/D-08). Implementation: the use-case receives `fetchChain: ForFetchingChain` — the composition root selects which implementation to inject based on freshness. Alternatively, the use-case can receive both and choose internally.

---

## Architecture Patterns

### System Architecture Diagram

```
CLI (auth setup/refresh/status/doctor)
  │
  ├─ loopback HTTPS listener (temporary)
  │     └─ captures code → exchanges → encrypts → writes broker_tokens
  │
  └─ broker_tokens repo (pgcrypto read/write)

apps/server + apps/worker
  │
  └─ broker_tokens repo ─→ reads token → injects into Schwab adapters
        │
        ├─ SchwabMarketAdapter ──→ GET /marketdata/v1/chains
        │     └─ flattens callExpDateMap/putExpDateMap → RawChain → ForFetchingChain
        │
        ├─ SchwabTraderAdapter ──→ GET /trader/v1/accounts/.../positions
        │                    └──→ GET /trader/v1/accounts/.../transactions
        │
        └─ AUTH_EXPIRED path ──→ getStatus tokenFreshness per app
                            └──→ snapshotCalendars falls back to CBOE
```

### Recommended Project Structure

```
packages/adapters/src/
├── schwab/
│   ├── auth/
│   │   ├── oauth-client.ts          # token exchange + refresh (vendored)
│   │   └── oauth-client.test.ts     # msw-backed: exchange, refresh, invalid_grant
│   ├── market/
│   │   ├── chain-adapter.ts         # implements ForFetchingChain
│   │   └── chain-adapter.test.ts    # msw fixture + contract test
│   └── trader/
│       ├── positions-adapter.ts     # implements ForFetchingPositions
│       ├── transactions-adapter.ts  # implements ForFetchingTransactions
│       └── trader-adapter.test.ts
├── postgres/
│   └── repos/
│       └── broker-tokens.ts         # ForReadingTokens + ForWritingTokens
└── memory/
    └── broker-tokens.ts             # in-memory twin for tests

packages/core/src/
└── brokerage/
    ├── domain/
    │   └── token-freshness.ts       # freshness domain logic (pure)
    ├── application/
    │   ├── ports.ts                 # ForFetchingPositions, ForFetchingTransactions, ForReadingTokenFreshness
    │   ├── refreshToken.ts          # on-demand refresh use-case
    │   └── getPositions.ts          # read-only positions use-case (BRK-02)
    └── index.ts

apps/auth/
├── src/
│   ├── main.ts                      # CLI entry: parse argv, dispatch subcommand
│   ├── setup.ts                     # auth setup: loopback dance
│   ├── refresh.ts                   # auth refresh: use refreshToken use-case
│   ├── status.ts                    # auth status: read broker_tokens, report freshness
│   └── doctor.ts                    # auth doctor: env check + callback match + live refresh
└── package.json
```

### Pattern: Vendored OAuth Client

The OAuth client is a thin module in `packages/adapters/src/schwab/auth/oauth-client.ts`. It is NOT a class — it follows the project's function-factory pattern.

```typescript
// packages/adapters/src/schwab/auth/oauth-client.ts
// Source: D-16 + standard OAuth2 flow [ASSUMED for exact shape]

export type SchwabTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;       // seconds (1800)
};

export type OAuthError = {
  readonly kind: 'oauth-error';
  readonly code: 'invalid_grant' | 'invalid_client' | 'network' | 'parse';
  readonly message: string;
};

export type SchwabOAuthClient = {
  readonly buildAuthUrl: (state: string) => string;
  readonly exchangeCode: (code: string) => Promise<Result<SchwabTokens, OAuthError>>;
  readonly refreshTokens: (refreshToken: string) => Promise<Result<SchwabTokens, OAuthError>>;
};

export function makeSchwabOAuthClient(config: {
  readonly appKey: string;
  readonly appSecret: string;
  readonly callbackUrl: string;
  readonly fetch: typeof globalThis.fetch;
}): SchwabOAuthClient {
  const basicAuth = Buffer.from(`${config.appKey}:${config.appSecret}`).toString('base64');
  // ...
}
```

The Basic auth header (`Authorization: Basic base64(APP_KEY:APP_SECRET)`) is used for token endpoint calls; the `access_token` Bearer is used for API calls.

### Pattern: Schwab Chain Adapter (mirrors CBOE)

```typescript
// packages/adapters/src/schwab/market/chain-adapter.ts
// [ASSUMED shape — mirrors cboe.ts structure]

export function makeSchwabChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): { fetchChain: ForFetchingChain } {
  const fetchChain: ForFetchingChain = async (root) => {
    const tokenResult = await deps.getAccessToken();
    if (!tokenResult.ok) {
      return err({ kind: 'fetch-error', message: 'AUTH_EXPIRED' });
    }
    // fetch, Zod-parse, flatten callExpDateMap → RawChain
  };
  return { fetchChain };
}
```

### Anti-Patterns to Avoid

- **Storing the encryption key anywhere in DB:** The `TOKEN_ENCRYPTION_KEY` env var must ONLY be present in Railway/Supabase secrets, read at the composition root, and passed to the repo adapter as an injected dependency.
- **Using `sql.raw()` for the encryption key:** Always use `sql` template literals so the key becomes a bound parameter.
- **Logging token values:** Never log access tokens, refresh tokens, or the encryption key. Log only timestamps and app IDs.
- **Sharing a single `ForFetchingChain` injection for both Schwab and CBOE at the same time:** The composition root must choose ONE implementation per request context. The cleanest approach is a wrapper that checks freshness and delegates.
- **Calling Schwab APIs without checking freshness first:** Every adapter call that uses an access token should check `expires_at` before calling — or handle the `401` and attempt a refresh before retrying once.
- **Using the account number (not the hash) in API calls:** Schwab trader API requires the `hashValue` from `/accounts/accountNumbers`, not the raw account number.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Loopback HTTPS listener for CLI auth | Custom Bun TLS server from scratch | `oauth-callback` library + `Bun.serve(tls:...)` if flagged | Self-signed cert generation, port lifecycle, timeout handling, connection filtering are all edge-case-heavy |
| Symmetric encryption of tokens | Custom AES implementation | `pgp_sym_encrypt` / `pgp_sym_decrypt` via `pgcrypto` | Extension already available in Supabase; correct cipher (AES-128 default), proper PGP padding, no custom key-schedule bugs |
| OAuth 2.0 state/CSRF param | Custom random string + comparison | `crypto.randomUUID()` from Node stdlib | `randomUUID()` is cryptographically random; no need for `Math.random` |
| Schwab symbol → OCC conversion | New parsing function | Reuse `formatOccSymbol` from `@morai/shared` + same parse logic as CBOE adapter | Logic already proven; symbol structure is the same |
| Clock-skew-safe token expiry check | Custom clock comparison | 60-second refresh buffer on `expires_at` | Prevents edge cases where server clock is slightly ahead of Schwab's |

**Key insight:** The OAuth flow itself (code exchange + refresh grant) is genuinely simple (two HTTP POSTs). The complexity is in the surrounding concerns: HTTPS loopback listener, state validation, clock-skew-safe expiry, per-app independence, and DB encryption. Use libraries/extensions for infrastructure; own the domain logic.

---

## Common Pitfalls

### Pitfall 1: Callback URL Not Exact-Match

**What goes wrong:** `auth setup` succeeds locally but Schwab rejects the redirect with `401` or `redirect_uri_mismatch`.
**Why it happens:** The registered callback URL must match the `redirect_uri` parameter character-for-character. Even a trailing slash difference fails.
**How to avoid:** `doctor` command must read the `SCHWAB_*_CALLBACK_URL` env var and compare it to a stored/known expected value. Document the registered URL clearly in env var docs.
**Warning signs:** Auth URL builds but browser redirect results in Schwab error page.

### Pitfall 2: Refresh Token 7-Day Hard Expiry (No Sliding Window)

**What goes wrong:** System runs fine for 6 days, then every Schwab call fails on day 8 because the refresh token expired.
**Why it happens:** Schwab's refresh token TTL is absolute from issuance, not sliding. A successful access token refresh does NOT extend the refresh token's life.
**How to avoid:** Track `refresh_issued_at` in `broker_tokens`. `doctor` warns when `refresh_issued_at` is within 24h of 7 days old. Job-02 (Phase 5) refreshes before the 7-day boundary.
**Warning signs:** Successful refreshes for days, then sudden `invalid_grant`/`invalid_client` at day 7.

### Pitfall 3: HTTPS Required on 127.0.0.1 Loopback

**What goes wrong:** CLI listener starts on HTTP, browser redirect fails because Schwab sends to `https://127.0.0.1`.
**Why it happens:** Schwab only allows HTTPS callback URLs.
**How to avoid:** The loopback listener MUST be HTTPS, even on localhost. Use a self-signed cert generated in-memory at CLI startup. The browser will show a cert warning, which is expected and OK for a one-time local flow.

### Pitfall 4: Authorization Code Expires in 30 Seconds

**What goes wrong:** Auth code is captured but token exchange fails with `invalid_grant`.
**Why it happens:** The authorization code has a 30-second TTL. Any delay between capture and exchange causes failure.
**How to avoid:** Exchange the code immediately after the loopback server captures it, before any other operations.

### Pitfall 5: Account Hash vs Account Number

**What goes wrong:** Trader API calls return 400 or 404 when using the raw account number.
**Why it happens:** Schwab trader API requires the hashed account number from `/accounts/accountNumbers`, not the raw brokerage account number.
**How to avoid:** Always fetch account hash via `/accounts/accountNumbers` first, cache it alongside tokens (or derive on each auth setup), use `hashValue` in all subsequent calls.

### Pitfall 6: `statusResponse` Contract Breaking Change

**What goes wrong:** Updating `tokenFreshness` from `z.literal("none yet")` to the per-app map breaks existing tests in `status.test.ts` and any consumer that hardcodes `"none yet"`.
**Why it happens:** The existing contract is a strict literal; the new shape is a union type.
**How to avoid:** Update `packages/contracts/src/status.ts`, `getStatus.ts` use-case, both HTTP and MCP adapters, and all tests in the same PR. Use `z.union([z.literal('none yet'), tokenFreshnessMap])` to maintain backward compatibility during the transition.

### Pitfall 7: pgcrypto key in query logs

**What goes wrong:** `TOKEN_ENCRYPTION_KEY` appears in Postgres slow-query logs or pg_stat_activity.
**Why it happens:** Using `sql.raw()` instead of `sql` template literals, or string interpolation instead of parameter binding.
**How to avoid:** Always use `sql` template literal (not `sql.raw()`). Verify with `EXPLAIN (ANALYZE, VERBOSE)` that the key appears as `$2` not inline. Never log the full SQL string of any query that touches `broker_tokens`.

### Pitfall 8: `ObservationRow.source` Type Narrowing

**What goes wrong:** TypeScript rejects `source: 'schwab_chain'` in `ObservationRow` because the type is `source: "cboe"`.
**Why it happens:** `ports.ts` currently defines `ObservationRow.source` as the literal `"cboe"` for MKT-01 Phase 2.
**How to avoid:** Widen `ObservationRow.source` to `"cboe" | "schwab_chain"` in the port definition. This is a cross-cutting change: `ports.ts` → adapter tests → any type-checked consumer.

### Pitfall 9: Schwab Rate Limits (120 req/min) [CITED: schwab-client-js/SchwabConfig.md]

**What goes wrong:** During batch operations (multiple calendar snapshots in a loop), Schwab returns `429`.
**Why it happens:** 120 req/min limit across all API calls. At 30-min snapshot cadence with few calendars this is unlikely, but bulk fetch on startup could hit it.
**How to avoid:** Add a 60-second back-off on `429`. Track request timestamps, insert `await sleep(500)` between chain fetches if fetching multiple expirations.

### Pitfall 10: `broker_tokens` Migration Timing

**What goes wrong:** Server/worker boot fails because the `broker_tokens` table doesn't exist when the token repo adapter tries to query it.
**Why it happens:** Migration must run before application code that reads this table.
**How to avoid:** The `broker_tokens` migration is in the same Drizzle migration sequence. The existing idempotent migrator runs on boot. Ensure the migration runs BEFORE the token repo is called. This is already the pattern (`runMigrations()` called in `main.ts` before serving).

---

## Runtime State Inventory

Phase 4 is greenfield for the auth/brokerage concern (new table, new adapters). No rename/refactor work.

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `broker_tokens` table does NOT yet exist | Migration creates it in this phase |
| Live service config | Schwab dev apps already registered (D-05) | No registration work; just read env vars |
| OS-registered state | None — no CLI binary installed yet | `apps/auth` is a new app |
| Secrets/env vars | `TOKEN_ENCRYPTION_KEY` must be added to Railway + local `.env` | Document in env var checklist |
| Build artifacts | None | — |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | Auth CLI, adapters | ✓ (already in project) | project-standard | — |
| Postgres / Supabase | broker_tokens table, pgcrypto | ✓ | 16 (Supabase) | — |
| pgcrypto extension | Encryption at rest | ✓ assumed (pre-enabled in Supabase) | Supabase default | `CREATE EXTENSION IF NOT EXISTS pgcrypto` in migration |
| `TOKEN_ENCRYPTION_KEY` env var | token repo adapter | Not yet set | — | Must be set before auth setup can run |
| Schwab app credentials (D-05) | OAuth client | Already configured per D-05 | — | — |

**Missing dependencies with no fallback:**
- `TOKEN_ENCRYPTION_KEY` must be provisioned in Railway and local `.env` before Phase 4 can run end-to-end.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (already configured) |
| Config file | `vitest.config.ts` at workspace root, per-package vitest projects |
| Quick run command | `bun run test` (workspace) |
| Full suite command | `bun run test` + testcontainers (requires Docker) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | `exchangeCode` returns `SchwabTokens` on 200 | unit (msw) | `bun vitest run packages/adapters/src/schwab/auth/oauth-client.test.ts` | ❌ Wave 0 |
| AUTH-01 | `refreshTokens` returns new tokens on 200 | unit (msw) | same | ❌ Wave 0 |
| AUTH-01 | `refreshTokens` returns `Result.err({kind:'oauth-error',code:'invalid_grant'})` on 400 | unit (msw) | same | ❌ Wave 0 |
| AUTH-02 | `broker-tokens` repo round-trip: write then read decrypts correctly | integration (testcontainers + pgcrypto) | `bun vitest run packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` | ❌ Wave 0 |
| AUTH-02 | encrypted column is not plaintext in raw DB row | integration (testcontainers) | same | ❌ Wave 0 |
| AUTH-03 | `auth status` reads from DB, does not call Schwab | unit (in-memory twin) | manual / CLI integration | ❌ |
| AUTH-03 | `auth doctor` reports missing env var | unit | `bun vitest run apps/auth/src/doctor.test.ts` | ❌ Wave 0 |
| AUTH-04 | `getStatus` returns `tokenFreshness.market: AUTH_EXPIRED` when market token stale | use-case (in-memory) | `bun vitest run packages/core/src/journal/application/getStatus.test.ts` | ❌ needs update |
| AUTH-04 | `statusResponse` Zod schema accepts per-app tokenFreshness map | unit | `bun vitest run packages/contracts/src/status.test.ts` | ❌ needs update |
| BRK-01 | Schwab chain adapter returns `RawChain` from fixture | unit (msw) | `bun vitest run packages/adapters/src/schwab/market/chain-adapter.test.ts` | ❌ Wave 0 |
| BRK-01 | Schwab chain adapter satisfies `ForFetchingChain` contract | contract (msw) | `bun vitest run packages/adapters/src/schwab/market/chain-adapter.contract.test.ts` | ❌ Wave 0 |
| BRK-01 | `leg_observations` tagged `source='schwab_chain'` after Schwab fetch | integration (testcontainers) | in leg-observations contract test | ❌ Wave 0 |
| BRK-02 | positions adapter returns `BrokerPosition[]` from fixture | unit (msw) | `bun vitest run packages/adapters/src/schwab/trader/trader-adapter.test.ts` | ❌ Wave 0 |
| BRK-02 | transactions adapter returns `BrokerTransaction[]` from fixture | unit (msw) | same | ❌ Wave 0 |
| BRK-02 | failed Zod parse returns `Result.err`, not thrown exception | unit | same | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run test` (in-memory + msw tests only; no Docker)
- **Per wave merge:** Full suite including testcontainers for broker-tokens pgcrypto round-trip
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps (files that must exist before implementation begins)

- [ ] `packages/adapters/src/schwab/auth/oauth-client.test.ts` — AUTH-01 msw fixtures for token exchange + refresh + invalid_grant
- [ ] `packages/adapters/src/schwab/market/chain-adapter.test.ts` — BRK-01 Schwab chain msw fixture (recorded from live or hand-crafted from schema)
- [ ] `packages/adapters/src/schwab/trader/trader-adapter.test.ts` — BRK-02 positions + transactions msw fixtures
- [ ] `packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` — AUTH-02 pgcrypto round-trip via testcontainers
- [ ] `packages/contracts/src/status.test.ts` — update for new `tokenFreshness` union type (AUTH-04)
- [ ] `packages/core/src/journal/application/getStatus.test.ts` — update for per-app token freshness (AUTH-04)
- [ ] `packages/adapters/src/memory/broker-tokens.ts` — in-memory twin (AUTH-02, required by hexagonal boundary rule)

---

## Project Constraints (from CLAUDE.md)

| Constraint | Impact on Phase 4 |
|------------|-------------------|
| `core` imports `shared` only | `brokerage` bounded context in core MUST NOT import Schwab adapter code, Drizzle, Bun APIs, or `process.env` |
| No `any`, `as`, `!` | Zod parse for all Schwab responses; `assertDefined` instead of `!`; no `as` casts on parsed values |
| TDD red→green | Every OAuth client function, adapter method, and use-case needs a failing test before implementation |
| MCP-02 | Every new use-case (getPositions, getTransactions, getTokenFreshness) ships HTTP route + MCP tool in same PR |
| Zod at every boundary | Schwab option chain, positions, transactions all Zod-parsed before reaching core |
| In-memory twin per port | `ForReadingTokenFreshness`, `ForFetchingPositions`, `ForFetchingTransactions` all need memory implementations |
| No `console.log` | Use `console.warn` / `console.error` only |
| pgcrypto key NEVER in DB | D-03 — enforced via parameterized Drizzle `sql` template calls |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TDA (TD Ameritrade) API | Schwab Trader API | Schwab acquired TDA; migration completed ~2024 | Different OAuth endpoints; Schwab does NOT use the old TDA token endpoint |
| Token storage in files | Token storage in Postgres (encrypted) | D-16 decision | Server + worker read same row; no file/volume coordination |
| Single Schwab app | Two separate apps (trader + market) | D-16 two-app rationale | Independent OAuth flows and token lifetimes; one expiring doesn't block the other |

**Deprecated/outdated:**
- TD Ameritrade API endpoints (`api.tdameritrade.com`) — replaced by `api.schwabapi.com`. Any old trade-advisor code from TDA era needs new Schwab URLs.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `oauth-callback` npm package is legitimate, Bun-compatible, and handles HTTPS loopback | Standard Stack, Loopback Capture | Would require hand-rolling Bun TLS loopback server (~40 lines); viable fallback exists |
| A2 | Error response on expired refresh is `{"error": "invalid_grant"}` OR `{"error": "invalid_client"}` | Schwab OAuth Flow | If different error key, the guard in `refreshTokens` catches the wrong condition; test both |
| A3 | SPX index option chain is requested with symbol `$SPX` (dollar-prefix) | Option Chain Shape | If symbol is `SPX` without prefix, all chain requests return empty or 404; verify from live test |
| A4 | Both apps use the same token endpoint (`/v1/oauth/token`) with different `client_id`/`client_secret` | Schwab OAuth Flow | If apps use different endpoints, the OAuth client factory needs two URL configs |
| A5 | pgcrypto is pre-enabled in Supabase free-tier databases | pgcrypto Pattern | If not enabled, `CREATE EXTENSION` migration either errors (need superuser) or succeeds; Supabase dashboard should confirm |
| A6 | `broker_tokens` Drizzle schema uses `customType` or `bytea` from `drizzle-orm/pg-core` for the encrypted columns | pgcrypto Pattern | If `bytea` Drizzle column type behaves differently than expected, column declaration needs adjustment |
| A7 | Account hash from `/accounts/accountNumbers` is stable and can be stored alongside tokens | Positions/Transactions Shape | If hash changes per session, must fetch fresh on each use — store the account number and hash separately |
| A8 | Schwab option chain symbol format for index options is `$SPX` not `SPX` for the query param | Option Chain Shape | Chain returns empty/error; verify via `auth doctor` live chain test |

**If any A1–A8 assumptions are wrong:** The planner must add a `checkpoint:human-verify` task before the affected implementation task.

---

## Open Questions (RESOLVED)

1. **HTTPS loopback: registered port**
   - What is: the already-registered callback URL port for each app (D-05 says apps are already configured)
   - What's unclear: whether the callback is `https://127.0.0.1` (no port) or `https://127.0.0.1:XXXX`
   - Recommendation: the `auth setup` implementation must read the exact registered callback URL from env (`SCHWAB_TRADER_CALLBACK_URL`, `SCHWAB_MARKET_CALLBACK_URL`) and derive the port from it. Make the loopback server bind to whatever port is in the registered URL.
   - **RESOLVED:** the listener port is derived at runtime from the registered callback URL: `new URL(config.SCHWAB_<APP>_CALLBACK_URL).port`. No hardcoded port. (Implemented in plan 04-03.)

2. **`$SPX` vs `SPX` symbol for index option chains**
   - What we know: community examples use `$SPX` for SPX index; some use `SPX`
   - What's unclear: which form the market data `/chains` endpoint requires
   - Recommendation: Build the market adapter to accept the underlying symbol as a parameter from the use-case. The first live `auth doctor` run should include a chain test that tries `$SPX` and validates the response. If wrong, the env config can hold the correct symbol.
   - **RESOLVED:** the chain symbol is a caller-supplied parameter, not hardcoded in the adapter; the adapter passes whatever symbol the use-case provides. The live `$SPX`-vs-`SPX` confirmation is a runtime/manual-verification item (already in VALIDATION.md manual checks), not a planning blocker. (Plan 04-04.)

3. **bytea column declaration in Drizzle**
   - What we know: pgcrypto returns `bytea`; Drizzle-orm has `customType` for non-standard types
   - What's unclear: exact Drizzle syntax for a `bytea` column that works with `pgp_sym_encrypt` return value
   - Recommendation: Use `customType<{ data: string; driverData: Buffer }>` from drizzle-orm or `sql<string>` with explicit cast on read. Verify in the testcontainers pgcrypto round-trip test (Wave 0 gap).
   - **RESOLVED:** use a Drizzle `customType<{ data: string; driverData: Buffer }>` for the encrypted `bytea` columns. (Implemented in plan 04-01 Task 3.)

---

## Sources

### Primary (HIGH confidence — official docs)
- [PostgreSQL pgcrypto docs](https://www.postgresql.org/docs/current/pgcrypto.html) — pgp_sym_encrypt/decrypt function signatures, param types, CREATE EXTENSION
- [Drizzle sql template docs](https://orm.drizzle.team/docs/sql) — parameterized sql tag usage for raw functions
- [schwab-py documentation](https://schwab-py.readthedocs.io/en/latest/auth.html) — access token 30min TTL, refresh token 7-day TTL, OAuthError on expired refresh

### Secondary (MEDIUM confidence — official-adjacent / well-maintained OSS)
- [sudowealth/schwab-api TypeScript schemas](https://github.com/sudowealth/schwab-api) — option chain, positions, transactions TypeScript type definitions; `GetOptionChainResponse`, `OptionContractSchema`, `Position`, `Transaction`
- [schwab-client-js DeveloperReference.md](https://github.com/slimandslam/schwab-client-js/blob/main/docs/DeveloperReference.md) — rate limits (120 req/min), token lifetime, OAuth endpoints
- [schwab-client-js SchwabConfig.md](https://github.com/slimandslam/schwab-client-js/blob/main/docs/SchwabConfig.md) — 120 req/min, callback URL pattern `https://127.0.0.1:5556`
- [kriasoft/oauth-callback](https://github.com/kriasoft/oauth-callback) — Bun-compatible loopback OAuth code capture library

### Tertiary (LOW confidence — community blog / indirect)
- [Carsten Savage Medium Guide](https://medium.com/@carstensavage/the-unofficial-guide-to-charles-schwabs-trader-apis-14c1f5bc1d57) — authorization URL, token URL, Basic auth header, account hash requirement
- [elkingarcia11/schwab-options-api-client](https://github.com/elkingarcia11/schwab-options-api-client) — `/marketdata/v1/chains` endpoint URL, response structure outline

---

## Metadata

**Confidence breakdown:**
- Schwab OAuth endpoints/flow: MEDIUM — multiple independent community implementations confirm same URLs and parameters
- Token TTLs (30min/7day): HIGH — confirmed by both schwab-py official docs and multiple community sources
- Option chain response shape: MEDIUM — confirmed by well-maintained TypeScript type library (sudowealth/schwab-api), not official docs
- Positions/transactions shape: MEDIUM — same TypeScript type library
- pgcrypto pattern: HIGH — PostgreSQL official docs
- Loopback HTTPS requirement: MEDIUM — confirmed by schwab-py official docs mentioning `127.0.0.1` and HTTPS

**Research date:** 2026-06-19
**Valid until:** 2026-07-19 (30 days for Schwab API; stable OAuth patterns)

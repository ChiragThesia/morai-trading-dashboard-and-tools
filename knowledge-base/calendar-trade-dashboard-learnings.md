# Calendar Trade Dashboard — Engineering & Trading Knowledge Extraction

**Source**: `calendar-trade-dashboard/` (deleted 2026-05-06)
**Scope**: All non-node_modules, non-.git directories. Reusable patterns, gotchas, calibration notes preserved here so the dashboard can be deleted.

## 1. Project Architecture

**Purpose**: Single-tenant TypeScript dashboard for SPX calendar (multi-leg) options trades. Live + historical Greeks, scenario tool, P/L attribution, CLI, MCP server. Self-hosted.

**Tech Stack**:
- **Runtime**: Bun (not Node)
- **Frontend**: Vite + React + Tailwind v4 + shadcn/ui + Recharts
- **Backend**: Hono RPC + Zod on Bun
- **Database**: Postgres 16 + TimescaleDB (time-series)
- **ORM**: Drizzle (type-safe, manual migrations)
- **Jobs**: BullMQ + Redis (deterministic job IDs via SHA1 hash)
- **Tests**: Vitest + fast-check + msw + testcontainers + Playwright
- **Container**: Docker Compose (server, worker, postgres, redis)

**Docker Compose**:
- `timescale/timescaledb:latest-pg16` — hypertable compression + chunking
- `redis:7-alpine` — BullMQ queue backend
- Server + Worker mount `./tokens` volume for Schwab token persistence (mode 0600)

---

## 2. TypeScript Strictness & Code Quality

### Compiler Rules (`tsconfig.base.json`, strict: true)
- `noUncheckedIndexedAccess` — prevents unchecked `obj[key]`
- `noImplicitOverride` — `override` keyword required
- `noPropertyAccessFromIndexSignature` — forbids `.prop` on widened index types
- `noFallthroughCasesInSwitch`
- `exactOptionalPropertyTypes` — `x?: T` ≠ `x: T | undefined`
- `useUnknownInCatchVariables` — catch must handle `unknown`

### ESLint Rules (`eslint.config.js`, flat config)
- **No type casts**: `no-explicit-any`, `consistent-type-assertions` — use Zod parsing or type guards
- **No non-null assertions**: forbids `!` — use `assertDefined()`
- **No optional chaining**: forbids `?.` — explicit branches
- **No floating promises**: all async awaited
- **Exhaustiveness**: switch must cover all union members
- **Strict booleans**: explicit boolean in if/while
- **Console gated**: only `.warn()`/`.error()`

**Calibration Gate**: `packages/greeks/test/tos-fixtures.test.ts` fails CI if BSM math drifts >0.5% from ThinkorSwim Analyze fixture.

---

## 3. Greeks: Black-Scholes-Merton & IV Inversion

### BSM Inputs & Greeks (`packages/greeks/src/bsm.ts`)
```typescript
type BsmInputs = { spot, strike, timeYears, rate, sigma, dividendYield, isCall };
type Greeks = { delta, gamma, theta, vega, rho };
// Raw: theta in dP/dT(years), vega in dP/dσ(decimal), rho in dP/dr(decimal)
```

### Display Greeks (`scaling.ts`)
```typescript
theta = raw.theta / 365  // per 1 calendar day
vega  = raw.vega / 100   // per 1pp IV move
rho   = raw.rho / 100    // per 1pp rate move
```

### IV Inversion (`packages/greeks/src/iv.ts`)
- Newton-Raphson with bisection fallback when step leaves bracket
- Bounds: σ ∈ [1e-4, 5.0]
- Convergence: 100 iter max, tolerance 1e-7
- **Robustness**: vega < 1e-12 → bisection
- **Gotcha**: Vega collapses near-zero for deep ITM/OTM or short DTE — bisection saves it

### Normal Distribution (`normal.ts`)
Abramowitz-Stegun 26.2.17 polynomial rational approximation. Accuracy ~7e-8.

### Scenario Tool (`scenario.ts`)
Re-prices legs under spot/sigma/time/rate shifts.
- `deltaSigma` decimal raw (0.05 = +5pp); σ_new = σ_before + 0.05
- `deltaRate` decimal raw (0.01 = +100bps)
- Process: IV invert → shift inputs → re-price → return new mark + Greeks

### Attribution P&L Decomposition (`attribution.ts`)
```
totalChange = priorPrice → currentPrice
deltaComponent = Δ * ΔS
gammaComponent = 0.5 * Γ * ΔS²
vegaComponent  = vega * (Δσ × 100)   // vega per 1pp, Δσ decimal → ×100
thetaComponent = θ * ΔdaysDays
rhoComponent   = rho * (Δr × 100)
residual = totalChange - explained
```

### Position Greeks (`position.ts`)
```typescript
factor = sign × qty × multiplier  // sign = long ? 1 : -1
delta = Σ(factor × leg.delta)
gamma = Σ(factor × leg.gamma)
theta = Σ(factor × leg.theta)
vega  = Σ(factor × leg.vega)
rho   = Σ(sign × qty × leg.rho)   // NO multiplier — TOS convention
```

### Calibration Constants
- **SPX dividend yield**: 0.010 (1%) — matches TOS Analyze defaults
- **Other underlyings**: 0.0
- **TOS calibration gate**: 4/24 SPX 7100P calendar fixture, 0.5% IV drift tolerance

---

## 4. Schwab Integration: Two-App Facade

### Token Lifecycle (`packages/schwab/src/auth.ts`)
```typescript
type Token = { access_token, refresh_token, expires_at(ms), token_type, scope };

async function refreshToken(input): Promise<Token> {
  // POST https://api.schwabapi.com/v1/oauth/token
  // Auth: Basic base64(appKey:appSecret)
  // Body: grant_type=refresh_token&refresh_token=...
  // expires_at = Date.now() + expires_in*1000
}
```

Token files: mode 0600, on-disk persistence, daily refresh.

### HTTP Client with Retry (`packages/schwab/src/http.ts`)
1. Bearer token injection
2. **401**: single-shot token refresh + retry once
3. **429**: respect `Retry-After` (seconds or HTTP-date), fallback exp backoff
4. **5xx/network**: `BASE_BACKOFF * 2^attempt + jitter(0-200ms)`
5. **Backoff caps**: min 500ms, max 60s
6. **Max retries**: default 5

```javascript
exp = Math.min(500 * 2^attempt, 60_000)
backoffMs = exp + Math.random() * 200
```

**Gotcha**: Auth refresh path doesn't increment attempt counter. If refresh fails, retries use stale token.

### Schwab Facade (`packages/schwab/src/index.ts`)
Two separate apps required by Schwab:
- **Trader app**: orders, positions
- **Market Data app**: chains, quotes

Each has own OAuth + token + rate limit. Facade combines:
```typescript
type SchwabConfig = {
  trader: { appKey, appSecret, tokenPath },
  market: { appKey, appSecret, tokenPath },
  tokens: { trader, market },
  onTokenRefreshed?: (which, token) => void  // persist callback
};
```

---

## 5. Orders Mapper: Schwab JSON → Trades

### Order Mapping (`packages/orders/src/map-order.ts`)
Maps Schwab Order JSON (all status/leg/strategy types) → normalized OrderRow + OrderLegRow. Validates enums, extracts contracts, de-dupes by OCC symbol.

### Contract Extraction (`contract-extract.ts`)
```typescript
EUROPEAN_ROOTS = { "SPX", "SPXW" }  // cash-settled European; rest American
ROOT_TO_UNDERLYING = {
  "SPX" → "SPX", "SPXW" → "SPX",   // weekly variant
  "NDX" → "NDX", "NDXP" → "NDX",
  "RUT" → "RUT", "RUTW" → "RUT"
}
// Strike stored as int (7100 for $71.00, 200500 for $200.50), divide by 1000 on parse
```

Row fields:
- `occSymbol` (PK, VARCHAR 32): `O:SPX260515P7100`
- `schwabSymbol` (VARCHAR 32): `SPX  260515P7100` (root padded to 6)
- `underlying`, `root`, `contractType`, `exerciseStyle`, `strike`, `expiration`, `multiplier` (100 for index/equity)

---

## 6. Database: Drizzle + TimescaleDB

### Hypertable Strategy (`migrations/0004_timeseries.sql`)
```sql
CREATE HYPERTABLE('leg_observations', 'time', INTERVAL '7 days');
ALTER TABLE leg_observations SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'contract'
);
ADD COMPRESSION_POLICY(INTERVAL '7 days');
```

7-day chunks balance write locality; compression after 1 week.

### Leg Observations
```sql
leg_observations (time, contract) PRIMARY KEY
  source ENUM (schwab_chain | massive_aggs | computed_only)
  bid, ask, mark, last, underlying_price
  rate, iv, delta, gamma, theta, vega, rho     -- Schwab raw
  bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, bsm_rho   -- computed
  open_interest, volume
```

**Index**: `leg_observations_bsm_pending_idx` ON `(time DESC, contract)` WHERE `bsm_iv IS NULL AND mark IS NOT NULL` — partial idx for cheap pending scan.

### Other Tables
- `underlying_observations (time, symbol)` — spot prices
- `rate_observations (date)` — DGS3MO daily from FRED
- `contracts (occ_symbol)` — first-seen contract metadata
- `orders` / `order_legs` — Schwab feed
- `trades` / `trade_legs` — derived (pairs open + close)

### Migration Pattern (`migrate.ts`)
- Tracking table `schema_migrations (filename, applied_at)`
- Lex-sort .sql files, run unapplied each in own txn
- Idempotent — safe across Docker restarts

---

## 7. FRED DGS3MO Fetcher

```typescript
// packages/fred/src/client.ts
const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";
const CACHE_TTL_MS = 7 * 86_400_000;
const FALLBACK_RATE = 0.045;  // 4.5% if FRED unreachable

// FRED returns "." for missing values → skip
// ISO date string → rate (decimal)
```

Daily 3-month Treasury for risk-free rate. Rho impact on SPX calendars small → graceful 4.5% fallback acceptable.

---

## 8. Massive (Polygon) Retry

### `packages/massive/src/retry.ts`
- **429**: parse `Retry-After` (seconds int OR HTTP-date), default 60s if unparseable
- **5xx + network**: `baseDelayMs * 2^attempt + random(0, baseDelayMs)`
- **4xx (not 429)**: fail fast, no retry
- **2xx/3xx**: return immediately

```typescript
class MaxRetriesExceededError extends Error {
  constructor(message, attempts, lastStatus, cause) { ... }
}
```

All responses Zod-parsed → malformed bodies surface as ZodError.

---

## 9. Worker: BullMQ Jobs & Crons

### Queue Names + Deterministic IDs (`queues.ts`)
```typescript
QUEUE_NAMES = {
  syncOrders, syncPositions, pollChain, pollUnderlying,
  enqueueBsmGreeks, computeBsmGreeks, backfillBsmGreeks,
  backfillHistorical, backfillUnderlying,
  refreshTokens, compressOldData, retentionPrune, syncEvents
};

makeJobId(queue, key) = SHA1(queue:key).slice(0,16)  // BullMQ dedup
```

### Cron Schedules (`scheduler.ts`, all in `America/New_York`)
| Job | Schedule | Purpose |
|-----|----------|---------|
| sync-orders | every 10s | Fetch live orders → map → upsert |
| sync-positions | every 10s | Same via positions endpoint |
| poll-chain | `*/1 * * * *` | Backup chain poll (streamer primary) |
| poll-underlying | `*/1 * * * *` | Spot price poll |
| enqueue-bsm-greeks | every 30s | Scan pending → enqueue compute |
| refresh-tokens | `0 4 * * *` | 04:00 ET — daily token refresh |
| compress-old-data | `0 3 * * 0` | 03:00 ET Sunday — compression |
| retention-prune | `0 2 1 * *` | 02:00 ET monthly — delete stale |
| sync-events | `30 6 * * *` | 06:30 ET — pre-open event refresh |

### compute-bsm-greeks Job
**Constants**:
- `SPX_DIVIDEND_YIELD = 0.010`
- `UNDERLYING_WINDOW_MS = 24h` — ±1 day spot match (live ±5min, historical ±1d)

**Process**: parse OCC → find spot in window → fetch DGS3MO rate → IV invert → BSM greeks → upsert bsm_*.

**Failure logging**: "mark is null", "mark not positive", "contract not found", "spot not found", "rate not found" — all return `{ computed: false, reason }`.

### refresh-tokens Job
- Calls `refreshToken()` for trader + market
- Writes mode 0600 to disk
- Critical alert on failure (UI banner)
- Doesn't throw — one app can fail without blocking other
- Returns `{ traderRefreshed, marketRefreshed, failures }`

---

## 10. Shared Utilities

### `packages/shared/src/`

**assertDefined** — replaces forbidden `!`:
```typescript
function assertDefined<T>(v: T | null | undefined, msg: string): asserts v is T {
  if (v === null || v === undefined) throw new Error(`Expected defined: ${msg}`);
}
```

**Result type** — explicit error handling:
```typescript
type Result<T, E> = { kind: "ok", value: T } | { kind: "err", error: E };
function ok<T>(v: T): Ok<T>
function err<E>(e: E): Err<E>
function isOk / isErr / mapResult
```

**Symbol parsing** (`symbol.ts`):
```typescript
const OCC_RE = /^O:([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/;
// O:SPX260515P7100  ↔  "SPX  260515P7100"
parseOcc, schwabToOcc, occToSchwab
// Strike int / 1000 on parse
```

**Time** (`time.ts`):
- `toEtIso(d)` — ISO 8601 ET offset
- `daysBetween(a, b)` — calendar days
- `isWeekend(d)` — UTC day
- `isUSMarketHours(d)` — 9:30–16:00 ET, **does NOT exclude holidays** (TODO)

---

## 11. Server: Hono Routes

### Startup (`apps/server/src/index.ts`)
- Port: 3000 (SERVER_PORT env)
- Postgres + auto-migrate on boot
- Optional SPA static serve from STATIC_DIR
- Token status check on startup

### Deps
```typescript
type ServerDeps = { db, schwab, logger, tokenStatus };
type TokenStatusBundle = {
  trader: { lastRefreshed, expiresAt },
  market: { lastRefreshed, expiresAt }
};
```

### Routes
- `GET /api/status` — health + token status
- `GET /api/trades` — open trades + Greeks
- `GET /api/orders` — order history
- `GET /api/greeks` — live position Greeks
- (Hono RPC + Zod validation throughout)

---

## 12. CLI Scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `fetch-greeks.ts` | Live Greeks for strike across two expirations |
| `fetch-positions.ts` | Open positions, refresh tokens, persist |
| `fetch-leg-greeks.ts` | Per-leg greeks for backfill/research |
| `fetch-spx.ts` | Spot price fetch |

Standard env:
```bash
SCHWAB_TRADER_TOKEN_PATH, SCHWAB_MARKET_TOKEN_PATH
SCHWAB_TRADER_APP_KEY, SCHWAB_TRADER_APP_SECRET
SCHWAB_MARKET_APP_KEY, SCHWAB_MARKET_APP_SECRET
```

---

## 13. Architectural Decisions & Gotchas

### Two Schwab Apps (Trader + Market)
**Why**: Schwab requires separate OAuth apps. Each maintains own token + refresh + rate limits. `SchwabFacade` wraps both; `onTokenRefreshed` callback persists tokens on every refresh.

### BSM Greeks Computed Separately from Schwab Raw
**Why**: Schwab Greeks pre-computed black-box, often include bid-ask mid-smile artifacts. BSM ensures consistent per-contract pricing, attribution accuracy, scenario consistency.

**Implementation**: leg_observations stores both. Server prefers bsm_*; falls back to Schwab raw if `bsm_iv IS NULL`. enqueue/compute jobs fill the gap.

### Hypertable Compression After 7 Days
**Why**: Live + intraday is write-heavy. 7-day chunks warm; compress after 1 week reduces storage. Compression CPU during 03:00 ET Sunday — acceptable single-user.

### Token Refresh 04:00 ET Daily
**Why**: Schwab tokens 7-day TTL. Daily refresh prevents expiry mid-session. 04:00 ET avoids market hours.

### No Holiday Check in `isUSMarketHours` (TODO)
Current: weekday + 9:30–16:00 ET only. Misses Thanksgiving, Good Friday, MLK, etc. Cron jobs poll API on holidays → wasted quota (graceful no-op).

**Fix**: NYSE holiday calendar or hardcoded exclusions.

### SPX Dividend Yield = 1.0%
SPX is total-return index. Calibrated to TOS Analyze (4/24 fixture, 0.5% tolerance).

### ±1 Day Spot Matching Window
Live ticks match seconds (±5min jitter). Historical Polygon aggs land 00:04:05 UTC post-close → close lives ±24h. ±1d window bridges; ranking picks closest.

---

## 14. Testing & Calibration

### TOS Calibration Gate (`tos-fixtures.test.ts`)
Fixture: `fixtures/tos-4-24-7100p-calendar.json`
- IV per leg: tight <0.5% relative
- Greeks per leg: loose <5% relative
- Net Greeks: loose <5% relative

Tight IV because IV is direct output of inversion. Greeks looser because they depend on IV.

### Test Stack
- **Vitest**: fast units (no Jest setup overhead)
- **fast-check**: property-based for numerical fns
- **msw**: API mocking
- **testcontainers**: real Postgres in Docker for integration
- **Playwright**: E2E browser

---

## 15. Reusable Patterns Summary

1. **Greeks Math**: BSM + IV inversion, TOS-calibrated <0.5% drift
2. **HTTP Retry**: Exp backoff + Retry-After parse — works Schwab + Massive
3. **Token Mgmt**: OAuth refresh, disk persistence, single-shot auth retry
4. **Result Type**: Discriminated union, no exceptions for control flow
5. **OCC Parsing**: Regex parse, Schwab root padding
6. **Hypertable Compression**: 7-day chunk + compression policy
7. **Deterministic Job IDs**: SHA1(queue:key) BullMQ dedup
8. **Cron in TZ**: BullMQ `tz: "America/New_York"` for DST
9. **Strict TypeScript**: No any/as/!/?. — ESLint + tests enforce
10. **Idempotent Migrations**: File-based tracking, safe repeated runs

---

## 16. File Map (Pre-Deletion Reference)

### Greeks
- `packages/greeks/src/bsm.ts`
- `packages/greeks/src/iv.ts`
- `packages/greeks/src/normal.ts`
- `packages/greeks/src/scenario.ts`
- `packages/greeks/src/attribution.ts`
- `packages/greeks/test/tos-fixtures.test.ts`

### Schwab
- `packages/schwab/src/auth.ts`
- `packages/schwab/src/http.ts`
- `packages/schwab/src/index.ts`

### Orders
- `packages/orders/src/map-order.ts`
- `packages/orders/src/contract-extract.ts`

### DB
- `packages/db/src/schema.ts`
- `packages/db/src/migrations/0004_timeseries.sql`
- `packages/db/src/migrations/0006_bsm_greeks.sql`

### Worker
- `apps/worker/src/queues.ts`
- `apps/worker/src/scheduler.ts`
- `apps/worker/src/jobs/sync-orders.ts`
- `apps/worker/src/jobs/poll-chain.ts`
- `apps/worker/src/jobs/compute-bsm-greeks.ts`
- `apps/worker/src/jobs/refresh-tokens.ts`

### Shared
- `packages/shared/src/assert.ts`
- `packages/shared/src/result.ts`
- `packages/shared/src/symbol.ts`
- `packages/shared/src/time.ts`

### Config
- `tsconfig.base.json`, `eslint.config.js`, `docker-compose.yml`
- `packages/db/src/migrate.ts`

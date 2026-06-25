# Architecture Research

**Domain:** Hexagonal TS monorepo + Python sidecar integration (v1.1 milestone)
**Researched:** 2026-06-25
**Confidence:** MEDIUM (cross-verified against existing codebase + schwab-py docs + SSE ecosystem)

---

## 1. Sidecar as a Driven Adapter — Hexagon Stays Intact

### Core principle

The Python sidecar is an external HTTP process, not a language change inside the hexagon. From the TS perspective it is just another remote API. The existing `ForFetchingChain`, `ForFetchingPositions`, `ForFetchingTransactions`, `ForFetchingOrders`, `ForResolvingAccountHash` ports in `packages/core/src/brokerage/application/ports.ts` are unchanged. The change is entirely in `packages/adapters/schwab/`: new adapter implementations that call the sidecar's REST proxy instead of Schwab directly.

### What the sidecar exposes

The sidecar runs as a single FastAPI or Flask app (3rd Railway service). It exposes:

```
GET  /health                     health + stream status
GET  /token/current              return decrypted current access-token string (trader + market)
POST /token/exchange             exchange OAuth code → token pair (initial setup only)
GET  /chain?symbol=…&…           proxy: call Schwab market chain API → return JSON
GET  /positions/{accountHash}    proxy: call Schwab trader positions API → return JSON
GET  /transactions/…             proxy: call Schwab trader transactions API → return JSON
GET  /orders/{accountHash}       proxy: call Schwab trader orders API → return JSON
GET  /account-hash               proxy: resolve /accounts/accountNumbers → return hash
GET  /stream                     SSE: live Schwab stream (LEVELONE_OPTIONS + ACCT_ACTIVITY)
```

Two strategy options exist for the REST surface. Pick one and lock it before implementation:

**Option A — Token-borrow only (minimal sidecar surface)**
The sidecar exposes `GET /token/current` returning the current access token. The existing TS Schwab adapters call this endpoint instead of reading `broker_tokens` from Postgres directly. No other proxy endpoints. TS adapters continue calling Schwab REST themselves with the borrowed token.

**Option B — Full proxy (sidecar as sole Schwab caller)**
All Schwab REST calls are proxied through the sidecar. The TS adapters call sidecar endpoints instead of `api.schwabapi.com`. The sidecar maps its own responses back to the same JSON shape Schwab returns (or a stable internal shape the TS adapter parses with its existing Zod schemas).

**Recommendation: Option B.** Reasoning:

- The rotating-refresh-token race applies to any code that reads the token at the moment of a refresh. With Option A, if the sidecar refreshes while a TS adapter is mid-call with the old token, the call fails and requires a retry path. With Option B the sidecar issues the call and token, so there is never a stale-token window.
- The TS Schwab adapters already have full Zod parsing at their boundary. Option B re-uses that exactly — the sidecar just returns the same JSON shape that Schwab does (it passes through the raw Schwab response body). The TS Zod schemas do not need to change.
- Testability: the sidecar becomes the sole seam. TS adapter tests mock the sidecar HTTP (msw), not Schwab directly.

### Adapter boundary diagram

```
packages/core/src/brokerage/application/ports.ts
    ForFetchingChain / ForFetchingPositions / ForFetchingTransactions …
              (unchanged — zero edits to core)
                     |
                     | implemented by
                     ▼
packages/adapters/src/schwab/
    chain-adapter.ts        ──HTTP GET──▶ sidecar /chain
    positions-adapter.ts    ──HTTP GET──▶ sidecar /positions/{hash}
    transactions-adapter.ts ──HTTP GET──▶ sidecar /transactions/…
    orders-adapter.ts       ──HTTP GET──▶ sidecar /orders/{hash}
    account-hash.ts         ──HTTP GET──▶ sidecar /account-hash
    (sidecar url injected via deps.sidecardBaseUrl — no hardcoded URL)
              |
              | calls
              ▼
apps/sidecar/  (Python, 3rd Railway service)
    FastAPI app
    schwab-py client  ──WebSocket──▶ Schwab Streaming API
    schwab-py client  ──HTTPS──▶ Schwab REST API
    token store ──────────────▶ Supabase broker_tokens (via asyncpg / psycopg3)
```

The sidecar's own Zod-equivalent (Pydantic) schemas parse Schwab responses before writing to Postgres or forwarding to TS. The TS adapters retain their existing Zod schemas as a second defence. Double-parsing at the boundary is acceptable overhead and preserves the existing contract test suite.

---

## 2. Single-Auth Gateway — Migration Plan

### Current state

- `packages/adapters/src/postgres/repos/broker-tokens.ts` implements `ForReadingTokens` / `ForWritingTokens` against the Supabase `broker_tokens` table.
- `packages/adapters/src/schwab/auth/oauth-client.ts` implements `refreshTokens` (refresh grant).
- `apps/worker/src/jobs/refresh-tokens.ts` (via `refreshToken` / `refreshTokens` use-cases) runs the daily 04:00 ET token refresh.
- The TS adapters call `getAccessToken()` which reads from `broker_tokens`.

### Target state after migration

- The Python sidecar owns `broker_tokens`. It reads/writes the table directly using `client_from_access_functions` with custom `token_read_func` / `token_write_func` backed by asyncpg.
- The sidecar's schwab-py handles all access-token refresh (30-min cadence, transparent to callers).
- The sidecar handles the weekly re-auth flow via a `POST /token/exchange` endpoint that accepts the OAuth code and triggers the initial `exchangeCode` → write to `broker_tokens`.
- The TS `refresh-tokens` job is retired. No TS code reads or writes `broker_tokens` for the purpose of refresh.
- The TS side reads tokens only via `GET /token/current` if using Option A, or not at all if using Option B (the sidecar proxies all calls).

### Migration sequence (race-free)

The key constraint is that during the cutover, exactly one refresher must be active. The sequence below guarantees this with a feature-flag in the composition root:

```
Step 1: Deploy sidecar with token read/write functions pointed at broker_tokens.
         Sidecar starts in PASSIVE mode: it reads the table but does NOT refresh.
         Verify sidecar /health shows PASSIVE + last_token_at timestamps.

Step 2: Disable the TS refresh-tokens job. Remove the pg-boss schedule registration
         in apps/worker/src/schedule.ts. Deploy the worker. Verify no refresh runs.
         (There is a gap here: maximum 30 minutes until the next access-token expiry.
          Acceptable because the sidecar is about to take over.)

Step 3: Switch sidecar from PASSIVE to ACTIVE (env var SIDECAR_REFRESH_MODE=active).
         The sidecar now auto-refreshes via schwab-py's built-in transparent refresh.
         Verify via /token/current that the token updates successfully.

Step 4: Switch TS adapters from direct Schwab calls to sidecar proxy calls.
         Update composition root in apps/server/src/main.ts and apps/worker/src/main.ts
         to wire the new sidecar-backed adapter implementations.
         Deploy server + worker. Verify existing tests pass.

Step 5: Remove TS oauth-client.ts + ForRefreshingToken port + refreshToken/refreshTokens
         use-cases from packages/core (these are now dead code). Keep broker_tokens
         Postgres repo only if TS needs to read status for /api/status display.
```

The gap between Step 2 and Step 3 is at most ~30 minutes of no automatic refresh. The access token from the last TS refresh is still valid during this window (it has a 30-min TTL). If deployment is done quickly, the gap is seconds. The window can be shortened further by doing Step 3 before Step 2 and tolerating a brief dual-refresh window — both read the same table, but schwab-py issuing a refresh invalidates the TS refresh token anyway, so the TS refresher would fail gracefully (it already handles `invalid_grant` → `AUTH_EXPIRED`). The recommended order (Step 2 first) is cleaner.

### Auth ownership table

| Concern | Owner after migration |
|---|---|
| Schwab OAuth code exchange | Python sidecar (`POST /token/exchange`) |
| Access token refresh (30 min) | Python sidecar (schwab-py transparent) |
| Token storage (`broker_tokens`) | Python sidecar (sole writer) |
| Token read for status display | TS server reads sidecar `/token/current` |
| 7-day re-auth alert | Python sidecar checks `refresh_issued_at` and exposes `/health` flag |
| 7-day re-auth action | Browser hits sidecar `/token/exchange` via server proxy, or CLI |

---

## 3. Stream Fan-Out Topology

### Decision: SSE at both hops

```
Schwab ──WebSocket──▶ sidecar StreamClient ──SSE──▶ apps/server ──SSE──▶ Browser
                           (1 connection)      (1 client)    (N clients)
```

**Sidecar → apps/server: SSE**
The sidecar exposes `GET /stream` as an SSE endpoint. The TS server connects to this as a single long-lived HTTP client (fetch with `response.body` streaming, or an `EventSource`-compatible reader). Rationale: SSE is simpler to serve from FastAPI (`StreamingResponse` with `text/event-stream`), works through Railway's HTTP proxy without websocket upgrade negotiation, auto-reconnects natively. The sidecar has one upstream (Schwab WebSocket) and one downstream consumer (the TS server), so SSE at this hop is zero overhead vs WebSocket.

**apps/server → Browser: SSE**
The TS Hono server fans out the single sidecar SSE stream to N browser SSE connections using `streamSSE()` from `hono/streaming`. Rationale: browsers connect with native `EventSource`, which auto-reconnects with `Last-Event-ID`. Hono's `streamSSE` is first-class with no extra dependency. SSE is unidirectional (server → browser), which is exactly what market data push requires — the browser never sends stream data to the server. Each browser SSE connection costs ~2-5 KiB vs ~50 KiB for WebSocket.

**JWT auth placement**
Supabase JWT verification stays at the TS server edge, not in the sidecar. The sidecar is internal-only (not internet-reachable — Railway private networking or same-service network). The browser sends `Authorization: Bearer <supabase_jwt>` in the EventSource request headers — EventSource does not support custom headers natively, so the JWT is passed as a URL query parameter (`?token=…`) and extracted server-side in the SSE route. The Supabase JWKS middleware verifies it before the route handler opens the SSE stream. The sidecar never sees the Supabase JWT and has no auth surface of its own.

### Fan-out multiplexer in apps/server

```typescript
// apps/server/src/adapters/http/stream-fanout.ts (sketch)

// One upstream SSE reader (singleton across all browser connections)
type StreamHub = {
  subscribe: (cb: (event: StreamEvent) => void) => () => void;
};

// On server start: connect to sidecar SSE, broadcast to all registered callbacks
// On browser connection: register callback → on disconnect: unregister
// streamSSE route reads from hub, not directly from sidecar
```

The hub pattern decouples the upstream sidecar connection from the downstream browser connections. The upstream reconnects independently (exponential backoff) without disconnecting browsers (browsers see a brief pause, then the stream resumes). The sidecar upstream is a single `fetch` call — not a web server concern — so it lives in the composition root or a dedicated `StreamManager` class in `apps/server`.

**Last-Event-ID**
Each event gets an incrementing `id` field. If the browser reconnects, it sends `Last-Event-ID`. The server checks if the buffered event is available (ring-buffer of last 100 events, ~30 seconds at 3/sec). If available, replay. If not, the browser receives a `snapshot` event synthesized from the last-known REST state (cold-start path, see Section 4).

---

## 4. Reconnect / Gap-Fill / Cold-Start

### Two independent reconnect loops

**Loop 1: sidecar → Schwab WebSocket**
The sidecar manages its own reconnect with exponential backoff. On reconnect it calls `StreamClient.login()` and re-subscribes. This is entirely internal to the sidecar.

**Loop 2: apps/server → sidecar SSE**
The TS server reconnects to the sidecar SSE with exponential backoff. During the gap, buffered events (ring-buffer) continue to be served to browsers. Once reconnected, the sidecar emits the current snapshot followed by a resumption of deltas.

### Cold-start path (server just started / stream never connected)

On server start, before the first browser SSE connection arrives:
1. The `StreamManager` immediately initiates the sidecar SSE connection.
2. It also calls `GET /positions/{hash}` and `GET /chain` on the sidecar REST surface to hydrate the last-known state cache.
3. When a browser connects, it immediately receives a synthetic `snapshot` SSE event from the REST-hydrated cache, then live stream deltas.

This means the browser always gets a useful starting state even if the stream just reconnected.

### What gets persisted vs passed through

| Data | Persistence | Rationale |
|---|---|---|
| Live mark/greeks from stream | Not persisted to Postgres | Display-only; too high frequency; journal has its own cadence |
| ACCT_ACTIVITY (fills) | Passed through to SSE only; `sync-transactions` job persists fills to Postgres from REST | Avoids dual-write; REST is the authoritative fill source |
| Stream snapshot (last-known) | In-memory cache in `StreamManager` | Survives browser reconnects, not server restarts |

The journal (30-min `calendar_snapshots`) remains unchanged — it is written by the existing `snapshot-calendars` → `compute-bsm-greeks` → `compute-analytics` job chain, sourcing its chain data from the sidecar's REST proxy (`GET /chain`). The stream does not feed the journal. These are parallel data paths that happen to source from the same sidecar.

**CBOE fallback during 7-day re-auth gap**
During the window when the Schwab refresh token has expired and the trader hasn't re-authed yet, the sidecar's REST proxy returns AUTH_EXPIRED for Schwab calls. The `selectChainSource` use-case in `packages/core` already falls back to CBOE (no-auth delayed chain). This remains unchanged — the existing CBOE adapter continues to work.

---

## 5. COT and FRED Adapters

Both belong in `packages/adapters/src/http/` as plain HTTP adapters, not in the sidecar.

**COT (CFTC):**
- No auth. Weekly CFTC disaggregated report published Fridays.
- New adapter: `packages/adapters/src/http/cot.ts` implementing a new `ForFetchingCotReport` driven port.
- New pg-boss scheduled job `fetch-cot` at `0 18 * * 5` (6pm ET Friday after release).
- New Postgres table `cot_observations` (week_of, asset_class, net_noncommercial, net_commercial, …).
- API surface: `GET /api/analytics/cot` + MCP `get_cot`.

**FRED expanded:**
- Existing `packages/adapters/src/http/fred.ts` and `fetch-rates` job extended.
- Currently pulls `DGS3MO` daily. Expand to: `DFF` (Fed Funds), `VIXCLS` (VIX close), `DGS2` (2Y), `DGS10` (10Y), `T10Y2Y` (yield curve spread).
- Same adapter, same job — add series IDs to the configured series list, no new port needed.
- Unblock the prod `FRED_API_KEY` env var (confirmed missing, referenced in PROJECT.md).

**Why not in the sidecar:** Both are auth-free HTTP calls with no streaming. Adding them to the sidecar couples unrelated concerns and makes the sidecar harder to reason about. The hexagon already has clean ports for HTTP data sources — use them.

---

## 6. Suggested Build Order (Dependency-Ordered Phases)

### Phase A: Python Sidecar + Auth Migration

**Goal:** Single Schwab auth owner. TS adapters call sidecar. TS refresher retired.

New components:
- `apps/sidecar/` — FastAPI app, schwab-py `client_from_access_functions`, `broker_tokens` read/write via asyncpg, REST proxy endpoints (`/chain`, `/positions`, `/transactions`, `/orders`, `/account-hash`, `/token/current`, `/health`).
- `packages/adapters/src/schwab/sidecar-client.ts` — thin TS HTTP client wrapping sidecar REST endpoints, replaces direct Schwab calls in all schwab adapters. Injected via `deps.sidecarBaseUrl`.
- Updated composition roots in `apps/server/src/main.ts` + `apps/worker/src/main.ts` to wire sidecar-backed adapters.
- `railway.json` / Dockerfile for 3rd Railway service.

Retire:
- `packages/adapters/src/schwab/auth/oauth-client.ts` (after migration)
- `refreshToken` / `refreshTokens` use-cases in `packages/core` (dead code after migration)
- `refresh-tokens` pg-boss job schedule

Existing Postgres tables: no schema changes needed (broker_tokens stays; sidecar is a new writer to the same table).

**Integration point with existing jobs:** `snapshot-calendars`, `sync-fills`, `sync-transactions` all call TS adapters that now call the sidecar — same port signatures, no job handler changes.

**Stack-decisions update required:** D16 (Schwab auth: own TS OAuth client) is superseded. New entry: Python sidecar as sole Schwab auth owner, schwab-py `client_from_access_functions`. D17 (streaming deferred) is lifted. A new decision entry for the Python sidecar as a 3rd Railway service is required before code.

---

### Phase B: Streaming + Fan-Out

**Goal:** One Schwab stream session → live SSE to browser.

New components:
- Sidecar `GET /stream` SSE endpoint (LEVELONE_OPTIONS + ACCT_ACTIVITY subscriptions).
- `apps/server/src/adapters/stream/stream-manager.ts` — upstream SSE reader, ring-buffer (last 100 events), subscriber registry, exponential reconnect.
- `apps/server/src/adapters/http/stream-route.ts` — Hono SSE route (`GET /api/stream`) with JWT auth middleware, fan-out via hub.
- New port `ForStreamingQuotes` in `packages/core/src/brokerage/application/ports.ts` (event emitter or async-iterable shape — adapter-side; core only defines the type for event payloads).
- `packages/contracts/src/stream.ts` — Zod schema for `StreamEvent` union type (snapshot, quote-update, fill-event) shared between server and future web.

No new Postgres tables (stream data is not persisted).

**Integration point with existing adapters:** `StreamManager` calls the sidecar REST `/chain` and `/positions` on cold-start to hydrate the snapshot cache. The same sidecar REST client used in Phase A.

---

### Phase C: COT Adapter + Positioning Analytic

**Goal:** CFTC COT weekly pull + new API/MCP surface.

New components:
- `packages/adapters/src/http/cot.ts` + `ForFetchingCotReport` port.
- `packages/core/src/analytics/application/getCot.ts` use-case.
- New Postgres table `cot_observations` + Drizzle schema + migration.
- `fetch-cot` pg-boss scheduled job (Fridays 18:00 ET).
- `GET /api/analytics/cot` + MCP `get_cot`.

No sidecar dependency. Clean isolated adapter.

---

### Phase D: FRED Expansion + Prod Key

**Goal:** Expanded macro series surfaced in API.

New components:
- Extended series list in `packages/adapters/src/http/fred.ts` config.
- New `rate_observations` rows for additional series.
- `FRED_API_KEY` env var set in Railway prod environment.
- `GET /api/rates` response expanded or new `GET /api/rates/macro` endpoint.

No sidecar dependency. Existing adapter extended.

---

### Phase E: 7-Day Re-Auth Smoothing

**Goal:** Alert before expiry + one-click browser re-auth flow.

New components:
- Sidecar `/health` response includes `refresh_token_expires_at` timestamp and `days_until_reauth`.
- `apps/server` exposes this via `GET /api/status` (already shows `TokenFreshnessMap` — extend it to include sidecar-reported refresh expiry).
- Browser-accessible re-auth flow: `GET /api/auth/schwab/url` → redirects to Schwab OAuth; `GET /api/auth/schwab/callback` → posts code to sidecar `POST /token/exchange`. Auth surface sits in the TS server (JWT-gated) and delegates to the sidecar — browser never contacts sidecar directly.

Depends on Phase A (sidecar must be running).

---

## Component Map: New vs Modified

```
New components                        Modified components
──────────────────────────────────    ──────────────────────────────────
apps/sidecar/                         apps/server/src/main.ts (wiring)
  app.py                              apps/worker/src/main.ts (wiring)
  auth.py                             packages/adapters/src/schwab/
  stream.py                             chain-adapter.ts (new impl)
  rest_proxy.py                         positions-adapter.ts (new impl)
  Dockerfile                            transactions-adapter.ts (new impl)
                                        orders-adapter.ts (new impl)
apps/server/src/adapters/             packages/adapters/src/http/
  stream/stream-manager.ts              fred.ts (expanded series)
  http/stream-route.ts              
                                    Retired components
packages/adapters/src/schwab/         ──────────────────────────────────
  sidecar-client.ts (NEW impl)        packages/adapters/src/schwab/auth/
                                        oauth-client.ts
packages/core/src/brokerage/          packages/core/src/brokerage/
  application/ports.ts (stream port)    application/refreshToken.ts
                                        application/refreshTokens.ts
packages/adapters/src/http/           apps/worker/src/jobs/
  cot.ts (new adapter)                  refresh-tokens.ts (retired)
```

---

## Key Architectural Invariants (Must Not Break)

1. `packages/core` is unchanged except for the new `ForStreamingQuotes` port type definition (no imports added, no business logic added to existing files).
2. The sidecar is never reachable from the internet. It is internal to Railway and accessed only by `apps/server` and `apps/worker` over private networking.
3. The browser never communicates with the sidecar. The TS server is the only consumer of sidecar endpoints.
4. Supabase JWT verification (JWKS ES256) is applied to `GET /api/stream` before the SSE stream opens — no unauthenticated stream access.
5. The `broker_tokens` table has exactly one writer after migration: the Python sidecar. The TS side keeps its read path for displaying token status in `/api/status` but does not write tokens.
6. The 30-min snapshot journal and live streaming are parallel data paths. The journal is not sourced from the stream; the stream is not sourced from the journal.

---

## Sources

- [schwab-py auth documentation](https://schwab-py.readthedocs.io/en/latest/auth.html) — `client_from_access_functions` signature and token lifecycle
- [schwab-py streaming documentation](https://schwab-py.readthedocs.io/en/latest/streaming.html) — `StreamClient`, `LEVELONE_OPTIONS`, `ACCT_ACTIVITY`, reconnect model
- [Hono SSE helper](https://hono.dev/docs/helpers/streaming) — `streamSSE()` API
- [Ably: WebSockets vs SSE](https://ably.com/blog/websockets-vs-sse) — SSE cost (~2-5 KiB) vs WebSocket (~50 KiB), CDN compatibility
- [WebSocket.org: SSE comparison](https://websocket.org/comparisons/sse/) — fan-out topology, EventSource auto-reconnect
- Existing codebase: `packages/core/src/brokerage/application/ports.ts`, `packages/adapters/src/schwab/`, `docs/architecture/stack-decisions.md` D16/D17

---
*Architecture research for: Morai v1.1 — Python sidecar integration into hexagonal TS monorepo*
*Researched: 2026-06-25*

# Phase 12: Streaming + TS Fan-Out — Research

**Researched:** 2026-06-28
**Domain:** Schwab schwab-py WebSocket streaming, FastAPI SSE, Hono SSE fan-out, opaque ticket auth
**Confidence:** HIGH (schwab-py API from installed source), MEDIUM (Hono SSE from installed types), LOW (ACCT_ACTIVITY message types — genuinely undocumented)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (Stream Auth):** `GET /api/stream` authenticates via a short-lived, single-use opaque ticket. Client POSTs (with Supabase JWT) to mint a ~30s ticket; EventSource connects with `?ticket=…`. Rationale: EventSource cannot send `Authorization` headers; query-param JWT leaks into logs.

**D-02 (Live Greeks Source):** Live greeks/IV are recomputed via `@morai/quant` BSM engine from the streamed mark + spot + rate, NOT taken from Schwab's raw `LEVELONE` greeks. Live = the journal's math at streaming cadence. STRM-04 unaffected (compute, not persistence).

**D-03 (Dynamic Subscription):** Subscription set is dynamic — on an `ACCT_ACTIVITY` fill that opens a new leg, subscribe it; when a leg closes, unsubscribe it. A newly opened position streams live immediately without a restart. Plus ad-hoc symbols per D-05.

**D-04 (Reconnect UX):** On stream drop/reconnect, the browser freezes the last values and shows a 'stale' badge, then swaps to fresh data when the reconcile REST pull lands.

**D-05 (Live Scope — expands STRM-01):** Live streaming covers open position legs AND ad-hoc instrument lookup (any OCC symbol the user enters/selects). STRM-01 must be amended. Watch the 500-symbol streamer cap.

**D-06 (UI Surfaces):** Live data renders on Positions/calendars view only. Not wired into journal row or GEX this phase.

**D-07 (Update Cadence):** Updates coalesced to ~1/sec per symbol (not raw passthrough).

**D-08 (Stream Lifecycle):** Schwab stream kept warm during RTH regardless of connected viewers. Single-streamer advisory lock (GW-04) still guards.

### Claude's Discretion

SSE framing/format, ticket store (in-memory vs Postgres), fan-out implementation (in-process pub/sub), reconnect/backoff timing, and the exact BSM input plumbing are implementation details for research + planning.

### Deferred Ideas (OUT OF SCOPE)

None deferred to other phases — the ad-hoc lookup scope question was pulled INTO Phase 12.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STRM-01 | Sidecar streams live LEVELONE_OPTION data (mark, bid/ask, delta/gamma/theta/vega/rho, IV) for open position legs. **Expanded by D-05** to also include ad-hoc instrument lookup. | schwab-py `level_one_option_subs` / `add` / `unsubs` confirmed in installed source |
| STRM-02 | Sidecar streams ACCT_ACTIVITY fill events. | `account_activity_sub()` confirmed; MESSAGE_TYPE values undocumented — discover empirically |
| STRM-03 | `apps/server` fans sidecar's single stream to N browser clients over authed `GET /api/stream` with Supabase JWT verified at edge. | Opaque-ticket pattern (D-01); Hono `streamSSE` confirmed installed |
| STRM-04 | Stream data is display-only — no per-tick persistence. | No Postgres calls in hot path; regression gate: `SELECT count(*) FROM leg_observations` must not grow |
| STRM-05 | On (re)connect and cold-start, sidecar reconciles current state via REST pull so the live view has no gaps. | New `/sidecar/positions` endpoint follows `chain_proxy.py` pattern; trader keep-alive (Phase 11) keeps token fresh |
</phase_requirements>

---

## Summary

Phase 12 wires the schwab-py sidecar's `StreamClient` into a live pipeline. The sidecar opens a single Schwab WebSocket session (after holding the GW-04 advisory lock), subscribes to `LEVELONE_OPTIONS` for open-position OCC symbols plus ad-hoc lookups, and subscribes to `ACCT_ACTIVITY` for fill events. Raw tick data flows via an internal SSE endpoint on the sidecar into the TS server, which coalesces ticks to ~1/sec, runs BSM IV inversion on the `MARK` + `UNDERLYING_PRICE` fields, and fans the computed `liveGreeks` to all connected browser EventSource clients. Auth is a short-lived single-use opaque ticket minted at a JWT-authed POST.

The most important technical finding: `UNDERLYING_PRICE` (field 35) is present in the `LEVELONE_OPTIONS` stream, so the underlying spot is available per tick without a separate index subscription. The BSM recompute on the TS server side uses this plus the strike decoded from the OCC symbol, the latest `rate_observations` rate (cached at stream open), and the mark as the target price for IV inversion. No new npm or Python packages are needed — all required libraries are already installed.

The second important finding: `ACCT_ACTIVITY` `MESSAGE_TYPE` values are genuinely undocumented. The correct Phase 12 strategy is to log-and-forward all account activity events, discover types empirically once the sidecar is live, and drive dynamic subscription via position-reconcile diff rather than message-type parsing.

**Primary recommendation:** Build the streaming pipeline as four loosely coupled pieces: (1) sidecar background task that runs the `StreamClient`, (2) sidecar SSE endpoint serving the server, (3) server-side fan-out with opaque-ticket auth, (4) browser EventSource consumer in the Positions screen. Each boundary is a plain SSE stream and a Zod-parsed JSON payload, matching existing patterns.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schwab WebSocket session + LEVELONE_OPTION subscription | Sidecar (Python) | — | Single session enforced by GW-04 advisory lock; schwab-py owns the protocol |
| ACCT_ACTIVITY receipt + forwarding | Sidecar (Python) | — | Stream session is on sidecar; sidecar logs raw events, forwards opaque |
| BSM IV inversion + greek recompute per tick | API Server (TS) | — | `@morai/quant` is TS; keeps compute in typed layer; display-only means no Python persistence |
| 1/sec coalescing + fan-out to browsers | API Server (TS) | — | Single-server path; in-process Set<SSEStreamingApi> is sufficient per D22 |
| Opaque ticket mint (POST) | API Server (TS) | — | Requires JWT verify already in server; issues ticket scoped to single connection |
| Opaque ticket validate (GET /api/stream) | API Server (TS) | — | Same process as mint; in-memory Map |
| Dynamic subscription management | Sidecar (Python) | Server (TS) triggers reconcile | Server detects position diff, calls sidecar to add/remove symbols |
| Cold-start reconcile REST pull | Sidecar (Python) | — | `/sidecar/positions` reuses trader_client kept fresh by Phase 11 keep-alive |
| Live Greeks display (D-06) | Browser / Client | — | Positions/calendars view only; EventSource consumer in Positions.tsx |

---

## Standard Stack

### Core — All Already Installed

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `hono/streaming` | 4.12.23 (installed) | `streamSSE` SSE fan-out in server | Confirmed in `apps/server/node_modules/hono/dist/types/helper/streaming/sse.d.ts` |
| `jose` | installed | Supabase JWKS verify; no new use in Phase 12 (reuse `supabase-auth.ts`) | `apps/server/src/adapters/http/supabase-auth.ts` |
| `schwab.streaming.StreamClient` | 1.5.1 (installed) | Schwab WebSocket session in sidecar | `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py` |
| `fastapi.responses.StreamingResponse` | fastapi 0.115+ (installed) | Sidecar SSE endpoint (sidecar → server) | Built into FastAPI/Starlette; no new package |
| `@morai/quant` | workspace | BSM `bsmPrice` + `bsmVega` for IV inversion per tick | `packages/quant/src/bsm.ts` |

### Zero New Packages Required

No new npm or PyPI packages are needed for Phase 12. Every building block is present in the already-installed stack:
- Sidecar SSE: `fastapi.responses.StreamingResponse` (starlette built-in, already installed)
- Server SSE fan-out: `hono/streaming` `streamSSE` (already installed)
- Ticket UUID: `crypto.randomUUID()` (Bun/Node built-in, no import)
- BSM recompute: `@morai/quant` (workspace package, already built)
- Disconnect detection in sidecar: `starlette.requests.Request.is_disconnected()` (built-in)

**Packages explicitly NOT needed (and marked SLOP/rejected):**
- `sse-starlette` (PyPI) — `StreamingResponse` is sufficient for the single-reader internal endpoint; sse-starlette adds no value here and is `[SUS]` on PyPI with unknown download count
- Any Python asyncio SSE library — FastAPI asyncio generators cover the pattern natively

---

## Package Legitimacy Audit

> Required section. All packages above are either workspace packages (exempt) or already installed. No new external packages are introduced in Phase 12.

| Package | Registry | Status | Verdict | Disposition |
|---------|----------|--------|---------|-------------|
| `hono` (via `hono/streaming`) | npm | Already installed 4.12.23, published June 2026 (too-new signal is a false positive — hono is a major project updated regularly) | Confirmed legitimate [VERIFIED: installed source inspection] | Approved — already in use |
| `@morai/quant` | workspace | Workspace package, no external registry | N/A | Approved — internal |
| `fastapi.responses.StreamingResponse` | PyPI (via fastapi) | Already installed; fastapi is the standard Python async web framework | Confirmed legitimate | Approved — already in use |
| `sse-starlette` | PyPI | [SUS] — too-new date, unknown download signal | Rejected — not needed | NOT USED — `StreamingResponse` is sufficient |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `sse-starlette` — rejected (not needed anyway)

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (EventSource)
    ↕  GET /api/stream?ticket=xxx  (SSE, Supabase ticket auth)
    ↕  POST /api/stream/ticket     (REST, Supabase JWT auth)
    ↓
apps/server (Hono)
  ├── Ticket store: Map<uuid, {userId, exp}> (in-memory, 30s TTL)
  ├── Client set: Set<SSEStreamingApi>   (fan-out registry)
  ├── Coalescer: Map<symbol, latestTick> (~1/sec flush)
  ├── BSM engine: @morai/quant (bsmPrice + bsmVega → IV inversion per tick)
  ├── Rate cache: latest rate_observations row (refreshed at stream open)
  └── POST /api/stream/ticket → mint ticket (JWT auth gate)
      GET  /api/stream?ticket=xxx → validate ticket, open SSE, push to Set
      (internal) GET /internal/sidecar → forward to sidecar /sidecar/events
    ↕  GET /sidecar/events  (SSE, internal Railway private net)
    ↕  GET /sidecar/positions  (REST, reconcile on connect)
    ↓
apps/sidecar (FastAPI)
  ├── Advisory lock: pg_try_advisory_lock(8876543210)  (GW-04)
  ├── Stream background task:
  │     StreamClient(trader_client) → login() → subs → handle_message() loop
  ├── asyncio.Queue: stream handler → SSE endpoint buffer
  ├── GET /sidecar/events  → StreamingResponse (text/event-stream)
  ├── GET /sidecar/positions → trader_client positions (fresh via keep-alive)
  └── Subscription set: subscribed OCC symbols (≤490 cap, LRU eviction for ad-hoc)
    ↕  WebSocket (wss://streamer.schwab.com)
    ↓
Schwab Streamer
  LEVELONE_OPTIONS: mark, bid, ask, underlying_price, delta, gamma, theta, vega, rho, volatility
  ACCT_ACTIVITY: subscription_key, account, message_type, message_data (empirically discovered)
```

### Recommended Project Structure (New Files)

```
apps/sidecar/
├── streamer.py          # StreamClient background task + subscription management
├── positions_proxy.py   # GET /sidecar/positions (trader_client, pattern: chain_proxy.py)
├── stream_proxy.py      # GET /sidecar/events SSE endpoint
└── tests/
    ├── test_streamer.py
    ├── test_positions_proxy.py
    └── test_stream_proxy.py

apps/server/src/adapters/http/
├── stream.routes.ts     # POST /api/stream/ticket + GET /api/stream
├── stream-fan-out.ts    # Set<SSEStreamingApi> + broadcast() + coalesce()
├── ticket-store.ts      # Map<uuid, TicketRecord> + mintTicket() + redeemTicket()
└── sidecar-sse.ts       # fetch-based consumer of /sidecar/events → fan-out dispatch

packages/contracts/src/
└── stream-events.ts     # Zod schemas: StreamTicketResponse, StreamLiveGreekEvent,
                         # StreamReconcileEvent, StreamFillEvent (permissive)
```

---

### Pattern 1: StreamClient Initialization in Sidecar Background Task

The `StreamClient` must be initialized from the **trader client** (not the market client). The `login()` method calls `get_user_preferences()` → `/trader/v1/userPreference`, which returns `streamerInfo` with the WSS URL and session credentials. The `access_token` used in the ADMIN/LOGIN request comes from `trader_client.token_metadata.token['access_token']`.

**Critical:** `login()` must be called ONLY after the GW-04 advisory lock is held. The lock is held before client init in `_acquire_lock_and_init()` in `main.py`. The streaming task starts AFTER `_init_schwab_clients()` completes.

```python
# Source: apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py
# StreamClient constructor:
# StreamClient(client, *, account_id=None, enforce_enums=True, ssl_context=None)

async def start_streamer(app: FastAPI, event_queue: asyncio.Queue) -> None:
    """
    Background task: hold advisory lock → init StreamClient → login() → subscribe → handle.
    Must only run AFTER app.state.has_lock is True and trader_client is set.
    """
    from schwab.streaming import StreamClient

    trader_client = app.state.trader_client
    if trader_client is None:
        logger.warning("streamer: trader_client not available — not starting stream")
        return

    stream_client = StreamClient(trader_client)  # trader client, not market

    # login() fetches /trader/v1/userPreference and opens the WebSocket
    await stream_client.login()

    # Subscribe to LEVELONE_OPTIONS for current position symbols
    initial_symbols = await _get_position_occ_symbols(app)
    if initial_symbols:
        await stream_client.level_one_option_subs(initial_symbols)

    # Subscribe to ACCT_ACTIVITY (key is self._stream_correl_id, no symbol list)
    await stream_client.account_activity_sub()

    # Register handlers
    stream_client.add_level_one_option_handler(
        lambda msg: asyncio.ensure_future(_on_level_one_option(msg, event_queue))
    )
    stream_client.add_account_activity_handler(
        lambda msg: asyncio.ensure_future(_on_acct_activity(msg, event_queue))
    )

    # Message loop — handle_message() must be called to dispatch to handlers
    while True:
        await stream_client.handle_message()
```

**Why the lock must be held before `login()`:** The advisory lock (GW-04) guarantees exactly one Schwab streaming session. `login()` opens the WebSocket. If `login()` were called before the lock was acquired, two sidecar instances could race to open concurrent sessions, which Schwab forbids and which causes `invalid_grant` on the next token refresh.

[VERIFIED: apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py lines 103-137, 344-391]

---

### Pattern 2: LEVELONE_OPTIONS Fields and BSM Recompute

**Key finding:** `UNDERLYING_PRICE` (field 35) is present in the `LEVELONE_OPTIONS` stream. No separate `LEVELONE_EQUITIES` subscription for `$SPX` or `$SPY` is needed. The spot price arrives with each option tick.

```python
# Source: schwab/streaming.py, class LevelOneOptionFields
# Fields needed for BSM recompute (D-02):
#   SYMBOL          = 0   # OCC symbol (e.g. "SPX   260620C05000000")
#   BID_PRICE       = 2
#   ASK_PRICE       = 3
#   MARK            = 37  # PRIMARY: BSM IV target price
#   UNDERLYING_PRICE= 35  # SPOT — eliminates separate index subscription
#   DELTA           = 28  # Schwab raw (not used per D-02, but useful for validation)
#   GAMMA           = 29
#   THETA           = 30
#   VEGA            = 31
#   RHO             = 32
#   VOLATILITY      = 10  # Schwab raw IV (not used per D-02, but useful for logging)
#   DAYS_TO_EXPIRATION = 27  # DTE from streamer (cross-check; BSM computes from OCC expiry)

REQUIRED_OPTION_FIELDS = [
    StreamClient.LevelOneOptionFields.SYMBOL,
    StreamClient.LevelOneOptionFields.MARK,
    StreamClient.LevelOneOptionFields.BID_PRICE,
    StreamClient.LevelOneOptionFields.ASK_PRICE,
    StreamClient.LevelOneOptionFields.UNDERLYING_PRICE,
    StreamClient.LevelOneOptionFields.DELTA,
    StreamClient.LevelOneOptionFields.GAMMA,
    StreamClient.LevelOneOptionFields.THETA,
    StreamClient.LevelOneOptionFields.VEGA,
    StreamClient.LevelOneOptionFields.RHO,
]
```

**BSM recompute on the TS server side:** The sidecar forwards raw tick data (MARK, UNDERLYING_PRICE, BID_PRICE, ASK_PRICE). The TS server runs IV inversion:

```typescript
// Source: packages/quant/src/bsm.ts (bsmPrice + bsmVega for Newton-Raphson)
// The IV inversion lives in packages/core (BSM-01). Rate from latest rate_observations.

function recomputeGreeks(tick: RawOptionTick, rate: number, now: Date): LiveGreekTick | null {
  const mark = tick.mark ?? (tick.bid + tick.ask) / 2;  // fallback midpoint
  if (mark <= 0) return null;

  const spot = tick.underlyingPrice;
  if (spot == null || spot <= 0) return null;

  // Decode strike + expiry + type from OCC symbol (reuse parseSchwabSymbol/formatOccSymbol)
  const parsed = parseOccSymbol(tick.symbol);
  if (!parsed.ok) return null;

  const { strike, expiry, type } = parsed.value;
  const T = Math.max(0, (expiry.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000));

  // IV inversion (Newton-Raphson) — uses bsmPrice + bsmVega from @morai/quant
  const iv = invertIv(mark, spot, strike, T, rate, 0.013 /* q */, type);
  if (iv == null) return null;

  const greeks = bsmGreeks(spot, strike, T, iv, rate, 0.013, type);
  return { occSymbol: tick.symbol, mark, bid: tick.bid, ask: tick.ask, bsmIv: iv, ...greeks, ts: now.toISOString() };
}
```

**Risk-free rate plumbing:** Cache the latest rate at stream-open time, refresh from DB every 30 minutes. The existing `makePostgresRateObservationsRepo` provides the latest rate. Avoids per-tick DB round trips.

[VERIFIED: schwab/streaming.py lines 859-1086 — LevelOneOptionFields enum with all field numbers]

---

### Pattern 3: Opaque Ticket Auth (D-01)

**Mint phase:** Inside the Supabase JWT auth group (`makeSupabaseJwtAuth` already guards the route):

```typescript
// packages/contracts/src/stream-events.ts
export const streamTicketResponse = z.object({ ticket: z.string().uuid() });

// apps/server/src/adapters/http/ticket-store.ts
type TicketRecord = { userId: string; exp: number; used: boolean };
const ticketStore = new Map<string, TicketRecord>();

export function mintTicket(userId: string): string {
  const ticket = crypto.randomUUID();  // Bun built-in
  ticketStore.set(ticket, { userId, exp: Date.now() + 30_000, used: false });
  return ticket;
}

export function redeemTicket(ticket: string): string | null {
  const record = ticketStore.get(ticket);
  if (!record) return null;
  if (record.used || Date.now() > record.exp) {
    ticketStore.delete(ticket);
    return null;
  }
  record.used = true;
  ticketStore.delete(ticket);
  return record.userId;
}
```

**Redeem phase:** `GET /api/stream?ticket=xxx` — this route is OUTSIDE the JWT `authReadGroup`. It validates the ticket from the in-memory store:

```typescript
// apps/server/src/adapters/http/stream.routes.ts
app.get('/api/stream', async (c) => {
  const ticket = c.req.query('ticket') ?? '';
  const userId = redeemTicket(ticket);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  return streamSSE(c, async (stream) => {
    registerClient(stream);
    stream.onAbort(() => unregisterClient(stream));

    // STRM-05: send reconcile on connect
    const positions = await fetchSidecarPositions(config.SIDECAR_URL);
    await stream.writeSSE({ event: 'reconcile', data: JSON.stringify(positions) });

    while (!stream.aborted) {
      await stream.sleep(30_000);
      if (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' });
      }
    }
    unregisterClient(stream);
  });
});
```

**In-memory is correct** for the ticket store. Single Railway instance for `apps/server` (D11). 30-second TTL means negligible memory. No Postgres write on the hot path. Lazy cleanup on `redeemTicket` is sufficient.

[VERIFIED: apps/server/node_modules/hono/dist/types/helper/streaming/sse.d.ts]

---

### Pattern 4: SSE Fan-Out in the TS Server

```typescript
// apps/server/src/adapters/http/stream-fan-out.ts
import type { SSEStreamingApi } from 'hono/streaming';

const clients = new Set<SSEStreamingApi>();

export function registerClient(stream: SSEStreamingApi): void {
  clients.add(stream);
}

export function unregisterClient(stream: SSEStreamingApi): void {
  clients.delete(stream);
}

// Coalescer: latest tick per symbol, flushed ~1/sec (D-07)
const tickBuffer = new Map<string, LiveGreekTick>();

export function bufferTick(tick: LiveGreekTick): void {
  tickBuffer.set(tick.occSymbol, tick);
}

export function flushTicks(): void {
  if (tickBuffer.size === 0 || clients.size === 0) return;
  const ticks = [...tickBuffer.values()];
  tickBuffer.clear();
  const data = JSON.stringify(ticks);
  for (const stream of clients) {
    if (stream.aborted) {
      clients.delete(stream);
      continue;
    }
    stream.writeSSE({ event: 'ticks', data }).catch(() => clients.delete(stream));
  }
}

// Start flush interval (called from composition root, Phase 12 plan Wave 0)
export function startFlushInterval(): NodeJS.Timer {
  return setInterval(flushTicks, 1_000);
}
```

**Server → Sidecar internal SSE connection:**

```typescript
// apps/server/src/adapters/http/sidecar-sse.ts
export async function connectToSidecarStream(sidecarUrl: string): Promise<void> {
  const response = await fetch(`${sidecarUrl}/sidecar/events`, {
    headers: { Accept: 'text/event-stream' },
  });
  if (!response.ok || !response.body) throw new Error(`sidecar stream failed: ${response.status}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() ?? '';
    for (const block of lines) {
      const dataLine = block.split('\n').find(l => l.startsWith('data: '));
      if (!dataLine) continue;
      const raw = JSON.parse(dataLine.slice(6));
      // Parse with permissive Zod schema, dispatch to fan-out
      dispatchSidecarEvent(raw);
    }
  }
}
```

[VERIFIED: apps/server/node_modules/hono/dist/types/helper/streaming/sse.d.ts, StreamingApi.aborted:boolean]

---

### Pattern 5: Sidecar SSE Endpoint (sidecar → server, internal only)

```python
# apps/sidecar/stream_proxy.py
# Source: FastAPI StreamingResponse + starlette Request.is_disconnected()
import asyncio
import json
import logging
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# Module-level asyncio.Queue: stream handlers push events here;
# GET /sidecar/events drains it to the TS server
event_queue: asyncio.Queue = asyncio.Queue(maxsize=500)

@router.get("/sidecar/events")
async def stream_events(request: Request) -> StreamingResponse:
    """
    Internal SSE endpoint consumed by apps/server (GW-05 — Railway private net only).
    Streams live option ticks and account activity events.
    Must end with 'Z' on any timestamp field (chain_proxy.py lesson).
    """
    async def generator():
        while True:
            if await request.is_disconnected():
                logger.info("sidecar events: server disconnected")
                break
            try:
                event = await asyncio.wait_for(event_queue.get(), timeout=25.0)
                yield f"data: {json.dumps(event)}\n\n"
            except asyncio.TimeoutError:
                yield "event: ping\ndata: \n\n"  # keep-alive

    return StreamingResponse(generator(), media_type="text/event-stream")
```

**Payload shape contract:** All timestamps must end in `Z` (not `+00:00`) to satisfy Zod `.datetime()` on the TS side. This mirrors the `observedAt` lesson from `chain_proxy.py`.

[CITED: FastAPI/Starlette StreamingResponse docs; chain_proxy.py observedAt pattern]

---

### Pattern 6: Cold-Start Reconcile (`/sidecar/positions`)

New sidecar endpoint following `chain_proxy.py` pattern. The trader client is kept fresh by the Phase 11 keep-alive task.

```python
# apps/sidecar/positions_proxy.py
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

class PositionItem(BaseModel):
    occSymbol: str
    longQty: float
    shortQty: float
    marketValue: Optional[float] = None
    underlyingSymbol: str

class PositionsResponse(BaseModel):
    positions: list[PositionItem]
    asOf: str  # ISO-8601 Z timestamp (chain_proxy.py lesson)

@router.get("/sidecar/positions", response_model=PositionsResponse)
async def get_positions(request: Request) -> PositionsResponse | JSONResponse:
    client = getattr(request.app.state, "trader_client", None)
    if client is None:
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
    # Call trader client positions endpoint (mirrors positions-adapter.ts)
    # Zod-parse equivalent: Pydantic model at the return boundary
    ...
```

The TS server calls `GET /sidecar/positions` on first client connect and on every reconnect to produce the `reconcile` SSE event (STRM-05).

[VERIFIED: apps/sidecar/main.py — app.state.trader_client set by _init_schwab_clients; keep-alive task in Phase 11 main.py]

---

### Pattern 7: Dynamic Subscription via Position Reconcile Diff (D-03)

Since `ACCT_ACTIVITY` `MESSAGE_TYPE` values are undocumented (see Pitfall 1), dynamic subscription on fills uses the safer position-reconcile diff approach:

```python
# apps/sidecar/streamer.py
async def sync_subscriptions(
    stream_client: StreamClient,
    subscribed: set[str],
    new_positions: list[str],
    ad_hoc: set[str],
    cap: int = 490,
) -> set[str]:
    """
    Diff current subscriptions against new positions + ad-hoc set.
    Add new symbols, remove closed legs. Respect 490-symbol cap.
    Returns updated subscribed set.
    """
    desired = set(new_positions) | ad_hoc
    to_add = desired - subscribed
    to_remove = subscribed - desired

    # Evict excess ad-hoc symbols if cap would be exceeded (LRU via ordered dict)
    while len(subscribed) - len(to_remove) + len(to_add) > cap:
        if not ad_hoc:
            break
        evicted = ad_hoc_lru.pop_oldest()  # LRU eviction from ad-hoc set
        to_remove.add(evicted)
        to_add.discard(evicted)

    if to_remove:
        await stream_client.level_one_option_unsubs(list(to_remove))
    if to_add:
        await stream_client.level_one_option_add(list(to_add))

    return (subscribed - to_remove) | to_add
```

**Trigger:** On any `ACCT_ACTIVITY` event (regardless of type), trigger a `/sidecar/positions` pull and diff. This is conservative (fires on every account event, not just fills) but correct.

[ASSUMED: Position-reconcile diff as ACCT_ACTIVITY trigger avoids dependency on undocumented MESSAGE_TYPE values]

---

### Pattern 8: 500-Symbol Cap with LRU Eviction (D-05)

```python
from collections import OrderedDict

class SubscriptionManager:
    """
    Tracks subscribed symbols with LRU ordering for ad-hoc eviction.
    Position legs are always kept; ad-hoc symbols evicted LRU when cap is reached.
    Cap: 490 (10 below the Schwab 500 limit per D17).
    """
    CAP = 490

    def __init__(self):
        self._position_legs: set[str] = set()
        self._ad_hoc: OrderedDict[str, None] = OrderedDict()  # LRU order

    @property
    def all_subscribed(self) -> set[str]:
        return self._position_legs | set(self._ad_hoc)

    def request_ad_hoc(self, symbol: str) -> tuple[list[str], list[str]]:
        """Returns (to_add, to_evict). Caller applies to StreamClient."""
        if symbol in self.all_subscribed:
            self._ad_hoc.move_to_end(symbol)  # refresh LRU
            return [], []
        to_evict = []
        while len(self.all_subscribed) >= self.CAP:
            if not self._ad_hoc:
                break  # can't evict position legs
            oldest = next(iter(self._ad_hoc))
            del self._ad_hoc[oldest]
            to_evict.append(oldest)
        self._ad_hoc[symbol] = None
        return [symbol], to_evict
```

[CITED: docs/architecture/stack-decisions.md D17 — "streaming caps at ~500 symbols"]

---

### Anti-Patterns to Avoid

- **Filtering ACCT_ACTIVITY by assumed MESSAGE_TYPE strings:** No official enumeration exists. Log all events; discover types empirically.
- **Subscribing the market client's StreamClient:** The `login()` method calls the trader endpoint `/trader/v1/userPreference`. Market client lacks access to this endpoint. Use trader client only.
- **Using DATABASE_POOL_URL (port 6543) for the lock connection:** PgBouncer transaction mode resets session-level advisory locks. Already prevented in `advisory_lock.py` but must not be introduced in new streaming-related DB connections.
- **Writing `leg_observations` rows in any streaming handler:** STRM-04 constraint. The regression gate must pass.
- **Passing timezone offset `+00:00` in any sidecar→TS payload:** Zod `.datetime()` rejects it. Always `.replace("+00:00", "Z")`.
- **Calling `level_one_option_subs` after already subscribed:** This re-initializes the subscription and loses existing symbols. Use `level_one_option_add` for incremental additions after initial `subs`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket session management + reconnect | Custom WebSocket client | `schwab.streaming.StreamClient` | Handles Schwab's protocol quirks, login/subscribe ordering, overflow queue for deferred messages |
| SSE event framing | Custom `text/event-stream` encoder | `FastAPI.StreamingResponse` (sidecar) + `hono/streaming streamSSE` (server) | Both handle correct SSE wire format, keep-alive, and disconnect detection |
| IV inversion | Newton-Raphson from scratch | `@morai/quant` `bsmPrice` + `bsmVega` | Existing tested implementation with round-trip property tests (BSM-01) |
| Ticket UUID generation | `Math.random()` or home-built entropy | `crypto.randomUUID()` (Bun built-in) | Cryptographically secure; single function call |
| Postgres advisory lock release | Explicit `pg_advisory_unlock` call | Let connection close (Postgres releases session-level lock on close) | Already proven in `advisory_lock.py`; explicit unlock risks double-unlock bugs |
| SSE parse on server (reading from sidecar) | Custom SSE frame parser | Fetch + ReadableStream + line-split on `data: ` prefix | The simple two-line-split approach is correct for this non-browser SSE consumer |

**Key insight:** The streaming pipeline is almost entirely assembly of existing pieces. The only genuinely new logic is the coalescer buffer, the ticket store, and the subscription manager.

---

## Common Pitfalls

### Pitfall 1: ACCT_ACTIVITY MESSAGE_TYPE Is Undocumented — Log Everything

**What goes wrong:** Attempting to filter or parse `MESSAGE_DATA` based on assumed `MESSAGE_TYPE` values (e.g. `"OrderFill"`) causes the dynamic subscription trigger to silently miss fills.

**Why it happens:** The schwab-py docs, Schwab streamer API guide, and all community sources confirm that no official list of `MESSAGE_TYPE` string values exists. Values from the TDA era (pre-Schwab migration) may not carry over.

**How to avoid:** Register the `ACCT_ACTIVITY` handler to log the full message at `INFO` level (not `DEBUG` — it must be visible in Railway logs during RTH testing). Forward the raw message to the server via the event queue. DO NOT filter events by `MESSAGE_TYPE` in Phase 12. Discover the actual type strings empirically from live fills during UAT.

**Warning signs:** If no account activity events appear in logs during a test order, the subscription command may have failed. Check that `account_activity_sub()` was called after `login()` and that `_stream_correl_id` is set (it's populated by `login()`).

[CITED: schwab-py.readthedocs.io/en/latest/streaming.html — AccountActivityFields docs]

---

### Pitfall 2: Service Name is `LEVELONE_OPTIONS` (Plural) Not `LEVELONE_OPTION`

**What goes wrong:** Passing `'LEVELONE_OPTION'` to a raw `_service_op` call results in a silent no-op or an `UnexpectedResponse` from the streamer.

**Why it happens:** The enum is `LevelOneOptionFields` (singular) but the service name string is `'LEVELONE_OPTIONS'` (plural). The method `level_one_option_subs` uses the correct string internally, so always call the method, not `_service_op` directly.

**How to avoid:** Use the schwab-py methods (`level_one_option_subs`, `level_one_option_add`, `level_one_option_unsubs`) exclusively. Never hardcode the service name string.

[VERIFIED: schwab/streaming.py lines 1047-1048 — `await self._service_op(symbols, 'LEVELONE_OPTIONS', 'SUBS', ...)`]

---

### Pitfall 3: `account_activity_sub()` Takes No Symbol Argument

**What goes wrong:** Attempting to call `account_activity_sub(symbols=[...])` raises `TypeError`.

**Why it happens:** The account activity subscription uses `self._stream_correl_id` as the key (set during `login()`). The subscription is account-scoped, not symbol-scoped.

**How to avoid:** Call `await stream_client.account_activity_sub()` with no arguments, after `login()` has set `_stream_correl_id`.

[VERIFIED: schwab/streaming.py lines 435-445 — `await self._service_op([self._stream_correl_id], 'ACCT_ACTIVITY', 'SUBS', ...)`]

---

### Pitfall 4: MARK Field Can Be Absent on First Tick (or During Halts)

**What goes wrong:** `tick.mark` is `None` when the option hasn't traded recently or the market is between sessions. BSM IV inversion receives `None` as the target price and produces `NaN` or crashes.

**Why it happens:** Schwab sends only changed fields on incremental ticks. The first snapshot for a symbol carries all fields, but subsequent ticks carry only changed fields. `MARK` may be absent if the mark hasn't changed.

**How to avoid:** Per-symbol state machine: cache the last valid mark. Use `(bid + ask) / 2` as a fallback midpoint. If both are absent, skip the IV computation for that tick (output no event). Guard `if (T <= 0) skip` — the BSM engine already handles `T=0` but IV inversion is undefined at expiry.

[VERIFIED: schwab/streaming.py `handle_message()` lines 303-340 — only changed fields delivered]

---

### Pitfall 5: `+00:00` Timestamp Rejection by Zod `.datetime()`

**What goes wrong:** Any ISO-8601 timestamp with `+00:00` suffix (Python's `datetime.isoformat()` default) fails `z.string().datetime()` on the TS side, causing Zod parse errors that silently drop events.

**Why it happens:** Python's `datetime.isoformat()` emits `+00:00` for UTC-aware datetimes. Zod's `.datetime()` requires a trailing `Z`.

**How to avoid:** Apply the same pattern as `chain_proxy.py` (`observedAt` lesson): always call `.replace("+00:00", "Z")` on every sidecar-emitted timestamp. Add a contract test.

[VERIFIED: apps/sidecar/chain_proxy.py lines 99-102 — `.replace("+00:00", "Z")` pattern]

---

### Pitfall 6: Fan-Out Memory Leak Without Disconnect Cleanup

**What goes wrong:** Dead `SSEStreamingApi` instances accumulate in the `clients` Set after browsers disconnect without a TCP RST (e.g., tab close in Safari). `writeSSE` continues to fail silently for dead clients.

**Why it happens:** Hono's `stream.aborted` is set asynchronously; the client is not removed from the Set automatically.

**How to avoid:** Two cleanup paths: (1) `stream.onAbort(() => clients.delete(stream))` for clean disconnects, (2) `.catch(() => clients.delete(stream))` on every `writeSSE` call to clean up dead clients that fail on write. Both paths are required.

[VERIFIED: apps/server/node_modules/hono/dist/types/utils/stream.d.ts — `aborted: boolean`, `onAbort(listener)`]

---

### Pitfall 7: SSE Ticket Route Must Be OUTSIDE the JWT `authReadGroup`

**What goes wrong:** If `GET /api/stream?ticket=xxx` is placed inside the `authReadGroup`, the Supabase JWT middleware rejects it with 401 (EventSource cannot send `Authorization` headers).

**Why it happens:** The entire point of the ticket pattern (D-01) is to exchange a short-lived ticket for an SSE stream without needing an `Authorization` header.

**How to avoid:** Mount `GET /api/stream` in a dedicated route group outside the `authReadGroup`. Only `POST /api/stream/ticket` goes inside the JWT auth group. The CORS middleware (already applied at `app.use("/*", cors(...))`) covers both routes.

[VERIFIED: apps/server/src/main.ts lines 183-222 — authReadGroup pattern]

---

### Pitfall 8: `handle_message()` Must Be Called in a Loop — Not Once

**What goes wrong:** Calling `await stream_client.handle_message()` once and awaiting completion causes the stream to stall. Each call processes exactly one message from the websocket.

**Why it happens:** `handle_message()` is a single-message pump, not a run-until-close method.

**How to avoid:** Always wrap in `while True: await stream_client.handle_message()`. The loop should have exception handling: `asyncio.CancelledError` propagates (for clean shutdown); other exceptions log the error and attempt reconnect.

[VERIFIED: schwab/streaming.py lines 303-340 — `async def handle_message(self)` — single message dispatch]

---

### Pitfall 9: StreamClient Must Be Created with Trader Client

**What goes wrong:** Creating `StreamClient(market_client)` causes `login()` to fail because `get_user_preferences()` returns a different response or 403 for the market app credentials.

**Why it happens:** The `login()` method calls `self._client.get_user_preferences()` (the `/trader/v1/userPreference` endpoint) which is a trader-scoped endpoint. The market client uses different OAuth credentials scoped to market data, not account/streamer info.

**How to avoid:** Always `StreamClient(app.state.trader_client)`. Sidecar's `app.state.trader_client` is the Schwab trader app client created by `client_from_access_functions` with `SCHWAB_TRADER_APP_KEY`.

[VERIFIED: schwab/streaming.py lines 367-369 — `r = self._client.get_user_preferences()` in `login()`]

---

### Pitfall 10: Starlette `Request.is_disconnected()` Must Be Awaited

**What goes wrong:** Checking `request.is_disconnected` without `await` always returns the coroutine object (truthy), which causes the SSE generator to exit immediately.

**How to avoid:** `if await request.is_disconnected(): break` — always await.

[CITED: Starlette docs — `is_disconnected()` is an async method]

---

## Runtime State Inventory

> N/A — this is a greenfield feature addition, not a rename/refactor/migration phase. No stored data, live service config, OS-registered state, secrets, or build artifacts from prior phases need changing.

**Cross-cutting note:** The GW-04 advisory lock (`pg_try_advisory_lock(8876543210)`) already guards streaming session uniqueness. The streamer background task joins the existing `_acquire_lock_and_init` lifecycle in `main.py` — it starts after lock acquisition, and the lock connection heartbeat continues unchanged.

---

## Code Examples

### Verified: Hono `streamSSE` with Abort Detection

```typescript
// Source: confirmed in apps/server/node_modules/hono/dist/types/helper/streaming/sse.d.ts
import { streamSSE } from 'hono/streaming';
import type { SSEMessage } from 'hono/streaming';

app.get('/api/stream', async (c) => {
  const ticket = c.req.query('ticket') ?? '';
  const userId = redeemTicket(ticket);
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  return streamSSE(c, async (stream) => {
    registerClient(stream);

    // onAbort fires when the client disconnects cleanly
    stream.onAbort(() => unregisterClient(stream));

    while (!stream.aborted) {
      await stream.sleep(30_000);
      if (!stream.aborted) {
        await stream.writeSSE({ event: 'ping', data: '' });
      }
    }
    unregisterClient(stream);
  }, async (err, stream) => {
    // onError: log but don't re-throw (prevents 500 leaking to client)
    console.error('SSE stream error:', err.message);
    unregisterClient(stream);
  });
});
```

### Verified: schwab-py LEVELONE_OPTIONS Subscription with Required Fields

```python
# Source: schwab/streaming.py lines 1033-1086 (installed at apps/sidecar/.venv/...)
from schwab.streaming import StreamClient

stream_client = StreamClient(trader_client)  # trader, not market
await stream_client.login()

await stream_client.level_one_option_subs(
    symbols=initial_symbols,  # e.g. ["SPX   260620C05000000"]
    fields=[
        StreamClient.LevelOneOptionFields.SYMBOL,
        StreamClient.LevelOneOptionFields.MARK,
        StreamClient.LevelOneOptionFields.BID_PRICE,
        StreamClient.LevelOneOptionFields.ASK_PRICE,
        StreamClient.LevelOneOptionFields.UNDERLYING_PRICE,  # spot — no separate index sub needed
        StreamClient.LevelOneOptionFields.DELTA,
        StreamClient.LevelOneOptionFields.GAMMA,
        StreamClient.LevelOneOptionFields.THETA,
        StreamClient.LevelOneOptionFields.VEGA,
        StreamClient.LevelOneOptionFields.RHO,
    ]
)

# Add more symbols later (does not reset existing subscription)
await stream_client.level_one_option_add(new_symbols)

# Remove symbols (closed legs or LRU eviction)
await stream_client.level_one_option_unsubs(closed_symbols)
```

### Verified: ACCT_ACTIVITY Subscription + Logging Handler

```python
# Source: schwab/streaming.py lines 435-463
await stream_client.account_activity_sub()  # no symbol argument — account-scoped

def on_account_activity(msg: dict) -> None:
    """
    Log ALL ACCT_ACTIVITY events. MESSAGE_TYPE values are undocumented.
    Discover empirically during RTH UAT. Forward raw to server via event_queue.
    """
    for item in msg.get("content", []):
        message_type = item.get("MESSAGE_TYPE", "<unknown>")
        message_data = item.get("MESSAGE_DATA", None)
        logger.info(
            "sidecar: ACCT_ACTIVITY message_type=%s data=%s",
            message_type,
            message_data[:200] if isinstance(message_data, str) else message_data,
        )
    asyncio.ensure_future(event_queue.put({"type": "acct_activity", "raw": msg}))

stream_client.add_account_activity_handler(on_account_activity)
```

### Verified: Timestamp Enforcement (Z suffix — chain_proxy.py lesson)

```python
# Source: apps/sidecar/chain_proxy.py lines 99-102
# Apply this pattern to EVERY timestamp emitted from the sidecar

import datetime

def utc_now_z() -> str:
    """Always ends in 'Z' — never '+00:00' — for Zod .datetime() compatibility."""
    return (
        datetime.datetime.now(tz=datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
```

---

## State of the Art

| Old Approach | Current Approach | Changed | Impact |
|--------------|------------------|---------|--------|
| STRM-01 was "deferred" (D17 original) | D17 lifted in v1.1; schwab-py sidecar owns the single session | Phase 10 | SSE fan-out now feasible |
| TS `refresh-tokens` job | Sidecar owns token lifecycle (GW-03) | Phase 11 | Trader token freshness via keep-alive, not TS scheduler |
| Server-direct Schwab positions | `/sidecar/positions` proxy (new in Phase 12) | Phase 12 | Reconcile on stream connect without TS direct auth |
| Static positions polling (TanStack) | EventSource + positions polling coexist | Phase 12 | Live overlay on Positions screen without removing REST baseline |

---

## Open Questions

1. **ACCT_ACTIVITY MESSAGE_TYPE Values for Fills**
   - What we know: Confirmed undocumented in schwab-py docs, Schwab streamer guide, and all community sources
   - What's unclear: The exact string values that fire for option fill/execution events on Schwab's API (vs TDA legacy)
   - Recommendation: In Phase 12, log all account activity events during RTH testing. Add a `discover-acct-activity` runbook step to UAT. Do NOT attempt to parse MESSAGE_TYPE in Phase 12 implementation.

2. **BSM IV Inversion Location**
   - What we know: `bsmPrice` and `bsmVega` are in `packages/quant`. The Newton-Raphson IV inversion implementation from Phase 2 (BSM-01) is in `packages/core/src/journal/domain/bsm.ts` (pre-extraction) or may have been extracted to quant.
   - What's unclear: Whether the IV inversion function is accessible from `@morai/quant` or only from `@morai/core`.
   - Recommendation: Verify the import path for `invertIv` or equivalent before planning the server-side BSM compute plan. If it's only in `@morai/core`, the streaming adapter can import from `@morai/core` (adapters → core is a valid dependency arrow).

3. **Positions Screen EventSource Integration**
   - What we know: `apps/web/src/screens/Positions.tsx` (21KB) exists from Phase 9, currently polling via TanStack Query
   - What's unclear: Whether the current Positions component structure supports an overlay of SSE-provided live values without a full rewrite
   - Recommendation: Read `Positions.tsx` at plan time to understand the prop/hook surface before writing the EventSource integration task.

---

## Environment Availability

> Cross-checking existing deployed services for Phase 12 prerequisites.

| Dependency | Required By | Available | Notes |
|------------|-------------|-----------|-------|
| `schwab/streaming.py` | STRM-01/02 | Yes — installed at `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py` | schwab-py 1.5.1; `StreamClient`, `LevelOneOptionFields`, `AccountActivityFields` all confirmed |
| `hono/streaming` (`streamSSE`) | STRM-03 | Yes — confirmed at `apps/server/node_modules/hono/dist/types/helper/streaming/sse.d.ts` | Hono 4.12.23 |
| `fastapi.responses.StreamingResponse` | Sidecar SSE endpoint | Yes — fastapi>=0.115 installed in requirements.txt | Starlette `Request.is_disconnected()` available |
| Supabase JWT JWKS verify (`makeSupabaseJwtAuth`) | Ticket mint route guard | Yes — `apps/server/src/adapters/http/supabase-auth.ts` | Reuse unchanged |
| `@morai/quant` (`bsmPrice`, `bsmVega`) | D-02 BSM recompute | Yes — workspace package built in Phase 9 | IV inversion location TBD (Open Question 2) |
| Trader token freshness | `/sidecar/positions` reconcile | Yes — Phase 11 keep-alive task in `main.py` | `_trader_token_keepalive` runs as background task |
| GW-04 advisory lock | STRM-01 (lock before login) | Yes — `advisory_lock.py`, `SIDECAR_LOCK_KEY = 8876543210` | `_acquire_lock_and_init` lifecycle already in main.py |
| `SIDECAR_URL` env var | Server → sidecar HTTP | Yes — added in Phase 11 to `apps/worker/src/config.ts` and `apps/server/src/config.ts` | `SIDECAR_URL` already in server config schema |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

---

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — section required.

### Test Framework

| Property | Value |
|----------|-------|
| TS Framework | Vitest 4.x (workspace vitest project in `apps/server`) |
| Python Framework | pytest 8.x (in `apps/sidecar/tests/`) |
| TS config | Inherited from workspace vitest config |
| Python config | `apps/sidecar/pytest.ini` |
| TS quick run | `bun run test --project server` |
| Python quick run | `cd apps/sidecar && python -m pytest tests/ -x` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STRM-01 | LEVELONE_OPTIONS subscription + tick dispatch | unit (msw-equivalent: mock StreamClient) | `bun run test --project sidecar` (Python: `pytest tests/test_streamer.py -x`) | Wave 0 |
| STRM-01 (D-02) | BSM recompute from mark + underlying_price → liveGreeks | unit + fast-check round-trip | `bun run test --project server -- stream-bsm` | Wave 0 |
| STRM-02 | ACCT_ACTIVITY forwarded to event queue | unit | `pytest tests/test_streamer.py::test_acct_activity_forwarded -x` | Wave 0 |
| STRM-03 | Opaque ticket: mint → redeem → SSE open | unit | `bun run test -- ticket-store` | Wave 0 |
| STRM-03 | Unauthenticated `GET /api/stream` → 401 | integration | `bun run test -- stream-auth` | Wave 0 |
| STRM-03 | Expired ticket → 401 | unit | `bun run test -- ticket-store` | Wave 0 |
| STRM-03 | Single-use ticket: second redemption → 401 | unit | `bun run test -- ticket-store` | Wave 0 |
| STRM-04 | `leg_observations` count unchanged after streaming session | integration (testcontainers) | `bun run test -- strm04-regression` | Wave 0 |
| STRM-05 | First SSE event is `reconcile` with current positions | integration | `bun run test -- stream-reconcile` | Wave 0 |
| D-07 | 1/sec coalescer: multiple ticks for same symbol → one event | unit | `bun run test -- fan-out-coalescer` | Wave 0 |
| D-08 | Stream stays warm with zero connected clients | unit (async mock) | `pytest tests/test_streamer.py::test_stream_warm_no_clients -x` | Wave 0 |
| D-05 (cap) | 491 symbols → LRU eviction of oldest ad-hoc | unit | `pytest tests/test_streamer.py::test_symbol_cap_eviction -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `bun run typecheck && bun run test --project server -- stream` (TS) + `cd apps/sidecar && pytest tests/ -x` (Python)
- **Per wave merge:** Full suite `bun run test` (all workspace projects)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps (Tests to Create Before Implementation)

- [ ] `apps/sidecar/tests/test_streamer.py` — STRM-01/02, D-08, D-05 cap tests
- [ ] `apps/sidecar/tests/test_positions_proxy.py` — STRM-05 sidecar side
- [ ] `apps/sidecar/tests/test_stream_proxy.py` — sidecar SSE endpoint
- [ ] `apps/server/src/adapters/http/ticket-store.test.ts` — STRM-03 ticket lifecycle
- [ ] `apps/server/src/adapters/http/stream-fan-out.test.ts` — D-07 coalescer, fan-out
- [ ] `apps/server/src/adapters/http/stream.routes.test.ts` — STRM-03 auth integration
- [ ] `packages/contracts/src/stream-events.test.ts` — Zod parse of stream payloads
- [ ] STRM-04 regression test (testcontainers: leg_observations count invariant)

---

## Security Domain

> `security_enforcement` is `true` in `.planning/config.json` (default enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — ticket mint requires Supabase JWT | `makeSupabaseJwtAuth` (existing); ticket single-use + 30s TTL |
| V3 Session Management | Yes — SSE is a long-lived connection | Ticket is single-use; SSE stream closed on `stream.aborted`; no persistent session state |
| V4 Access Control | Yes — only authed users can open stream | `POST /api/stream/ticket` inside JWT `authReadGroup`; `GET /api/stream` validates ticket |
| V5 Input Validation | Yes — OCC symbol from ad-hoc lookup | Zod parse of OCC symbol; existing `parseOccSymbol` in `@morai/shared`; reject malformed symbols before streaming subscribe |
| V6 Cryptography | No — ticket is opaque UUID, not encrypted | `crypto.randomUUID()` provides cryptographically secure entropy; ticket carries no extractable claims |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Ticket replay (stolen ticket URL) | Spoofing | Single-use enforcement in `redeemTicket()`; 30s TTL |
| JWT leak via query-param | Information Disclosure | Ticket (not JWT) in query param; JWT stays in `Authorization` header at POST |
| SSE connection flooding (DoS) | Denial of Service | Rate-limit `POST /api/stream/ticket` per user; max concurrent streams per userId (simple counter in ticket store) |
| Symbol injection (ad-hoc lookup) | Tampering | Validate OCC symbol format via `parseOccSymbol` before calling `level_one_option_add`; reject unknown format |
| Account activity data exposure | Information Disclosure | ACCT_ACTIVITY events carry account numbers; strip `ACCOUNT` field before forwarding to browser SSE |
| Token values in sidecar logs | Information Disclosure | `token_store.py` V6 constraint: never log token values; only log `app_id` + `issued_at` |
| Streaming session hijack (dual writer) | Elevation of Privilege | GW-04 advisory lock enforced before `login()` — already implemented |

---

## Project Constraints (from CLAUDE.md)

1. **Dependencies point inward:** `core` imports `shared` only. Stream adapters belong in `apps/server/src/adapters/http/`. Stream contracts belong in `packages/contracts/src/`. BSM compute lives in `@morai/quant` (already a valid leaf).
2. **TDD red→green:** All stream adapter code requires a failing test first. No production streaming code before `test_streamer.py` / `ticket-store.test.ts` are red.
3. **No `any`, no `as`, no `!`:** Tick payloads from sidecar → Zod safeParse → typed. No casting of unknown SSE data.
4. **Docs before architecture changes:** If Phase 12 introduces new architectural patterns (e.g., the in-process pub/sub pattern for fan-out), document in `docs/architecture/` before implementing.
5. **Zod at every boundary:** SSE event payloads from sidecar → Zod-parsed in server SSE consumer. Ad-hoc OCC symbol from browser → Zod-parse before subscribe.
6. **Never log token values:** Applies in all new sidecar code (existing constraint from token_store.py V6 / T-11-04-01).
7. **ACCT_ACTIVITY data:** Strip `ACCOUNT` (account number) field before forwarding to browser. Account numbers are sensitive.
8. **OCC symbol log safety:** OCC symbols in logs are fine (not sensitive). Account numbers are not.
9. **`chain_proxy.py` Z-suffix lesson:** Every new sidecar→TS timestamp must end in `Z`. Add contract tests.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ACCT_ACTIVITY MESSAGE_TYPE values empirically seen in TDA era (SUBSCRIBED, OrderEntryRequest, OrderFill, UROut) may exist on Schwab API | Pitfall 1 / D-03 | D-03 dynamic subscription would need adjustment; LOW risk since design uses position-reconcile diff rather than message-type filtering |
| A2 | IV inversion function accessible from `@morai/core` import path for the server-side streaming adapter | Code Examples / D-02 BSM recompute | If IV inversion is only in an internal core module not re-exported, the server streaming adapter needs an explicit re-export added to `@morai/core` barrel |
| A3 | Position-reconcile diff (not message-type parsing) is sufficient for D-03 dynamic subscription | Pattern 7 | If fill events arrive so fast that position reconcile lags, new legs might have a brief un-subscribed window; mitigated by calling reconcile on ANY ACCT_ACTIVITY event |
| A4 | Starlette `Request.is_disconnected()` reliably fires when the TS server drops the sidecar SSE connection | Pattern 5 | If Railway's load balancer recycles idle connections silently, the sidecar SSE generator might not detect disconnect; mitigate with the 25s ping keepalive in the generator |
| A5 | The fan-out coalescer (D-07 ~1/sec) running in a `setInterval` on the TS server main event loop does not block inbound requests | Pattern 4 (fan-out) | If `writeSSE` calls block the event loop under many clients, consider moving to a worker thread; unlikely at current scale (single operator) |

---

## Sources

### Primary (HIGH confidence)
- `apps/sidecar/.venv/lib/python3.14/site-packages/schwab/streaming.py` — StreamClient API, LevelOneOptionFields enum (all 56 fields with numbers), AccountActivityFields enum, `login()` source, `handle_message()` source, `level_one_option_subs/add/unsubs`, `account_activity_sub` [VERIFIED: read from installed source]
- `apps/server/node_modules/hono/dist/types/helper/streaming/sse.d.ts` — `streamSSE` signature, `SSEStreamingApi`, `SSEMessage` interface [VERIFIED: read from installed types]
- `apps/server/node_modules/hono/dist/types/utils/stream.d.ts` — `StreamingApi.aborted`, `onAbort`, `close` [VERIFIED: read from installed types]
- `apps/sidecar/main.py`, `advisory_lock.py`, `token_store.py`, `chain_proxy.py` — existing patterns for background tasks, lock lifecycle, dual-write, Z-suffix, error logging [VERIFIED: read from codebase]
- `packages/quant/src/bsm.ts` — `bsmPrice`, `bsmGreeks`, `bsmVega` signatures and `BsmGreeks` type [VERIFIED: read from codebase]
- `apps/server/src/adapters/http/supabase-auth.ts` — `makeSupabaseJwtAuth` factory, JWT verify pattern [VERIFIED: read from codebase]

### Secondary (MEDIUM confidence)
- [Hono Streaming Helper docs](https://hono.dev/docs/helpers/streaming) — confirmed `streamSSE` API matches installed types [CITED: official Hono docs]
- [schwab-py streaming docs](https://schwab-py.readthedocs.io/en/latest/streaming.html) — AccountActivityFields documentation, confirmed working status of ACCT_ACTIVITY [CITED: official schwab-py docs]

### Tertiary (LOW confidence)
- Web searches for ACCT_ACTIVITY MESSAGE_TYPE values — confirmed undocumented; no official or authoritative enumeration found [LOW — all sources confirm absence of documentation]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages confirmed in installed source files
- schwab-py StreamClient API: HIGH — verified from installed `streaming.py`
- Hono `streamSSE` API: MEDIUM — verified from installed types + official docs
- ACCT_ACTIVITY MESSAGE_TYPE values: LOW — confirmed undocumented; discover-empirically is the correct strategy
- BSM IV inversion path: MEDIUM — existence confirmed, exact import path needs verification at plan time
- Architecture patterns: HIGH — direct extension of existing Phase 11 patterns

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (schwab-py 1.5.1 pinned; Hono 4.x stable)

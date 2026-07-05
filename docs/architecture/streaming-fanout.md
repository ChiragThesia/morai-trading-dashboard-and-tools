# Streaming Fan-Out Architecture

**Added**: Phase 12 — Streaming + TS Fan-Out
**Decisions**: D-01 (ticket auth), D-02 (BSM recompute), D-03 (dynamic subscription), D-04 (stale UX), D-07 (coalescer), D-08 (warm stream)
**Constraint**: STRM-04 — display-only; no per-tick Postgres writes

## The Pipeline

```
Browser (EventSource)
    ↕  GET /api/stream?ticket=xxx   (SSE, ticket auth)
    ↕  POST /api/stream/ticket      (REST, Supabase JWT auth)
    ↓
apps/server (Hono)
  Ticket store:  Map<uuid, {userId, exp}>   (in-memory, 30s TTL)
  Client set:    Set<SSEStreamingApi>        (fan-out registry)
  Coalescer:     Map<symbol, latestTick>     (~1/sec flush, D-07)
  BSM engine:    @morai/quant                (IV inversion per tick, D-02)
    ↕  GET /sidecar/events    (SSE, Railway private net)
    ↕  GET /sidecar/positions (REST, reconcile on connect)
    ↓
apps/sidecar (FastAPI)
  Advisory lock: pg_try_advisory_lock(8876543210)  (GW-04, single session)
  StreamClient:  schwab-py WebSocket               (one session, RTH warm)
  Event queue:   asyncio.Queue                     (handlers → SSE endpoint)
    ↕  WebSocket (wss://streamer.schwab.com)
    ↓
Schwab Streamer
  LEVELONE_OPTIONS: mark, bid/ask, underlying_price (field 35), delta/gamma/theta/vega
  ACCT_ACTIVITY:    subscription_key, message_type, message_data (types undocumented — D-03)
```

## Ticket Auth (D-01)

`GET /api/stream` uses an opaque single-use ticket, not a query-param JWT.

**Why**: `EventSource` cannot send `Authorization` headers. A JWT in the query string leaks into server logs and browser history. The ticket carries no claims — it is a 30-second random UUID that maps to a userId in an in-memory store.

**Flow**:
1. Client POSTs to `/api/stream/ticket` with `Authorization: Bearer <supabase-jwt>`.
2. Server verifies the JWT (existing `makeSupabaseJwtAuth`), mints a UUID ticket, returns it.
3. Client opens `EventSource("/api/stream?ticket=<uuid>")`.
4. Server validates the ticket (single-use, TTL check), removes it, opens the SSE stream.

`POST /api/stream/ticket` lives inside the Supabase JWT `authReadGroup`.
`GET /api/stream` lives outside — EventSource cannot send auth headers (Pitfall 7).

## BSM Recompute (D-02)

The sidecar forwards raw LEVELONE_OPTIONS fields: `MARK`, `BID_PRICE`, `ASK_PRICE`, `UNDERLYING_PRICE`.

The TS server recomputes greeks via IV inversion — it never uses Schwab's raw `DELTA/GAMMA/THETA/VEGA` fields.

**Why**: The entire app (journal, GEX, analytics) uses the `@morai/quant` BSM engine. Displaying Schwab's raw greeks on the live view would put different numbers on the same leg. Live = journal math at streaming cadence.

**Implementation**: `recomputeLiveGreek(tick, rate, q, now)` in `packages/core/src/streaming/`.
- price = mark ?? (bid+ask)/2; skip when price unavailable or ≤ 0.
- T = years from `now` to expiry decoded from OCC symbol; skip when T ≤ 0.
- `invertIv(price, S, K, T, r, q, type)` → ok(iv) or typed skip.
- `bsmGreeks(S, K, T, iv, r, q, type)` → delta/gamma/theta/vega.

## Display-Only Invariant (STRM-04)

Stream data is ephemeral. No streaming handler writes to `leg_observations` or any other table.

**Regression gate**: `SELECT count(*) FROM leg_observations` must not increase during a streaming session.

The authoritative fill source remains `sync-transactions` (REST). `ACCT_ACTIVITY` events trigger position reconcile diffs — not direct writes.

## Dynamic Subscription (D-03)

Subscription set changes on position changes, not on `ACCT_ACTIVITY` message-type parsing.

**Why**: `ACCT_ACTIVITY` `MESSAGE_TYPE` values are undocumented on the Schwab API. Filtering by assumed type strings would silently miss fills. On any `ACCT_ACTIVITY` event, the sidecar pulls `/sidecar/positions`, diffs against the current subscription set, and calls `level_one_option_add` / `level_one_option_unsubs`.

Ad-hoc symbol lookups (D-05) are added to the set with LRU eviction when the 490-symbol cap is reached.

## Coalescing and Warmth (D-07, D-08)

`D-07`: The server coalesces ticks to ~1/sec per symbol via a `Map<symbol, latestTick>` buffer flushed by `setInterval(flush, 1_000)`. Greeks refresh once per second regardless of how many raw ticks arrive.

`D-08`: The Schwab stream stays open during RTH even when zero browser clients are connected. The first client gets live data immediately — no cold-start latency.

## Ping Heartbeat Carries `isRth` (WATCH-01, D-03)

The `ping` heartbeat now carries `{ isRth: boolean }`, schema `streamPingEvent` in
`@morai/contracts`. The server computes `isRth` from `isWithinRth`/`isNyseHoliday` —
the same predicate the snapshot job's RTH gate uses — so the badge and the snapshot
job can never disagree on market state. The client consumes it to drive the 3-state
stream badge. This is additive: prior consumers ignored the empty ping and are
unaffected.

## Reconnect and Stale State (D-04, STRM-05)

On first connect and every reconnect:
1. Server calls `GET /sidecar/positions` to get the current position snapshot.
2. Server emits a `reconcile` SSE event with the snapshot.
3. Browser updates its position state.

While the SSE stream is broken, the browser freezes the last values and shows a `stale` badge. When the stream reconnects and the `reconcile` event lands, it swaps to fresh data. Users never see false confidence in stale numbers.

## Z-Suffix Timestamp Contract

All sidecar→TS timestamps must end in `Z`.

Python's `datetime.isoformat()` emits `+00:00` for UTC-aware datetimes. Zod's `.datetime()` rejects `+00:00`. The sidecar must call `.replace("+00:00", "Z")` on every emitted timestamp.

This is enforced by `streamLiveGreekEvent.parse` in the contract test (Pitfall 5 — chain_proxy.py lesson).

## Hexagon Placement

| Code | Layer | Package |
|---|---|---|
| `ForReconcilingPositions` port | Core — ports | `packages/core/src/streaming/` |
| `recomputeLiveGreek` | Core — domain | `packages/core/src/streaming/` |
| `makeMemoryPositionReconciler` | Adapters — memory | `packages/adapters/src/memory/` |
| Zod stream schemas | Contracts | `packages/contracts/src/stream-events.ts` |
| Ticket store, fan-out, SSE routes | Driving adapter | `apps/server/src/adapters/http/` |
| StreamClient, event queue, SSE endpoint | Python sidecar | `apps/sidecar/` |

Core imports only `@morai/shared` and `@morai/quant`. No SSE primitives, no `hono`, no `process.env` inside `packages/core/src/streaming/`.

## References

- [stack-decisions.md](stack-decisions.md) — D17 (streaming lifted), D22 (sidecar), D20 (JWT auth), D23 (SSE fan-out + opaque ticket)
- [deployment.md](deployment.md) — Railway private networking, sidecar service
- `packages/contracts/src/stream-events.ts` — Zod schemas for all SSE payloads
- `packages/core/src/streaming/ports.ts` — ForReconcilingPositions port + domain types
- `apps/sidecar/chain_proxy.py` — Z-suffix timestamp pattern (observedAt lesson)

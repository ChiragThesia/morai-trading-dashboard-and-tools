# Phase 12: Streaming + TS Fan-Out — Pattern Map

**Mapped:** 2026-06-28
**Files analyzed:** 12 new/modified files
**Analogs found:** 10 / 12 (2 flagged greenfield)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/sidecar/streamer.py` | service (background task) | event-driven | `apps/sidecar/main.py` `_acquire_lock_and_init` + `_trader_token_keepalive` | role-match |
| `apps/sidecar/stream_proxy.py` | route (SSE endpoint) | streaming | `apps/sidecar/chain_proxy.py` (route shape, error logging, Z-suffix) | role-match |
| `apps/sidecar/positions_proxy.py` | route (REST proxy) | request-response | `apps/sidecar/chain_proxy.py` (route + Pydantic response model + 503 pattern) | exact |
| `apps/server/src/adapters/http/ticket-store.ts` | utility | request-response | `apps/server/src/adapters/http/supabase-auth.ts` (in-memory token lifecycle) | partial |
| `apps/server/src/adapters/http/stream-fan-out.ts` | utility | pub-sub | — | GREENFIELD |
| `apps/server/src/adapters/http/stream.routes.ts` | route | streaming + request-response | `apps/server/src/adapters/http/analytics.routes.ts` (Hono router factory, Zod parse, Result map) + `supabase-auth.ts` (auth group placement) | role-match |
| `apps/server/src/adapters/http/sidecar-sse.ts` | adapter | streaming | — | GREENFIELD |
| `packages/contracts/src/stream-events.ts` | contract | transform | `packages/contracts/src/live-greeks.ts` | exact |
| `packages/core/src/streaming/ports.ts` | port definition | event-driven | `packages/core/src/brokerage/application/ports.ts` (`ForFetchingPositions` style) + `getLiveGreeks.ts` (`ForRunning*` pattern) | exact |
| `apps/web/src/hooks/useLiveStream.ts` | hook | streaming | `apps/web/src/hooks/usePositions.ts` | role-match |
| `apps/web/src/components/LiveStatusBadge.tsx` | component | — | `apps/web/src/screens/Positions.tsx` `CardHeading` + `Badge` usage | role-match |
| `apps/web/src/screens/Positions.tsx` (modified) | screen | streaming overlay | itself — extending existing Positions.tsx | self |

---

## Pattern Assignments

### `apps/sidecar/streamer.py` (service, event-driven)

**Analog:** `apps/sidecar/main.py` — `_acquire_lock_and_init`, `_trader_token_keepalive`, `asyncio.create_task`

**Background task launch pattern** (`apps/sidecar/main.py` lines 145–201):
```python
# Start as asyncio task from lifespan AFTER lock is acquired and clients are set.
# The task must cancel cleanly on CancelledError.
keepalive_task = asyncio.create_task(_trader_token_keepalive(app))

# Exception handling: non-CancelledError exceptions log and loop back (never kill the task).
try:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        await loop.run_in_executor(None, _ping)
except asyncio.CancelledError:
    raise  # propagate — this is a clean shutdown
except Exception as exc:  # noqa: BLE001
    logger.error("sidecar: lock heartbeat failed (%s) — lock lost; re-acquiring", type(exc).__name__)
```

**State access pattern** (`apps/sidecar/main.py` lines 95–143):
```python
# Always read from app.state — never import module-level globals.
client = getattr(app.state, "trader_client", None)
if client is None:
    return  # not seeded — degrade gracefully, never raise
```

**Critical constraint:** `StreamClient(app.state.trader_client).login()` MUST be called only inside the streamer background task, which only runs after `app.state.has_lock is True`. The streamer task is created at the same point as `keepalive_task` in `_acquire_lock_and_init`, after the lock acquisition and client init.

**Timestamp helper** (`apps/sidecar/chain_proxy.py` lines 98–102 — copy verbatim):
```python
def utc_now_z() -> str:
    return (
        datetime.datetime.now(tz=datetime.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
```

---

### `apps/sidecar/stream_proxy.py` (route, streaming)

**Analog:** `apps/sidecar/chain_proxy.py` — module structure, router, logger, error logging discipline

**Module header pattern** (`apps/sidecar/chain_proxy.py` lines 1–31):
```python
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse  # here: StreamingResponse instead

logger = logging.getLogger(__name__)
router = APIRouter()
```

**Route shape** (`apps/sidecar/chain_proxy.py` lines 158–163):
```python
@router.get("/sidecar/chain", response_model=ChainResponse)
async def get_chain(request: Request, ...) -> ChainResponse | JSONResponse:
    client = getattr(request.app.state, "market_client", None)
    if client is None:
        logger.error("chain proxy: market_client not available on app.state — ...")
        return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
```

For `stream_proxy.py`, the route returns `StreamingResponse` instead of `ChainResponse | JSONResponse`. Replace the client-null guard with a queue-availability check. The error logging rule is identical: log `type(exc).__name__` only, never `str(exc)`.

**Router include in `main.py`** — follows the pattern at lines 319–322:
```python
from stream_proxy import router as stream_router
from positions_proxy import router as positions_router
app.include_router(stream_router)
app.include_router(positions_router)
```

---

### `apps/sidecar/positions_proxy.py` (route, request-response)

**Analog:** `apps/sidecar/chain_proxy.py` — exact match for the REST proxy pattern

**Pydantic response model pattern** (`apps/sidecar/chain_proxy.py` lines 40–63):
```python
class ChainQuote(BaseModel):
    occSymbol: str
    contractType: str   # "C" or "P"
    expiry: str         # ISO-8601 datetime string — must end in "Z"
    bid: Optional[float] = None
    ...

class ChainResponse(BaseModel):
    root: str
    observedAt: str     # Always ".replace('+00:00', 'Z')" before assignment
    spot: float
    quotes: list[ChainQuote]
    source: str = "schwab_chain"
```

**Auth-expired guard pattern** (`apps/sidecar/chain_proxy.py` lines 185–196):
```python
client = getattr(request.app.state, "trader_client", None)
if client is None:
    logger.error("chain proxy: market_client not available on app.state — ...")
    return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
try:
    resp = await client.get_option_chain(root)
    raw = resp.json()
except Exception as exc:
    logger.error("chain proxy: get_option_chain failed — %s (message redacted)", type(exc).__name__)
    return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
```

For `positions_proxy.py`, substitute `trader_client` for `market_client` and call the trader positions endpoint. The `asOf` timestamp field must use `utc_now_z()` — never raw `.isoformat()`.

---

### `apps/server/src/adapters/http/ticket-store.ts` (utility, request-response)

**Analog:** `apps/server/src/adapters/http/supabase-auth.ts` — same ES module pattern, named exports, no class

**Module shape** (`apps/server/src/adapters/http/supabase-auth.ts` lines 1–58):
```typescript
// No class. Named factory function + exported types.
export type SupabaseJwtAuthDeps = { getKey: JWTVerifyGetKey };
export function makeSupabaseJwtAuth(deps: SupabaseJwtAuthDeps): MiddlewareHandler { ... }
```

`ticket-store.ts` follows the same shape: a module-level `Map`, two named exports (`mintTicket`, `redeemTicket`), no default export, no class. No Zod parse needed here (inputs are `string` + `number`, both already typed). The `Map` is module-level (singleton for the process lifetime — single Railway instance per D11).

---

### `apps/server/src/adapters/http/stream-fan-out.ts` (utility, pub-sub)

**GREENFIELD — no close analog exists.** The project has no existing in-process pub-sub or SSE fan-out. The RESEARCH.md Pattern 4 code is the definitive reference (it was written from verified Hono types). Key facts:
- `SSEStreamingApi` type from `hono/streaming` — confirmed installed
- `stream.aborted: boolean` + `stream.onAbort(cb)` — both exist on the type
- Two cleanup paths required: `onAbort` (clean disconnect) + `.catch(() => clients.delete(stream))` on every `writeSSE` call (dead client cleanup — Pitfall 6)
- `setInterval(flushTicks, 1_000)` started from the composition root, not from this module

**Closest structural analog for module shape:** `apps/server/src/adapters/http/supabase-auth.ts` — named exports, no default, module-level mutable state (here: `Map` + `Set`).

---

### `apps/server/src/adapters/http/stream.routes.ts` (route, streaming + request-response)

**Analog:** `apps/server/src/adapters/http/analytics.routes.ts` (Hono router factory, Zod parse at boundary) + `apps/server/src/main.ts` lines 219–222 (auth group placement)

**Router factory pattern** (`apps/server/src/adapters/http/analytics.routes.ts` lines 21–52):
```typescript
export function analyticsRoutes(
  getTermStructure: ForRunningGetTermStructure,
  getSkew: ForRunningGetSkew,
) {
  const router = new Hono();
  router.get("/analytics/term-structure", async (c) => {
    const result = await getTermStructure(query);
    if (!result.ok) return c.json({ error: "internal" }, 500);
    return c.json(termStructureResponse.parse(...));
  });
  return router;
}
```

**Auth group placement** (`apps/server/src/main.ts` lines 219–222):
```typescript
// POST /api/stream/ticket → INSIDE authReadGroup (needs Supabase JWT)
const authReadGroup = new Hono();
authReadGroup.use("/*", makeSupabaseJwtAuth({ getKey: createRemoteJWKSet(supabaseJwksUrl) }));
authReadGroup.route("/", apiRouter);  // ticket mint route added to apiRouter
app.route("/api", authReadGroup);

// GET /api/stream → OUTSIDE authReadGroup (ticket auth, not JWT)
// Mounted directly on app, like /api/status which is also outside the group.
app.route("/api", streamRoutes(...));
```

**Pitfall 7 (RESEARCH) — SSE route MUST be outside `authReadGroup`.** `POST /api/stream/ticket` goes inside (JWT guard). `GET /api/stream` goes outside — EventSource cannot send `Authorization` headers.

---

### `apps/server/src/adapters/http/sidecar-sse.ts` (adapter, streaming)

**GREENFIELD — no existing server-side SSE consumer in the codebase.** The project's existing sidecar adapter (`packages/adapters/src/sidecar/chain-adapter.ts`) makes standard fetch calls, not streaming reads. The RESEARCH.md Pattern 4 code block for `connectToSidecarStream` is the definitive reference.

**Closest structural analog:** `packages/adapters/src/sidecar/chain-adapter.ts` for the `fetch`-based sidecar HTTP call pattern, but the streaming `ReadableStream` reader loop is genuinely new.

---

### `packages/contracts/src/stream-events.ts` (contract, transform)

**Analog:** `packages/contracts/src/live-greeks.ts` — exact structural match

**Contract module pattern** (`packages/contracts/src/live-greeks.ts` lines 1–21):
```typescript
import { z } from "zod";

// MCP-02: ONE schema source — shared by HTTP adapter and any MCP tool.
// Shape mirrors the core type; adapters parse at the boundary.

const legGreeks = z.object({
  occSymbol: z.string(),
  bsmIv: z.string(),
  ...
});

export const liveGreeksResponse = z.object({
  calendarId: z.string().uuid(),
  legs: z.array(legGreeks),
});

export type LegGreeks = z.infer<typeof legGreeks>;
export type LiveGreeksResponse = z.infer<typeof liveGreeksResponse>;
```

`stream-events.ts` follows the identical pattern: named Zod schemas + `z.infer` types exported. Timestamp fields use `z.string().datetime()` — Zod rejects `+00:00`, only accepts `Z`. This is the contract test that enforces the sidecar Z-suffix rule (chain_proxy.py lesson, Pitfall 5).

Export at least: `streamTicketResponse`, `streamLiveGreekEvent`, `streamReconcileEvent`, `streamFillEvent`.

---

### `packages/core/src/streaming/ports.ts` (port definition, event-driven)

**Analog:** `packages/core/src/brokerage/application/ports.ts` lines 127–138 + `packages/core/src/journal/application/getLiveGreeks.ts` lines 35–37

**`ForVerbingNoun` function-type port pattern** (`packages/core/src/brokerage/application/ports.ts` lines 127–129):
```typescript
/**
 * ForFetchingPositions — fetch positions from the Schwab trader API (BRK-02).
 */
export type ForFetchingPositions = (
  accountHash: string,
) => Promise<Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>>;
```

**`ForRunning*` driver port with factory pattern** (`packages/core/src/journal/application/getLiveGreeks.ts` lines 35–37):
```typescript
export type ForRunningGetLiveGreeks = (
  calendarId: string,
) => Promise<Result<LiveGreeks, StorageError>>;
```

Phase 12 streaming ports follow the same shape: `ForStreamingOptionQuotes`, `ForSubscribingSymbol`, etc. — all function types, no classes, named `ForVerbingNoun`, returning `Promise<Result<T, E>>`. Defined in `packages/core/src/streaming/ports.ts` so adapters can import inward.

**Hexagonal constraint:** `packages/core` imports ONLY `@morai/shared`. No `hono`, no `fastapi` types, no SSE primitives in port definitions.

---

### `apps/web/src/hooks/useLiveStream.ts` (hook, streaming)

**Analog:** `apps/web/src/hooks/usePositions.ts` — module shape, error class, `apiFetch` usage

**Hook module pattern** (`apps/web/src/hooks/usePositions.ts` lines 1–49):
```typescript
import { useQuery } from "@tanstack/react-query";
import { positionsResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() { super("UNAUTHORIZED"); this.name = "UnauthorizedError"; }
}

export function usePositions() {
  return useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await apiFetch("/api/positions");
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) throw new Error(`GET /api/positions failed: ${res.status}`);
      return positionsResponse.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}
```

`useLiveStream.ts` does NOT use `useQuery` — it manages an `EventSource` directly (no TanStack for SSE). But it follows the same module conventions: named export, typed error class, Zod parse of incoming events (`streamLiveGreekEvent.parse(JSON.parse(event.data))`), `apiFetch` for the ticket-mint POST.

Return shape per UI-SPEC:
```typescript
// Returns:
{ greeks: Map<string, LiveGreekTick>, status: "live" | "stale" | "reconnecting" | "poll", lastTickAt: Date | null }
```

State machine: uses `useRef` for the `EventSource` instance (not `useState` — avoids re-render on ref change). `useState` for `greeks`, `status`, `lastTickAt`. `useEffect` mounts and tears down the `EventSource`.

---

### `apps/web/src/components/LiveStatusBadge.tsx` (component, presentational)

**Analog:** `apps/web/src/screens/Positions.tsx` `CardHeading` + inline `Badge`-style span pattern (lines 109–148)

**Presentational component pattern** (`apps/web/src/screens/Positions.tsx` lines 109–148):
```typescript
function CardHeading({ text, badge }: { text: string; badge?: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.9px",
                     textTransform: "uppercase", color: "#7b8696",
                     fontFamily: "Space Grotesk, sans-serif" }}>
        {text}
      </span>
      {badge !== undefined && (
        <span style={{ fontSize: 10, color: "#566273", fontFamily: "JetBrains Mono, monospace",
                       background: "#161d2b", borderRadius: 3, padding: "1px 5px" }}>
          {badge}
        </span>
      )}
    </div>
  );
}
```

`LiveStatusBadge.tsx` is a pure function component with typed props. No hooks. Props:
```typescript
type Props = { status: "live" | "stale" | "reconnecting" | "poll"; lastTickAt: Date | null };
export function LiveStatusBadge({ status, lastTickAt }: Props): React.ReactElement { ... }
```

Color tokens from UI-SPEC: `#26a69a` (live/`--color-up`), `#f0b429` (stale/`--color-amber`), `#7b8696` (reconnecting/`--color-muted`), `#566273` (poll/`--color-dim`). The pulsing dot is a `<span>` with className `live-dot` — the keyframe CSS is added to `apps/web/src/index.css` (UI-SPEC implementation note).

---

### `apps/web/src/screens/Positions.tsx` (modified)

**Analog:** itself — this is an extension of the existing 21KB file.

**Existing patterns to continue:**

`parseOccSymbol` import and usage (`Positions.tsx` lines 23, 67–73):
```typescript
import { parseOccSymbol } from "@morai/shared";

function legLabel(occSymbol: string): string {
  const r = parseOccSymbol(occSymbol);
  if (!r.ok) return occSymbol.trim();
  ...
}
```

The `AdHocPicker` section is a new inline component (or sub-function) placed below the `<Separator>` in the Open positions card. It uses `parseOccSymbol` for client-side OCC validation (UI-SPEC Surface 4) — no new import required.

`fmtGreek` formatter (`Positions.tsx` line 61–64):
```typescript
function fmtGreek(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(4)}`;
}
```

Live value cells reuse `fmtGreek` for BSM-recomputed greeks. For IV: `${(bsmIv * 100).toFixed(1)}%`. For mark: `$${mark.toFixed(2)}`.

---

## Shared Patterns

### Z-suffix timestamps (sidecar → TS boundary)
**Source:** `apps/sidecar/chain_proxy.py` lines 98–102
**Apply to:** every sidecar file that emits a timestamp field (`stream_proxy.py`, `positions_proxy.py`, `streamer.py`)
```python
observed_at = (
    datetime.datetime.now(tz=datetime.timezone.utc)
    .isoformat(timespec="milliseconds")
    .replace("+00:00", "Z")
)
```
Add a Zod contract test in `packages/contracts/src/stream-events.test.ts` that feeds a `+00:00` string and asserts it fails `.parse()`.

### Auth-expired guard + error logging discipline (sidecar)
**Source:** `apps/sidecar/chain_proxy.py` lines 185–212
**Apply to:** `stream_proxy.py`, `positions_proxy.py`
```python
client = getattr(request.app.state, "trader_client", None)
if client is None:
    logger.error("...: client not available on app.state — ...")
    return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
try:
    ...
except Exception as exc:
    logger.error("...: call failed — %s (message redacted)", type(exc).__name__)
    return JSONResponse(status_code=503, content={"error": "AUTH_EXPIRED"})
```
NEVER log `str(exc)` — only `type(exc).__name__`. This is a V6 constraint from `token_store.py`.

### Hono router factory (TS server routes)
**Source:** `apps/server/src/adapters/http/analytics.routes.ts` lines 21–30
**Apply to:** `stream.routes.ts`
```typescript
export function streamRoutes(deps: StreamRouteDeps) {
  const router = new Hono();
  // routes...
  return router;
}
```
Zero business logic in routes. Pattern: Zod-parse input → call port/utility → respond.

### Supabase JWT auth group mounting (TS server)
**Source:** `apps/server/src/main.ts` lines 219–222
**Apply to:** `stream.routes.ts` — `POST /api/stream/ticket` inside `authReadGroup`; `GET /api/stream` OUTSIDE
```typescript
const authReadGroup = new Hono();
authReadGroup.use("/*", makeSupabaseJwtAuth({ getKey: createRemoteJWKSet(supabaseJwksUrl) }));
// POST /api/stream/ticket mounts here (inside JWT group)
authReadGroup.route("/", apiRouter);

// GET /api/stream mounted directly on app (ticket auth, no JWT header)
app.route("/api", streamRoutes(...));
```

### `ForVerbingNoun` function-type port (core)
**Source:** `packages/core/src/brokerage/application/ports.ts` lines 127–129
**Apply to:** `packages/core/src/streaming/ports.ts`
```typescript
export type ForStreamingOptionQuotes = (
  symbols: ReadonlyArray<string>,
) => AsyncIterable<LiveGreekTick> | void;
```
All ports: function types, named `ForVerbingNoun`, return `Promise<Result<T, E>>` for fallible operations, no classes, no framework imports.

### React hook module conventions (web)
**Source:** `apps/web/src/hooks/usePositions.ts` lines 1–49
**Apply to:** `apps/web/src/hooks/useLiveStream.ts`
- Named export (no default)
- Typed error subclass for non-retryable failures
- Zod parse every incoming payload — never `as` cast
- `apiFetch` (not raw `fetch`) for authenticated REST calls

---

## No Analog Found (Greenfield)

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/server/src/adapters/http/stream-fan-out.ts` | utility | pub-sub | No in-process pub-sub or SSE fan-out exists anywhere in the codebase. The `Set<SSEStreamingApi>` + `Map<symbol, tick>` coalescer pattern is novel. RESEARCH.md Pattern 4 is the definitive reference. |
| `apps/server/src/adapters/http/sidecar-sse.ts` | adapter | streaming | All existing sidecar adapters use standard `fetch` → `res.json()` (request-response). Reading a streaming `ReadableStream` from the sidecar's SSE endpoint is novel. RESEARCH.md Pattern 4 `connectToSidecarStream` is the definitive reference. |

---

## Analog Search Scope

- `apps/sidecar/` — all `.py` files (4 read: `main.py`, `chain_proxy.py`, `advisory_lock.py` referenced, `token_store.py` referenced)
- `apps/server/src/adapters/http/` — all `.ts` files (read: `supabase-auth.ts`, `analytics.routes.ts`, `brokerage.routes.ts`, `main.ts` grep)
- `packages/contracts/src/` — all files (read: `live-greeks.ts`)
- `packages/quant/src/` — all files (read: `bsm.ts`)
- `packages/core/src/brokerage/application/ports.ts` + `packages/core/src/journal/application/getLiveGreeks.ts`
- `apps/web/src/hooks/` — all files (read: `usePositions.ts`)
- `apps/web/src/screens/Positions.tsx` — first 140 lines
- `apps/web/src/lib/` — inventory only

**Files scanned:** 18
**Pattern extraction date:** 2026-06-28

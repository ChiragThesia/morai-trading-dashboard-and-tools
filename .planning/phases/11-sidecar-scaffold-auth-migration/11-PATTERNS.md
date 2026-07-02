# Phase 11: Sidecar Scaffold + Auth Migration — Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 16 (new/modified)
**Analogs found:** 11 / 16 (Python sidecar files have no direct TS analog; structural analogs mapped)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/sidecar/main.py` | service-entry / lifespan | request-response + event-driven | `apps/worker/src/main.ts` (composition root shape) | structural |
| `apps/sidecar/config.py` | config | — | `apps/worker/src/config.ts` | structural |
| `apps/sidecar/token_store.py` | adapter (token read/write callbacks) | CRUD | `packages/adapters/src/postgres/repos/broker-tokens.ts` | structural |
| `apps/sidecar/chain_proxy.py` | route handler | request-response | `packages/adapters/src/http/cboe.ts` (fetch pattern) | structural |
| `apps/sidecar/health.py` | route handler | request-response | `apps/server/src/routes/status.ts` | structural |
| `apps/sidecar/advisory_lock.py` | utility | — | No analog — first advisory-lock usage | none |
| `apps/sidecar/Dockerfile` | config | — | Per-service Dockerfiles (Phase 1 lesson) | structural |
| `apps/sidecar/requirements.txt` | config | — | No analog | none |
| `apps/sidecar/tests/test_token_store.py` | test | CRUD | `packages/adapters/src/postgres/repos/broker-tokens.contract.test.ts` | structural |
| `apps/sidecar/tests/test_advisory_lock.py` | test | — | No analog | none |
| `apps/sidecar/tests/test_chain_proxy.py` | test | request-response | `packages/adapters/src/memory/chain.contract.test.ts` | structural |
| `packages/adapters/src/sidecar/chain-adapter.ts` | adapter | request-response | `packages/adapters/src/http/cboe.ts` | exact |
| `packages/adapters/src/memory/sidecar-chain.ts` | adapter (in-memory twin) | request-response | `packages/adapters/src/memory/chain.ts` | exact |
| `apps/worker/src/schedule.ts` | scheduler | event-driven | self (retire `refresh-tokens` queue/cron/handler) | self-modify |
| `apps/worker/src/schedule.test.ts` | test | — | self (remove `refresh-tokens` expectations) | self-modify |
| `apps/worker/src/main.ts` | composition root | — | self (swap `schwabMarketAdapter` → `sidecarAdapter`) | self-modify |
| `apps/worker/src/config.ts` | config | — | self (add `SIDECAR_URL`) | self-modify |

---

## Pattern Assignments

### `apps/sidecar/main.py` (service-entry, lifespan)

**No direct Python analog** — structural mirror of `apps/worker/src/main.ts` composition-root shape.

**Analog structural pattern** — composition root order from `apps/worker/src/main.ts` (lines 63–161):
```typescript
// 1. Parse config
const config = bootWorkerConfig();
// 2. Run migrations / infra setup
await runMigrations(config.DATABASE_URL);
// 3. Build infrastructure (DB, boss)
const boss = new PgBoss(bossConnectionString);
await boss.start();
// 4. Build adapters / repos
const cboeAdapter = makeCboeChainAdapter({ fetch: globalThis.fetch, userAgent: USER_AGENT });
// 5. Wire use-cases
const fetchChainUseCase = makeFetchChainUseCase({ ... });
// 6. Register handlers
registerAllJobs(boss, handlers);
```

**Python equivalent shape for `main.py`:**
```python
# FastAPI lifespan mirrors the composition-root pattern:
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Config already parsed at module load (config.py)
    # 2. Acquire advisory lock (infra guard — must succeed before anything else)
    lock_conn = acquire_sidecar_lock(config.DATABASE_URL)
    # 3. Init schwab-py clients (two — one per app, D-05)
    trader_client, market_client = await init_schwab_clients(config)
    app.state.market_client = market_client
    app.state.trader_client = trader_client
    yield
    # Shutdown: release lock (releases on conn close, Postgres handles crash)
    lock_conn.close()

app = FastAPI(lifespan=lifespan)
```

**Railway binding** — must bind `::` (all interfaces, IPv4+IPv6) for private network:
```dockerfile
CMD ["uvicorn", "main:app", "--host", "::", "--port", "8000"]
```

---

### `apps/sidecar/config.py` (config)

**Analog:** `apps/worker/src/config.ts` (lines 1–73)

**Pattern:** Env-var schema parsed once at module load; typed config flows into all handlers. In TS this is a Zod schema; in Python use `pydantic-settings` `BaseSettings`.

**TS config schema pattern** (`apps/worker/src/config.ts` lines 6–33):
```typescript
const workerConfigSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  DATABASE_POOL_URL: z.string().url().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 chars"),
  SCHWAB_TRADER_APP_KEY: z.string().min(1),
  SCHWAB_TRADER_APP_SECRET: z.string().min(1),
  SCHWAB_MARKET_APP_KEY: z.string().min(1),
  SCHWAB_MARKET_APP_SECRET: z.string().min(1),
});
```

**Python equivalent for `config.py`** — mirrors field set, uses `pydantic-settings`:
```python
from pydantic_settings import BaseSettings

class SidecarConfig(BaseSettings):
    DATABASE_URL: str          # direct connection (port 5432) — NEVER pool URL (advisory lock)
    TOKEN_ENCRYPTION_KEY: str  # min 32 chars; bound-parameter only, never logged
    SCHWAB_TRADER_APP_KEY: str
    SCHWAB_TRADER_APP_SECRET: str
    SCHWAB_MARKET_APP_KEY: str
    SCHWAB_MARKET_APP_SECRET: str
    PORT: int = 8000

config = SidecarConfig()
```

**Critical rule** from `apps/worker/src/config.ts` line 57 comment: "never log config values — only field names on failure." Apply same to Python: `TOKEN_ENCRYPTION_KEY` is never logged, never f-string interpolated into SQL.

---

### `apps/sidecar/token_store.py` (adapter, CRUD)

**No direct Python analog.** Structural mirror of `packages/adapters/src/postgres/repos/broker-tokens.ts` — same `broker_tokens` table, same column semantics.

**Key column semantics** from `packages/adapters/src/memory/broker-tokens.ts` lines 54–68:
- `writeTokens` does NOT reset `lastRefreshError` — only `recordRefreshOutcome` owns it.
- `writeTokens` does NOT reset `refresh_issued_at` — anchored at initial OAuth dance only.
- `readTokens` returns `null` (not error) when the row is absent.

**Python pattern for `token_store.py`** (from RESEARCH.md Pattern 1):
```python
import json, psycopg2

def make_token_callbacks(db_url: str, app_id: str, encryption_key: str):
    """Returns (token_read_func, token_write_func) bound to a specific app_id row."""

    def token_read_func():
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT token_json FROM broker_tokens WHERE app_id = %s",
                    (app_id,)            # ALWAYS bound parameter — never f-string
                )
                row = cur.fetchone()
                if row is None or row[0] is None:
                    raise ValueError(f"No token found for app_id={app_id}")
                return row[0]            # psycopg2 returns JSONB as dict; schwab-py expects dict
        finally:
            conn.close()

    def token_write_func(token: dict):
        access_token = token["token"]["access_token"]
        # refresh_issued_at NOT updated on access rotation (Phase 4 P02 rule)
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE broker_tokens SET
                        token_json = %s,
                        access_token = pgp_sym_encrypt(%s, %s),
                        issued_at = NOW(),
                        expires_at = to_timestamp(%s),
                        updated_at = NOW()
                    WHERE app_id = %s
                """, (
                    json.dumps(token),
                    access_token, encryption_key,    # encryption_key as bound param — never interpolated
                    token["token"]["expires_at"],
                    app_id
                ))
            conn.commit()
        finally:
            conn.close()

    return token_read_func, token_write_func
```

**Token blob shape** (from RESEARCH.md Pattern 1 — schwab-py source):
```python
# Full blob that token_write_func receives; store as-is to token_json:
{
    "creation_timestamp": 1719340800,  # unix int; NEVER changes after initial OAuth dance
    "token": {
        "access_token": "...",
        "refresh_token": "...",
        "expires_at": 1719342600.0,    # unix float (access token expiry)
        "token_type": "Bearer",
        "scope": "..."
    }
}
```

---

### `apps/sidecar/chain_proxy.py` (route handler, request-response)

**Analog:** `packages/adapters/src/http/cboe.ts` — same fetch-and-parse pattern, Python equivalent.

**safeParse-at-boundary pattern** from `packages/adapters/src/http/cboe.ts` lines 150–170:
```typescript
// Step 1: HTTP GET, catch network errors
let rawBody: unknown;
try {
  const response = await deps.fetch(CBOE_SPX_URL, { headers: { "User-Agent": deps.userAgent } });
  if (!response.ok) {
    return err({ kind: "fetch-error", message: `CBOE returned HTTP ${response.status}` });
  }
  rawBody = await response.json();
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err({ kind: "fetch-error", message });
}

// Step 2: Zod-parse before core sees any data
const parsed = CboeResponseSchema.safeParse(rawBody);
if (parsed.success !== true) {
  return err({ kind: "fetch-error", message: `CBOE payload parse error: ${parsed.error.message}` });
}
```

**Python equivalent for `chain_proxy.py`** — use Pydantic `model_validate` as the equivalent of Zod `safeParse`:
```python
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel, ValidationError
import logging

router = APIRouter()

class ChainQuote(BaseModel):
    occSymbol: str
    contractType: str      # "C" or "P"
    strike: float
    expiry: str            # ISO-8601 datetime
    bid: float | None
    ask: float | None
    mark: float | None
    iv: float | None
    delta: float | None
    gamma: float | None
    theta: float | None
    vega: float | None
    openInterest: int
    volume: int

class ChainResponse(BaseModel):
    root: str
    observedAt: str
    spot: float
    quotes: list[ChainQuote]
    source: str = "schwab_chain"

@router.get("/sidecar/chain", response_model=ChainResponse)
async def get_chain(request: Request, root: str = "SPX"):
    client = request.app.state.market_client
    try:
        resp = await client.get_option_chain(root, ...)
    except Exception as e:
        # AUTH_EXPIRED: return 503 so TS adapter maps it to err({kind:"fetch-error",message:"AUTH_EXPIRED"})
        logging.error("sidecar chain fetch failed: %s", e)
        raise HTTPException(status_code=503, detail={"error": "AUTH_EXPIRED"})
    # Validate/transform before returning (Pydantic model_validate = Zod safeParse equivalent)
    ...
```

**AUTH_EXPIRED response contract** (RESEARCH.md Pattern 5):
On any auth failure: `HTTP 503` with body `{"error": "AUTH_EXPIRED"}`. The TS sidecar adapter maps 503 + `AUTH_EXPIRED` to `err({ kind: "fetch-error", message: "AUTH_EXPIRED" })`.

---

### `apps/sidecar/advisory_lock.py` (utility)

**No analog** — first advisory-lock usage in this codebase.

**Full pattern from RESEARCH.md Pattern 3:**
```python
import psycopg2, logging

SIDECAR_LOCK_KEY = 8876543210  # stable bigint; document here as the canonical value

def acquire_sidecar_lock(direct_db_url: str) -> psycopg2.extensions.connection:
    """
    Acquire a session-level Postgres advisory lock.
    Must use direct DATABASE_URL (port 5432) — NOT DATABASE_POOL_URL.
    PgBouncer transaction mode silently releases session-level locks.
    Returns open connection (caller holds it; lock released when conn closes).
    Raises SystemExit(1) on failure (second instance — GW-04).
    """
    conn = psycopg2.connect(direct_db_url)
    conn.autocommit = True   # required: session-level lock needs autocommit
    with conn.cursor() as cur:
        cur.execute("SELECT pg_try_advisory_lock(%s)", (SIDECAR_LOCK_KEY,))
        acquired = cur.fetchone()[0]
    if not acquired:
        conn.close()
        logging.error(
            "sidecar: failed to acquire advisory lock %s — "
            "another sidecar instance is running. "
            "Refusing to start to prevent dual Schwab streaming sessions.",
            SIDECAR_LOCK_KEY
        )
        raise SystemExit(1)
    logging.info("sidecar: advisory lock %s acquired", SIDECAR_LOCK_KEY)
    return conn  # do NOT close until shutdown; lock releases on conn.close()
```

---

### `packages/adapters/src/sidecar/chain-adapter.ts` (adapter, request-response)

**Analog:** `packages/adapters/src/http/cboe.ts` — exact role and data-flow match.

**Imports pattern** from `packages/adapters/src/http/cboe.ts` lines 1–5:
```typescript
import { z } from "zod";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
import type { ForFetchingChain, RawChain, RawQuote, FetchError } from "@morai/core";
```

**Adapter factory pattern** from `packages/adapters/src/http/cboe.ts` lines 150–155:
```typescript
export function makeCboeChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  userAgent: string;
}): CboeChainAdapter {
```

**Sidecar adapter deps shape** (sidecar has `sidecarUrl` instead of a fixed URL):
```typescript
export function makeSidecarChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  sidecarUrl: string;  // e.g. "http://sidecar.railway.internal:8000"
}): SidecarChainAdapter {
```

**safeParse-at-boundary pattern** from `packages/adapters/src/http/cboe.ts` lines 173–182:
```typescript
// Zod-parse before core sees any data (T-02-07)
const parsed = CboeResponseSchema.safeParse(rawBody);
if (parsed.success !== true) {
  return err({
    kind: "fetch-error",
    message: `CBOE payload parse error: ${parsed.error.message}`,
  });
}
```

**Network error catch pattern** from `packages/adapters/src/http/cboe.ts` lines 159–169:
```typescript
try {
  const response = await deps.fetch(CBOE_SPX_URL, { headers: { "User-Agent": deps.userAgent } });
  if (!response.ok) {
    return err({ kind: "fetch-error", message: `CBOE returned HTTP ${response.status}` });
  }
  rawBody = await response.json();
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err({ kind: "fetch-error", message });
}
```

**Full sidecar adapter implementation shape** (from RESEARCH.md Code Examples):
```typescript
// packages/adapters/src/sidecar/chain-adapter.ts
import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { ForFetchingChain, RawChain, FetchError } from "@morai/core";

const SidecarChainResponseSchema = z.object({
  root: z.enum(["SPX", "SPXW"]),
  observedAt: z.string().datetime(),
  spot: z.number(),
  quotes: z.array(z.object({
    occSymbol: z.string(),
    contractType: z.enum(["C", "P"]),
    strike: z.number(),
    expiry: z.string().datetime(),
    bid: z.number().nullable(),
    ask: z.number().nullable(),
    mark: z.number().nullable(),
    iv: z.number().nullable(),
    delta: z.number().nullable(),
    gamma: z.number().nullable(),
    theta: z.number().nullable(),
    vega: z.number().nullable(),
    openInterest: z.number(),
    volume: z.number(),
  })),
  source: z.literal("schwab_chain"),
});

export type SidecarChainAdapter = { readonly fetchChain: ForFetchingChain };

export function makeSidecarChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  sidecarUrl: string;
}): SidecarChainAdapter {
  const fetchChain: ForFetchingChain = async (root) => {
    let rawBody: unknown;
    try {
      const resp = await deps.fetch(`${deps.sidecarUrl}/sidecar/chain?root=${root}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        const msg = (body as { error?: string }).error ?? `HTTP ${resp.status}`;
        return err({ kind: "fetch-error", message: msg });
      }
      rawBody = await resp.json();
    } catch (e) {
      return err({ kind: "fetch-error", message: e instanceof Error ? e.message : String(e) });
    }
    const parsed = SidecarChainResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      return err({ kind: "fetch-error", message: `sidecar chain parse error: ${parsed.error.message}` });
    }
    const d = parsed.data;
    const chain: RawChain = {
      root: d.root,
      observedAt: new Date(d.observedAt),
      spot: d.spot,
      quotes: d.quotes.map(q => ({ ...q, expiry: new Date(q.expiry) })),
      source: d.source,
    };
    return ok(chain);
  };
  return { fetchChain };
}
```

---

### `packages/adapters/src/memory/sidecar-chain.ts` (in-memory twin, request-response)

**Analog:** `packages/adapters/src/memory/chain.ts` — exact role match; copy wholesale, rename.

**Full pattern** from `packages/adapters/src/memory/chain.ts` lines 1–41:
```typescript
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingChain, RawChain, FetchError } from "@morai/core";

export type MemoryChainAdapter = {
  readonly fetchChain: ForFetchingChain;
  readonly seed: (root: "SPX" | "SPXW", chain: RawChain) => Promise<void>;
};

export function makeMemoryChainAdapter(): MemoryChainAdapter {
  const store = new Map<string, RawChain>();

  const fetchChain: ForFetchingChain = async (root) => {
    const chain = store.get(root);
    if (chain === undefined) {
      return err<FetchError>({ kind: "fetch-error", message: `Root not seeded: ${root}` });
    }
    return ok(chain);
  };

  const seed = async (root: "SPX" | "SPXW", chain: RawChain): Promise<void> => {
    store.set(root, chain);
  };

  return { fetchChain, seed };
}
```

The sidecar in-memory twin is identical — just rename the export to `makeMemorySidecarChainAdapter` (or reuse `makeMemoryChainAdapter` with a type alias if the port is identical). The architecture rule from `packages/adapters/src/memory/chain.ts` line 12–13 applies: "every driven port change updates the in-memory adapter in the same PR."

---

### `apps/worker/src/schedule.ts` (self-modify — retire `refresh-tokens`)

**Analog:** self — `apps/worker/src/schedule.ts`

**Current state** (lines 55–57 in `AllHandlers`, lines 78–79 createQueue, lines 117–122 schedule, line 138 work):
```typescript
// AllHandlers type — REMOVE:
readonly refreshTokens: PgBossHandler;

// createQueue phase — REMOVE:
await boss.createQueue("refresh-tokens");

// schedule phase — REMOVE:
await boss.schedule("refresh-tokens", "0 4 * * *", null, { tz: "America/New_York" });

// work phase — REMOVE:
await boss.work("refresh-tokens", POLLING_INTERVAL, handlers.refreshTokens);
```

**File header comment** (line 8): Update "Registers all 10 queues" → "Registers all 9 queues"; update "schedule 6 crons" → "5 crons"; update "10 handlers" → "9 handlers".

---

### `apps/worker/src/schedule.test.ts` (self-modify)

**Current constants** (lines 61–81) that must change:
```typescript
// RENAME + SHRINK:
const ALL_10_QUEUES = [           // → ALL_9_QUEUES (remove "refresh-tokens")
  ...
  "refresh-tokens",               // REMOVE this entry
  ...
];

const SCHEDULED_6 = [            // → SCHEDULED_5 (remove "refresh-tokens")
  ...
  "refresh-tokens",               // REMOVE this entry
];
```

**Test assertions to update** (lines 84–96, 91–96, 144–152, 154–158):
- `"calls createQueue for all 10 job names"` → 9, array excludes `"refresh-tokens"`
- `"calls schedule for exactly 6 jobs"` → `toHaveLength(5)`, `SCHEDULED_5`
- `"refresh-tokens cron is '0 4 * * *' tz America/New_York"` → **DELETE this entire test block** (lines 144–152)
- `"calls work() for all 10 queues"` → 9 queues

**`makeFakeHandlers()` update** (lines 45–59): remove `refreshTokens: handler` from the returned object.

---

### `apps/worker/src/main.ts` (self-modify — chain source swap)

**Current wiring to remove** (lines 26–27, 50, 59, 106–137):
```typescript
// REMOVE imports:
makeSchwabChainAdapter,
makeSchwabOAuthClient,

// REMOVE from @morai/core imports:
makeRefreshTokenUseCase,
makeRefreshTokensUseCase,

// REMOVE import:
import { makeRefreshTokensHandler } from "./handlers/refresh-tokens.ts";

// REMOVE block (lines 106–137):
const marketGetAccessToken = async () => { ... };
const schwabChainFromDate = ...;
const schwabChainToDate = ...;
const schwabMarketAdapter = makeSchwabChainAdapter({ ... });
```

**Add in place of removed block:**
```typescript
import { makeSidecarChainAdapter } from "@morai/adapters";

const sidecarAdapter = makeSidecarChainAdapter({
  fetch: globalThis.fetch,
  sidecarUrl: config.SIDECAR_URL,
});
```

**Update `selectChainSource` wiring** (lines 147–161):
```typescript
// CHANGE: schwabFetchChain: schwabMarketAdapter.fetchChain,
// TO:     schwabFetchChain: sidecarAdapter.fetchChain,
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChain: (root) =>
    selectChainSource({
      readTokenFreshness: brokerTokensRepo.readTokenFreshness,
      schwabFetchChain: sidecarAdapter.fetchChain,   // ← changed
      cboeFetchChain: cboeAdapter.fetchChain,
    }).then((fetchChain) => fetchChain(root)),
  ...
});
```

---

### `apps/worker/src/config.ts` (self-modify — add `SIDECAR_URL`)

**Analog:** self — `apps/worker/src/config.ts`

**Pattern** (Zod field, lines 6–33): add one field to `workerConfigSchema`:
```typescript
SIDECAR_URL: z.string().url("SIDECAR_URL must be a valid URL"),
// e.g. "http://sidecar.railway.internal:8000" on Railway
// e.g. "http://localhost:8000" in local dev
```

Remove the now-unused Schwab OAuth fields (they move to the sidecar):
```typescript
// REMOVE from workerConfigSchema:
SCHWAB_TRADER_APP_KEY: z.string().min(1),
SCHWAB_TRADER_APP_SECRET: z.string().min(1),
SCHWAB_TRADER_CALLBACK_URL: z.string().url(),
SCHWAB_MARKET_APP_KEY: z.string().min(1),
SCHWAB_MARKET_APP_SECRET: z.string().min(1),
SCHWAB_MARKET_CALLBACK_URL: z.string().url(),
```

Note: `TOKEN_ENCRYPTION_KEY` stays in the worker config — the worker still reads `broker_tokens` for freshness via `makePostgresBrokerTokensRepo`.

---

## Shared Patterns

### safeParse-at-boundary (T-04-14 / T-02-07)

**Source:** `packages/adapters/src/http/cboe.ts` lines 176–182 and `packages/adapters/src/schwab/market/chain-adapter.ts` lines 209–215

**Apply to:** `packages/adapters/src/sidecar/chain-adapter.ts` (TS); `apps/sidecar/chain_proxy.py` (Python Pydantic equivalent)

```typescript
const parsed = CboeResponseSchema.safeParse(rawBody);
if (parsed.success !== true) {
  return err({ kind: "fetch-error", message: `... parse error: ${parsed.error.message}` });
}
```

Rule: never `throw` on vendor parse failure; always `return err(...)`. No `any`, no `as`.

### Network error catch-and-wrap

**Source:** `packages/adapters/src/http/cboe.ts` lines 159–170

**Apply to:** `packages/adapters/src/sidecar/chain-adapter.ts`

```typescript
try {
  const response = await deps.fetch(url);
  if (!response.ok) {
    return err({ kind: "fetch-error", message: `... returned HTTP ${response.status}` });
  }
  rawBody = await response.json();
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  return err({ kind: "fetch-error", message });
}
```

### Adapter factory with injected deps

**Source:** `packages/adapters/src/http/cboe.ts` lines 150–155; `packages/adapters/src/schwab/market/chain-adapter.ts` lines 155–164

**Apply to:** `packages/adapters/src/sidecar/chain-adapter.ts`

All adapters are factory functions (`makeXxxAdapter(deps)`) with explicit dep injection. `fetch` is always injected — never `globalThis.fetch` directly inside an adapter. This is what makes Vitest's `msw`/in-memory swaps possible.

### In-memory twin (architecture-boundaries.md §8)

**Source:** `packages/adapters/src/memory/chain.ts`

**Apply to:** `packages/adapters/src/memory/sidecar-chain.ts`

Every driven port ships an in-memory twin in the same PR. The twin uses a `Map` store, exposes a `seed()` method for test setup, and returns `err(...)` when not seeded.

### Env config schema (process.env read once at composition root)

**Source:** `apps/worker/src/config.ts` lines 6–73

**Apply to:** `apps/worker/src/config.ts` (self-modify), `apps/sidecar/config.py` (Python mirror)

- Zod schema (TS) / Pydantic `BaseSettings` (Python) — parse once at startup
- On validation failure: log field names, never values; exit non-zero
- Never interpolate sensitive values into log strings

### TDD red-first order for schedule.test.ts modifications

**Source:** `apps/worker/src/schedule.test.ts` lines 61–81

**Apply to:** `apps/worker/src/schedule.test.ts` (self-modify)

Per the TDD rule: update `schedule.test.ts` first (add assertion that `refresh-tokens` is NOT in queues; change `10 → 9`, `6 → 5`), run suite to get RED, then remove from `schedule.ts` to go GREEN. Matches the `schedule.test.ts` pattern of testing by constants (`ALL_10_QUEUES`, `SCHEDULED_6`) — just update those constants.

### Dockerfile-per-service Railway deploy

**Source:** Phase 1 deploy lessons (MEMORY.md) — no file to read, but pattern is: one `Dockerfile` per `apps/` service, bind to `::` not `0.0.0.0`, use `$PORT` from Railway env.

**Apply to:** `apps/sidecar/Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "::", "--port", "8000"]
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/sidecar/advisory_lock.py` | utility | — | First Postgres advisory lock in the codebase |
| `apps/sidecar/requirements.txt` | config | — | First Python service; no prior Python deps file |
| `apps/sidecar/tests/test_advisory_lock.py` | test | — | No prior advisory lock tests anywhere |

For these three files, the RESEARCH.md Pattern 3 code is the reference (not a codebase analog).

---

## Metadata

**Analog search scope:** `packages/adapters/src/`, `apps/worker/src/`, `packages/core/src/`
**Files scanned:** 12
**Pattern extraction date:** 2026-06-25

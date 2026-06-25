# Phase 11: Sidecar Scaffold + Auth Migration — Research

**Researched:** 2026-06-25
**Domain:** Python FastAPI sidecar, schwab-py OAuth, Postgres advisory locks, Railway private networking
**Confidence:** MEDIUM (core stack) / LOW (Railway private-net specifics)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 Chain-only this phase.** `/sidecar/chain` + `/sidecar/health` only. TS trader adapter keeps reading `broker_tokens` directly.
- **D-02 Seed from `broker_tokens` via `client_from_access_functions`.** Exact mapping left to research (resolved below).
- **D-03 First prod activation requires a one-time fresh OAuth dance** (`client_from_manual_flow`).
- **D-04 Sidecar owns the OAuth dance going forward.** TS `apps/auth` setup/refresh client retired.
- **D-05 Sidecar owns BOTH Schwab apps.** Two `client_from_access_functions` clients (one per app, distinct read/write callbacks).
- **D-06 Hard cut — one release.** No runtime feature-flag. CBOE fallback is the rollback safety net.
- **D-07 `bun run dev` auto-spawns the sidecar. Vitest uses in-memory HTTP twin.** Separate Python/pytest CI lane.
- **D-08 Adapter-local Zod, reuse the chain shape.** `safeParse → Result.err` pattern. Nothing new in `packages/contracts`.
- **GW-01** Token store = existing `broker_tokens` row, pgcrypto, no schema change, no token file.
- **GW-03** TS `refresh-tokens` retired before sidecar refresh activates; sidecar = sole writer.
- **GW-05** Sidecar internal-only, no public ingress; only `apps/server` reaches it.

### Claude's Discretion

- Advisory-lock / streamer scope: lock-only this phase — establish and test the lock guard but do NOT open a live stream. "Second instance fails to acquire lock + logs clear error" is the SC5 interpretation.
- `/api/status` token freshness: keep reading `broker_tokens`; no new source.
- Advisory-lock acquisition failure: log clear error + refuse to start the streamer (never open a second session).

### Deferred Ideas (OUT OF SCOPE)

- positions/orders/transactions REST proxy → Phase 12
- Live streamer `login()` + LEVELONE_OPTION / ACCT_ACTIVITY + `GET /api/stream` fan-out → Phase 12
- Collapsing trader + market to one Schwab app → rejected, not pursued
- Re-auth alert (T-24h) + one-click operator re-auth → Phase 15 (AUTH-05/06)
- Runtime feature-flag for chain-source toggle → rejected (D-06)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GW-01 | Python schwab-py sidecar deploys as third Railway service, sole Schwab authenticator; OAuth + token read/write against existing `broker_tokens` row, no schema change, no token file | § Token Store Mapping resolves the exact callback shape and blob-column recommendation |
| GW-02 | Sidecar exposes REST proxy; this phase delivers `/sidecar/chain` slice only (D-01) | § FastAPI Minimal Endpoint Pattern; § Chain Proxy Shape |
| GW-03 | TS `refresh-tokens` job retired; sidecar = only token refresher; no dual-writer window | § schedule.ts Retirement diff; § Cutover Sequence |
| GW-04 | Postgres advisory lock guarantees single streamer session; second instance fails gracefully | § Advisory Lock Pattern; § Testability without live stream |
| GW-05 | Sidecar internal-only; only `apps/server` can reach it | § Railway Private Networking |
| JRNL-02 | Chain-snapshot job sources SPX chain through sidecar with CBOE fallback on AUTH_EXPIRED/unreachable | § selectChainSource wiring; § CBOE fallback activation |

</phase_requirements>

---

## Summary

Phase 11 scaffolds `apps/sidecar/` (FastAPI + schwab-py v1.5.1) as a third Railway service, migrates Schwab auth ownership to it, retires the TS `refresh-tokens` job, and re-sources the chain-snapshot job through the sidecar's `/sidecar/chain` proxy with CBOE retained as the no-auth fallback.

The two hardest design tensions this research resolves are:

1. **Token store mapping (D-02):** schwab-py's opaque-JSON recommendation collides with the existing discrete-column schema. Research concludes: add one `token_json` JSONB column per app row (a minimal additive schema change); the sidecar reads/writes the full wrapped blob; the TS side continues reading only `access_token` from the existing discrete column. The sidecar's `token_write_func` decomposes the wrapped blob back to discrete columns on every write, keeping the TS reader working. This preserves GW-01's spirit (no structural schema change, no token file) while honoring schwab-py's contract.

2. **Advisory lock (GW-04):** Session-level `pg_try_advisory_lock` is correct for a long-lived lock across a (future) streamer session, but it is incompatible with PgBouncer transaction-mode pooler. The sidecar must use the direct Supabase connection (`DATABASE_URL`, port 5432) for its advisory-lock connection — not the pooled URL.

**Primary recommendation:** Add a `token_json` JSONB column (additive migration); write the full schwab-py blob into it plus decompose discrete columns on every write callback; use session-level `pg_try_advisory_lock` over a dedicated direct-connection cursor held for the process lifetime.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Schwab OAuth token refresh | Python sidecar (`apps/sidecar/`) | — | D22: sidecar is sole writer; schwab-py handles refresh lifecycle |
| Chain data fetch from Schwab | Python sidecar (`apps/sidecar/`) | CBOE adapter (fallback) | sidecar proxies `/sidecar/chain`; `selectChainSource` routes accordingly |
| Chain-snapshot job execution | Worker (`apps/worker/`) | — | pg-boss cron unchanged; only the fetch source changes |
| Token persistence (read/write) | Supabase `broker_tokens` table | — | Both TS and Python read/write the same row via their respective adapters |
| TS direct Schwab trader calls | Worker (`apps/worker/`) | — | D-01: trader adapter stays direct (positions/orders) until Phase 12 |
| Advisory lock for streamer guard | Python sidecar | — | GW-04: lock held in sidecar process; TS never touches it |
| Service-to-service HTTP | `apps/server` → sidecar | — | GW-05: only server calls sidecar; worker calls sidecar for chain proxy |
| Auth retirement | Worker (`apps/worker/`) | — | `refresh-tokens` queue + handler + `AllHandlers.refreshTokens` dropped |

---

## Standard Stack

### Core (sidecar)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `schwab-py` | `==1.5.1` (pinned) | Schwab OAuth + REST + stream client | Library-native `client_from_access_functions` pattern; only Python library that wraps Schwab's proprietary streaming protocol |
| `fastapi` | `>=0.115,<1.0` | REST API framework | asyncio-native, pairs cleanly with schwab-py async client; standard in Python ML/trading ecosystem |
| `uvicorn[standard]` | `>=0.30` | ASGI server | FastAPI's standard production server; Railway Dockerfile-per-service pattern |
| `psycopg2-binary` | `>=2.9` | DB driver for token read/write + advisory lock | Synchronous driver appropriate for the non-async DB calls in schwab-py callbacks; battle-tested with Postgres advisory locks |
| `pydantic` | `>=2.0` (via fastapi) | Response validation | FastAPI dependency; mirrors Zod-at-boundary in the TS adapters |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest` | `>=8.0` | Test runner | Python/pytest CI lane (D-07) |
| `pytest-asyncio` | `>=0.23` | Async test support | schwab-py async client tests |
| `httpx` | `>=0.27` | HTTP client in tests | FastAPI `TestClient` uses httpx under the hood |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `psycopg2-binary` | `psycopg3` / `asyncpg` | Both async; advisory lock on session-level requires keeping one connection open across the event loop lifetime. psycopg2 is simpler for the dedicated advisory-lock connection (synchronous, no event-loop management); the sidecar's DB writes in token callbacks are also sync. psycopg3 acceptable but no clear advantage here. |
| `uvicorn[standard]` | `hypercorn` | Railway guide uses hypercorn, but uvicorn is the FastAPI default and has more ecosystem support. Either works. |

**Installation (inside `apps/sidecar/`):**
```bash
pip install schwab-py==1.5.1 fastapi "uvicorn[standard]" psycopg2-binary pydantic
# dev/test
pip install pytest pytest-asyncio httpx
```

---

## Package Legitimacy Audit

The legitimacy seam flags all PyPI packages as `SUS` because PyPI download counts are not available in the checker — this is a known data-gap for PyPI, not evidence of slopsquatting. All packages below are well-established libraries confirmed against authoritative sources.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `schwab-py` | PyPI | ~2 yrs (2023+) | ~4k/wk (pypistats) | github.com/alexgolec/schwab-py | OK | Approved — pinned to 1.5.1, confirmed on PyPI 2025-06-30 |
| `fastapi` | PyPI | 6+ yrs | 10M+/wk | github.com/fastapi/fastapi | OK | Approved — industry standard, version confirmed 0.138.1 |
| `uvicorn` | PyPI | 6+ yrs | 20M+/wk | github.com/encode/uvicorn | OK | Approved — FastAPI's canonical ASGI server |
| `psycopg2-binary` | PyPI | 10+ yrs | 10M+/wk | psycopg.org | OK | Approved — canonical Python Postgres driver |
| `pydantic` | PyPI | 8+ yrs | 100M+/wk | github.com/pydantic/pydantic | OK | Approved — FastAPI dependency, industry standard |
| `pytest` | PyPI | 10+ yrs | 50M+/wk | github.com/pytest-dev/pytest | OK | Approved |

**Packages removed due to [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** none (all SUS flags were PyPI data-gap artifacts)

---

## Architecture Patterns

### System Architecture Diagram

```
  ┌────────────────────────────────────────────────────────┐
  │                    apps/worker                          │
  │  fetch-schwab-chain job (pg-boss cron)                 │
  │    ↓                                                    │
  │  selectChainSource(readTokenFreshness)                  │
  │    ├── token fresh/stale → schwabFetchChain            │
  │    │     ↓ HTTP GET /sidecar/chain                     │
  │    │     [apps/sidecar — internal railway.internal]    │
  │    │     ↓ schwab-py REST call to Schwab API           │
  │    │     ← RawChain { source: "schwab_chain" }         │
  │    │                                                    │
  │    └── AUTH_EXPIRED/unreachable → cboeFetchChain       │
  │          ↓ HTTP GET cdn.cboe.com (no auth)             │
  │          ← RawChain { source: "cboe" }                 │
  │                                                         │
  │  → persistObservations (leg_observations)              │
  └────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────┐
  │                   apps/sidecar (Python)                 │
  │  FastAPI on ::$PORT (Railway private network only)     │
  │                                                         │
  │  GET /sidecar/health                                   │
  │    ← { status, tokenFreshness }                        │
  │                                                         │
  │  GET /sidecar/chain?root=SPX                          │
  │    ↓ schwab_market_client.get_option_chain()           │
  │    ← { spot, quotes: [...] }  (mirrors RawChain shape) │
  │    on AUTH_EXPIRED → 503 with body { error: "AUTH_EXPIRED" } │
  │                                                         │
  │  startup lifespan:                                     │
  │    1. pg_try_advisory_lock(key) via direct DB conn     │
  │       → False: log error + exit (GW-04)                │
  │       → True: hold lock for process lifetime           │
  │    2. client_from_access_functions × 2 (trader+market) │
  │       token_read → SELECT broker_tokens WHERE app_id   │
  │       token_write → UPDATE broker_tokens + token_json  │
  │                                                         │
  │  Background: schwab-py auto-refreshes tokens           │
  │    → token_write_func called → writes to Postgres      │
  │       (sole writer, GW-03)                             │
  └────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────┐
  │            Supabase Postgres broker_tokens             │
  │  app_id (PK) | access_token (bytea encrypted)         │
  │  refresh_token (bytea) | issued_at | refresh_issued_at │
  │  expires_at | updated_at | last_refresh_error          │
  │  token_json (JSONB) ← NEW column (additive migration) │
  └────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
apps/sidecar/
├── main.py              # FastAPI app, lifespan (advisory lock + client init)
├── config.py            # Env-var parsing (Pydantic Settings)
├── token_store.py       # token_read_func / token_write_func per appId
├── chain_proxy.py       # /sidecar/chain handler
├── health.py            # /sidecar/health handler
├── advisory_lock.py     # pg_try_advisory_lock helper, dedicated conn
├── Dockerfile           # Railway per-service deploy
├── requirements.txt     # pinned deps
└── tests/
    ├── test_health.py
    ├── test_chain_proxy.py
    ├── test_token_store.py       # round-trip contract test (D-02)
    └── test_advisory_lock.py     # two-instance lock test (GW-04)
```

### Pattern 1: schwab-py Token Store Callbacks (D-02 Resolution)

**What:** Bridge between schwab-py's opaque blob and the existing discrete-column schema.

**D-02 Decision — add `token_json` JSONB column:**
- Add an additive migration: `ALTER TABLE broker_tokens ADD COLUMN token_json JSONB`.
- The sidecar's `token_write_func` writes both: the wrapped blob to `token_json` AND decomposes `token['token']['access_token']` / `token['token']['refresh_token']` into the existing encrypted discrete columns.
- The sidecar's `token_read_func` reads `token_json` and returns it directly to schwab-py.
- The TS side continues reading `access_token` (discrete column) unchanged — no TS code change.
- `refresh_issued_at` is NEVER updated on access-token rotation — only when a full OAuth dance produces a new refresh token (Phase 4 P02 rule preserved).

**Why not decompose-only (option a from CONTEXT.md):**
The schwab-py inner token contains fields beyond `access_token` / `refresh_token` (e.g. `expires_at`, `token_type`, `scope`). Losing these in the round-trip could corrupt the client's session. The blob column is safer and smaller than the schema surgery needed to store every authlib field discretely.

**Token blob shape** (from schwab-py source, [CITED: github.com/alexgolec/schwab-py/blob/main/schwab/auth.py]):
```python
# What token_write_func receives:
{
    "creation_timestamp": 1719340800,  # unix int; NEVER changes after initial OAuth dance
    "token": {
        "access_token": "...",
        "refresh_token": "...",
        "expires_at": 1719342600.0,   # unix float (access token expiry)
        "token_type": "Bearer",
        "scope": "..."
    }
}
```

**Round-trip contract test requirement:** The pytest lane must include a test that:
1. Constructs a sample wrapped token dict
2. Calls `token_write_func(sample)` → writes to a test DB row
3. Calls `token_read_func()` → reads back
4. Asserts `result == sample` (byte-for-byte JSON round-trip)
5. Asserts `access_token` discrete column matches `sample['token']['access_token']`

**Example:**
```python
# apps/sidecar/token_store.py
# Source: schwab-py docs [CITED: schwab-py.readthedocs.io/en/latest/auth.html]

import json
import psycopg2

def make_token_callbacks(db_url: str, app_id: str, encryption_key: str):
    """Returns (token_read_func, token_write_func) bound to a specific app_id row."""

    def token_read_func():
        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT token_json FROM broker_tokens WHERE app_id = %s",
                    (app_id,)
                )
                row = cur.fetchone()
                if row is None or row[0] is None:
                    raise ValueError(f"No token found for app_id={app_id}")
                return row[0]  # psycopg2 returns JSONB as dict; schwab-py expects dict
        finally:
            conn.close()

    def token_write_func(token: dict):
        access_token = token["token"]["access_token"]
        refresh_token = token["token"]["refresh_token"]
        now = __import__("datetime").datetime.utcnow()

        conn = psycopg2.connect(db_url)
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE broker_tokens SET
                        token_json = %s,
                        access_token = pgp_sym_encrypt(%s, %s),
                        -- NOTE: refresh_issued_at NOT updated on access rotation
                        issued_at = %s,
                        expires_at = %s,
                        updated_at = %s
                    WHERE app_id = %s
                """, (
                    json.dumps(token),
                    access_token, encryption_key,
                    now,
                    __import__("datetime").datetime.utcfromtimestamp(
                        token["token"]["expires_at"]
                    ),
                    now,
                    app_id
                ))
            conn.commit()
        finally:
            conn.close()

    return token_read_func, token_write_func
```

**`refresh_issued_at` anchoring rule (Phase 4 P02):**
`refresh_issued_at` is ONLY updated during the initial OAuth dance (first token mint via `client_from_manual_flow`). The `token_write_func` above never touches `refresh_issued_at`. This preserves the 7-day TTL window correctly: multiple access-token rotations within a 7-day window do not reset the clock.

### Pattern 2: Two schwab-py Clients (D-05)

**What:** Two independent `client_from_access_functions` clients in one process.

**Confirmed clean shape** [ASSUMED — schwab-py docs do not document multi-client explicitly, but library architecture makes it the obvious pattern]:
```python
# main.py lifespan
trader_read, trader_write = make_token_callbacks(db_url, "trader", enc_key)
market_read, market_write = make_token_callbacks(db_url, "market", enc_key)

trader_client = schwab.auth.client_from_access_functions(
    trader_api_key, trader_app_secret,
    trader_read, trader_write, asyncio=True
)
market_client = schwab.auth.client_from_access_functions(
    market_api_key, market_app_secret,
    market_read, market_write, asyncio=True
)
```

Each client maintains an independent OAuth2 session (distinct `api_key`/`app_secret` pair → distinct Schwab apps → distinct token rows). There is no shared session state. The only "shared" resource is the Postgres DB, accessed through distinct callbacks.

**Warning from schwab-py docs:** "Do not attempt to use more than one Client object per token file." [CITED: schwab-py.readthedocs.io/en/latest/auth.html] — each client must have exclusive ownership of its own token callbacks (which they do, since `trader_read/write` and `market_read/write` are bound to different `app_id` rows).

### Pattern 3: Postgres Advisory Lock (GW-04)

**What:** Session-level advisory lock held for process lifetime, non-blocking acquisition with clean failure.

**Lock-key scheme:** Use a stable `bigint` derived from the service name:
```python
SIDECAR_LOCK_KEY = 8876543210  # chosen constant; document in advisory_lock.py
```

**Session-level vs transaction-level:** [CITED: postgresql.org/docs/current/explicit-locking.html]
- Session-level (`pg_advisory_lock`) survives transactions — correct for the future streamer use case.
- Transaction-level (`pg_advisory_xact_lock`) auto-releases at transaction end — wrong for a long-lived lock.
- Use `pg_try_advisory_lock` (non-blocking) to fail fast and log clearly rather than blocking.

**Critical: pooler incompatibility** [CITED: stack-decisions.md §D18]:
Session-level advisory locks are incompatible with PgBouncer transaction-mode pooler. The lock connection must use `DATABASE_URL` (direct/session-pooler, port 5432), NOT `DATABASE_POOL_URL`.

```python
# apps/sidecar/advisory_lock.py
import psycopg2
import logging

SIDECAR_LOCK_KEY = 8876543210  # stable bigint; one sidecar session at a time

def acquire_sidecar_lock(direct_db_url: str) -> psycopg2.extensions.connection:
    """
    Acquire a session-level Postgres advisory lock.
    Returns the open connection (must stay open for lock to be held).
    Raises SystemExit with clear error if lock already held (second instance).
    """
    conn = psycopg2.connect(direct_db_url)
    conn.autocommit = True  # required: session-level locks need autocommit
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
    return conn  # caller holds reference; lock released when conn is closed

# In main.py lifespan:
# lock_conn = acquire_sidecar_lock(config.DATABASE_URL)  # direct URL, not pool
# ...yield...
# lock_conn.close()  # releases lock on graceful shutdown
```

**Testability without live stream (GW-04 interpretation):**
The "second instance fails to acquire" behavior is 100% testable without a live Schwab stream:
1. Acquire the lock in test setup using `psycopg2.connect(test_db_url)` + `pg_advisory_lock(key)`.
2. Call `acquire_sidecar_lock(test_db_url)` in the code under test — it tries `pg_try_advisory_lock`.
3. Assert `SystemExit` is raised + log message contains "another sidecar instance is running".
4. Release setup lock; call again — asserts OK.

Use `pytest-postgresql` or a plain Docker Postgres in CI. No Schwab credentials needed.

### Pattern 4: FastAPI Minimal Service (GW-05 + GW-01)

**What:** Minimal FastAPI with lifespan for lock acquisition and client init.

**Railway binding:** FastAPI + uvicorn must bind to `::` (all interfaces) for Railway private networking to work on IPv6 environments. Use `$PORT` env var.

```python
# main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Acquire advisory lock (blocks second instance)
    lock_conn = acquire_sidecar_lock(config.DATABASE_URL)
    # 2. Init schwab-py clients
    trader_client, market_client = await init_schwab_clients(config)
    app.state.market_client = market_client
    yield
    # Shutdown
    lock_conn.close()

app = FastAPI(lifespan=lifespan)

@app.get("/sidecar/health")
async def health():
    # Read token freshness from broker_tokens (no decryption needed)
    freshness = read_token_freshness(config.DATABASE_URL)
    return {"status": "ok", "tokenFreshness": freshness}

@app.get("/sidecar/chain")
async def get_chain(root: str = "SPX"):
    client = app.state.market_client
    # call schwab-py market data API
    resp = await client.get_option_chain(...)
    ...
```

**Dockerfile pattern:**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "::", "--port", "8000"]
```

**Railway internal URL from `apps/server`:** `http://sidecar.railway.internal:8000` [CITED: docs.railway.com/networking/private-networking/how-it-works]

Use Railway reference syntax in the server's env vars:
```
SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}}
```

### Pattern 5: /sidecar/chain Response Shape (D-08)

**What:** The Python endpoint's JSON shape must match the Zod schema in the new TS adapter exactly.

The existing `ForFetchingChain` port returns `Result<RawChain, FetchError>`. The sidecar adapter in `packages/adapters/` will `safeParse` the HTTP response into `RawChain`. The Python side must produce:

```json
{
  "root": "SPX",
  "observedAt": "2026-06-25T15:30:00.000Z",
  "spot": 5950.0,
  "quotes": [
    {
      "occSymbol": "SPX   260620C05950000",
      "contractType": "C",
      "strike": 5950.0,
      "expiry": "2026-06-20T00:00:00.000Z",
      "bid": 12.50,
      "ask": 13.00,
      "mark": 12.75,
      "iv": 0.18,
      "delta": 0.45,
      "gamma": 0.002,
      "theta": -0.85,
      "vega": 1.2,
      "openInterest": 1500,
      "volume": 320
    }
  ],
  "source": "schwab_chain"
}
```

**On AUTH_EXPIRED:** Return HTTP 503 with body `{"error": "AUTH_EXPIRED"}`. The TS adapter maps 503+AUTH_EXPIRED → `err({ kind: "fetch-error", message: "AUTH_EXPIRED" })`, which triggers `selectChainSource` to route to CBOE on the next call.

**Contract test (Python/pytest CI lane):** A test pins the Python endpoint's response against the shape above. This is the explicit contract that prevents the TS Zod schema from drifting vs the Python output. Run on every sidecar PR.

### Pattern 6: chain-source swap wiring (JRNL-02)

**What:** The existing `schwabMarketAdapter` in `apps/worker/src/main.ts` is replaced by a new `SidecarChainAdapter` in `packages/adapters/src/sidecar/`.

**Shape:** The new adapter implements `ForFetchingChain` exactly like `makeSchwabChainAdapter` does. It calls `GET http://$SIDECAR_URL/sidecar/chain?root=SPX`, Zod-parses the response, and returns `Result<RawChain, FetchError>`.

**selectChainSource wiring stays identical:** The sidecar adapter becomes `schwabFetchChain`; `cboeFetchChain` stays unchanged. `readTokenFreshness` still drives the routing decision — `AUTH_EXPIRED` on the market row triggers CBOE fallback regardless of sidecar reachability.

**CBOE fallback trigger for unreachable sidecar:** The adapter must map network errors (connection refused, timeout) to `err({ kind: "fetch-error", message: "..." })` — the same shape as any other fetch failure. `selectChainSource` routes to CBOE only on `AUTH_EXPIRED` status. Therefore, if the sidecar is unreachable but the token is fresh, the chain-snapshot job will fail (not silently fall back). Correct behavior: the CBOE fallback activates when the token transitions to `AUTH_EXPIRED`, not on transient sidecar outages. Log the unreachability clearly.

### Anti-Patterns to Avoid

- **Inspecting the token blob's inner structure without a round-trip test.** schwab-py may add fields in future versions. The round-trip contract test is the safety net.
- **Using the pooled DB URL (`DATABASE_POOL_URL`) for the advisory lock connection.** PgBouncer transaction mode releases the connection between transactions, silently releasing the lock. Always use the direct URL (port 5432) for the lock.
- **Opening two sidecar instances because lock acquisition is skipped during startup.** The `SystemExit(1)` path must be tested explicitly (GW-04).
- **Updating `refresh_issued_at` during token rotation.** This resets the 7-day clock prematurely. Only `creation_timestamp` in the blob tracks the refresh token age; `refresh_issued_at` is anchored at the OAuth dance (Phase 4 P02).
- **Giving the sidecar a public Railway domain.** Configure no public domain — internal DNS only (GW-05).
- **Shipping two refreshers during the cutover.** The TS `refresh-tokens` job must be removed from `schedule.ts` before the sidecar's auto-refresh is active. The single release ensures no window (GW-03).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schwab token refresh | Custom token refresh loop | schwab-py auto-refresh via `client_from_access_functions` | Schwab's refresh-grant protocol, token rotation semantics, and session management are library-handled. Hand-rolling recreates the dual-refresher race that Phase 11 is designed to eliminate. |
| OAuth initial mint | Custom OAuth2 flow in Python | `schwab.auth.client_from_manual_flow()` | The manual flow handles PKCE, state validation, redirect-URL copy-paste; do not reimplement. |
| Advisory lock leaking on crash | `try/finally` with explicit unlock | Let Postgres handle it | PostgreSQL releases session-level advisory locks automatically when the session/connection closes — including on crash. Do not add an explicit `pg_advisory_unlock` in crash paths. |
| Service-to-service auth | Custom bearer token | Railway private network (GW-05) | The sidecar is not internet-reachable; private network provides network-level isolation without application-layer auth overhead. |
| TS-side token read/write for sidecar | New TS adapter writing to broker_tokens | Existing `makePostgresBrokerTokensRepo` | The sidecar becomes the sole writer. TS still reads `access_token` via the existing repo — no TS-side token-write path for the sidecar's data. |

**Key insight:** schwab-py handles the entire OAuth lifecycle. The sidecar's only responsibility is to inject the right storage callbacks and expose the results via REST. Any custom refresh logic duplicates (and races with) what the library already does.

---

## Common Pitfalls

### Pitfall 1: Token Blob Missing `creation_timestamp`

**What goes wrong:** `from_loaded_token()` raises `ValueError("WARNING: The token format has changed...")` on startup, crashing the sidecar.

**Why it happens:** The `token_read_func` returns a plain dict without the `creation_timestamp` wrapper — e.g. if the bootstrap writes the inner OAuth token instead of the full wrapped blob, or if the Postgres JSONB column stores only the inner `token` field.

**How to avoid:** The `token_write_func` receives the full wrapped blob (always). Write the exact object received to `token_json`. The round-trip contract test catches this: write, read, compare.

**Warning signs:** Sidecar crashes at startup with "The token format has changed since this token was created. Please delete it and create a new one." Log message at startup.

### Pitfall 2: Pooler Connection for Advisory Lock

**What goes wrong:** The sidecar acquires the lock, processes a request, PgBouncer returns the connection to the pool between requests, and the lock is silently released. A second instance then acquires it successfully — dual-session invariant broken.

**Why it happens:** Using `DATABASE_POOL_URL` (port 6543, transaction mode) for the advisory lock connection. PgBouncer resets the session state (including advisory locks) when the connection is returned to the pool.

**How to avoid:** Always use `DATABASE_URL` (direct connection, port 5432) for the advisory lock connection. Document this explicitly in `advisory_lock.py`.

**Warning signs:** Two sidecar instances running simultaneously with no error in either.

### Pitfall 3: `refresh_issued_at` Reset on Token Rotation

**What goes wrong:** The 7-day refresh-token TTL clock is reset to "now" every time schwab-py refreshes the access token (every ~30 min). The token appears perpetually fresh; AUTH_EXPIRED never fires; users never know they need to re-dance.

**Why it happens:** `token_write_func` updates `refresh_issued_at = now` on every write (confusing access-token issuance with refresh-token issuance).

**How to avoid:** `token_write_func` ONLY updates `issued_at` and `expires_at` on rotation. `refresh_issued_at` is set once during the initial OAuth dance and must not be touched afterward. The column reflects when the refresh token was issued, not when the access token was last rotated.

**Warning signs:** `GET /api/status` always shows `refreshIssuedAt` = current time; `status` never transitions to `AUTH_EXPIRED`.

### Pitfall 4: Dual-Refresher Window During Cutover

**What goes wrong:** The TS `refresh-tokens` job is left active while the sidecar starts refreshing. Both write to `broker_tokens` simultaneously. Schwab invalidates the old refresh token on each refresh — whichever process loses the race gets `invalid_grant` on the next call.

**Why it happens:** Incomplete cutover sequence — sidecar deployed before `refresh-tokens` removed.

**How to avoid:** Hard-cut release order (D-06): (1) remove `refresh-tokens` from `schedule.ts` + `AllHandlers`; (2) deploy worker with job retired; (3) deploy sidecar. Verify `GET /api/status` no longer lists `refresh-tokens` in `lastJobRuns` before confirming go-live (SC2).

**Warning signs:** `invalid_grant` errors appearing in either the sidecar logs or the TS worker logs within 30 minutes of sidecar startup.

### Pitfall 5: Sidecar Port Binding IPv4-only

**What goes wrong:** `apps/server` cannot reach the sidecar via private network — connection refused.

**Why it happens:** `uvicorn ... --host 0.0.0.0` binds IPv4 only. Railway private network uses IPv6 in legacy environments (before Oct 2025). Connection to `sidecar.railway.internal` resolves to an IPv6 address, but nothing is listening.

**How to avoid:** Bind to `::` (all interfaces, IPv4+IPv6): `uvicorn main:app --host :: --port $PORT`. The Railway FastAPI guide [CITED: docs.railway.com/guides/fastapi] uses `--bind ::`.

**Warning signs:** `apps/server` logs show connection refused or DNS resolution to IPv6 address with ECONNREFUSED.

### Pitfall 6: CBOE Fallback Triggered on Sidecar Transient Errors

**What goes wrong:** Chain-snapshot falls back to CBOE on a momentary sidecar blip (e.g. rolling deploy), masking the issue.

**Why it happens:** The sidecar adapter maps network errors to `AUTH_EXPIRED` fetch-error message, and `selectChainSource` sees AUTH_EXPIRED in the token freshness → routes to CBOE.

**How to avoid:** `selectChainSource` routes to CBOE only based on `readTokenFreshness()` result, not on the adapter's fetch result. Network errors from the sidecar adapter will propagate as `err({ kind: "fetch-error" })` — the job handler should log them visibly. CBOE fallback activates only when the market token's freshness status is AUTH_EXPIRED. This is the correct behavior — sidecar transient errors should fail the job, not silently fall back.

---

## Code Examples

### schedule.ts Retirement Diff

```typescript
// BEFORE (apps/worker/src/schedule.ts):
export type AllHandlers = {
  ...
  readonly refreshTokens: PgBossHandler;  // REMOVE
  ...
};

// BEFORE Phase 1 createQueue:
await boss.createQueue("refresh-tokens");  // REMOVE

// BEFORE Phase 2 schedule:
await boss.schedule("refresh-tokens", "0 4 * * *", null, { tz: "America/New_York" }); // REMOVE

// BEFORE Phase 3 work:
await boss.work("refresh-tokens", POLLING_INTERVAL, handlers.refreshTokens);  // REMOVE

// AFTER: 9 queues, 5 crons, 9 handlers
```

The schedule.test.ts expectations update:
- `ALL_10_QUEUES` constant → `ALL_9_QUEUES` (remove `"refresh-tokens"`)
- Test "schedule called for exactly 6 jobs" → "exactly 5 jobs"
- Test "refresh-tokens cron is..." → remove entirely
- Test "calls work() for all 10 queues" → 9 queues

### SidecarChainAdapter (new file in packages/adapters/src/sidecar/)

```typescript
// Source: mirrors makeSchwabChainAdapter pattern [CITED: packages/adapters/src/schwab/market/chain-adapter.ts]
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

export function makeSidecarChainAdapter(deps: {
  fetch: typeof globalThis.fetch;
  sidecarUrl: string;  // e.g. "http://sidecar.railway.internal:8000"
}): { fetchChain: ForFetchingChain } {
  const fetchChain: ForFetchingChain = async (root) => {
    let rawBody: unknown;
    try {
      const resp = await deps.fetch(
        `${deps.sidecarUrl}/sidecar/chain?root=${root}`
      );
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

### worker/main.ts swap (diff only)

```typescript
// REMOVE:
// makeSchwabChainAdapter, makeSchwabOAuthClient, marketGetAccessToken,
// schwabMarketAdapter, makeRefreshTokenUseCase, makeRefreshTokensUseCase,
// makeRefreshTokensHandler, traderOAuthClient, marketOAuthClient

// ADD:
import { makeSidecarChainAdapter } from "@morai/adapters";

const sidecarAdapter = makeSidecarChainAdapter({
  fetch: globalThis.fetch,
  sidecarUrl: config.SIDECAR_URL,  // "http://sidecar.railway.internal:8000"
});

// selectChainSource wiring unchanged — sidecarAdapter.fetchChain replaces schwabMarketAdapter.fetchChain
const fetchChainUseCase = makeFetchChainUseCase({
  fetchChain: (root) =>
    selectChainSource({
      readTokenFreshness: brokerTokensRepo.readTokenFreshness,
      schwabFetchChain: sidecarAdapter.fetchChain,  // ← changed
      cboeFetchChain: cboeAdapter.fetchChain,
    }).then((fetchChain) => fetchChain(root)),
  ...
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TS OAuth client + `refresh-tokens` job owns token rotation | schwab-py sidecar as sole authenticator | Phase 11 | Eliminates dual-refresher rotating-token race; enables future streaming |
| Direct Schwab REST calls from worker for chain data | Sidecar REST proxy for chain, CBOE fallback | Phase 11 | Clean separation; CBOE fallback provides continuity during 7-day re-auth gap |
| TS streamer (deferred) | Python schwab-py sidecar streamer (Phase 12) | D17 lifted | schwab-py handles asyncio WebSocket protocol natively |

**Deprecated/outdated:**
- `makeSchwabOAuthClient()` adapter: retired by D16 supersession; remove from `packages/adapters/` export index in Phase 11.
- `makeRefreshTokensHandler`: remove from worker handlers.
- `traderOAuthClient` / `marketOAuthClient` construction in `apps/worker/src/main.ts`: remove.

---

## Runtime State Inventory

This is NOT a rename/refactor phase, but it involves retiring a live scheduled job. The following runtime state must be addressed:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `broker_tokens` has 2 rows (trader + market) with `access_token`/`refresh_token` encrypted — sidecar will read these at startup | Additive migration adds `token_json` column; initial value is NULL until first sidecar startup + OAuth dance seeds it |
| Live service config | `refresh-tokens` pg-boss scheduled job registered in the pg-boss schema tables | Removing `boss.schedule("refresh-tokens", ...)` from `schedule.ts` causes pg-boss to NOT recreate it on next boot. Existing scheduled rows may linger in pg-boss's `schedule` table. Safe: pg-boss will not fire them if the corresponding `work()` handler is also removed. |
| OS-registered state | None — jobs live in Postgres, not OS cron | None |
| Secrets/env vars | New env vars needed: `SCHWAB_MARKET_APP_KEY`, `SCHWAB_MARKET_APP_SECRET`, `SCHWAB_TRADER_APP_KEY`, `SCHWAB_TRADER_APP_SECRET`, `DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `SIDECAR_URL` (for server/worker to reach sidecar) | Add to Railway sidecar service env; add `SIDECAR_URL` to server + worker Railway env |
| Build artifacts | Sidecar is a new Python service with its own `Dockerfile` — no prior artifacts | None |

**Dead prod token (D-03):** The current prod `broker_tokens` rows have expired refresh tokens (Phase 8-9 deploy lesson from MEMORY.md). The sidecar's `token_read_func` will return the existing (stale) token blob, schwab-py will attempt to refresh, and it will fail with `invalid_grant`. The deploy runbook must include: after sidecar starts, run `client_from_manual_flow` via an admin CLI to mint fresh tokens → write to Postgres → sidecar's auto-refresh takes over.

---

## Open Questions

1. **pg-boss lingering schedule table entry for `refresh-tokens`**
   - What we know: pg-boss stores schedules in its own `schedule` table. Removing `boss.schedule("refresh-tokens", ...)` prevents re-registration, but the old row may persist.
   - What's unclear: Does pg-boss fire a schedule whose handler has been deregistered via `boss.work()` removal?
   - Recommendation: After worker redeploy, verify `SELECT count(*) FROM pgboss.schedule WHERE name = 'refresh-tokens'` = 0 (pg-boss cleans up on restart when the `createQueue` is also removed). If not, manually `DELETE FROM pgboss.schedule WHERE name = 'refresh-tokens'`. Also remove `createQueue("refresh-tokens")` from `schedule.ts`.

2. **Initial sidecar token seed — `token_json` column is NULL at first deploy**
   - What we know: The sidecar's `token_read_func` will find `token_json = NULL`, causing `client_from_access_functions` to fail with "No token found".
   - What's unclear: Does the sidecar health endpoint need to handle the pre-seed state gracefully (return `tokenFreshness: "not_seeded"` rather than crashing)?
   - Recommendation: The lifespan should catch the "No token found" exception from `token_read_func`, log a clear error ("Sidecar: token not seeded — run the manual OAuth dance"), and set a flag in `app.state`. `/sidecar/health` returns `{ status: "degraded", tokenFreshness: "not_seeded" }`. The sidecar stays up; chain requests return 503.

3. **Schwab 500-symbol streamer cap confirmation**
   - What we know: D17 lifted for legs-only streaming (Phase 12). Advisory lock sized for one session.
   - What's unclear: The exact cap — developer portal documentation may have updated.
   - Recommendation: Confirm during Phase 12 infra setup. Phase 11 advisory lock design is independent of the cap (it guards any single session).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.11+ | sidecar Dockerfile | ✓ (Docker image) | 3.11-slim | — |
| Postgres (Supabase) | advisory lock, token store | ✓ | 16 | — |
| Railway CLI | sidecar Railway service creation | ✓ | (installed per MEMORY) | railway.com UI |
| `schwab-py` | sidecar core | PyPI | 1.5.1 | — |
| `DATABASE_URL` (direct) | advisory lock connection | ✓ (Phase 1 deploy) | — | No fallback — required |
| `SIDECAR_URL` env var | server + worker → sidecar routing | ✗ (not yet set) | — | Must be added to Railway server + worker env |

**Missing dependencies with no fallback:**
- `SIDECAR_URL` must be added to Railway `apps/server` and `apps/worker` environment before go-live.

**Missing dependencies with fallback:**
- None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (TS) + pytest (Python) |
| Config file | `vitest.workspace.ts` (existing) / `apps/sidecar/pytest.ini` (Wave 0 gap) |
| Quick run command (TS) | `bun run test --reporter=verbose apps/worker` |
| Quick run command (Python) | `cd apps/sidecar && pytest -x -q` |
| Full suite command | `bun run test` + `cd apps/sidecar && pytest` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GW-01 | Token round-trip: write blob → read → assert identical | contract/integration | `pytest tests/test_token_store.py -x` | ❌ Wave 0 |
| GW-01 | `refresh_issued_at` NOT updated during access-token rotation | unit | `pytest tests/test_token_store.py::test_refresh_issued_at_unchanged -x` | ❌ Wave 0 |
| GW-02 | `/sidecar/chain` returns schema-valid RawChain shape | contract | `pytest tests/test_chain_proxy.py -x` | ❌ Wave 0 |
| GW-02 | `/sidecar/chain` returns 503 + AUTH_EXPIRED when token expired | integration | `pytest tests/test_chain_proxy.py::test_auth_expired -x` | ❌ Wave 0 |
| GW-03 | `schedule.ts` does NOT register `refresh-tokens` queue/cron/handler | unit | `bun run test apps/worker/src/schedule.test.ts` | ✅ (needs update) |
| GW-03 | `GET /api/status` does NOT list `refresh-tokens` in lastJobRuns | integration | manual verify at deploy | — |
| GW-04 | Second sidecar instance fails to acquire lock + logs clear error | integration | `pytest tests/test_advisory_lock.py::test_second_instance_fails -x` | ❌ Wave 0 |
| GW-04 | First instance acquires lock successfully | unit | `pytest tests/test_advisory_lock.py::test_first_instance_acquires -x` | ❌ Wave 0 |
| GW-05 | Sidecar has no public domain (Railway config) | manual | Railway dashboard verification | — |
| JRNL-02 | TS sidecar adapter Zod-parses sidecar chain response correctly | unit | `bun run test packages/adapters/src/sidecar/chain-adapter.test.ts` | ❌ Wave 0 |
| JRNL-02 | CBOE fallback: selectChainSource routes to CBOE when token is AUTH_EXPIRED | unit | `bun run test packages/core/src/brokerage/application/selectChainSource.test.ts` | ✅ (existing) |
| JRNL-02 | `leg_observations` gains rows with `source = 'cboe'` during AUTH_EXPIRED | regression | `bun run test` integration suite | ✅ (existing pattern) |

### Sampling Rate

- **Per task commit:** `bun run test apps/worker/src/schedule.test.ts` (TS) + `pytest tests/ -x -q` (Python)
- **Per wave merge:** `bun run test` + `cd apps/sidecar && pytest`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `apps/sidecar/pytest.ini` — pytest config for Python CI lane
- [ ] `apps/sidecar/tests/__init__.py`
- [ ] `apps/sidecar/tests/test_token_store.py` — round-trip contract test (GW-01)
- [ ] `apps/sidecar/tests/test_advisory_lock.py` — two-instance lock test (GW-04)
- [ ] `apps/sidecar/tests/test_chain_proxy.py` — chain endpoint contract test (GW-02)
- [ ] `packages/adapters/src/sidecar/chain-adapter.test.ts` — TS adapter Zod parse test (JRNL-02)
- [ ] Update `apps/worker/src/schedule.test.ts` — remove `refresh-tokens` expectations

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1`

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | schwab-py handles Schwab OAuth; Supabase JWT at `apps/server` edge (D20) |
| V3 Session Management | yes | Advisory lock + schwab-py session; no new user sessions in sidecar |
| V4 Access Control | yes | GW-05: sidecar unreachable from internet; Railway private network |
| V5 Input Validation | yes | Python: Pydantic response models; TS: Zod `safeParse` at sidecar adapter boundary (D-08) |
| V6 Cryptography | yes | `TOKEN_ENCRYPTION_KEY` passed as bound parameter to pgp_sym_encrypt — never logged, never in SQL string interpolation (D-03 rule applied to Python side too) |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token value logged in sidecar | Information Disclosure | `token_write_func` logs only `app_id` and `issued_at` — never token values (matching TS T-04-04 rule) |
| Sidecar endpoint publicly reachable | Elevation of Privilege | No public Railway domain assigned (GW-05); Railway private network is the only ingress |
| SQL injection in token write | Tampering | `TOKEN_ENCRYPTION_KEY` passed as `%s` bound parameter in psycopg2 `execute()` — never f-string or format string |
| Dual-writer token race | Tampering | GW-03 hard-cut retirement of TS `refresh-tokens` before sidecar activates |
| Advisory lock bypass | Spoofing | `pg_try_advisory_lock` non-blocking; `SystemExit(1)` on failure — no soft fallback |

---

## Project Constraints (from CLAUDE.md)

| Constraint | Impact on Phase 11 |
|------------|-------------------|
| **Dependencies point inward** — `core` imports only `shared` | New `SidecarChainAdapter` lives in `packages/adapters/src/sidecar/`, not `core`. No Python types cross into `core`. |
| **TDD red→green** — failing test before production code | Python/pytest lane: write failing tests for `test_token_store`, `test_advisory_lock`, `test_chain_proxy` before implementing `main.py`. TS lane: update `schedule.test.ts` first (add "does NOT schedule refresh-tokens"), watch it fail, then remove from `schedule.ts`. |
| **No `any`, no `as`, no `!`** | `SidecarChainAdapter` Zod schemas use `z.infer<>`, no type assertions. `safeParse` returns typed Result. |
| **Docs before architecture changes** | Phase 10 completed DOC-01 (D16/D17/D22 recorded in stack-decisions.md). No further docs-before-code gate for Phase 11. |
| **Hexagonal: in-memory twin for every driven port** | `makeSidecarChainAdapter` needs an in-memory twin in `packages/adapters/src/memory/`. Vitest uses the in-memory twin, not a live Python service. |
| **Zod at every external boundary** | The sidecar HTTP response is an external boundary — `SidecarChainResponseSchema.safeParse()` is mandatory (D-08). |
| **`process.env` read once at composition root** | `SIDECAR_URL` added to `apps/worker/src/config.ts` and `apps/server/src/config.ts`. Python sidecar reads env via `pydantic-settings` in `config.py`. |
| **Dockerfile-per-service Railway deploy** | `apps/sidecar/Dockerfile` required (Phase 1 deploy lesson). |
| **Session-pooler caveat** | Sidecar advisory lock uses `DATABASE_URL` (direct port 5432), not `DATABASE_POOL_URL`. This is documented in MEMORY.md and must be enforced in the sidecar's `config.py`. |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Two `client_from_access_functions` clients with distinct read/write callbacks in one process is clean and has no shared session-state interference | Standard Stack Pattern 2 | Could cause token callback cross-contamination if schwab-py has global state. Verify by testing with two clients against separate rows in pytest before production. |
| A2 | schwab-py inner token dict contains `access_token`, `refresh_token`, `expires_at`, `token_type`, `scope` as standard authlib OAuth2 fields | Pattern 1 token shape | If fields differ in v1.5.1, the `token_write_func` decomposition will fail to populate discrete columns. Mitigated by round-trip contract test. |
| A3 | Railway's `RAILWAY_PRIVATE_DOMAIN` auto-env var is set and resolves correctly for the sidecar service | Railway Private Networking | If not set, server/worker cannot reach sidecar. Confirm at infra setup step (as flagged in CONTEXT.md). |
| A4 | Removing `createQueue("refresh-tokens")` + `schedule(...)` + `work(...)` from schedule.ts causes pg-boss to clean up the existing schedule entry on next boot | Runtime State Inventory | If pg-boss retains the schedule, the job may fire with no handler. Mitigation: verify via SQL query post-deploy. |

---

## Sources

### Primary (MEDIUM confidence — official docs)
- [schwab-py auth.html](https://schwab-py.readthedocs.io/en/latest/auth.html) — `client_from_access_functions`, `client_from_manual_flow`, token opaque-JSON recommendation, multi-client warning
- [schwab-py auth.py source](https://raw.githubusercontent.com/alexgolec/schwab-py/main/schwab/auth.py) — `TokenMetadata` class, `wrap_token_in_metadata`, exact `{'creation_timestamp', 'token'}` blob shape
- [PostgreSQL explicit-locking docs](https://postgresql.org/docs/current/explicit-locking.html) — session vs transaction advisory lock semantics
- [Railway private networking](https://docs.railway.com/networking/private-networking/how-it-works) — `<service>.railway.internal` hostname pattern, private-only service configuration
- [Railway FastAPI guide](https://docs.railway.com/guides/fastapi) — `--bind ::` Dockerfile pattern
- [Railway variables reference](https://docs.railway.com/variables/reference) — `RAILWAY_PRIVATE_DOMAIN` env var

### Secondary (LOW confidence — web search synthesis)
- stack-decisions.md §D18 — Supabase pooler caveat (direct connection required for advisory locks) — project-internal source [VERIFIED: codebase]
- broker-tokens.ts + schema.ts — exact discrete column schema confirmed via codebase read [VERIFIED: codebase]
- schedule.ts + schedule.test.ts — exact queue/cron/handler structure confirmed via codebase read [VERIFIED: codebase]

### Tertiary (LOW confidence — ASSUMED)
- Two schwab-py clients per process behavior (A1 above)
- schwab-py inner token field names (A2 above)

---

## Metadata

**Confidence breakdown:**
- Standard stack (FastAPI, uvicorn, psycopg2): HIGH — industry standards confirmed on PyPI
- schwab-py token shape: MEDIUM — source code confirmed; inner field names inferred from authlib
- Architecture patterns: HIGH — derived from existing codebase patterns
- Railway private networking: MEDIUM — docs confirmed, specific env vars confirmed
- Advisory lock correctness: HIGH — PostgreSQL docs authoritative

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (stable stack; schwab-py pinned to 1.5.1)

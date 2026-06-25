---
phase: 11-sidecar-scaffold-auth-migration
reviewed: 2026-06-25T00:00:00Z
depth: standard
files_reviewed: 25
files_reviewed_list:
  - apps/sidecar/token_store.py
  - apps/sidecar/advisory_lock.py
  - apps/sidecar/main.py
  - apps/sidecar/config.py
  - apps/sidecar/chain_proxy.py
  - apps/sidecar/health.py
  - apps/sidecar/Dockerfile
  - apps/sidecar/requirements.txt
  - apps/sidecar/tests/conftest.py
  - apps/sidecar/tests/test_token_store.py
  - apps/sidecar/tests/test_advisory_lock.py
  - apps/sidecar/tests/test_chain_proxy.py
  - apps/sidecar/tests/test_health.py
  - apps/worker/src/config.ts
  - apps/worker/src/main.ts
  - apps/worker/src/schedule.ts
  - apps/worker/src/schedule.test.ts
  - packages/adapters/src/sidecar/chain-adapter.ts
  - packages/adapters/src/sidecar/chain-adapter.test.ts
  - packages/adapters/src/memory/sidecar-chain.ts
  - packages/adapters/src/memory/sidecar-chain.test.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql
  - railway.sidecar.toml
findings:
  critical: 4
  warning: 6
  info: 3
  total: 13
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-06-25
**Depth:** standard
**Files Reviewed:** 25
**Status:** issues_found

## Summary

Phase 11 migrates Schwab auth from a TS app to a Python schwab-py sidecar, retiring the
`refresh-tokens` TS job (GW-03) and introducing a dual-write path (GW-01). The overall
design is sound: advisory-lock guard, graceful not-seeded degradation, parameterized SQL
throughout, and no token values in logs or 503 bodies. The TS side (`chain-adapter.ts`,
`schedule.ts`) is clean and meets project rules strictly.

However four blockers require attention before this ships: a crash-masking bug in the
config error handler (the MRO iteration raises `AttributeError` before the real error
is reported); a lock-connection leak when an unexpected exception propagates during
client initialization; the Dockerfile hardcodes port 8000 instead of reading `$PORT`;
and the orphaned `refresh-tokens.ts` handler file is still on disk with live imports —
a dead-code landmine that will confuse future phases.

---

## Critical Issues

### CR-01: Config Error Handler Crashes Before Logging — Masks Real Startup Failure

**File:** `apps/sidecar/main.py:44-49`

**Issue:** The `except Exception` block in the config-parse guard iterates
`type(exc).__mro__` to extract field names. `__mro__` returns a tuple of *class
objects* (e.g. `(<class 'ValidationError'>, <class 'Exception'>, ...)`). These class
objects have no `.alias` or `.field_name` attributes. The list comprehension therefore
raises `AttributeError` before `logger.error()` is ever called, and this secondary
exception replaces the original `ValidationError` in the traceback. A deployment with
a missing env var produces a confusing `AttributeError: type object 'ValidationError'
has no attribute 'alias'` instead of the useful field-level message that was intended.
Verified: `python3 -c "class Foo(Exception): pass; [f.alias for f in type(Foo()).__mro__]"`
immediately raises `AttributeError`.

**Fix:**
```python
except Exception as exc:
    # pydantic-settings ValidationError exposes .errors() for field-level detail
    import pydantic_core
    if isinstance(exc, pydantic_core.ValidationError):
        field_names = [str(e["loc"]) for e in exc.errors()]
    else:
        field_names = [type(exc).__name__]
    logger.error(
        "sidecar: config validation failed — check env vars: %s",
        field_names,
    )
    raise
```

---

### CR-02: Advisory Lock Connection Leaked on Non-ValueError Exception During Client Init

**File:** `apps/sidecar/main.py:53,116-121`

**Issue:** `lock_conn` is acquired at line 53 (before the `try: yield` block). The
`try: yield ... finally: lock_conn.close()` at lines 116-121 only protects against
exceptions that occur *at or after* the `yield`. If an unexpected exception (anything
other than `ValueError`) propagates from the `schwab.auth.client_from_access_functions`
calls at lines 71 or 89 — for example a `TypeError`, `AttributeError`, or network error
from the schwab-py library — execution never reaches `try: yield`, so `lock_conn.close()`
is never called. The advisory lock is held until Postgres detects the dead connection,
but GC timing is non-deterministic and a rapid restart will find the lock still held,
causing the new instance to fail with `SystemExit(1)`. This turns a transient init
failure into a permanent start-loop failure until the DB connection times out.

**Fix:** Wrap everything after lock acquisition in a single outer `try/finally`:
```python
lock_conn = acquire_sidecar_lock(cfg.DATABASE_URL)
try:
    # ... all client init code ...
    app.state.trader_client = trader_client
    app.state.market_client = market_client
    app.state.degraded = market_client is None
    try:
        yield
    finally:
        pass  # inner finally is now just a placeholder; outer handles cleanup
finally:
    lock_conn.close()
    logger.info("sidecar: advisory lock released; shutdown complete")
```

---

### CR-03: Dockerfile CMD Hardcodes Port 8000 — Ignores Railway's `$PORT` Env Var

**File:** `apps/sidecar/Dockerfile:13`

**Issue:** The Dockerfile CMD is:
```
CMD ["uvicorn", "main:app", "--host", "::", "--port", "8000"]
```
The port is hardcoded to `8000`. Railway injects `$PORT` at deploy time and may assign a
different port value. When `$PORT != 8000`, the uvicorn process binds to `8000` while
Railway routes traffic to a different port — the service becomes unreachable even though
`/sidecar/health` never responds as expected. `railway.sidecar.toml` already documents
`SIDECAR_URL=http://${{sidecar.RAILWAY_PRIVATE_DOMAIN}}:${{sidecar.PORT}}`, relying on
Railway's `PORT` variable being honoured. The `main.py` `__main__` block correctly reads
`os.environ.get("PORT", "8000")` but the Docker `CMD` is what runs in production — the
`__main__` block is never reached.

**Fix:**
```dockerfile
CMD ["sh", "-c", "uvicorn main:app --host :: --port ${PORT:-8000}"]
```
This passes `$PORT` through the shell so Railway's value is respected.

---

### CR-04: Orphaned `refresh-tokens.ts` Handler Still on Disk — Dead Code With Live Imports

**File:** `apps/worker/src/handlers/refresh-tokens.ts`

**Issue:** GW-03 retired the `refresh-tokens` job. `schedule.ts` no longer registers the
queue/cron/handler, and `main.ts` contains no import or wiring for it. However
`apps/worker/src/handlers/refresh-tokens.ts` still exists on disk as a full 50+ line
handler with active imports (`@morai/core`, `@morai/shared`, `pg-boss`). This file:

1. Creates a false impression that the job still runs (confusing for the next phase).
2. Will be picked up by future editors who read the `handlers/` directory and assume all
   files in it correspond to registered jobs.
3. Imports live types (`RefreshTokensResult`, `ForRecordingRefreshOutcome`) — if either
   of those types is later removed as part of the auth retirement cleanup, this file
   will cause a TypeScript compile error that blocks the build, surfacing a "retired"
   job as a blocker.

The focus area explicitly calls this out as "note if it should be removed" — it should.

**Fix:** Delete `apps/worker/src/handlers/refresh-tokens.ts`. The GW-03 retirement
comment in `main.ts:331-334` and `schedule.ts:19` provides all necessary documentation
that the job was retired.

---

## Warnings

### WR-01: `token_write_func` Silently No-Ops When `app_id` Row Does Not Exist

**File:** `apps/sidecar/token_store.py:131-156`

**Issue:** The `UPDATE broker_tokens SET ... WHERE app_id = %s` statement executes
without checking `cursor.rowcount`. If the row for `app_id` does not exist (e.g., wrong
`app_id` passed, row accidentally deleted, or first-deploy state), psycopg2 commits
successfully with zero rows updated. The token write is silently lost; `token_read_func`
will subsequently raise `ValueError("No token found")` on the next read, causing the
client to re-enter the not-seeded degraded state despite the write appearing to succeed.
This is particularly dangerous during the OAuth dance (D-03) where a silent no-op
would silently discard the freshly-obtained token.

**Fix:**
```python
cur.execute("UPDATE broker_tokens SET ... WHERE app_id = %s", (..., app_id))
if cur.rowcount == 0:
    raise ValueError(
        f"token_write_func: no broker_tokens row for app_id={app_id!r} — "
        "row absent. Cannot write token. Run schema migration or seed the row."
    )
conn.commit()
```

---

### WR-02: `chain_proxy.py` Logs Full Exception Message — Potential Token Leakage in Logs

**File:** `apps/sidecar/chain_proxy.py:197-201, 211-215`

**Issue:** Both `except Exception` handlers log `exc` directly as the second `%s`
argument to `logger.error()`:
```python
logger.error(
    "chain proxy: get_option_chain failed — %s: %s",
    type(exc).__name__,
    exc,           # ← logs str(exc), which may include response body text
)
```
The comment at line 196 says "Log the error type without exposing token values", but
`str(exc)` is logged. schwab-py wraps HTTP errors via `httpx.HTTPStatusError`, whose
`str()` representation includes the response body. If the Schwab API returns a 401 with
a body containing token or credential detail (e.g. during an expired-token refresh
attempt), that detail would be written to the application log, which violates the
security constraint stated in the docstring (T-11-05-02) and in CLAUDE.md.

**Fix:** Log only the exception type, not its string representation:
```python
logger.error(
    "chain proxy: get_option_chain failed — %s (message redacted)",
    type(exc).__name__,
)
```

---

### WR-03: `health.py` Returns `status:'ok'` When Token Is `expired` or `unknown`

**File:** `apps/sidecar/health.py:101-104`

**Issue:** The health endpoint returns `{"status": "ok", "tokenFreshness": "expired"}`
and `{"status": "ok", "tokenFreshness": "unknown"}`. An expired token means the sidecar
will return 503 AUTH_EXPIRED on every chain request — this is a degraded state, not
`"ok"`. A monitoring system or health check consumer polling `/sidecar/health` and
expecting `status != "ok"` to mean degraded will miss this failure mode entirely.
`railway.sidecar.toml` uses `/sidecar/health` as the healthcheck path; Railway's
healthcheck only checks HTTP 2xx (which this always returns), so the Railway healthcheck
will never flip to unhealthy even when all chain requests are failing.

**Fix:**
```python
if freshness in ("not_seeded", "expired", "unknown"):
    return JSONResponse(
        content={"status": "degraded", "tokenFreshness": freshness}
    )
return JSONResponse(
    content={"status": "ok", "tokenFreshness": freshness}
)
```

---

### WR-04: `chain_proxy.py` `root` Parameter Is Unvalidated — Accepts Any String

**File:** `apps/sidecar/chain_proxy.py:155`

**Issue:** The route parameter is declared as `root: str = "SPX"` with no enum
validation. Any caller can pass `root=INVALID` or any arbitrary string. The value is
passed directly to `await client.get_option_chain(root)` without sanitization. For an
internal-only service (GW-05) the direct attack surface is low, but a misconfigured
caller (e.g., worker passing a bad `SIDECAR_URL` path) will receive a generic 503
`AUTH_EXPIRED` rather than a meaningful `400 Bad Request`, making debugging difficult
and the response semantically wrong (an unknown symbol is not an auth error).

The TS `SidecarChainResponseSchema` already restricts `root` to `z.enum(["SPX", "SPXW"])`,
and `ForFetchingChain` is typed `(root: "SPX" | "SPXW")`. The Python side should match.

**Fix:**
```python
from typing import Literal
@router.get("/sidecar/chain", response_model=ChainResponse)
async def get_chain(
    request: Request,
    root: Literal["SPX", "SPXW"] = "SPX",
    _test_auth_expired: bool = False,
) -> ChainResponse | JSONResponse:
```
FastAPI will automatically return 422 Unprocessable Entity for values outside the Literal.

---

### WR-05: `config.py` Module-Level `SidecarConfig()` Parse Runs at Import Time

**File:** `apps/sidecar/config.py:43`

**Issue:** `config = SidecarConfig()` at line 43 is executed whenever any file does
`import config` or `from config import ...`. This means any test or tool that imports
the module will fail with `ValidationError` if the required env vars (`DATABASE_URL`,
`TOKEN_ENCRYPTION_KEY`, etc.) are not set. `main.py` correctly avoids this by importing
`SidecarConfig` (not `config`) lazily inside the lifespan. However, the module-level
singleton is exported and could be accidentally imported by future developers who see
it in the module. If any future file does `from config import config`, it will fail in
CI unless all prod env vars are mocked.

The singleton is also never used anywhere in the current codebase — all callers import
`SidecarConfig` class directly or parse config inside the lifespan.

**Fix:** Remove the module-level singleton:
```python
# Remove line 43:
# config = SidecarConfig()
```
If a singleton is genuinely needed later, it can be added as a lazy-initialized
module-level variable with `_config: SidecarConfig | None = None`.

---

### WR-06: Test Fixture `_patch_app_state` Accepts `monkeypatch` But Never Uses It

**File:** `apps/sidecar/tests/conftest.py:168-197`

**Issue:** The `_patch_app_state` fixture signature accepts `monkeypatch:
pytest.MonkeyPatch` but then directly assigns to `app.state.*` attributes instead of
using `monkeypatch.setattr()`. The `monkeypatch` fixture registers teardown undo-hooks
when `setattr` is called; since those calls never happen, no cleanup occurs. The direct
assignments are only re-applied because the fixture is `autouse=True` (function-scoped)
and reruns before each test. If the fixture is ever changed to session or module scope,
or if the `autouse=True` is removed, the state won't be restored and tests will pollute
each other's `app.state`. This is a subtle maintenance trap.

**Fix:**
```python
@pytest.fixture(autouse=True)
def _patch_app_state(monkeypatch: pytest.MonkeyPatch) -> None:
    # Use monkeypatch.setattr so teardown restores the original values
    monkeypatch.setattr(app.state, "market_client", mock_market_client)
    monkeypatch.setattr(app.state, "degraded", False)
    monkeypatch.setattr(app.state, "db_url", _DB_URL)
    monkeypatch.setattr(app.state, "market_app_id", "market")
```

---

## Info

### IN-01: `token_write_func` Opens a New Connection Per Call — No Connection Reuse

**File:** `apps/sidecar/token_store.py:80, 129`

**Issue:** Both `token_read_func` and `token_write_func` call `psycopg2.connect(db_url)`
on each invocation and close it in `finally`. schwab-py calls the write callback on
every token rotation (~every 30 minutes). Each call incurs a new TCP connection +
Postgres handshake. This is not a correctness issue and is explicitly documented as
using the direct URL (not pool) for advisory lock compatibility. However, the connection
per call on the write path is unnecessary — `token_write_func` does not need a
session-level lock, so it could safely use a persistent connection or a small pool.
Flagged as info since this is an explicit constraint from the phase design (pool URL
prohibited) and the frequency is low enough to be harmless.

**Suggestion:** If connection overhead becomes visible in metrics, introduce a
module-level connection for the write callback that reconnects on failure.

---

### IN-02: `_is_auth_error` Heuristic in `chain_proxy.py` Is Unused

**File:** `apps/sidecar/chain_proxy.py:69-78`

**Issue:** The `_is_auth_error(exc: Exception) -> bool` function is defined at module
level but never called anywhere. The route handler catches all exceptions and returns
503 AUTH_EXPIRED unconditionally — there is no call site for `_is_auth_error`. The
function appears to be a leftover from a design iteration where auth failures were
distinguished from other errors.

**Fix:** Remove `_is_auth_error` (12 lines) to reduce dead code. If auth-specific
routing is needed in the future it can be reintroduced.

---

### IN-03: `apps/worker/src/handlers/refresh-tokens.ts` Imports From `@morai/core` — Will Break if Retirement Types Are Cleaned

**File:** `apps/worker/src/handlers/refresh-tokens.ts` (see also CR-04)

**Issue:** (Supporting detail for CR-04.) The file imports
`RefreshTokensResult`, `ForRecordingRefreshOutcome`, and `AppId` from `@morai/core`.
These types were introduced for the retired refresh flow. When Phase 11-07 or a
subsequent cleanup phase removes them from `@morai/core`, the TypeScript compiler will
fail to build the worker package due to this dead file's unresolved imports. This turns
an info-level dead-file into a build-blocker on the next cleanup commit, which is why
CR-04 escalates it.

**Fix:** Delete `apps/worker/src/handlers/refresh-tokens.ts` (addressed in CR-04).

---

_Reviewed: 2026-06-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

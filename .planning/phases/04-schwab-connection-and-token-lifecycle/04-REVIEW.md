---
phase: 04-schwab-connection-and-token-lifecycle
reviewed: 2026-08-31T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - src/morai/vendor/connections.py
  - src/morai/vendor/protocol.py
  - src/morai/vendor/schwab_adapter.py
  - src/morai/vendor/__init__.py
  - src/morai/api/models_connections.py
  - src/morai/api/routes_connections.py
  - src/morai/api/app.py
  - src/morai/db/models.py
  - src/morai/identity/account.py
  - src/morai/identity/setup_tokens.py
  - src/morai/settings.py
  - alembic/versions/0010_schwab_connections.py
  - typings/schwab/__init__.pyi
  - typings/schwab/auth.pyi
  - typings/schwab/client.pyi
  - tests/vendor/conftest.py
  - tests/vendor/test_oauth_flow.py
  - tests/vendor/test_reauth.py
  - tests/vendor/test_refresh_lock.py
  - tests/vendor/test_health.py
  - tests/vendor/test_tracer_connect.py
  - tests/gate/test_vendor_boundary.py
  - tests/gate/test_type_gate.py
  - tests/gate/fixtures/violation_schwab_json_boundary.py
  - .railway/railway.ts
  - pyproject.toml
findings:
  critical: 2
  warning: 1
  info: 0
  total: 3
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-08-31
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

The Schwab OAuth handshake, encrypted-token storage, per-user refresh lock and
`derive_connection_health` are implemented carefully and match the project's own
stated invariants. The token-write landmine (an `async def` closure silently
discarded by `schwab-py`'s un-awaited `token_write_func`) is correctly avoided —
`TokenHolder.write` and `_capture_token` are both plain `def`, exactly as
documented. The CSRF `state` is consumed by one atomic `DELETE ... RETURNING`
(`setup_tokens.consume_token`), the refresh lock genuinely derives its key from
`hashtext(user_id)` and is proven per-user by test, `schwab_adapter.py` is the
sole importer of `schwab` (enforced by a gate test), and the two permanently-null
columns (`last_synced_at`, `reauth_notified_at`) are honest gaps, not fabricated
values. `schwab_connections` is granted `SELECT` (unlike `fills`/`events`), so the
ORM-insert-triggers-`RETURNING`-under-RLS trap (`V092`) does not apply here.

Two things found are, in the reviewer's judgment, blockers: a deployment
configuration gap that will silently strip the three Schwab credentials on the
next `railway config apply`, and a log-leak path for the OAuth code/state/URL
that the module's own stated design principle (avoid `exc_info` on a handler that
can render suppressed input) is not applied to the one handler most likely to
catch a vendor-raised exception carrying those values. One warning: a same-user
concurrent-first-connect race in `upsert_connection` that isn't covered by any
lock or `ON CONFLICT` clause.

## Critical Issues

### CR-01: The three Schwab credentials are absent from the Railway IaC file, so the next `railway config apply` will silently strip them

**File:** `.railway/railway.ts:27-49`
**Issue:** `Settings.schwab_credentials` requires `schwab_api_key`, `schwab_app_secret`
and `schwab_callback_url` (`src/morai/settings.py:72-105`) — `SchwabAuthAdapter`
raises a `RuntimeError` if any is missing, and `/schwab/connect`/`/schwab/callback`
depend on it via `get_schwab_auth()`. The `web` service's `env` block in
`railway.ts` declares only `DATABASE_URL`, `MORAI_APP_DB_PASSWORD` and
`MORAI_MASTER_KEY` with `preserve()`. It does not mention
`SCHWAB_API_KEY`/`SCHWAB_APP_SECRET`/`SCHWAB_CALLBACK_URL` at all.

The file's own comment on the two secrets it does declare states the exact
mechanism this misses: *"`preserve()` keeps whatever is already set in Railway
... Without these two lines a `railway config apply` would strip both, and the
failure would present as a healthcheck timeout rather than as missing
configuration."* The same mechanism applies to the three Schwab variables, which
this phase introduces as required runtime configuration, but the file was never
updated to declare or preserve them.

Because `Settings.schwab_api_key`/`schwab_app_secret`/`schwab_callback_url` are
`Optional` on the model (deliberately, so Alembic and the worker don't die over a
variable they never read — `settings.py:65-71`), the app will still boot and pass
its healthcheck with these variables stripped. The failure surfaces later and
silently, as a 500 on the first real user's "Connect Schwab" click — worse than a
healthcheck timeout because nothing in the deploy pipeline flags it.

**Fix:**
```ts
const web = service("web", {
  source: github(REPO, { rootDirectory: "." }),
  start: 'alembic upgrade head && hypercorn --bind "[::]:$PORT" morai.api.app:app',
  healthcheck: "/health",
  env: {
    DATABASE_URL: Postgres.env.DATABASE_URL,
    MORAI_APP_DB_PASSWORD: preserve(),
    MORAI_MASTER_KEY: preserve(),
    // Phase 4: required by SchwabAuthAdapter (settings.schwab_credentials).
    // Without these, /schwab/connect and /schwab/callback 500 lazily on the
    // next railway config apply -- see the MORAI_MASTER_KEY comment above
    // for why this needs preserve() rather than a literal value here.
    SCHWAB_API_KEY: preserve(),
    SCHWAB_APP_SECRET: preserve(),
    SCHWAB_CALLBACK_URL: preserve(),
  },
});
```

### CR-02: The catch-all exception handler logs `exc_info`, which can re-render the OAuth code/state/URL the callback route exists to protect

**File:** `src/morai/api/errors.py:169-177`
**Issue:** `unhandled_exception_handler` is registered for the bare `Exception`
class (`install_error_handling`, `errors.py:186-187`) and is what actually catches
whatever `SchwabAuthAdapter.exchange_callback` raises when the real vendor
exchange fails — `schwab.auth.client_from_received_url` (via `authlib`) is called
directly with `received_url` (the full callback URL, code and state included) at
`schwab_adapter.py:152-160`, with no `try`/`except` around it in
`routes_connections.callback`.

```python
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = _current_request_id()
    logger.error("unhandled exception request_id=%s", request_id, exc_info=exc)
    ...
```

`exc_info=exc` causes the standard-library `logging` formatter to render the full
traceback, whose last line is `str(exc)` — the exception's own message. This
module's own docstring states the precise risk and the mitigation for the
*sibling* handler: *"`exc_info` is omitted on that handler for the same reason: a
formatted traceback ends with `str(exc)`, which re-renders the very inputs being
suppressed."* (`errors.py:12-15`, applied to
`response_validation_exception_handler`, which indeed omits `exc_info` at
`errors.py:153-158`). That same reasoning is not applied to
`unhandled_exception_handler` — the one handler that will actually receive a
vendor-library exception from the OAuth exchange, the single highest-value target
in the file for `NN-34`.

`tests/vendor/test_tracer_connect.py::test_no_log_record_or_response_body_contains_the_code_url_or_state`
does not close this gap: it drives the 500 path with a synthetic
`RuntimeError("exchange failed -- proving the opaque-500 path leaks nothing")`
(`test_tracer_connect.py:254-256`), a message the test author controls and which
deliberately contains none of the three secrets. It proves the response body and
the direct log call are clean for *that* message; it does not prove anything about
what `authlib`/`httpx` actually put in `str(exc)` for a real token-exchange
failure (e.g. an `httpx.HTTPStatusError` or `authlib.OAuth2Error`, whose message
shapes are not controlled by this codebase and were not verified against the real
wheel for this property).

**Fix:** Either omit `exc_info` on this handler the same way the sibling handler
does (losing the traceback is the same trade this codebase already made once), or
redact before logging — e.g. log `type(exc).__name__` and
`traceback.extract_tb(exc.__traceback__)` (file/line/function only, the same
shape `telemetry.capture_exception` already uses) instead of the formatted
`exc_info`:
```python
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = _current_request_id()
    logger.error(
        "unhandled exception request_id=%s type=%s",
        request_id, type(exc).__name__, exc_info=False,
    )
    capture_exception(exc, request_id=request_id, context={"path": request.url.path})
    return _opaque_500(request_id)
```

## Warnings

### WR-01: `upsert_connection` has no protection against two concurrent first-time connects of the same user

**File:** `src/morai/vendor/connections.py:248-276`
**Issue:** `upsert_connection` runs `UPDATE ... WHERE user_id = :uid`, and only
falls back to `INSERT` when `result.rowcount == 0` (a deliberate choice over
`ON CONFLICT DO UPDATE`, per the module's own docstring). If a user has two
`OAUTH_STATE` tokens in flight at once (e.g. two browser tabs, both completing
their callbacks nearly simultaneously) and has never connected before, both
callbacks' `UPDATE` statements can each affect 0 rows, and both then attempt
`session.add(SchwabConnection(user_id=user_id, ...))` — a duplicate-primary-key
`INSERT` for the same `user_id`. One raises `IntegrityError` on flush.

Unlike the cross-user race (proven safe by
`test_oauth_flow.py::test_two_overlapping_callbacks_each_land_their_own_users_row`)
and the identical-`state`-replay race (guarded by `consume_token`'s atomic
`DELETE ... RETURNING`), this same-user/different-`state` race is not exercised by
any test in this phase and is not guarded by the per-user advisory lock — that
lock (`schwab_client_for_user`, `connections.py:331-417`) wraps only the refresh
path (CONN-06), not the initial-connect/`upsert_connection` path. The
`IntegrityError` is unhandled and propagates to `unhandled_exception_handler`,
surfacing as an opaque 500 to whichever request loses the race — not data
corruption (the other user's row is unaffected, `user_id` is the PK), but an
avoidable failure for a plausible real usage pattern (double-tab connect).

**Fix:** Wrap `upsert_connection`'s body in the same per-user advisory lock
`schwab_client_for_user` already uses, or catch the `IntegrityError` from the
`INSERT` fallback and retry as an `UPDATE`:
```python
result = await session.execute(update(SchwabConnection)...)
if not isinstance(result, CursorResult) or result.rowcount == 0:
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:uid))"), {"uid": str(user_id)}
    )
    # re-check under the lock before falling back to INSERT
    ...
```

---

_Reviewed: 2026-08-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

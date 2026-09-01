---
phase: 04-schwab-connection-and-token-lifecycle
fixed_at: 2026-08-31T00:00:00Z
review_path: .planning/phases/04-schwab-connection-and-token-lifecycle/04-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-08-31
**Source review:** `.planning/phases/04-schwab-connection-and-token-lifecycle/04-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, CR-02, WR-01)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: The three Schwab credentials were absent from the Railway IaC file

**Files modified:** `.railway/railway.ts`
**Commit:** `96eb8c4`
**Applied fix:** Declared `SCHWAB_API_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_CALLBACK_URL` with
`preserve()` in the `web` service's `env` block, alongside the existing two secrets, with a
comment in the same style explaining the risk (silent strip on the next `railway config apply`,
surfacing as a lazy 500 on the first `/schwab/connect` rather than a healthcheck timeout). No test
ceremony — static IaC config is exempt under `.claude/rules/tdd.md`'s own scope ("pure wiring in
composition roots, static config"). No TypeScript checker was available in this repo (no
`tsconfig.json`/`package.json`), so verification was Tier 1 only: re-read, balanced structure,
matches the file's existing `preserve()` pattern exactly.

### CR-02: `unhandled_exception_handler` logged `exc_info=exc`, re-rendering a real vendor exception's message

**Files modified:** `src/morai/api/errors.py`, `tests/vendor/test_tracer_connect.py`,
`tests/gate/test_api_boundary.py`
**Commits:** `44ff18e` (RED), `52b82c1` (fix), `7ef27fa` (fallout — see below)
**Applied fix:** Removed `exc_info=exc` from the one `logger.error(...)` call in
`unhandled_exception_handler`; it now logs `type(exc).__name__` alongside the request id instead.
Extended the module docstring to state both handlers now omit `exc_info`, and why —
`unhandled_exception_handler` is the one that actually catches a real vendor exception out of
`SchwabAuthAdapter.exchange_callback`, where `str(exc)` (e.g. `httpx.HTTPStatusError`) is not under
this codebase's control and can embed the OAuth code/URL.

**RED evidence (before the fix), confirmed failing for the right reason:**
```
E       AssertionError: assert 'FAKE-AUTH-C...-LEAK-9f3d2a' not in 'unhandled e...P/Status/400'
E
E         'FAKE-AUTH-CODE-MUST-NEVER-LEAK-9f3d2a' is contained here:
E           oken?code=FAKE-AUTH-CODE-MUST-NEVER-LEAK-9f3d2a&grant_type=authorization_code'
E           For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/400
```
The test raises a real `httpx.HTTPStatusError` (built via `Response.raise_for_status()` on a 400
whose request URL embeds a fake authorization code, `test_no_log_record_contains_the_code_from_a_
real_vendor_exception_shape`) — a genuinely vendor-shaped message, not an author-controlled string,
per the review's own explicit critique of the pre-existing negative test.

**GREEN evidence (after the fix):**
```
tests/vendor/test_tracer_connect.py ........                                 [100%]
8 passed
```

**CR-02 fallout, discovered by the full-suite run and fixed in the same pass (`7ef27fa`):**
Two pre-existing issues surfaced once the fix was in place, both necessary corollaries of the fix
rather than scope creep, both fixed in the same commit:
1. `tests/gate/test_api_boundary.py::test_unhandled_exception_logs_full_detail_keyed_by_request_id`
   asserted `any(r.exc_info for r in matching)` — "log line must carry the traceback." That
   assertion *was* the CR-02 leak, encoded as a requirement. Renamed to
   `test_unhandled_exception_logs_the_type_but_never_exc_info` and rewritten to assert the exception
   type is present in the log message and `exc_info` is never attached.
2. The new CR-02 test built its `httpx.HTTPStatusError` via a bare `try`/`except`, which
   basedpyright correctly flagged `vendor_exc` as possibly unbound (`reportPossiblyUnboundVariable`)
   — `raise_for_status()`'s return type doesn't prove to the type checker that it always raises on a
   400 status. Switched to `pytest.raises(...)`, which both guarantees binding and is the idiomatic
   form.

### WR-01: `upsert_connection` had no protection against two concurrent first-time connects of one user

**Files modified:** `src/morai/vendor/connections.py`, `tests/vendor/test_upsert_connection_race.py`
**Commits:** `696cc7d` (RED), `44098e8` (fix)
**Applied fix:** Collapsed the `UPDATE ... WHERE user_id = :uid` + fallback-`INSERT`-on-`rowcount==0`
into one `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_update(index_elements=[user_id],
set_=...)` statement — race-free by construction, per the review's own suggested fix. No
`.returning()` was added (per the finding's explicit caution re: `V092`), and the `CursorResult`
isinstance-narrowing import/guard the old code needed is gone, making the function smaller than the
one it replaces, not larger. Module docstring updated to describe the new mechanism and why (WR-01
citation included).

**RED evidence (before the fix), confirmed failing for the right reason:**
```
E                   sqlalchemy.exc.IntegrityError: (sqlalchemy.dialects.postgresql.asyncpg.IntegrityError) <class 'asyncpg.exceptions.UniqueViolationError'>: duplicate key value violates unique constraint "schwab_connections_pkey"
E                   [SQL: INSERT INTO schwab_connections (user_id, account_hash_ciphertext, ...) VALUES (...) RETURNING schwab_connections.created_at]
```
Two coroutines, each on its own engine/session/connection (the two-independent-engines shape already
established by `test_oauth_flow.py`/`test_refresh_lock.py`), fenced by an `asyncio.Barrier(2)`
awaited immediately before each calls `upsert_connection` for the same never-connected user — both
see `rowcount == 0` on the old `UPDATE`, both attempt the fallback `INSERT`, and the loser raises the
duplicate-key `IntegrityError` shown above.

**GREEN evidence (after the fix):**
```
tests/vendor/test_upsert_connection_race.py::test_two_concurrent_first_time_connects_of_one_user_land_exactly_one_row PASSED
1 passed in 0.25s
```
Neither call raises, and exactly one row survives.

**RLS regression check:** `schwab_connections`' `user_isolation` policy carries both `USING` and
`WITH CHECK` on `user_id` (migration `0010`), which `ON CONFLICT DO UPDATE` needs both of. Ran the
full `tests/vendor/` suite (30 tests, including `test_oauth_flow.py`'s re-auth-repairs-the-row test
and `test_reauth.py`) against the fix — all pass.

## Skipped Issues

None — all three in-scope findings were fixed.

## Investigation (not a fix): `capture_exception` and the `telemetry.py` path

Both `errors.py` handlers also call `capture_exception(exc, ...)`, forwarding the exception object to
PostHog. Investigated whether this is a second instance of CR-02's leak class. **Finding: no, it is
not.** Evidence, read directly from `src/morai/telemetry.py`:

- `capture_exception`'s own docstring states it explicitly: *"Does NOT send `str(exc)`, the
  exception's arguments, or any frame locals."*
- The actual `properties` dict it builds and sends contains only: `exception_type` (`type(exc)
  .__name__`), `exception_module`, `request_id`, `frame_count`, and `frames` — built from
  `traceback.extract_tb(exc.__traceback__)` and formatted as `"{filename}:{lineno} in {name}"` for
  each frame (file/line/function only, never the frame's locals or the exception message).
- Grepped the file directly (`grep -nF 'str(exc)' src/morai/telemetry.py`) — the only match is the
  docstring's own explanation of what it deliberately omits; no code path in the module calls
  `str(exc)`, `repr(exc)`, or reads `exc.args`.
- Both callers in `errors.py` pass `context={"path": request.url.path}` only — never the query
  string, which is where the OAuth code/state actually travels on the `/schwab/callback` GET.

`capture_exception` was already built to the same discipline CR-02 restores to the log call — it
predates the CR-02 bug and was not affected by it. No change made to `telemetry.py`, per the scope
boundary given.

## Verification

Full suite and gate, run after all three fixes and the CR-02 fallout fix, in this worktree:

```
283 passed, 36 warnings in 42.07s          # uv run pytest (baseline was 281; +2 new test files)
bash tools/gate.sh: exit 0                  # ruff clean, basedpyright 0 errors, mypy clean, 283 passed
```

No modifications were made to `STATE.md` or `ROADMAP.md`.

---

_Fixed: 2026-08-31_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

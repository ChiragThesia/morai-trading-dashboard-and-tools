---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
plan: 04
subsystem: auth
tags: [fastapi, psycopg2, schwab-py, asyncio, oauth, hmac]

requires:
  - phase: 37-01
    provides: reauth_nonces table (migration 0024)
  - phase: 37-03
    provides: "SIDECAR_ADMIN_TOKEN/SCHWAB_WEB_CALLBACK_URL config, make_reauth_writer, reinit_schwab_session, app.state.cfg"
provides:
  - "POST /sidecar/admin/reauth/start — mints a per-app Schwab authorize URL + persists a single-use nonce"
  - "POST /sidecar/admin/reauth/exchange — atomically consumes the nonce, exchanges off the event loop, anchors refresh, re-inits, returns {app, ok} gated on a live freshness re-check"
  - "hmac.compare_digest admin-token guard shared by both endpoints"
affects: [37-05, 37-07]

tech-stack:
  added: []
  patterns:
    - "Constant-time (hmac.compare_digest) shared-secret guard applied to both admin routes only — never health/chain/positions"
    - "Atomic single-use nonce via DELETE ... RETURNING app_id with a TTL predicate — no background sweep needed for correctness"
    - "Blocking schwab-py exchange call wrapped in loop.run_in_executor — never awaited directly in the async handler"
    - "Freshness re-check (refresh_issued_at within 5 minutes) as the actual success signal, decoupled from whether the exchange call raised"

key-files:
  created:
    - apps/sidecar/reauth_admin.py
    - apps/sidecar/tests/test_reauth_admin.py
  modified:
    - apps/sidecar/main.py
    - apps/sidecar/tests/conftest.py

key-decisions:
  - "reinit_schwab_session imported lazily inside reauth_exchange (not at reauth_admin.py's module top) to avoid a reauth_admin<->main circular import at module-load time — mirrors main.py's own lazy `from streamer import start_streamer` pattern. Verified empirically: importing main.py standalone registers all 5 routers (including reauth_admin_router) with no ImportError."
  - "reinit_schwab_session is called unconditionally after any exchange that raises no exception (regardless of the freshness re-check's result) — matches the plan's exact sequencing; only the response's `ok` flag is gated on freshness, not whether re-init runs."
  - "Task 1 and Task 2 were executed as two genuinely separate RED->GREEN cycles (not combined) so each task's own commit reflects a real, independently-verified green state matching the plan's per-task <verify> commands exactly."

requirements-completed: [REAUTH-01, REAUTH-02, REAUTH-03, REAUTH-04]

coverage:
  - id: T-37-03
    description: "Both admin endpoints reject any request whose X-Sidecar-Admin-Token does not constant-time-match cfg.SIDECAR_ADMIN_TOKEN (401), including a missing header"
    requirement: REAUTH-01
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthStart::test_bad_admin_token_returns_401_and_mints_nothing"
        status: pass
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthStart::test_missing_admin_token_returns_401"
        status: pass
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_bad_admin_token_returns_401"
        status: pass
    human_judgment: false
  - id: T-37-01a
    description: "/start mints an authUrl+nonce and persists the nonce to reauth_nonces (app_id=app) against real Postgres"
    requirement: REAUTH-01
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthStart::test_valid_request_mints_authurl_and_persists_nonce"
        status: pass
    human_judgment: false
  - id: T-37-01b
    description: "Nonce single-use + TTL: validate+consume exactly once via DELETE...RETURNING; a second consume of the same state fails; a row older than 10 minutes fails the TTL predicate"
    requirement: REAUTH-02
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthStart::test_nonce_single_use_and_ttl"
        status: pass
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_replay_of_consumed_state_fails"
        status: pass
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_unknown_state_rejected_generically"
        status: pass
    human_judgment: false
  - id: T-37-05a
    description: "/exchange consumes the nonce atomically, exchanges off the event loop via run_in_executor, anchors refresh_issued_at through make_reauth_writer, re-inits the session, and returns {app, ok:true} only when the post-exchange freshness re-check passes"
    requirement: REAUTH-03
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_successful_exchange_anchors_refresh_reinits_and_returns_ok_true"
        status: pass
    human_judgment: false
  - id: T-37-05b
    description: "A written-but-stale row (freshness gate fails even though the exchange raised nothing) returns ok:false — HTTP success alone is never the success signal; reinit still runs"
    requirement: REAUTH-03
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_ok_false_when_refresh_issued_at_not_freshly_anchored"
        status: pass
    human_judgment: false
  - id: T-37-02
    description: "An exchange exception returns {app, ok:false} with the nonce already consumed and no reinit call; the failure log carries only type(exc).__name__, never the code, redirect URL, or exception message"
    requirement: REAUTH-04
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_exchange_exception_returns_ok_false_and_never_logs_code_or_url"
        status: pass
    human_judgment: false
  - id: T-37-05c
    description: "Partial-failure isolation: a failed exchange for one app does not touch the other app's already-fresh broker_tokens row"
    requirement: REAUTH-04
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reauth_admin.py::TestReauthExchange::test_partial_failure_isolation_leaves_other_app_untouched"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-13
status: complete
---

# Phase 37 Plan 04: Sidecar Re-auth Admin Endpoints (start + exchange) Summary

**The sidecar gains `POST /sidecar/admin/reauth/start` (mints a per-app Schwab authorize URL + a single-use Postgres-backed CSRF nonce) and `POST /sidecar/admin/reauth/exchange` (atomically consumes the nonce, exchanges the redirect off the event loop, anchors `refresh_issued_at`, re-inits the Schwab session, and returns success gated on a live freshness re-check) — both behind a constant-time admin-token guard.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2/2 completed
- **Files created:** 2 (reauth_admin.py, tests/test_reauth_admin.py)
- **Files modified:** 2 (main.py, tests/conftest.py)
- **Sidecar test suite:** 73 -> 84 passed (11 new tests, all in test_reauth_admin.py)

## Accomplishments

- `reauth_admin.py` implements both admin endpoints exactly as specified: `/start` calls
  `schwab.auth.get_auth_context` (no network, no local server) and persists the returned nonce;
  `/exchange` does an atomic `DELETE ... RETURNING app_id` to validate+consume the nonce, wraps
  the blocking `schwab.auth.client_from_received_url` call in `loop.run_in_executor` so the
  event loop (and `/sidecar/health`) never stalls during the Schwab token-endpoint round trip,
  and gates its `{app, ok}` response on a live `refresh_issued_at` freshness re-check — never a
  bare "no exception happened" signal.
- The admin-token guard (`hmac.compare_digest`) is a single shared helper applied to both
  routes and only those routes — health/chain/positions remain ungated, matching GW-05's
  existing internal-only posture plus the new SIDECAR_ADMIN_TOKEN layer this phase adds.
- Closed the loop on 37-03's plumbing: `make_reauth_writer` (anchors `refresh_issued_at`) and
  `reinit_schwab_session` (cancels+recreates the keepalive/streamer tasks) are now actually
  *called* from a live endpoint, not just unit-proven in isolation.
- `reauth_admin_router` registered in `main.py` alongside the four existing sidecar routers.
- Full sidecar suite green throughout (84 passed at hand-off), including a standalone `import
  main` sanity check confirming the reauth_admin<->main lazy-import pattern never triggers a
  circular-import error.

## Task Commits

Each task was committed atomically, matching a real, independently-verified RED->GREEN cycle:

1. **Task 1: /start endpoint + admin-token guard + nonce persistence** - `e6dfca1` (feat)
   - `apps/sidecar/reauth_admin.py` (new, /start only), `apps/sidecar/tests/conftest.py`
     (+ reauth_nonces DDL + `read_nonce` fixture), `apps/sidecar/tests/test_reauth_admin.py`
     (new, `TestReauthStart` — 4 tests).
   - Verify: `pytest tests/test_reauth_admin.py -x -q` (4 passed) + `grep -q 'compare_digest'
     reauth_admin.py` + `grep -q 'reauth/start' reauth_admin.py` — all pass.
2. **Task 2: /exchange endpoint (consume + exchange + anchor + reinit) + register router** -
   `dceb565` (feat)
   - `apps/sidecar/reauth_admin.py` (+ /exchange), `apps/sidecar/main.py` (router registration),
     `apps/sidecar/tests/test_reauth_admin.py` (+ `TestReauthExchange` — 7 tests, 11 total).
   - Verify: `pytest tests/test_reauth_admin.py -x -q` (11 passed) + `grep -q 'run_in_executor'`
     + `grep -q 'RETURNING app_id'` + `grep -Eq "type\(exc\)\.__name__|__class__\.__name__"` +
     `grep -q 'reauth_admin_router' main.py` — all pass.

**Plan metadata:** this commit (docs: complete plan)

_Note: both tasks were RED-first (confirmed `ModuleNotFoundError`/`ImportError` for the
right reason before implementing), matching the intended per-task protocol exactly — no
combined RED+GREEN commits this time._

## Files Created/Modified

- `apps/sidecar/reauth_admin.py` (NEW) - `/start` + `/exchange` endpoints, `_require_admin_token`
  guard, `_app_credentials` (app_id -> key/secret lookup), `_consume_nonce` (atomic
  DELETE...RETURNING), `_is_freshly_anchored` (freshness re-check)
- `apps/sidecar/main.py` - `from reauth_admin import router as reauth_admin_router` +
  `app.include_router(reauth_admin_router)`
- `apps/sidecar/tests/conftest.py` - + `reauth_nonces` table DDL (session-scoped `_setup_db`
  fixture) + `read_nonce` fixture (callable(state) -> (app_id, created_at) | None)
- `apps/sidecar/tests/test_reauth_admin.py` (NEW) - `TestReauthStart` (4 tests) +
  `TestReauthExchange` (7 tests): bad/missing token 401s, nonce mint+persist, nonce
  single-use+TTL, successful exchange (anchor+reinit+ok:true), replay-kill, exception path
  (ok:false + log-safety via `caplog`), freshness-gate defensive test, partial-failure isolation

## Decisions Made

- **Lazy `from main import reinit_schwab_session` inside `reauth_exchange`** (not a top-level
  import in `reauth_admin.py`) — avoids a `reauth_admin`<->`main` circular import at
  module-load time. Verified this empirically both via the full test suite (which exercises
  `main.py`'s own router-registration import of `reauth_admin`) and a standalone `python -c
  "import main"` check confirming all 5 routers register with no `ImportError`.
- **`reinit_schwab_session` runs unconditionally after any raise-free exchange**, independent
  of the freshness re-check's outcome — only the response's `ok` field is gated on freshness.
  This matches the plan's action text exactly ("do the per-app freshness re-check ... AND
  await reinit_schwab_session ... Return {app: app_id, ok: <fresh>}").
- **Executed as two real, separate RED->GREEN cycles** (Task 1: `/start` only + its own test
  class; Task 2: extended the test file with `/exchange` tests, then implemented) rather than
  writing the whole file at once, so each task's commit independently satisfies the plan's own
  per-task `<verify>` command as written (including the `-x` fail-fast flag, which requires
  every test present in the file at that commit to pass).

## Deviations from Plan

None — plan executed exactly as written. Both tasks' automated `<verify>` commands passed
verbatim, including the exact grep patterns specified in the plan.

## Issues Encountered

- None. The sidecar test Postgres container (`morai-sidecar-test-pg`, port 5499) was already
  running from a prior session (37-03) — no setup needed.

## User Setup Required

None — no external service configuration required. `SIDECAR_ADMIN_TOKEN`/
`SCHWAB_WEB_CALLBACK_URL` Railway env vars remain unset until REAUTH-07's deploy step (37-07).

## Next Phase Readiness

Both admin endpoints are live, tested, and registered. 37-05 (server proxy routes) can now
forward `POST /api/reauth/start` and `POST /api/reauth/exchange` to
`SIDECAR_URL/sidecar/admin/reauth/{start,exchange}` with the `X-Sidecar-Admin-Token` header
attached. Full sidecar suite green (84 passed) at hand-off — no regressions in the parallel
37-02 (TS contracts/core/adapter) executor's territory, since this plan touched only
`apps/sidecar/*.py` + its own tests.

## Self-Check: PASSED

- FOUND: `apps/sidecar/reauth_admin.py`
- FOUND: `apps/sidecar/tests/test_reauth_admin.py`
- FOUND: `reauth_admin_router` registered in `apps/sidecar/main.py`
- FOUND commit `e6dfca1`
- FOUND commit `dceb565`

---
*Phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the*
*Completed: 2026-07-13*

---
phase: 02-identity-sessions-and-tenant-isolation
plan: 01
subsystem: database
tags: [postgres, row-level-security, sqlalchemy, alembic, fastapi, asyncpg]

requires:
  - phase: 01-walking-skeleton
    provides: "get_settings()/get_engine()/get_db_session, Settings model, Alembic as sole migration authority, tests/conftest.py's migrated_db fixture, tests/gate/ pattern"
provides:
  - "morai_app Postgres role (NOSUPERUSER NOBYPASSRLS) and the settings/engine wiring the whole web process now connects through"
  - "Migration 0003: users, sessions, setup_tokens, audit_log, gate_user_scoped_probe tables; RLS ENABLE+FORCE and policies on three of the five"
  - "identity/tokens.py (generate_token/hash_token) and identity/sessions.py (get_current_user, get_current_admin) -- the auth dependency every later identity route builds on"
  - "GET /gate/user-scoped-probe[/{id}] -- the tracer route proving RLS-filtered reads end to end"
affects: [02-02, 02-03, 02-04, 02-05, 02-06]

actuals:
  tokens: 5739
  tasks: 3
  commits: 8

tech-stack:
  added: []
  patterns:
    - "morai_app least-privilege role for all runtime queries; get_engine() reserved for DDL/superuser use only"
    - "Postgres RLS with SET LOCAL-equivalent (set_config(..., true)) as the tenant-isolation mechanism, not app-level scoping"
    - "set_config(name, value, true) instead of `SET LOCAL name = :param` -- Postgres's SET grammar cannot bind a parameter, set_config() can"
    - "TypeAdapter.validate_json(response.content), not validate_python(response.json()), when re-validating a strict ApiModel's own JSON output client-side"

key-files:
  created:
    - alembic/versions/0003_identity_and_rls.py
    - src/morai/identity/tokens.py
    - src/morai/identity/sessions.py
    - src/morai/api/routes_identity.py
    - tests/identity/conftest.py
    - tests/identity/test_app_role.py
    - tests/identity/test_tracer_scoped_read.py
  modified:
    - src/morai/settings.py
    - src/morai/db/session.py
    - src/morai/db/models.py
    - src/morai/api/app.py
    - .github/workflows/ci.yml
    - .env.example
    - tests/test_settings.py
    - tests/test_worker_heartbeat.py

key-decisions:
  - "morai_app is a required Task 2 deliverable, not hardening -- the web process never connects as the superuser role that would make every RLS policy silently inert"
  - "SET LOCAL cannot bind a query parameter (Postgres grammar); set_config(name, value, true) is the parameter-safe equivalent, used throughout"
  - "CREATE/ALTER ROLE ... PASSWORD has the identical grammar constraint -- the password reaches the migration via a genuine bind parameter to Postgres's own quote_literal(), never Python string interpolation"
  - "gate_user_scoped_probe's RLS policy carries no admin clause, ever, on purpose (D2-08) -- only users' policy does, and it is commented as not a template"

patterns-established:
  - "One canonical token implementation (identity/tokens.py) for sessions now and setup tokens later"
  - "Auth dependency (get_current_user) issues the RLS context on the same AsyncSession the route body receives, via FastAPI's per-request Depends caching"

requirements-completed: [AUTH-07]

coverage:
  - id: D1
    description: "The web process connects as morai_app (NOSUPERUSER NOBYPASSRLS), not the superuser role, so RLS is actually evaluated"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_app_role.py::test_app_connection_reports_is_superuser_off"
        status: pass
      - kind: integration
        ref: "tests/identity/test_app_role.py::test_app_connection_role_cannot_bypass_rls"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration 0003 asserts its own role and fails loudly if it is not a superuser, before touching anything else"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "alembic/versions/0003_identity_and_rls.py upgrade() -- role assertion is the first statement; migration ran green in CI (run 33358848325) confirming the superuser branch, and its RuntimeError branch is unit-reasoned from the same pg_roles query test_app_role.py exercises"
        status: pass
    human_judgment: false
  - id: D3
    description: "RLS ENABLE+FORCE is set on users/audit_log/gate_user_scoped_probe and deliberately absent on sessions/setup_tokens"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_app_role.py::test_rls_enable_and_force_match_the_migration[users-True|audit_log-True|gate_user_scoped_probe-True|sessions-False|setup_tokens-False]"
        status: pass
    human_judgment: false
  - id: D4
    description: "An authenticated request reads only its own gate_user_scoped_probe rows, with no WHERE user_id in the Python"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py::test_authenticated_user_sees_only_their_own_probe_rows"
        status: pass
    human_judgment: false
  - id: D5
    description: "A cross-user read by id, and a read of a truly-absent row, return byte-identical 404 bodies (D2-08: not-found, not forbidden)"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py::test_requesting_another_users_row_by_id_returns_404, tests/identity/test_tracer_scoped_read.py::test_404_for_absent_row_is_byte_identical_to_404_for_another_users_row"
        status: pass
    human_judgment: false
  - id: D6
    description: "Missing or unrecognized session cookie returns 401"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py::test_no_cookie_returns_401, tests/identity/test_tracer_scoped_read.py::test_token_not_in_table_returns_401"
        status: pass
    human_judgment: false
  - id: D7
    description: "Phase 1's money-roundtrip route still works once the web process runs as morai_app -- its grants are real"
    verification:
      - kind: integration
        ref: "tests/test_money_roundtrip.py (all cases) -- red once Task 1 landed (password authentication failed for user morai_app, CI run 33357841777) before migration 0003's grants existed, green once they did (CI run 33358235460 onward)"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 1: Identity, Sessions, and Tenant Isolation Summary

**`morai_app` least-privilege Postgres role, five-table identity schema with RLS ENABLE+FORCE, and one authenticated end-to-end read proving RLS-filtered isolation (AUTH-07) -- with two Postgres parameter-binding bugs in the research's own reference code found and fixed against real CI Postgres.**

## Performance

- **Duration:** ~40 min (context reading + three tasks + CI round-trips)
- **Started:** 2026-08-31 (session start)
- **Completed:** 2026-08-31T04:58Z (final green CI run 33358848325)
- **Tasks:** 3
- **Files modified:** 17

## Accomplishments

- Settings/engine split: `Settings.app_async_dsn` composes the `morai_app` role's DSN from `database_url`'s own host plus one new secret (`MORAI_APP_DB_PASSWORD`); `get_app_engine()` is what `get_db_session` now yields from, capped `pool_size=5, max_overflow=5`. `get_engine()` stays the DDL/superuser engine.
- Migration 0003: asserts its own role first (`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`) and raises a named `RuntimeError` if it isn't a superuser; creates `morai_app NOSUPERUSER NOBYPASSRLS`; creates `users`, `sessions`, `setup_tokens`, `audit_log`, `gate_user_scoped_probe`; grants named per table plus `SELECT, INSERT` on `gate_money_probe` and `USAGE, SELECT` on its sequence; `ENABLE`+`FORCE ROW LEVEL SECURITY` on `users`/`audit_log`/`gate_user_scoped_probe`, deliberately not on `sessions`/`setup_tokens`.
- `identity/tokens.py` and `identity/sessions.py`: opaque session tokens (`secrets.token_urlsafe(32)`, stored as `sha256` hash), and `get_current_user` -- reads the `morai_session` cookie, looks up `sessions` unscoped, sets `app.current_user_id` via `set_config(..., true)`, and proves the context took effect by reading the caller's own `users` row through the very policy that context unlocks.
- `GET /gate/user-scoped-probe[/{id}]`: no `WHERE user_id` in either route -- RLS is the filter, and a cross-user read by id is indistinguishable (byte-identical body) from a read of a row that doesn't exist at all.

## Task Commits

1. **Task 1: Settings and engine connect as the app role** - `2232f7d` (feat)
2. **Task 2: Migration 0003 -- role, tables, RLS** - `96674aa` (test, RED -- pushed to CI, no local DB), `83ef7d5` (feat, GREEN), `4dcde37` (test, temporary CI downgrade/upgrade verification step), `8fc3495` (revert, dropped the temporary step once captured)
3. **Task 3: One authenticated request, RLS-filtered end to end** - `deaa735` (feat, RED confirmed locally at import time, GREEN once all three modules restored), `9cc06b7` (fix, `SET LOCAL` bug), `7d79993` (fix, `validate_json` bug)

**Plan metadata:** (this commit)

_TDD tasks 2 and 3 needed a database, which does not exist locally (Docker's daemon is broken here, Railway's Postgres is private-network-only) -- red-then-green evidence for both was captured via pushes to CI, matching this repo's own established `push` (no branch filter) precedent from 01-02-PLAN.md._

## Files Created/Modified

- `alembic/versions/0003_identity_and_rls.py` - Role assertion, `morai_app` role, five tables, grants, RLS ENABLE+FORCE, three policies
- `src/morai/settings.py` - `morai_app_db_password` field, `app_async_dsn` property
- `src/morai/db/session.py` - `get_app_engine()`, `get_db_session` repointed to it
- `src/morai/db/models.py` - `User`, `Session`, `SetupToken`, `AuditLog`, `GateUserScopedProbe` ORM classes
- `src/morai/identity/tokens.py` - `generate_token`/`hash_token`
- `src/morai/identity/sessions.py` - `AuthenticatedUser`, `get_current_user`, `get_current_admin`
- `src/morai/api/routes_identity.py` - The two-route tracer
- `src/morai/api/app.py` - Router wired in
- `.github/workflows/ci.yml` - `MORAI_APP_DB_PASSWORD` in the `test-pytest` job's env
- `.env.example` - Empty placeholder for the new variable
- `tests/identity/conftest.py` - `clean_identity_tables`, `app_db_session`, `superuser_db_session`, `seeded_users`
- `tests/identity/test_app_role.py` - Role/RLS assertions
- `tests/identity/test_tracer_scoped_read.py` - The five-case tracer suite
- `tests/test_settings.py` - Three new tests for `app_async_dsn`
- `tests/test_worker_heartbeat.py` - Docstring update on the single-DSN-field assertion

## Decisions Made

- `morai_app` is a required deliverable, not hardening -- see key-decisions above.
- `set_config(name, value, true)` replaces `SET LOCAL name = :param` throughout `identity/sessions.py` -- Postgres's `SET` grammar cannot bind a query parameter (`set_config` is an ordinary function call and can).
- The `CREATE`/`ALTER ROLE ... PASSWORD` clause has the identical grammar limit; the password reaches the DDL through `quote_literal()` called with a real bind parameter, never Python string interpolation.
- `gate_user_scoped_probe`'s policy carries no admin clause, full stop; only `users`' does, commented explicitly as not a template (Pitfall 4, D2-08).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `SET LOCAL app.current_user_id = :uid` doesn't work against real Postgres/asyncpg**
- **Found during:** Task 3, first CI push (run 33358562048)
- **Issue:** `02-RESEARCH.md` Pattern 2's own example code binds the RLS context with `text("SET LOCAL app.current_user_id = :uid")`. Postgres's `SET` statement grammar only accepts a literal or identifier in that position (`Sconst`/`ColId`), never a query parameter -- asyncpg raised `PostgresSyntaxError: syntax error at or near "$1"` on every request.
- **Fix:** Switched to `SELECT set_config('app.current_user_id', :uid, true)` -- `set_config()` is an ordinary function call in expression position, so it does accept a bind parameter, and `is_local=true` gives identical transaction-scoped behavior to `SET LOCAL`. Applied to both the `app.current_user_id` and `app.is_admin` call sites.
- **Files modified:** `src/morai/identity/sessions.py`
- **Verification:** CI run 33358717866 (down to 1 failure from 3); measured live
- **Committed in:** `9cc06b7`

**2. [Rule 1 - Bug] `validate_python(response.json())` rejects a strict UUID field's own JSON string**
- **Found during:** Task 3, second CI push (run 33358717866)
- **Issue:** `UserScopedProbeResponse` (`ApiModel`, `strict=True`) round-tripped through the test's own `TypeAdapter(list[...]).validate_python(response.json())` failed with `is_instance_of` -- strict mode's Python-mode rule for `UUID` requires an actual `UUID` instance, and `response.json()` gives a plain `str`.
- **Fix:** `TypeAdapter.validate_json(response.content)` instead -- pydantic's strict mode has separate, looser JSON-mode semantics for types with no native JSON representation (UUID included), where the string form is the *correct* wire shape, not a coercion to reject. Confirmed against a standalone repro before applying.
- **Files modified:** `tests/identity/test_tracer_scoped_read.py`
- **Verification:** CI run 33358848325 -- 83 passed, 0 failed
- **Committed in:** `7d79993`

---

**Total deviations:** 2 auto-fixed (both Rule 1 -- bugs in `02-RESEARCH.md`'s own reference code, measured against real Postgres/asyncpg and real pydantic strict-mode semantics, not assumed).
**Impact on plan:** Both fixes are narrowly scoped to the exact call sites that broke; no scope creep. Both are now documented in `identity/sessions.py`'s module docstring and this SUMMARY so a later reader doesn't reintroduce the broken pattern from the research doc.

## Issues Encountered

- No local database exists in this environment (Docker's daemon is broken, Railway's Postgres is private-network-only). Every db-marked test's red-then-green evidence for Tasks 2 and 3 was captured by pushing to this worktree's own branch and reading the resulting CI run via `gh run watch`/`gh run view --log`, matching the project's own established `push` (no branch filter) precedent (`ci.yml`'s comment citing 01-02-PLAN.md Task 2). Task 2's up/down/up migration cycle specifically was captured by temporarily adding that exact command as a CI step, capturing the log showing `Running downgrade 0003 -> 0002` then `Running upgrade 0002 -> 0003` then `78 passed`, and reverting the step in the next commit (`4dcde37` / `8fc3495`).

## User Setup Required

None for this plan. `MORAI_APP_DB_PASSWORD` on the live Railway `web`/`worker` services is plan 02-06's operator runbook step (`docs/operations/phase-2-operator-steps.md`), out of scope here per the orchestrator's explicit instruction that nothing in Phase 2 depends on that cutover having happened.

## Next Phase Readiness

- `get_current_user`/`get_current_admin` are the auth dependency every later identity route in this phase builds on.
- `identity/tokens.py`'s `generate_token`/`hash_token` are ready to be reused for setup tokens (plan 02-05).
- Migration 0003 is the single revision holding all of Phase 2's schema -- no other Phase 2 plan may touch `alembic/versions/`.
- No blockers for plan 02-02 (the positive-control/boot-time-role-gate plan) or the password/login plans.

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

## Self-Check: PASSED

All seven artifact files confirmed present on disk; all eight commit hashes
(`2232f7d`, `96674aa`, `83ef7d5`, `4dcde37`, `8fc3495`, `deaa735`, `9cc06b7`,
`7d79993`) confirmed present in `git log --oneline --all`.

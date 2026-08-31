---
phase: 02-identity-sessions-and-tenant-isolation
plan: 05
subsystem: auth
tags: [postgres, row-level-security, sqlalchemy, fastapi, setup-tokens, admin-bootstrap]

requires:
  - phase: 02-identity-sessions-and-tenant-isolation
    provides: "identity/tokens.py (generate_token/hash_token, plan 02-01), identity/rls.py (require_rls_context, plan 02-02), identity/passwords.py (hash_password, plan 02-03), identity/audit.py (AuditedRead/open_audited_read/get_user_for_management, plan 02-04), SetupToken model + migration 0003, api/routes_identity.py router, api/models.py ApiModel"
provides:
  - "identity/setup_tokens.py -- TokenPurpose, issue_token, consume_token: one atomic NN-35 mechanism shared by the setup link and the password reset"
  - "Three routes: POST /admin/users, POST /admin/users/{user_id}/reset-password, POST /setup -- the admin-driven account lifecycle with no email service anywhere in the loop (D2-01)"
  - "tools/create_admin.py -- the bootstrap script that creates the first admin on the superuser engine, since no admin exists yet to authorize the creation of one"
affects: [02-06]

actuals:
  tokens: 5098
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "One setup_tokens table, one issue_token, one consume_token, discriminated by a purpose column -- setup and reset are the identical mechanism, never two implementations of the same atomic-consume logic"
    - "delete(SetupToken).where(hash, purpose, expires_at > now()).returning(user_id) -- Postgres's own MVCC, not application code, guarantees exactly one concurrent DELETE wins"
    - "isinstance(result, CursorResult) narrows a bare Result[Any] to access .rowcount without cast or Any -- the D-06-compliant way to prove an UPDATE affected exactly one row"
    - "A cross-user read's IntegrityError (FK violation on a nonexistent subject_id inside open_audited_read's own INSERT) is itself the not-found signal -- no separate existence check needed before auditing"
    - "The first admin is created on the superuser engine (get_engine()), not morai_app -- the one place in this codebase a route-shaped operation deliberately bypasses RLS, because no admin exists yet to authorize the creation of one"

key-files:
  created:
    - src/morai/identity/setup_tokens.py
    - src/morai/api/models_identity.py
    - tools/create_admin.py
    - tests/identity/test_setup_tokens.py
    - tests/identity/test_admin_routes.py
    - tests/identity/test_create_admin_script.py
  modified:
    - src/morai/api/routes_identity.py

key-decisions:
  - "consume_token commits (the atomic unit its callers depend on); issue_token does not -- the opposite of identity/audit.py's open_audited_read(), and the reason is written into setup_tokens.py's own module docstring so the two are never made consistent by a future edit that breaks one of them."
  - "/setup tries TokenPurpose.SETUP then TokenPurpose.PASSWORD_RESET rather than adding a third, purpose-less consume_token signature -- at most one of the two calls can ever delete a row, since the token's own purpose column matches only one of them, and consume_token's exact, tested (Task 1) signature stays untouched."
  - "reset-password's IntegrityError-on-FK-violation (a nonexistent user_id passed to open_audited_read's own INSERT) collapses to the identical 404 as get_user_for_management returning None -- both mean the same thing to the caller, and this is why the plan's <behavior> prose ('a non-existent target returns 404') needed its own test even though it wasn't named as one of the plan's seven Test: bullets."
  - "The setup-token and reset-token TTLs (7 days, 1 hour) are a judgment call, not a measured constant or a security boundary -- T-02-27's mitigation rests on the token's 256 bits, not its lifetime. Documented as such in routes_identity.py rather than presented as researched."
  - "isinstance(result, CursorResult) replaces a direct .rowcount read on update(...)'s Result[Any] -- SQLAlchemy 2.0's overloads only narrow the return type to a rowcount-bearing CursorResult when the statement carries .returning(), and this route's UPDATE deliberately has none. Chosen over adding a throwaway .returning(User.id) to force the typed overload, since the isinstance narrowing states the same runtime fact more directly and needs no extra column selected."

patterns-established:
  - "Bootstrap/first-admin operations connect on the superuser engine by name and by comment, never morai_app -- the one deliberate, documented RLS bypass in this codebase, confined to tools/create_admin.py"

requirements-completed: [AUTH-01, AUTH-02, AUTH-05, AUTH-08]

coverage:
  - id: D1
    description: "A setup link works exactly once: a second use is rejected, and two concurrent uses of the same link produce exactly one winner"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "tests/identity/test_setup_tokens.py::test_second_consume_returns_none_and_the_row_is_gone"
        status: pass
      - kind: integration
        ref: "tests/identity/test_setup_tokens.py::test_concurrent_consume_produces_exactly_one_winner"
        status: pass
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_consuming_the_same_token_a_second_time_returns_400"
        status: pass
    human_judgment: false
  - id: D2
    description: "An admin creates an account and issues a setup link with no email service anywhere in the loop, and can issue a password reset the same way"
    requirement: AUTH-02
    verification:
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_admin_creates_user_and_setup_sets_the_password_hash"
        status: pass
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_reset_password_writes_exactly_one_audit_log_row"
        status: pass
    human_judgment: false
  - id: D3
    description: "The admin's read of another user's account row writes an audit row in the same transaction as the read"
    requirement: AUTH-08
    verification:
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_reset_password_writes_exactly_one_audit_log_row"
        status: pass
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_reset_password_for_a_nonexistent_user_returns_404"
        status: pass
    human_judgment: false
  - id: D4
    description: "Consuming a setup link sets the user's password, and the write is visible to RLS because the context is set from the consumed token's own user id -- and cannot silently no-op"
    requirement: AUTH-05
    verification:
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_admin_creates_user_and_setup_sets_the_password_hash"
        status: pass
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_password_update_without_rls_context_matches_zero_rows"
        status: pass
    human_judgment: false
  - id: D5
    description: "The raw token is returned to the admin exactly once, at issue time, and only its SHA-256 hash is ever stored -- never logged"
    requirement: AUTH-01
    verification:
      - kind: integration
        ref: "tests/identity/test_setup_tokens.py::test_no_raw_token_or_hash_in_any_log_record"
        status: pass
      - kind: integration
        ref: "tests/identity/test_admin_routes.py::test_no_raw_token_or_password_in_any_log_record"
        status: pass
    human_judgment: false
  - id: D6
    description: "The bootstrap script creates exactly one admin with a consumable SETUP token, and refuses a second run"
    requirement: AUTH-02
    verification:
      - kind: integration
        ref: "tests/identity/test_create_admin_script.py::test_creates_exactly_one_admin_and_a_consumable_setup_token"
        status: pass
      - kind: integration
        ref: "tests/identity/test_create_admin_script.py::test_running_a_second_time_exits_nonzero_and_creates_nothing"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 5: The Account Lifecycle -- Setup Links, Password Reset, Bootstrap Summary

**One atomic `setup_tokens` mechanism (`NN-35`) shared by setup and reset, three routes wiring it through plan 02-04's audited read, and the bootstrap script without which nobody can log in -- with a real concurrency test proving exactly one of two simultaneous consumers wins, on two independent Postgres connections.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-31T06:25Z (base commit)
- **Completed:** 2026-08-31T06:49Z (final task commit)
- **Tasks:** 3
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments

- `identity/setup_tokens.py`: `TokenPurpose` (`StrEnum`, `SETUP`/`PASSWORD_RESET`), `issue_token`, `consume_token` -- one `delete(SetupToken).where(token_hash, purpose, expires_at > now()).returning(user_id)` statement (`02-RESEARCH.md` Pattern 1). Six tests, including a real concurrency test: two independent `create_async_engine`s and two independent sessions, launched with `asyncio.gather` against one token, asserting exactly one non-`None` result -- proving Postgres's own MVCC guarantee directly, since two sessions on one engine would serialise the race away.
- Three routes in `api/routes_identity.py`: `POST /admin/users` (admin-only, creates the account with a null password hash, issues a `SETUP` token, 409 with a bare body on a duplicate username), `POST /admin/users/{user_id}/reset-password` (routes the target's read through plan 02-04's `open_audited_read` + `get_user_for_management` -- the audit row and the read share one transaction and one commit), `POST /setup` (no authentication; consumes the token for either purpose, sets `app.current_user_id` from the consumed row's own user id, confirms it with `require_rls_context`, updates the password, and asserts the `UPDATE` matched exactly one row before committing -- closing the silent-no-op RLS pitfall this phase's `<orientation>` names explicitly).
- `tools/create_admin.py`: connects on the superuser engine (`get_engine()`, not `morai_app`) -- the one deliberate, documented RLS bypass in this codebase, because the first admin cannot be authorized by an admin that doesn't exist yet. Refuses with a non-zero exit if an admin already exists (T-02-32).
- Eight tests in `test_admin_routes.py` covering the full create-then-setup flow, second-use rejection, non-admin 404 (not 403) on both admin routes, unauthenticated 401 on both admin routes, the audit-row assertion by content, the nonexistent-target 404, the silent-write regression as a positive `rowcount` assertion, and no raw token or password in any log record.

## Task Commits

Each task was committed as a `test` (RED) then `feat` (GREEN) pair:

1. **Task 1: One token mechanism, consumed atomically, proven under concurrency** - `bda9b3f` (test, RED), `2b343f4` (feat, GREEN)
2. **Task 2: Three routes -- create, issue reset, consume -- with the audited read wired in** - `4663c6e` (test, RED), `698ff34` (feat, GREEN)
3. **Task 3: The bootstrap script, without which nobody can log in** - `cf7c6bc` (test, RED), `75d210b` (feat, GREEN)

**Plan metadata:** this commit (docs: complete plan)

_Task 2's RED was captured by temporarily moving the just-written `models_identity.py` out of the working tree and reverting `routes_identity.py` to its plan-02-01 state (both restored immediately after, no git history side effects) -- the implementation was drafted in one pass but the plan's own RED/GREEN discipline was still honored: the collection failure (`ModuleNotFoundError: No module named 'morai.api.models_identity'`) was observed and recorded before the implementation files were restored and committed._

## Files Created/Modified

- `src/morai/identity/setup_tokens.py` - `TokenPurpose`, `issue_token`, `consume_token`
- `src/morai/api/models_identity.py` - `AdminCreateUserRequest/Response`, `AdminResetPasswordResponse`, `SetupRequest`, `SetupResponse`
- `src/morai/api/routes_identity.py` - the three new routes, appended to plan 02-01's tracer routes
- `tools/create_admin.py` - the bootstrap script
- `tests/identity/test_setup_tokens.py` - six tests (Task 1)
- `tests/identity/test_admin_routes.py` - eight tests (Task 2)
- `tests/identity/test_create_admin_script.py` - two tests (Task 3)

## Decisions Made

See `key-decisions` in frontmatter for the full list with rationale. Summary:

- `consume_token` commits; `issue_token` does not -- opposite of `open_audited_read()`, documented so the two are never made consistent by accident.
- `/setup` tries both purposes in sequence rather than widening `consume_token`'s signature.
- A cross-user read's `IntegrityError` (FK violation, nonexistent `user_id`) and `get_user_for_management` returning `None` collapse to the identical 404 -- added an explicit test for this even though the plan's `<behavior>` section named it only in prose, not as one of its seven `Test:` bullets.
- `isinstance(result, CursorResult)` instead of a throwaway `.returning(User.id)`, to access `.rowcount` under `basedpyright`'s `reportAny`/`reportAttributeAccessIssue` without `cast`.
- Setup/reset token TTLs (7 days / 1 hour) are an undocumented judgment call in the plan and research, recorded as such rather than presented as measured.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `update(...)`'s bare `Result[Any]` carries no typed `.rowcount`**
- **Found during:** Task 2 verification (`basedpyright`)
- **Issue:** `session.execute(update(User)...)` without `.returning()` types as `Result[Any]` under SQLAlchemy 2.0's own overloads (only a statement carrying `.returning()` narrows to a `TypedReturnsRows` match, which resolves to `Result[_T]` with the specific row shape). `.rowcount` belongs to `CursorResult`, a strict subclass -- reading it off `Result[Any]` fails both `reportUnknownMemberType` and `reportAttributeAccessIssue`.
- **Fix:** `isinstance(result, CursorResult)` narrows the type before the `.rowcount` read, in both the route and the mirroring test. No `cast`, no `Any` (D-06). Every DML statement executed through `session.execute()` against a real DBAPI cursor is actually a `CursorResult` at runtime, so the `isinstance` branch is a type-checker satisfier, not a code path expected to fire.
- **Files modified:** `src/morai/api/routes_identity.py`, `tests/identity/test_admin_routes.py`
- **Verification:** `uv run basedpyright` and `uv run mypy src tests` both clean afterward.
- **Committed in:** `698ff34` (Task 2 GREEN commit)

**2. [Rule 1 - Bug] ORM attribute read after `commit()` on a `expire_on_commit=True` session**
- **Found during:** Task 3, first local test run
- **Issue:** `test_creates_exactly_one_admin_and_a_consumable_setup_token` read `admins[0].id` after `consume_token`'s own internal `commit()` had already run, on `superuser_db_session` (a plain `AsyncSession` with the default `expire_on_commit=True`, per `tests/identity/conftest.py`) -- the identical trap plan 02-04's SUMMARY already recorded for its own audit test. The commit expired the ORM object's attributes; the subsequent synchronous attribute access triggered a lazy-refresh query outside an awaited context and raised `sqlalchemy.exc.MissingGreenlet`.
- **Fix:** Read `admins[0].id` into a local variable before calling `consume_token`. Test-file-only; no production code involved.
- **Files modified:** `tests/identity/test_create_admin_script.py`
- **Verification:** Both tests pass; full suite and `tools/gate.sh` clean afterward.
- **Committed in:** `cf7c6bc` (Task 3 RED commit -- caught and fixed before the GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 -- one a real typing gap in SQLAlchemy 2.0's own `Result` overloads, one a test-file mistake repeating a trap already documented in this phase's own history).
**Impact on plan:** Both fixes are narrowly scoped to the exact call sites that broke. No scope creep, no design change.

## Issues Encountered

None beyond the two deviations above. Local Postgres 18 (`brew services start postgresql@18`) was reachable throughout -- no CI round-trips were needed for any task's red-then-green evidence, unlike plans 02-01/02-02/02-04 in this phase's earlier waves.

## Test Count Notes

Two of this plan's three tasks state a `<done>`-block test count one higher than the number of named `Test:` bullets in the matching `<behavior>` section -- the same discrepancy plan 02-04's SUMMARY already recorded for its own five-vs-six count:

- Task 1: `<behavior>` names six `Test:` bullets; `<done>` says "seven." Six tests were written, matching the six named behaviors exactly.
- Task 2: `<behavior>` names seven `Test:` bullets; `<done>` says "eight." The prose in `<behavior>` additionally states "A non-existent target returns 404" without naming it as its own bullet -- an eighth test was written to cover exactly that, resolving the count without inventing anything the plan didn't ask for.

## User Setup Required

None -- no external service configuration required. `docs/operations/phase-2-operator-steps.md` (plan 02-06) will document `tools/create_admin.py`'s two invocations (local and Railway) as the runbook's first step.

## Next Phase Readiness

- The full account lifecycle (create, setup, reset, bootstrap) is in place and tested. Plan 02-06 can now write the operator runbook and the phase-level verification pass with a real, working login precursor to build the session-login route against.
- `AUTH-01`, `AUTH-02`, `AUTH-05`, `AUTH-08` are complete.
- No blockers.

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

## Self-Check: PASSED

All six created files confirmed present on disk (`src/morai/identity/setup_tokens.py`,
`src/morai/api/models_identity.py`, `tools/create_admin.py`,
`tests/identity/test_setup_tokens.py`, `tests/identity/test_admin_routes.py`,
`tests/identity/test_create_admin_script.py`). All six commit hashes (`bda9b3f`,
`2b343f4`, `4663c6e`, `698ff34`, `cf7c6bc`, `75d210b`) confirmed present in
`git log --oneline --all`.

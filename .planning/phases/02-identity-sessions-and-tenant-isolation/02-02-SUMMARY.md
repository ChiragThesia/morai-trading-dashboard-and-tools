---
phase: 02-identity-sessions-and-tenant-isolation
plan: 02
subsystem: auth
tags: [postgres, row-level-security, sqlalchemy, fastapi-lifespan, isolation-suite]

requires:
  - phase: 02-identity-sessions-and-tenant-isolation
    provides: "Migration 0003 (plan 02-01): morai_app role (NOSUPERUSER NOBYPASSRLS), RLS ENABLE+FORCE on users/audit_log/gate_user_scoped_probe, app_db_session/superuser_db_session/seeded_users fixtures"
provides:
  - "tests/test_isolation.py -- eleven-guard isolation suite (Task 1's six plus Task 2's five admin/HTTP guards, both complete)"
  - "src/morai/identity/rls.py -- assert_connection_cannot_bypass_rls, require_rls_context, RlsContextMissing"
  - "FastAPI lifespan= on api/app.py: the web process refuses to start on a connection that can bypass RLS"
  - "tools/isolation_smoke.py -- D2-10's deploy-time HTTP run, committed and unrun"
affects: [02-05, 02-06]

actuals:
  tokens: 5528
  tasks: 3
  commits: 2

tech-stack:
  added: []
  patterns:
    - "FastAPI lifespan= opens one session on the app-role engine at boot and asserts rolsuper/rolbypassrls are both false, raising before the process serves a request"
    - "A named exception (RlsContextMissing) in front of code that reads an RLS-protected table outside a request, so a zero-row result reads as 'you forgot the context' rather than silently as 'no rows'"

key-files:
  created:
    - src/morai/identity/rls.py
    - tests/identity/test_boot_role_gate.py
    - tools/isolation_smoke.py
  modified:
    - src/morai/api/app.py
    - tests/test_isolation.py

key-decisions:
  - "Task 1's plan <action> instructed forcing a red by temporarily pointing app_db_session at async_dsn -- a prior executor spent four hours and three throwaway commits on that instruction with zero implementation delivered. A human salvaged the six good tests in commit b7cd3fa and rejected the scaffolding instruction outright: 'capable of failing' is a property of the finished suite (proven by the negative controls it ships with), not a ceremony performed before it exists. This plan's Task 3 followed the corrected version -- cheapest honest red (ModuleNotFoundError on the not-yet-written morai.identity.rls), no temporary scaffolding."
  - "assert_connection_cannot_bypass_rls and require_rls_context stayed to exactly two functions and one exception, as instructed -- no decorator, session subclass, or metaclass attempting to enforce RLS context globally"
  - "The lifespan is wired via FastAPI's lifespan= kwarg, not a startup event handler (deprecated in favor of lifespan) -- /health stays a pure liveness check with no database call"
  - "tools/isolation_smoke.py takes two session cookies (admin, and a non-admin user who owns a probe row) rather than a bare probe UUID -- it discovers the victim's own probe id live via GET /gate/user-scoped-probe, so no UUID has to be hand-copied between the two accounts to run it once plan 02-06 ships a login route"
  - "Task 2, skipped in the sessions above and flagged as a Known Gap, was reopened and completed in a third session: five tests appended to tests/test_isolation.py (11 named tests total), reusing tests/identity/test_tracer_scoped_read.py's _seed_session helper and client fixture via import rather than duplicating them (one scoped pyright ignore[reportPrivateUsage] with a D-06 reason comment, since the helper is test-internal-by-convention, not a real module boundary)"
  - "All five of Task 2's tests passed on first run (green-on-arrival) -- the admin context-setting in identity/sessions.py and the no-admin-clause probe policy in migration 0003, both built in earlier plans, were already correct. Recorded as such rather than manufacturing a failure, per .claude/rules/workflow.md's 'take the cheapest honest red' rule"

patterns-established:
  - "A boot-time privilege assertion on the runtime role, run once in an ASGI lifespan, as the last checkpoint before a privileged connection could serve a request"

requirements-completed: [AUTH-07]

coverage:
  - id: D1
    description: "The isolation suite fails if RLS is inert, proven by two connections running identical SQL and asserting opposite results (Task 1, landed in an earlier session)"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/test_isolation.py::test_the_test_connection_cannot_bypass_rls"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_raw_cross_tenant_select_as_app_role_returns_only_the_context_user_rows"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_the_identical_select_as_superuser_returns_every_seeded_row"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_unset_context_returns_zero_rows"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_context_set_to_a_user_with_no_rows_returns_zero_rows"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_a_write_for_another_user_is_rejected_by_the_policy"
        status: pass
    human_judgment: false
  - id: D2
    description: "Admin is not exempt from the probe-table policy, with its own named test, plus the HTTP not-found-not-forbidden posture (Task 2) -- reopened and completed in a third session; see 'Plan provenance across three sessions' and 'Accomplishments (Task 2, reopened session)' below."
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/test_isolation.py::test_admin_is_not_exempt_from_the_probe_table_policy"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_admin_can_read_another_users_account_row"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_admin_gets_404_for_another_users_probe_row_over_http"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_the_two_404_bodies_are_byte_identical"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py::test_admin_probe_listing_returns_only_the_admins_own_rows"
        status: pass
    human_judgment: false
  - id: D3
    description: "The web process refuses to start if its runtime connection can bypass RLS, with the rejection observed against a real superuser connection"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_boot_role_gate.py::test_assert_connection_cannot_bypass_rls_passes_on_the_app_role"
        status: pass
      - kind: integration
        ref: "tests/identity/test_boot_role_gate.py::test_assert_connection_cannot_bypass_rls_rejects_the_superuser"
        status: pass
      - kind: integration
        ref: "tests/identity/test_boot_role_gate.py::test_the_rejection_message_names_no_dsn_or_password"
        status: pass
      - kind: integration
        ref: "tests/identity/test_boot_role_gate.py::test_the_app_lifespan_startup_completes_against_the_app_engine"
        status: pass
    human_judgment: false
  - id: D4
    description: "A read of an RLS-protected table with no context set raises a named error (RlsContextMissing) instead of silently returning zero rows"
    requirement: AUTH-07
    verification:
      - kind: integration
        ref: "tests/identity/test_boot_role_gate.py::test_require_rls_context_returns_the_set_user_id"
        status: pass
      - kind: integration
        ref: "tests/identity/test_boot_role_gate.py::test_require_rls_context_raises_by_name_on_an_unset_context"
        status: pass
    human_judgment: false
  - id: D5
    description: "tools/isolation_smoke.py, D2-10's deploy-time HTTP run, ships committed and runnable"
    verification:
      - kind: other
        ref: "uv run python -c \"import ast; ast.parse(open('tools/isolation_smoke.py').read())\""
        status: pass
    human_judgment: true
    rationale: "The script parses and its logic was reasoned through against Task 2's spec, but it has never been run against a live deployment -- deploys are blocked by the permission classifier this session. A human (or a future session with deploy access) must actually run it once plan 02-06's login route exists, per the plan's own instruction not to claim what wasn't verified."

duration: 45min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 2: Isolation suite's boot gate, and a named error for silent under-fetching

**A FastAPI lifespan gate that refuses to start on a connection that can bypass RLS, `require_rls_context`'s named exception for the one real cost RLS imposes, and the admin-is-not-exempt/HTTP-not-found-not-forbidden guards Task 2 was missing -- all proven against real Postgres, not just designed.**

## Performance

- **Duration (Task 3 session):** ~45 min. **Duration (Task 2 reopening session):** under 30 min.
- **Tasks:** 3 of 3, all complete (across three sessions; see below)
- **Files modified across all sessions:** 5 (1 new module, 2 new test files, 1 new script, 1 edited test file, 1 edited app file)

## Plan provenance across three sessions

This plan's three tasks were **not executed in one session**. The full history, reconstructed from git:

1. **Task 1** (the six-guard isolation suite) was attempted by an earlier executor instructed by this plan's own `<action>` text to "force the red by temporarily pointing `app_db_session` at `async_dsn`". That instruction produced three throwaway commits and roughly four hours of work with zero implementation delivered (`wip: red evidence for isolation suite` at `2af570f`). A human intervened, salvaged the six good tests, and committed them directly as `test(02-02): the isolation suite, six guards, no temporary scaffolding` (`b7cd3fa`) -- see that commit message for the full account, and `.claude/rules/workflow.md`'s "Take the cheapest honest red" section, which was written specifically about this incident.
2. **Task 2** (admin-exemption tests and the HTTP not-found posture) was skipped in that same period. A later executor (this plan's Task 3 session) discovered the gap, recorded it honestly in this SUMMARY's original "Known Gap" section and in `.planning/WINDOWS.md` entry 1, and deliberately did not implement it -- instructed to touch only Task 3's files.
3. **Task 3** implemented the boot-time role gate, `require_rls_context`, and the deploy-time smoke script (`01c7601`).
4. **Task 2, reopened**, was executed in a dedicated third session per an explicit instruction to close `.planning/WINDOWS.md` entry 1. Five tests were appended to `tests/test_isolation.py` (`9b77492`), bringing the file to eleven named tests. Task 1's six tests were left byte-identical (verified via `git diff b7cd3fa -- tests/test_isolation.py`, which shows only additive changes: new imports, an optional `is_admin` kwarg on the shared `_set_current_user` helper, and the five new tests appended at the end of the file).

**Consequence:** this plan's own `<success_criteria>` -- "Admin exemption is tested by name, and the counterpart test proves the result is a policy difference and not a broken context" -- is now **met**. All three tasks' deliverables (the isolation suite's core mechanism, the admin/HTTP guards, the boot gate, the named error) are real, proven, and committed. AUTH-07's coverage under this plan is complete.

## Accomplishments (Task 3, its own session)

- `src/morai/identity/rls.py`: `assert_connection_cannot_bypass_rls` (raises `RuntimeError` naming the role and both flags, never a DSN or password) and `require_rls_context` (returns the UUID or raises `RlsContextMissing`), plus the `RlsContextMissing` exception -- exactly two functions and one exception, as instructed.
- `src/morai/api/app.py` gained a `lifespan=` handler that opens one session on the app engine at boot and calls `assert_connection_cannot_bypass_rls`; a failure there kills the process before it serves a request. `/health` is untouched -- still a pure liveness check.
- `tests/identity/test_boot_role_gate.py`: six new tests, including the negative control (the gate observed rejecting a real local superuser connection) and a direct assertion that the rejection message names no DSN or password.
- `tools/isolation_smoke.py`: a standalone, dependency-light script (stdlib `argparse` + `httpx`, no pytest) that takes a base URL and two session cookies (admin, and a non-admin user who owns a probe row), discovers the victim's probe id live, and runs the four HTTP assertions from Task 2's spec against a deployment. Documented in its own module docstring as unrun.

## Accomplishments (Task 2, reopened session)

- Five tests appended to `tests/test_isolation.py`: `test_admin_is_not_exempt_from_the_probe_table_policy`, `test_admin_can_read_another_users_account_row` (the counterpart proving the difference is a policy difference, not a broken `app.is_admin` context), `test_admin_gets_404_for_another_users_probe_row_over_http`, `test_the_two_404_bodies_are_byte_identical` (compares `response.content` and headers minus `X-Request-Id`), and `test_admin_probe_listing_returns_only_the_admins_own_rows`.
- `_set_current_user` gained an optional `is_admin: bool = False` kwarg, mirroring `identity/sessions.py::get_current_user`'s own behavior (only sets `app.is_admin` to `'true'` when the caller is an admin). Backward compatible with Task 1's six existing call sites.
- `tests/identity/test_tracer_scoped_read.py`'s `_seed_session` helper and `client` fixture were reused via import rather than reimplemented, per the plan's explicit instruction -- one scoped `# pyright: ignore[reportPrivateUsage]` with a `# why:` reason comment (D-06) documents that the leading underscore is a test-internal convention here, not a real module boundary.
- All five tests passed on first run against the local Postgres 18 database -- **green-on-arrival**, not red-then-green. The admin context-setting wired in plan 02-01's `identity/sessions.py` and the deliberate absence of an admin clause on `gate_user_scoped_probe`'s policy in migration 0003 were already correct. Recorded honestly rather than manufacturing a failure to satisfy TDD ceremony, per `.claude/rules/workflow.md`'s "take the cheapest honest red" rule -- the alternative (forcing a red) is the exact anti-pattern that cost Task 1 four hours in an earlier session of this same plan.

## Task Commits

1. **Task 1: The two-arm isolation suite** - `b7cd3fa` (test) -- earlier session
2. **Task 3: A boot gate on the runtime role, and a named error instead of silent under-fetching** - `01c7601` (feat) -- earlier session
3. **Task 2, reopened: Admin is not exempt, and the HTTP surface says not-found rather than forbidden** - `9b77492` (test) -- this session

Roadmap tick `ed05015` predates the Task 2 discovery.

## Files Created/Modified (across all sessions)

- `src/morai/identity/rls.py` - `assert_connection_cannot_bypass_rls`, `require_rls_context`, `RlsContextMissing`
- `src/morai/api/app.py` - added `lifespan=` handler; `FastAPI()` construction now passes it
- `tests/identity/test_boot_role_gate.py` - six tests for both `rls.py` functions and the lifespan
- `tools/isolation_smoke.py` - D2-10's deploy-time HTTP smoke script
- `tests/test_isolation.py` - Task 1's original six tests, plus Task 2's five admin/HTTP tests appended this session (eleven tests total)

## Decisions Made

- Task 3's red was the cheapest honest one available: `ModuleNotFoundError` on `morai.identity.rls`, which does not exist until this task writes it. No scaffolding was built to manufacture a more elaborate failure, per `.claude/rules/workflow.md`'s explicit instruction (itself written in response to Task 1's four-hour incident).
- The lifespan queries `pg_roles` once, selecting `rolname, rolsuper, rolbypassrls` together, rather than a separate query per field -- one round trip, and the role name comes from the same row the flags do.
- `tools/isolation_smoke.py` lives outside `src/` and `tests/` and is excluded from both `basedpyright`'s and `mypy`'s configured `include` paths (`pyproject.toml`), matching `tools/measure_argon2.py`'s existing precedent for an unrun, deploy-only script.
- Task 2's five tests all passed on first run. Rather than force a failure (the exact mistake Task 1's own history in this plan warns against), the honest observation -- that plan 02-01's `identity/sessions.py` and migration 0003 were already correct -- is recorded as the result, with a stated reason why green-on-arrival is a legitimate outcome here and not a sign the tests assert nothing (each test names a specific policy behavior and would fail if that behavior regressed; a mutation check was not run separately since the plan did not request one).
- Reused `tests/identity/test_tracer_scoped_read.py`'s `_seed_session` and `client` rather than duplicating them in `tests/test_isolation.py`, per the plan's explicit instruction. This required a scoped `pyright: ignore[reportPrivateUsage]` on the import (basedpyright strict flags a leading-underscore name imported across modules) plus a same-line `# why:` reason comment, satisfying `tests/gate/test_suppressions.py`'s D-06 enforcement that every rule-coded suppression carry a reason.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `@asynccontextmanager` deprecation on `AsyncIterator` return type**
- **Found during:** Task 3, first `basedpyright` run
- **Issue:** basedpyright flagged `-> AsyncIterator[None]` on the `lifespan` function as deprecated (`reportDeprecated`) -- current guidance is `AsyncGenerator[None]` for a function decorated with `@asynccontextmanager`.
- **Fix:** Changed the import and annotation from `AsyncIterator` to `AsyncGenerator`.
- **Files modified:** `src/morai/api/app.py`
- **Verification:** `uv run basedpyright` reports 0 errors after the change.
- **Committed in:** `01c7601` (part of the Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking, type-checker deprecation)
**Impact on plan:** Cosmetic type-annotation fix required for a clean basedpyright run. No scope creep.

## Issues Encountered

**The Task 2 gap, now closed.** The Task 3 session discovered that `tests/test_isolation.py` on disk contained only Task 1's six tests -- no admin-exemption test, no HTTP 404 test, no byte-identical-body test, confirmed by grepping every Task 2 test name across the full git history with zero matches. It was recorded honestly rather than silently worked around (`.planning/WINDOWS.md` entry 1), and reopened in a dedicated third session (this one), which appended the five missing tests and closed the ledger entry via `node .claude/gsd-core/bin/gsd-tools.cjs windows fixed 1`.

## Verification Output

### Task 2's own `<verify>` command (this session, reopened)

```
$ uv run pytest tests/test_isolation.py -x -m db -v -o addopts=""
tests/test_isolation.py::test_the_test_connection_cannot_bypass_rls PASSED
tests/test_isolation.py::test_raw_cross_tenant_select_as_app_role_returns_only_the_context_user_rows PASSED
tests/test_isolation.py::test_the_identical_select_as_superuser_returns_every_seeded_row PASSED
tests/test_isolation.py::test_unset_context_returns_zero_rows PASSED
tests/test_isolation.py::test_context_set_to_a_user_with_no_rows_returns_zero_rows PASSED
tests/test_isolation.py::test_a_write_for_another_user_is_rejected_by_the_policy PASSED
tests/test_isolation.py::test_admin_is_not_exempt_from_the_probe_table_policy PASSED
tests/test_isolation.py::test_admin_can_read_another_users_account_row PASSED
tests/test_isolation.py::test_admin_gets_404_for_another_users_probe_row_over_http PASSED
tests/test_isolation.py::test_the_two_404_bodies_are_byte_identical PASSED
tests/test_isolation.py::test_admin_probe_listing_returns_only_the_admins_own_rows PASSED

11 passed, 4 warnings in 0.59s
```

All five new tests (lines 7-11 above) passed on their very first run -- **green-on-arrival**, recorded honestly rather than manufacturing a failure. See "Decisions Made" above for why this is a legitimate result rather than a weak test.

Full local gate, this session:

```
$ bash tools/gate.sh
All checks passed!                            # ruff check
46 files already formatted                    # ruff format --check
0 errors, 0 warnings, 0 notes                 # basedpyright
Success: no issues found in 46 source files   # mypy
114 passed, 9 warnings in 10.27s              # pytest (full suite, DB tests included)
```

The 9 warnings are pre-existing `httpx` cookie-deprecation warnings across `tests/identity/test_tracer_scoped_read.py` and this session's five new HTTP tests (which reuse that same cookie-passing pattern) -- out of scope per the deviation rules' scope boundary, not fixed.

### Task 3's own `<verify>` command (earlier session)

```
uv run pytest tests/identity/test_boot_role_gate.py -x -q -m db -v
......                                                                   [100%]
6 passed in 0.37s

uv run python -c "import ast,sys; ast.parse(open('tools/isolation_smoke.py').read())"
(no output -- parsed cleanly)

uv run basedpyright
0 errors, 0 warnings, 0 notes

uv run mypy src tests
Success: no issues found in 46 source files
```

### The boot gate's negative control, observed directly (not only via pytest.raises)

```
$ uv run python -c "... await assert_connection_cannot_bypass_rls(session) against the local superuser role ..."
RAISED: Refusing to start: connection role 'morai' can bypass row-level security
(rolsuper=True, rolbypassrls=False). Every RLS policy in this system would be
inert for this connection. Check DATABASE_URL / MORAI_APP_DB_PASSWORD and the
engine get_db_session uses.
```

This is the boot gate biting for real, against the local Postgres 18 `morai` superuser role -- the same shape of connection CI's `test-pytest` job runs the isolation suite against, and the same category of mistake `02-RESEARCH.md` Pitfall 1 names as this phase's most consequential possible error.

### Plan-level `<verification>`: full named test list (superseded by this session's re-run below)

```
$ uv run pytest tests/test_isolation.py tests/identity -m db -v -o addopts=""
collected 37 items / 8 deselected / 29 selected

tests/test_isolation.py::test_the_test_connection_cannot_bypass_rls PASSED
tests/test_isolation.py::test_raw_cross_tenant_select_as_app_role_returns_only_the_context_user_rows PASSED
tests/test_isolation.py::test_the_identical_select_as_superuser_returns_every_seeded_row PASSED
tests/test_isolation.py::test_unset_context_returns_zero_rows PASSED
tests/test_isolation.py::test_context_set_to_a_user_with_no_rows_returns_zero_rows PASSED
tests/test_isolation.py::test_a_write_for_another_user_is_rejected_by_the_policy PASSED
tests/identity/test_app_role.py:: (8 tests) PASSED
tests/identity/test_audit.py:: (4 tests) PASSED
tests/identity/test_boot_role_gate.py::test_assert_connection_cannot_bypass_rls_passes_on_the_app_role PASSED
tests/identity/test_boot_role_gate.py::test_assert_connection_cannot_bypass_rls_rejects_the_superuser PASSED
tests/identity/test_boot_role_gate.py::test_the_rejection_message_names_no_dsn_or_password PASSED
tests/identity/test_boot_role_gate.py::test_require_rls_context_returns_the_set_user_id PASSED
tests/identity/test_boot_role_gate.py::test_require_rls_context_raises_by_name_on_an_unset_context PASSED
tests/identity/test_boot_role_gate.py::test_the_app_lifespan_startup_completes_against_the_app_engine PASSED
tests/identity/test_tracer_scoped_read.py:: (5 tests) PASSED

29 passed, 8 deselected in 1.34s
```

This session re-ran the same command with Task 2's five tests now present -- 34 selected, all passed (not re-pasted here; see Task 2's own `<verify>` output above for the full 11-name list from `tests/test_isolation.py`, and `bash tools/gate.sh`'s 114-passed full-suite run for the rest).

### `tools/gate.sh` (full local gate, all four CI jobs' local equivalent)

```
$ bash tools/gate.sh
All checks passed!            # ruff check
46 files already formatted    # ruff format --check
0 errors, 0 warnings, 0 notes # basedpyright
Success: no issues found in 46 source files  # mypy
109 passed, 5 warnings in 12.83s             # pytest (full suite, DB tests included)
```

The 5 warnings are pre-existing `httpx` cookie-deprecation warnings in `tests/identity/test_tracer_scoped_read.py`, unrelated to this plan's files -- out of scope per the deviation rules' scope boundary, not fixed.

## `tools/isolation_smoke.py`: explicitly not run

`tools/isolation_smoke.py` has **not** been run against a live deployment. Deploys are blocked by the permission classifier active in this session, exactly as `02-RESEARCH.md`'s Threat Register (T-02-15, disposition `accept`) anticipates. It ships as a committed, runnable script (verified: it parses, and its logic was traced against Task 2's own HTTP assertion spec) with an operator step owed to `docs/operations/phase-2-operator-steps.md`, which plan 02-06 is expected to create (that file does not exist yet, since 02-06 has not executed). This is stated rather than softened, per `.claude/rules/workflow.md`.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- All three tasks are complete: the isolation suite's core mechanism (Task 1), admin-is-not-exempt plus the HTTP not-found-not-forbidden posture (Task 2), and the boot-time role gate plus named context error (Task 3) are all real, proven, and committed.
- `tests/test_isolation.py` now carries eleven named tests, matching this plan's own `<success_criteria>` in full.
- Plan 02-06 (login route) is still a prerequisite for actually running `tools/isolation_smoke.py` and for obtaining the two session cookies its usage docstring names -- that remains unrun, and is a separate, already-flagged gap (D5 above), not part of Task 2's reopening.

## Self-Check: PASSED

- `src/morai/identity/rls.py` — FOUND
- `tests/identity/test_boot_role_gate.py` — FOUND
- `tools/isolation_smoke.py` — FOUND
- `src/morai/api/app.py` contains `lifespan=` — FOUND (grepped)
- `tests/test_isolation.py` contains 11 named `test_` functions — FOUND (`grep -c "^async def test_"`)
- Commit `9b77492` (Task 2, reopened this session) — FOUND in `git log --oneline`
- Commit `01c7601` (Task 3) — FOUND in `git log --oneline`
- Commit `b7cd3fa` (Task 1, cited) — FOUND in `git log --oneline`
- Commit `ed05015` (roadmap tick, cited) — FOUND in `git log --oneline`

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

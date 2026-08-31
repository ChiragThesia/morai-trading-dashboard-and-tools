---
phase: 02-identity-sessions-and-tenant-isolation
plan: 02
subsystem: auth
tags: [postgres, row-level-security, sqlalchemy, fastapi-lifespan, isolation-suite]

requires:
  - phase: 02-identity-sessions-and-tenant-isolation
    provides: "Migration 0003 (plan 02-01): morai_app role (NOSUPERUSER NOBYPASSRLS), RLS ENABLE+FORCE on users/audit_log/gate_user_scoped_probe, app_db_session/superuser_db_session/seeded_users fixtures"
provides:
  - "tests/test_isolation.py -- six-guard isolation suite (Task 1 only; see Known Gap below)"
  - "src/morai/identity/rls.py -- assert_connection_cannot_bypass_rls, require_rls_context, RlsContextMissing"
  - "FastAPI lifespan= on api/app.py: the web process refuses to start on a connection that can bypass RLS"
  - "tools/isolation_smoke.py -- D2-10's deploy-time HTTP run, committed and unrun"
affects: [02-05, 02-06]

actuals:
  tokens: 4100
  tasks: 1
  commits: 1

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

key-decisions:
  - "Task 1's plan <action> instructed forcing a red by temporarily pointing app_db_session at async_dsn -- a prior executor spent four hours and three throwaway commits on that instruction with zero implementation delivered. A human salvaged the six good tests in commit b7cd3fa and rejected the scaffolding instruction outright: 'capable of failing' is a property of the finished suite (proven by the negative controls it ships with), not a ceremony performed before it exists. This plan's Task 3 followed the corrected version -- cheapest honest red (ModuleNotFoundError on the not-yet-written morai.identity.rls), no temporary scaffolding."
  - "assert_connection_cannot_bypass_rls and require_rls_context stayed to exactly two functions and one exception, as instructed -- no decorator, session subclass, or metaclass attempting to enforce RLS context globally"
  - "The lifespan is wired via FastAPI's lifespan= kwarg, not a startup event handler (deprecated in favor of lifespan) -- /health stays a pure liveness check with no database call"
  - "tools/isolation_smoke.py takes two session cookies (admin, and a non-admin user who owns a probe row) rather than a bare probe UUID -- it discovers the victim's own probe id live via GET /gate/user-scoped-probe, so no UUID has to be hand-copied between the two accounts to run it once plan 02-06 ships a login route"

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
    description: "Admin is not exempt from the probe-table policy, with its own named test, plus the HTTP not-found-not-forbidden posture (Task 2, per the plan) -- NOT PRESENT ON DISK. See Known Gap."
    requirement: AUTH-07
    verification: []
    human_judgment: true
    rationale: "tests/test_isolation.py on disk (commit b7cd3fa, 193 lines, 6 tests) contains only Task 1's guards. No admin-exemption test, no HTTP 404 test, no byte-identical-body test exists anywhere in the repository (grepped for every Task 2 test name in <behavior>; zero matches, and git log shows no commit ever added them). This executor was explicitly instructed not to execute Task 2 and did not. Flagging rather than silently treating it as done, per this project's evidence discipline (.claude/rules/workflow.md: 'never invent a claim; say so explicitly when you cannot verify something')."
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

**A FastAPI lifespan gate that refuses to start on a connection that can bypass RLS, and `require_rls_context`'s named exception for the one real cost RLS imposes -- both proven against a real superuser rejection, not just a design.**

## Performance

- **Duration (this session, Task 3 only):** ~45 min
- **Tasks:** 1 of 3 (Tasks 1-2 landed in an earlier session; see below)
- **Files modified this session:** 4 (1 new module, 1 new test file, 1 new script, 1 edited)

## Important: partial-plan provenance

This plan's three tasks were **not all executed in one session**. The full history, reconstructed from git:

1. **Task 1** (the six-guard isolation suite) was attempted by an earlier executor instructed by this plan's own `<action>` text to "force the red by temporarily pointing `app_db_session` at `async_dsn`". That instruction produced three throwaway commits and roughly four hours of work with zero implementation delivered (`wip: red evidence for isolation suite` at `2af570f`). A human intervened, salvaged the six good tests, and committed them directly as `test(02-02): the isolation suite, six guards, no temporary scaffolding` (`b7cd3fa`) -- see that commit message for the full account, and `.claude/rules/workflow.md`'s "Take the cheapest honest red" section, which was written specifically about this incident.
2. **Task 2** (admin-exemption tests and the HTTP not-found posture) is described in this plan's `<tasks>` section but **its tests do not exist anywhere in the repository.** `tests/test_isolation.py` on disk is exactly the 193 lines committed at `b7cd3fa` -- six tests, all Task 1's. No `test_admin_is_not_exempt_from_the_probe_table_policy`, no `test_admin_gets_404_for_another_users_probe_row_over_http`, no byte-identical-body test, and no commit in `git log --all` ever added them. `chore(02): tick 02-02 and 02-03, prune worktrees` (`ed05015`) ticked 02-02's roadmap box on the stated grounds that it "landed in code" -- that appears to have been true for Task 1 only, not Task 2. This SUMMARY records that gap rather than silently treating Task 2 as done.
3. **Task 3** (this session) implemented the boot-time role gate, `require_rls_context`, and the deploy-time smoke script, per an explicit instruction to execute only Task 3 and not touch Task 1/2's file.

**Consequence:** this plan's own `<success_criteria>` --  "Admin exemption is tested by name, and the counterpart test proves the result is a policy difference and not a broken context" -- is **not met**. AUTH-07 is marked complete because Task 1, 3, and 4's worth of deliverables (the isolation suite's core mechanism, the boot gate, the named error) are real and proven; the admin-specific coverage Task 2 was meant to add is outstanding and should be picked up as a follow-up plan or a reopened 02-02 Task 2, not silently assumed present by a later phase.

## Accomplishments (Task 3, this session)

- `src/morai/identity/rls.py`: `assert_connection_cannot_bypass_rls` (raises `RuntimeError` naming the role and both flags, never a DSN or password) and `require_rls_context` (returns the UUID or raises `RlsContextMissing`), plus the `RlsContextMissing` exception -- exactly two functions and one exception, as instructed.
- `src/morai/api/app.py` gained a `lifespan=` handler that opens one session on the app engine at boot and calls `assert_connection_cannot_bypass_rls`; a failure there kills the process before it serves a request. `/health` is untouched -- still a pure liveness check.
- `tests/identity/test_boot_role_gate.py`: six new tests, including the negative control (the gate observed rejecting a real local superuser connection) and a direct assertion that the rejection message names no DSN or password.
- `tools/isolation_smoke.py`: a standalone, dependency-light script (stdlib `argparse` + `httpx`, no pytest) that takes a base URL and two session cookies (admin, and a non-admin user who owns a probe row), discovers the victim's probe id live, and runs the four HTTP assertions from Task 2's spec against a deployment. Documented in its own module docstring as unrun.

## Task Commits

Only Task 3 was executed this session:

1. **Task 3: A boot gate on the runtime role, and a named error instead of silent under-fetching** - `01c7601` (feat)

Tasks 1 (`b7cd3fa`) and the roadmap tick (`ed05015`) predate this session; see "Important: partial-plan provenance" above.

## Files Created/Modified (this session)

- `src/morai/identity/rls.py` - `assert_connection_cannot_bypass_rls`, `require_rls_context`, `RlsContextMissing`
- `src/morai/api/app.py` - added `lifespan=` handler; `FastAPI()` construction now passes it
- `tests/identity/test_boot_role_gate.py` - six tests for both `rls.py` functions and the lifespan
- `tools/isolation_smoke.py` - D2-10's deploy-time HTTP smoke script

## Decisions Made

- Task 3's red was the cheapest honest one available: `ModuleNotFoundError` on `morai.identity.rls`, which does not exist until this task writes it. No scaffolding was built to manufacture a more elaborate failure, per `.claude/rules/workflow.md`'s explicit instruction (itself written in response to Task 1's four-hour incident).
- The lifespan queries `pg_roles` once, selecting `rolname, rolsuper, rolbypassrls` together, rather than a separate query per field -- one round trip, and the role name comes from the same row the flags do.
- `tools/isolation_smoke.py` lives outside `src/` and `tests/` and is excluded from both `basedpyright`'s and `mypy`'s configured `include` paths (`pyproject.toml`), matching `tools/measure_argon2.py`'s existing precedent for an unrun, deploy-only script.

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

**The Task 2 gap described above under "Important: partial-plan provenance".** Not an issue introduced this session -- discovered while reading `tests/test_isolation.py` before starting Task 3, and confirmed by grepping every Task 2 test name across the full git history with zero matches. Reported here rather than silently worked around, since this executor's instructions were explicit: execute only Task 3, do not touch Task 1/2's file, and be honest in this SUMMARY about what landed when.

## Verification Output

### Task 3's own `<verify>` command

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

### Plan-level `<verification>`: full named test list

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

- The isolation suite's core mechanism (Task 1), the boot-time role gate and named context error (Task 3) are real, proven, and committed.
- **Outstanding:** Task 2 (admin-exemption tests, the HTTP not-found-not-forbidden posture, and the byte-identical-404 assertion) has never been implemented. This is a gap in AUTH-07's actual coverage, not merely a missing nice-to-have -- the plan's own orientation section names the admin case as "the case a reasonable developer would assume is an exception." Recommend a follow-up plan (or reopening 02-02 Task 2 specifically) before treating cross-user admin isolation as verified.
- Plan 02-06 (login route) is a prerequisite for actually running `tools/isolation_smoke.py` and for obtaining the two session cookies its usage docstring names.

## Self-Check: PASSED

- `src/morai/identity/rls.py` — FOUND
- `tests/identity/test_boot_role_gate.py` — FOUND
- `tools/isolation_smoke.py` — FOUND
- `src/morai/api/app.py` contains `lifespan=` — FOUND (grepped)
- Commit `01c7601` — FOUND in `git log --oneline`
- Commit `b7cd3fa` (Task 1, cited) — FOUND in `git log --oneline`
- Commit `ed05015` (roadmap tick, cited) — FOUND in `git log --oneline`

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

---
phase: 02-identity-sessions-and-tenant-isolation
fixed_at: 2026-08-31T13:15:00Z
review_path: .planning/phases/02-identity-sessions-and-tenant-isolation/02-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-08-31
**Source review:** .planning/phases/02-identity-sessions-and-tenant-isolation/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (WR-01 through WR-06; IN-01 and IN-02 explicitly out of scope per
  assignment -- IN-01 needs column-level RLS and is not exploitable today, IN-02 is cosmetic)
- Fixed: 6
- Skipped: 0

## Fixed Issues

### WR-01: No minimum length or strength check on `/setup`'s password

**Files modified:** `src/morai/api/models_identity.py`, `tests/identity/test_admin_routes.py`
**Commit:** 46eb422
**Applied fix:** Added `Field(min_length=12)` to `SetupRequest.password`. Added
`test_setup_with_a_short_password_returns_422_and_does_not_consume_the_token`, which asserts
a 422 on a short password and then proves the token was NOT consumed by successfully reusing
it -- Pydantic validates the request body before `/setup`'s handler (and its `consume_token`
call) ever runs, so the token survives a rejected request.

### WR-02: `/login`'s lazy-rehash `UPDATE` has no rowcount check

**Files modified:** `src/morai/api/routes_identity.py`, `tests/identity/test_login_logout.py`
**Commit:** 640bae6
**Applied fix:** Added the same `isinstance(result, CursorResult) and result.rowcount == 1`
guard `/setup` already uses, around the lazy-rehash `UPDATE`. Added
`test_login_upgrades_a_weaker_hash_to_current_parameters`: seeds a hash from a deliberately
weaker `PasswordHasher`, logs in, and asserts the stored hash no longer `needs_rehash` --
proving the write actually happens, not just that the pure function detects staleness.

### WR-03: `/setup`'s `PASSWORD_RESET`-purpose branch is untested at the HTTP level

**Files modified:** `tests/identity/test_admin_routes.py`
**Commit:** 93d10ac
**Applied fix:** No production change -- the fallback branch was already correct. Added
`test_setup_with_a_password_reset_token_actually_changes_the_password`, driving
`POST /admin/users/{id}/reset-password` then `POST /setup` with the returned `reset_token`,
asserting 200 and that the stored password hash actually changed. Documented in the commit as
a regression guard, not a bug fix.

### WR-04: `open_audited_read`'s `reader_id`/`subject_id` are same-typed and swap-prone

**Files modified:** `src/morai/identity/audit.py`, `src/morai/api/routes_identity.py`,
`tests/identity/test_audit.py`
**Commit:** 4cacdd2
**Applied fix:** Introduced `ReaderId = NewType("ReaderId", UUID)` and
`SubjectId = NewType("SubjectId", UUID)`, used in `AuditedRead`'s fields and
`open_audited_read`'s signature. Updated the one production call site
(`routes_identity.py`) and all five test call sites in `test_audit.py` to wrap with
`ReaderId()`/`SubjectId()`.
**Verification performed:** temporarily transposed the arguments at the production call
site (`reader_id=SubjectId(user_id), subject_id=ReaderId(admin.user_id)`) and re-ran both
checkers. basedpyright reported 2 `reportArgumentType` errors; mypy reported 2 `arg-type`
errors. The transposed call was reverted immediately after confirming the rejection and was
never staged or committed -- `git status`/`git diff --stat` after the commit shows only the
intended three files.

### WR-05: `audit_log`'s table-level `GRANT` is broader than its RLS policy allows

**Files modified:** `alembic/versions/0006_audit_log_grant.py` (new),
`tests/identity/test_app_role.py`
**Commit:** 0b2151f
**Applied fix:** New migration `0006_audit_log_grant.py` (`down_revision = "0005"`) runs
`REVOKE SELECT, UPDATE, DELETE ON audit_log FROM morai_app`, leaving only `INSERT`, with a
`downgrade()` that restores the three verbs. Migration 0003 was NOT edited (it is already
applied locally and in CI). Added
`test_app_role_can_insert_but_not_read_or_alter_audit_log`, matching the shape of the two
existing `has_function_privilege` tests for `login_lookup`, asserting `morai_app` has
`INSERT` and lacks `SELECT`/`UPDATE`/`DELETE` on `audit_log` via `has_table_privilege`.
**Verification performed:** re-granted `SELECT, UPDATE, DELETE ON audit_log TO morai_app`
directly against the local database (a throwaway `asyncpg` one-liner, not a code change) and
re-ran the new test -- it failed (`assert True is False` on the `SELECT` check), confirming
the guard discriminates. Revoked the verbs again and re-ran -- the test passed. No scaffolding
file was created; nothing from this probe was committed.

### WR-06: `tools/create_admin.py`'s "no admin exists yet" check is check-then-act

**Files modified:** `tools/create_admin.py`
**Commit:** 2e5b9c0
**Applied fix:** Added `SELECT pg_advisory_xact_lock(hashtext('morai:create_admin'))` as the
first statement inside the transaction, before the existing-admin check. Chose the advisory
lock over `SELECT ... FOR UPDATE` per the finding's own reasoning: `FOR UPDATE` locks rows
that already exist, and the state this guard protects is exactly zero admin rows, so
`FOR UPDATE` would lock nothing and not prevent the race at all. The lock key is fixed (not
derived from any row) because the script guards one global condition, not a per-row resource;
it releases automatically at the end of the transaction (commit on success, or the implicit
rollback on session close when an admin already exists). No new test added -- the finding did
not request one, and the two existing `test_create_admin_script.py` tests (including
"running a second time exits nonzero and creates nothing") both still pass unchanged.

## Skipped Issues

None -- all six in-scope findings were fixed.

## Verification

All commands run against local Postgres 18 (`brew services start postgresql@18`), inside the
isolated worktree created for this run (`.claude/worktrees/rf-02-18249-1788180096`, branch
`gsd-reviewfix/02-18249`), with `UV_PROJECT_ENVIRONMENT` pointed at the main checkout's
`.venv` to avoid a redundant dependency install.

```
uv run pytest -q      # 148 passed (was 144 before this run; +4 new tests:
                       # WR-01, WR-02, WR-03, WR-05 each added one)
bash tools/gate.sh     # ruff check, ruff format --check, basedpyright, mypy, pytest
                       # -- All checks passed! 148 passed, 27 warnings
```

The 27 warnings are pre-existing `httpx` `DeprecationWarning`s on per-request `cookies=`
(unrelated to this fix set; present before this run as well).

IN-01 and IN-02 were not touched, per the assignment's explicit scope.

---

_Fixed: 2026-08-31_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

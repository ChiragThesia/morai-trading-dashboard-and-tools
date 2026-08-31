---
phase: 02-identity-sessions-and-tenant-isolation
reviewed: 2026-08-31T00:00:00Z
depth: standard
files_reviewed: 37
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - alembic/versions/0003_identity_and_rls.py
  - alembic/versions/0004_login_lookup.py
  - alembic/versions/0005_revoke_public_login_lookup.py
  - docs/operations/phase-2-operator-steps.md
  - pyproject.toml
  - src/morai/api/app.py
  - src/morai/api/models_identity.py
  - src/morai/api/routes_identity.py
  - src/morai/db/models.py
  - src/morai/db/session.py
  - src/morai/identity/audit.py
  - src/morai/identity/passwords.py
  - src/morai/identity/rls.py
  - src/morai/identity/sessions.py
  - src/morai/identity/setup_tokens.py
  - src/morai/identity/tokens.py
  - src/morai/settings.py
  - tests/gate/fixtures/violation_unaudited_read.py
  - tests/gate/test_type_gate.py
  - tests/identity/conftest.py
  - tests/identity/test_admin_routes.py
  - tests/identity/test_app_role.py
  - tests/identity/test_audit.py
  - tests/identity/test_boot_role_gate.py
  - tests/identity/test_create_admin_script.py
  - tests/identity/test_login_logout.py
  - tests/identity/test_passwords.py
  - tests/identity/test_setup_tokens.py
  - tests/identity/test_tracer_scoped_read.py
  - tests/test_isolation.py
  - tests/test_settings.py
  - tests/test_worker_heartbeat.py
  - tools/create_admin.py
  - tools/isolation_smoke.py
  - tools/measure_argon2.py
findings:
  critical: 0
  warning: 6
  info: 2
  total: 8
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-31
**Depth:** standard
**Files Reviewed:** 37
**Status:** issues_found

## Summary

This phase's core claim — no request can reach another user's data — holds up under adversarial
reading. `login_lookup`'s `SECURITY DEFINER` pair (0004/0005) is correctly scoped (two columns,
one row, `search_path` pinned, `PUBLIC EXECUTE` revoked) and the RLS policies on `users` and
`gate_user_scoped_probe` fail closed by construction, confirmed by both a negative test (app role)
and a positive control (superuser) in `tests/test_isolation.py`. `consume_token`'s single
`DELETE ... RETURNING` is a genuine atomic consume (`NN-35`), proven under real concurrency in
`test_concurrent_consume_produces_exactly_one_winner`. `open_audited_read`'s use of raw `text()`
INSERT to dodge SQLAlchemy's implicit `RETURNING` against an INSERT-only RLS policy is correct and
tested for both the commit and rollback cases (D2-12). Timing/existence-disclosure discipline
(`T-02-36`, `D2-08`) is real: unknown-username and wrong-password pay one Argon2 verify each and
return byte-identical bodies, and the two probe routes' 404s are asserted byte-identical including
for the admin-reading-another-user's-row case.

No Critical finding — no path was found that reaches another user's data, bypasses RLS, leaks a
secret, or contains a broken atomic consume. The findings below are Warnings: real, bounded-impact
gaps, several of them in verification coverage rather than in the production code path itself, plus
two Info-level structural notes for future work.

## Warnings

### WR-01: No minimum length or strength check on `/setup`'s password

**File:** `src/morai/api/models_identity.py:29-31`, `src/morai/api/routes_identity.py:181-239`
**Issue:** `SetupRequest.password: str` carries no `min_length` or complexity constraint, and
`hash_password(body.password)` in the `/setup` handler accepts any string, including `""`. Anyone
holding a valid `SETUP` or `PASSWORD_RESET` token — which the admin hands off out of band, or which
a user requests for themselves — can set the account's password to the empty string or a
single character. `passwords.py`'s own docstring frames the higher Argon2id band as justified
because "these accounts are linked to brokerage credentials"; the hashing strength is moot if the
input to it is trivially guessable.
**Fix:**
```python
class SetupRequest(ApiModel):
    token: str
    password: str = Field(min_length=12)
```

### WR-02: `/login`'s lazy-rehash `UPDATE` has no rowcount check, unlike `/setup`'s identical case

**File:** `src/morai/api/routes_identity.py:302-310`
**Issue:** `/setup`'s password `UPDATE` explicitly checks `result.rowcount != 1` and raises if the
RLS context didn't take (T-02-29's own named mechanism: an `UPDATE` against an RLS-protected table
with no matching context silently matches zero rows and reports success). The lazy-rehash `UPDATE`
a few lines above in `/login` performs the exact same class of write — same table, same
context-dependence — with no rowcount check at all. Today this is provably safe (the context was
just set two statements earlier, same transaction), but a future regression that broke that
ordering would silently and permanently prevent legacy-parameter password hashes from ever being
upgraded: no error, no log line, and login itself still succeeds (the password was already verified
against the *old* hash before this `UPDATE` runs), so nothing would ever surface the failure. No
test exercises this path at all — `test_needs_rehash_...` in `tests/identity/test_passwords.py`
tests the pure function, not `/login`'s use of it; `tests/identity/test_login_logout.py` never logs
in with a weaker-parameter hash to confirm the row actually gets rewritten.
**Fix:** Add the same `isinstance(result, CursorResult) and result.rowcount == 1` guard used in
`/setup`, and add an integration test that seeds a user with a hash produced by a weaker
`PasswordHasher`, logs in, and asserts `password_hash` in the database now satisfies
`needs_rehash(...) is False`.

### WR-03: `/setup`'s `PASSWORD_RESET`-purpose branch is untested at the HTTP level

**File:** `src/morai/api/routes_identity.py:206-212`, `tests/identity/test_admin_routes.py`,
`tests/identity/test_setup_tokens.py`
**Issue:** `/setup` tries `consume_token(..., purpose=TokenPurpose.SETUP)` first, then falls back
to `consume_token(..., purpose=TokenPurpose.PASSWORD_RESET)`. Every test that drives `/setup` over
HTTP (`test_admin_routes.py`) only ever does so with a token issued by `POST /admin/users`, which
is always `TokenPurpose.SETUP`. `test_admin_routes.py`'s reset-password test stops at asserting a
token was issued and one audit row was written — it never calls `/setup` with that token.
`test_setup_tokens.py` exercises `consume_token` directly with `TokenPurpose.PASSWORD_RESET`, but
never through the route. The fallback branch that makes a password-reset link actually usable has
no coverage proving it works end to end.
**Fix:** Add a test that calls `POST /admin/users/{id}/reset-password`, then `POST /setup` with the
returned `reset_token`, and asserts 200 plus the password hash actually changed.

### WR-04: `open_audited_read`'s `reader_id`/`subject_id` are same-typed, swap-prone, and unguarded

**File:** `src/morai/identity/audit.py:72-104`
**Issue:** Both parameters are plain `UUID` keyword arguments with no type-level distinction. A
future call site that writes `open_audited_read(session, reader_id=user_id, subject_id=admin.user_id)`
— transposed relative to the one correct call in `routes_identity.py:159-161` — type-checks cleanly
under both mypy and basedpyright and passes at runtime, silently writing an audit row that records
the *subject* as having read the *admin's* row rather than the reverse. The audit log's entire value
is as a forensic/compliance record of who read what; a swapped pair corrupts that record with
nothing — no test, no type error, no runtime check — to catch it. The module's own docstring
carefully reasons about the forged-capability case (`AuditedRead` built by hand) and about the
commit/rollback fate-sharing, but says nothing about protecting the two `UUID`s from being passed
in the wrong order.
**Fix:** A `NewType` (or two single-field dataclasses) for `ReaderId`/`SubjectId` would make a swap
a real type error rather than a same-shaped `UUID` accepted either way; short of that, name the
parameters distinctively enough in a call-site convention and add a test asserting the one existing
call site passes them in the documented order (e.g. assert on `AuditLog.reader_id == admin.user_id`
specifically, which `test_reset_password_writes_exactly_one_audit_log_row` already does — the gap
is that nothing would catch a *second*, future call site getting it backwards).

### WR-05: `audit_log`'s table-level `GRANT` is broader than its RLS policy allows, undermining
defense-in-depth for the one table whose whole point is tamper-resistance

**File:** `alembic/versions/0003_identity_and_rls.py:196-207`, `alembic/versions/0003_identity_and_rls.py:256-260`
**Issue:** The migration grants `SELECT, INSERT, UPDATE, DELETE` uniformly to `morai_app` across
all five identity tables in one loop, including `audit_log`. `audit_log` then gets a single
`append_only` policy: `FOR INSERT WITH CHECK (true)`, with no `SELECT`/`UPDATE`/`DELETE` policy at
all. Today that's safe — `FORCE ROW LEVEL SECURITY` plus the absence of a matching policy means
those three verbs default-deny for `morai_app` regardless of the table-level grant. But the
guarantee `identity/audit.py`'s own docstring states — "the app role can append and cannot read its
own trail back" — currently rests *entirely* on RLS being correctly configured, with no
independent floor at the GRANT layer. A single future migration that adds an overly permissive
`SELECT`/`UPDATE`/`DELETE` policy on `audit_log` (easy to do by copy-pasting `gate_user_scoped_probe`'s
`FOR ALL` shape, which this migration explicitly warns readers not to do for a different reason)
would, combined with the grant already in place, immediately make the audit trail readable and
alterable by the app role — no second line of defense would need to fail, only one.
**Fix:** Grant only what `audit_log` actually needs:
```python
bind.execute(sa.text("GRANT INSERT ON audit_log TO morai_app"))
```
and move it out of the uniform `SELECT, INSERT, UPDATE, DELETE` loop, matching the "named
individually per table" discipline the migration already applies to which *tables* get access.

### WR-06: `tools/create_admin.py`'s "no admin exists yet" check is check-then-act, not atomic

**File:** `tools/create_admin.py:44-58`
**Issue:** The script's stated purpose is to refuse a second admin creation ("a second unnoticed
admin is a second unnoticed cross-user reach"). The guard is a plain `SELECT` followed later by an
`INSERT`, with no unique constraint or advisory lock preventing two concurrent invocations from
both observing zero admins and both proceeding to create one. This is a bootstrap script normally
run once by a human, so the likelihood is low, but the failure mode is exactly the one the script's
own docstring names as unacceptable, and it is plausible in practice (e.g. a deploy runbook or a
human re-running the same `railway run` command after a slow first attempt with no visible output
yet).
**Fix:** Wrap the check-and-insert in a single transaction using `SELECT ... FOR UPDATE` against
`users WHERE is_admin`, or take a Postgres advisory lock (`pg_advisory_xact_lock`) around the whole
block, so two concurrent runs serialize instead of racing.

## Info

### IN-01: `users`' `self_or_admin` policy has no column-level restriction on self-writes

**File:** `alembic/versions/0003_identity_and_rls.py:237-255`
**Issue:** `WITH CHECK (id = current_setting('app.current_user_id', true)::uuid OR ...)` permits a
user to write *any* column of their own row, including `is_admin`. Today this is not exploitable —
the only write to `users` scoped by a non-admin's own context is `/setup`'s `UPDATE ... SET
password_hash = ...`, which never touches `is_admin`. Worth recording so a future route that lets a
user update their own profile doesn't inherit unrestricted column access without noticing; RLS
policies in Postgres constrain rows, not columns, so this has to be an application-level discipline
(explicit `.values(password_hash=...)`, never a broader `update(User).values(**body.model_dump())`)
rather than something the policy itself can enforce.

### IN-02: `tools/isolation_smoke.py` doesn't check `admin_listing`'s status before parsing it

**File:** `tools/isolation_smoke.py:102-103`
**Issue:** Every other response in this script is guarded with a status-code check before `.json()`
is called (see the very first check on `listing`), except `admin_listing`, whose `.json()` is
called unconditionally. A non-200 response here (e.g. the admin session expired between calls) will
raise inside the operator's smoke-test run with a `JSONDecodeError` or similar, rather than
reporting a clean `isolation_smoke: FAILED` line like every other failure mode in this script.

---

_Reviewed: 2026-08-31_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

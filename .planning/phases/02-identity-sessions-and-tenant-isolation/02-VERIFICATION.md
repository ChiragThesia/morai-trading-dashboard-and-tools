---
phase: 02-identity-sessions-and-tenant-isolation
verified: 2026-08-31T00:00:00Z
status: human_needed
score: 4/5 must-haves verified (1 routed to human verification, 0 failed)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run docs/operations/phase-2-operator-steps.md Steps 1-4 against the real Railway deployment: set MORAI_APP_DB_PASSWORD on both services, deploy and confirm the migration chain (0003-0006) applies, then run `tools/isolation_smoke.py` against https://web-production-183cf.up.railway.app with a real admin cookie and a real non-admin cookie."
    expected: "`isolation_smoke: all checks passed`, exit 0 -- the same not-found/not-forbidden isolation claim CI already proves, now proven against the actual deployed service and its actual (currently-unconfirmed) connection role."
    why_human: "Requires Railway deploy/variable-set access this session does not have. Not a code gap -- the mechanism (RLS + morai_app + no pooler) is fully proven in CI against a topology the phase's own research confirms is the same kind as Railway's (direct connection, no pooler). But the deployed web/worker services do not yet have MORAI_APP_DB_PASSWORD set at all, so no isolation claim has actually been exercised against the live service yet -- only inferred from CI plus a topology finding."
  - test: "Run `tools/measure_argon2.py` against the real Railway `web` container (`railway run --service web uv run python tools/measure_argon2.py`) and compare the 128MiB/t=3/p=1 row against the 250-400ms OWASP band."
    expected: "The container's measured time lands in the 250-400ms band, or the documented fallback (reduce time_cost before memory_cost) is applied and re-measured."
    why_human: "Requires Railway container access. Two independent laptop measurements (M1 Pro in 02-RESEARCH.md, this session's local run in 02-03-SUMMARY.md) agree with each other but neither is a Railway container measurement, and D2-03 explicitly requires the container number, not a laptop's. This does not gate any of the four ROADMAP success criteria directly -- it strengthens criterion 1's password-hashing quality but the criterion's own text does not name a timing band -- included here because it is an explicitly owed, unclosed item from this phase's own record."
---

# Phase 2: Identity, Sessions, and Tenant Isolation Verification Report

**Phase Goal:** Accounts exist, sessions are invalidated server-side, and no request can reach another user's data.
**Verified:** 2026-08-31
**Status:** human_needed
**Re-verification:** No — initial verification

## Method

Every claim below was checked against the codebase and a live local Postgres 18 instance
(`brew services start postgresql@18`, `DATABASE_URL=postgresql://morai:morai@localhost:5432/morai`),
not against SUMMARY.md prose. The full local suite and gate were re-run independently:

```
$ uv run pytest -q
148 passed, 27 warnings in 21.69s

$ bash tools/gate.sh
All checks passed!                            # ruff check
52 files already formatted                    # ruff format --check
0 errors, 0 warnings, 0 notes                  # basedpyright
Success: no issues found in 52 source files    # mypy
148 passed, 27 warnings in 21.69s              # pytest
```

This matches 02-REVIEW-FIX.md's claimed post-fix state exactly (148 passed, all four gate
jobs clean) and confirms it independently rather than trusting the SUMMARY's own paste.
`alembic current` on the local database reports `0006 (head)`, matching the six migrations
on disk.

Beyond running the suite, RLS state, grants, and function security were queried directly
against the live database rather than read off migration source (per this project's own
"verify against the thing itself" rule):

```
morai_app role flags (rolsuper, rolbypassrls): (False, False)
audit_log grants for morai_app: [('audit_log', 'INSERT')]        -- WR-05, confirmed live
RLS enable/force flags: users=(T,T) audit_log=(T,T)
  gate_user_scoped_probe=(T,T) sessions=(F,F) setup_tokens=(F,F)  -- matches design intent
login_lookup: prosecdef=True, proacl=['morai=X/morai', 'morai_app=X/morai']
  (no bare '=X/morai' entry -- PUBLIC EXECUTE is in fact revoked, migration 0005 confirmed live)
morai_app EXECUTE on login_lookup(text): True
```

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Admin can create an account and issue a setup link that works exactly once (a second use is rejected, including under real concurrency), and can reset a password with no email service anywhere in the loop | ✓ VERIFIED | `identity/setup_tokens.py::consume_token` — single `DELETE...RETURNING`, Postgres MVCC guarantees exactly one winner. `tests/identity/test_setup_tokens.py::test_concurrent_consume_produces_exactly_one_winner` — **two independent `create_async_engine`s, two independent connections**, `asyncio.gather`, asserts exactly one non-`None` result — this is a real concurrency proof, not a sequential double-call. `test_second_consume_returns_none_and_the_row_is_gone`, `tests/identity/test_admin_routes.py::test_consuming_the_same_token_a_second_time_returns_400` cover sequential reuse. `grep -rniE "smtp\|sendgrid\|mailgun\|import email"` over `src/morai/` returns nothing — no email service exists in this codebase at all. Re-run locally: all 6 tests in `test_setup_tokens.py` pass. |
| 2 | A logged-in user stays logged in across a browser restart, and after logout a replayed session cookie is rejected because the session was destroyed server-side | ✓ VERIFIED | `api/routes_identity.py::login` sets `morai_session` with `max_age=2592000` (30 days) — a persistent, not a session, cookie; observed live: `Max-Age=2592000; HttpOnly; SameSite=lax; Secure`. `logout` runs `delete(SessionRow)...` then `session.commit()` — the row, never a flag. `tests/identity/test_login_logout.py::test_logout_deletes_the_row_and_the_replayed_cookie_is_rejected` asserts **both facts in one function**: reads `sessions` through the superuser connection and gets `rows == []`, *then* replays the same cookie against `GET /me` and gets `401` — exactly the shape this project's own D2-05 decision requires (a client-side-only logout would pass a test that checked either fact alone but fails this one). `test_persistent_cookie_survives_a_client_restart` and `test_logging_out_twice_returns_the_same_result_the_second_time` (idempotent-looking 401, not a silent 204) also verified locally. |
| 3a | A request authenticated as user A that asks for user B's trading data returns not-found, not forbidden, **including when A is the admin** | ✓ VERIFIED | Live DB query confirms `users`/`audit_log`/`gate_user_scoped_probe` all have RLS `ENABLE`+`FORCE` set; `sessions`/`setup_tokens` deliberately do not (token possession is the authorization for those, documented as such). `gate_user_scoped_probe`'s policy (`user_id = current_setting('app.current_user_id')::uuid`) carries **no admin clause** — confirmed both in the migration and by direct query of `pg_policies`. `tests/test_isolation.py`'s 11 named tests, re-run locally, all pass, including the two adversarial-per-the-project's-own-standard guards: a **superuser positive control** (`test_the_identical_select_as_superuser_returns_every_seeded_row`) proving a green "zero rows" test isn't measuring an empty table, and `test_admin_is_not_exempt_from_the_probe_table_policy` paired with its counterpart `test_admin_can_read_another_users_account_row` (same connection, same context, opposite results — proves the zero-rows result is a policy difference, not a broken `app.is_admin` context). HTTP-level: `test_admin_gets_404_for_another_users_probe_row_over_http` and `test_the_two_404_bodies_are_byte_identical` (compares raw `response.content`, not parsed JSON, headers minus `X-Request-Id`) confirm a 404, never a 403, and that the body cannot be used to distinguish "exists, not yours" from "does not exist." All 11 tests re-run and pass locally. |
| 3b | ...**and the isolation suite passes against the real Railway pooling configuration, rather than only a direct-connection test container** | ⚠️ Human verification required — see below | **Partially met, and the partial-vs-full distinction matters.** The *design question* the criterion cares about (does RLS's `SET LOCAL`-equivalent context survive whatever pooling Railway uses) is genuinely resolved: `02-RESEARCH.md` fetched Railway's own docs live (pooling is opt-in, added via a separate PgBouncer feature, not present by default) and cross-checked `railway variables` output live, finding one un-pooled `DATABASE_URL` with no `DATABASE_UNPOOLED_URL` sibling — the signal Railway's own PgBouncer doc says only appears once pooling is added. That is a real, evidenced finding, not an assumption, and it means CI's direct-connection Postgres container is "the same topology in kind, not a lesser stand-in" (ROADMAP.md's own phrase) as far as the pooling *mechanism* is concerned. **But the criterion's literal text asks for the suite to pass against the real deployed configuration, and that has not happened.** `docs/operations/phase-2-operator-steps.md` — written by this same phase, not by this verification — states plainly that none of its four steps have run: `MORAI_APP_DB_PASSWORD` is not yet set on either Railway service, so the deployed `web`/`worker` processes cannot currently even connect as `morai_app` (they would fail at the point of use, per that doc's own wording) — meaning RLS may not be in effect on the live deployment *at all* right now, pooler or no pooler. `tools/isolation_smoke.py` (D2-10's deploy-time HTTP run) is committed, parses cleanly, and its logic was traced against the same HTTP assertions `test_isolation.py` proves locally — but it has never been executed against a live URL. This is not a code defect this session can fix; it requires Railway deploy/variable-set access. Routed to `human_verification` below rather than marked passed or failed. |
| 4 | Every privileged read of user data writes an audit row naming reader, subject, and time, and a privileged read that bypasses the audited path does not compile or does not pass review | ✓ VERIFIED | `identity/audit.py::open_audited_read` writes the `audit_log` row via `text()` INSERT (deliberately not `insert(AuditLog).values(...)`, which would trigger an implicit `RETURNING` that RLS's INSERT-only policy rejects — a real bug found and fixed against CI Postgres, not merely designed around) and returns an `AuditedRead` capability that `get_user_for_management` requires as its only accepted proof type. D2-12 (same-transaction fate-sharing): `tests/identity/test_audit.py::test_open_audited_read_rollback_leaves_zero_rows` proves a rollback undoes both the audit row and the read's effects together. **The "does not compile" claim was independently re-verified, not taken on trust:** `tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[basedpyright-unaudited_read-reportArgumentType]` and `[mypy-unaudited_read-arg-type]` each run the real checker as a subprocess against `tests/gate/fixtures/violation_unaudited_read.py` (a bare `UUID` passed where `AuditedRead` is required) and assert both a non-zero exit **and** the specific rule marker — not merely a bare exit-code check, which the module's own docstring explicitly says would be insufficient ("asserting only a non-zero exit would pass on the wrong failure"). `test_fixtures_excluded_from_real_gate_run` confirms the fixture doesn't itself break `tools/gate.sh`. `audit.py`'s own module docstring states the honest ceiling in three parts (what type-checks / what only a runtime guard catches — a forged `AuditedRead` built by hand, tested in `test_constructing_auditedread_directly_raises_runtime_error` — / what neither covers, a reviewer missing a new privileged surface entirely) and that self-assessment matches what the code actually does; it does not overclaim. WR-04's fix (`ReaderId`/`SubjectId` `NewType`s) additionally makes a transposed `reader_id`/`subject_id` call a type error, confirmed in `audit.py` source. Live DB query confirms `audit_log`'s table-level grant to `morai_app` is `INSERT` only (WR-05 fix, migration 0006) — an independent floor at the GRANT layer beneath the RLS policy, not merely at RLS. `identity/audit.py`'s own comment states this exact defense-in-depth reasoning. All 11 type-gate tests and all 5 audit tests re-run and pass locally. |

**Score:** 4/5 truths verified locally against evidence; 1 (3b) requires infrastructure access this session does not have and is not a code failure.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `alembic/versions/0003_identity_and_rls.py` | `morai_app` role, 5 tables, RLS enable+force, policies | ✓ VERIFIED | Applied at local head; role flags, RLS flags, and policy text all confirmed live against the database, not just read from the file |
| `alembic/versions/0004_login_lookup.py` | `SECURITY DEFINER` narrow anonymous read for login | ✓ VERIFIED | `prosecdef=True`; exposes only `(id, password_hash)`; applied |
| `alembic/versions/0005_revoke_public_login_lookup.py` | Revoke the default `PUBLIC EXECUTE` on `login_lookup` | ✓ VERIFIED | Live `proacl` shows no bare `=X/morai` (PUBLIC) entry; only owner and `morai_app` |
| `alembic/versions/0006_audit_log_grant.py` | Narrow `audit_log`'s table grant to `INSERT` only | ✓ VERIFIED | Live grant query returns exactly `[('audit_log', 'INSERT')]` for `morai_app` |
| `src/morai/identity/tokens.py`, `sessions.py`, `setup_tokens.py`, `passwords.py`, `audit.py`, `rls.py` | The identity subsystem | ✓ VERIFIED | All present, substantive (no stubs, no placeholder returns), wired into `api/routes_identity.py` and `api/app.py`'s `lifespan=` |
| `src/morai/api/routes_identity.py` | 8 routes: tracer x2, admin x2, setup, login, logout, me | ✓ VERIFIED | All 8 present, each backed by its own passing test(s) |
| `tests/test_isolation.py` | 11-guard isolation suite | ✓ VERIFIED | 11 named tests, all pass locally, all guards present (superuser positive control, third-user-no-rows, fail-closed unset context, `WITH CHECK` write test, admin-not-exempt + counterpart) |
| `tools/isolation_smoke.py`, `tools/create_admin.py`, `tools/measure_argon2.py` | Deploy-time scripts | ✓ VERIFIED (exist, parse, unrun) | Not run against Railway — see human_verification |
| `docs/operations/phase-2-operator-steps.md` | Operator runbook for the 4 blocked deploy steps | ✓ VERIFIED | Exists, states plainly which of its 4 steps have and have not run (none have) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `api/app.py` lifespan | `identity/rls.py::assert_connection_cannot_bypass_rls` | Called once at boot on the app-role engine | ✓ WIRED | Grepped and read directly: `lifespan=lifespan` on `FastAPI()` construction; `test_the_app_lifespan_startup_completes_against_the_app_engine` and the negative-control test (rejects a real local superuser connection) both pass |
| `api/routes_identity.py::login`/`setup` | `identity/rls.py::require_rls_context` (setup) / `set_config` (login) | Establishes `app.current_user_id` before any write to `users` | ✓ WIRED | Read directly in source; `/setup`'s `rowcount != 1` guard and `/login`'s matching WR-02 guard on the lazy rehash both present |
| `api/routes_identity.py::reset_password` | `identity/audit.py::open_audited_read` + `get_user_for_management` | The one privileged cross-user read | ✓ WIRED | Read directly; audit row and read share one transaction, one commit |
| `get_db_session` | `get_app_engine()` (the `morai_app`-role engine) | Every route's DB dependency | ✓ WIRED | Confirmed live: no route in this file executes as the superuser role |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| AUTH-01 | 02-05 | Admin creates account + single-use setup link | ✓ SATISFIED | Truth 1 above |
| AUTH-02 | 02-05, 02-06 | User sets password from link, consumed once | ✓ SATISFIED | Truth 1 above |
| AUTH-03 | 02-06 | User logs in, stays logged in across sessions | ✓ SATISFIED | Truth 2 above — **but REQUIREMENTS.md's own checkbox for AUTH-03 is still `[ ]` unchecked and its status table still says "Pending"; this is a stale bookkeeping entry, not a code gap.** `tests/identity/test_login_logout.py` (12+ tests) proves login end to end, re-run and confirmed passing. |
| AUTH-04 | 02-06 | Logout invalidates server-side | ✓ SATISFIED | Truth 2 above — **same stale-checkbox note as AUTH-03: REQUIREMENTS.md still shows `[ ]`/"Pending" despite the code and tests being complete.** |
| AUTH-05 | 02-05 | Admin resets password, no email | ✓ SATISFIED | Truth 1, Truth 4 above |
| AUTH-07 | 02-01, 02-02 | No cross-user data leak, including admin | ✓ SATISFIED (mechanism) / see 3b | Truth 3a above |
| AUTH-08 | 02-04 | Audited privileged reads, bypass rejected | ✓ SATISFIED | Truth 4 above |

**REQUIREMENTS.md discrepancy (not a code defect, flagged for correction):** AUTH-03 and AUTH-04 are marked complete in every phase artifact (02-06-SUMMARY.md's `requirements-completed` frontmatter, ROADMAP.md's phase-2 requirements list, and this verification's own direct test evidence) but `.planning/REQUIREMENTS.md` lines 18-19 and 173-174 still show them as `[ ]` / "Pending". This should be corrected as a documentation fix; it does not affect this verification's status determination since the underlying code and tests were checked directly.

**STATE.md discrepancy (also not a code defect):** `.planning/STATE.md`'s "Blockers/Concerns" section still lists "Phase 2: Postgres pooling topology on Railway (UNVERIFIED) — RLS safety depends on it" as an open decision, but `02-RESEARCH.md` and `ROADMAP.md`'s own phase-2 entry both record this as resolved (direct connection, no pooler, verified live against Railway's own CLI output and documentation) on the same date. The *topology question* is genuinely settled; what remains open is the *deployment verification* (truth 3b above), which is a different and narrower thing than what STATE.md's stale entry describes. Worth correcting STATE.md so a future reader doesn't re-open a question that already has an evidenced answer.

### Anti-Patterns Found

None of severity Blocker or Warning. Scanned every file this phase created or modified for `TODO`/`FIXME`/`HACK`/`XXX`/`TBD`/placeholder patterns, empty implementations, and hardcoded-empty data flowing to output — none found. The one `ponytail:` comment in `identity/sessions.py` (documenting the mid-handler-commit RLS-context gap as a known, not-yet-needed ceiling) is exactly the kind of scoped, honestly-labeled simplification this project's own conventions ask for, not a code smell — no route in this phase's scope commits mid-handler, confirmed by reading every route in `routes_identity.py`.

### Behavioral Spot-Checks

Not run as a separate pass — the full local test suite (148 tests, including all identity/isolation/audit/type-gate suites) was executed directly against real local Postgres as this verification's primary evidence, which is a stronger check than a handful of spot commands would add. `bash tools/gate.sh` was also run in full (ruff, basedpyright, mypy, pytest) and confirmed clean, matching 02-REVIEW-FIX.md's claimed final state exactly.

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention exists in this project; this phase does not declare probes in its plans. Not applicable.

## Gaps Summary

No blocking gaps. All four ROADMAP success criteria are met by the code, with one clause of
criterion 3 (the Railway-deployed pooling proof) unable to be closed from this session because
it requires live Railway deploy/variable-set access that is not available here — the same
constraint every plan in this phase already recorded honestly rather than working around. This
is the correct and expected state for a phase whose own operator runbook says its deployment
steps have not run yet; it is not a defect introduced by this verification.

Two documentation-accuracy items (REQUIREMENTS.md's stale AUTH-03/AUTH-04 checkboxes, STATE.md's
stale pooling-topology blocker) are noted above for correction but do not affect the phase's
functional completeness, which was checked against the code and a live database, not against
those files.

---

_Verified: 2026-08-31_
_Verifier: Claude (gsd-verifier)_

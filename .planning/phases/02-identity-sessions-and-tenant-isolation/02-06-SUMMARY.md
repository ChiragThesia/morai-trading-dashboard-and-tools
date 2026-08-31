---
phase: 02-identity-sessions-and-tenant-isolation
plan: 06
subsystem: auth
tags: [argon2, cookies, rls, security-definer, postgres, fastapi]

requires:
  - phase: 02-identity-sessions-and-tenant-isolation
    provides: "identity/tokens.py (generate_token/hash_token, plan 02-01), identity/passwords.py (hash_password/verify_password/needs_rehash, plan 02-03), the users/sessions schema and self_or_admin RLS policy (migration 0003, plan 02-01), setup_tokens.py and the account lifecycle routes (plan 02-05)"
provides:
  - "POST /login, POST /logout, GET /me -- the session lifecycle every later authenticated route in this project builds on"
  - "Migration 0004: login_lookup(text), a SECURITY DEFINER function closing the gap where users' FORCEd self_or_admin RLS policy made every login attempt return 401, correct password or not"
  - "docs/operations/phase-2-operator-steps.md -- the four Railway steps this session could not run, in dependency order, with what CI already proves stated first"
affects: [03-encryption]

actuals:
  tokens: 5394
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER Postgres function as the narrow escape hatch for the one read that must precede authentication -- exposes exactly the columns needed for exactly one row, never a wider RLS policy"
    - "Establish app.current_user_id only after password verification succeeds, then route every further write through the normal RLS-respecting morai_app path (mirrors /setup's consume-then-context ordering)"
    - "Dummy-hash timing control built once at import time from a fixed throwaway string, verified against on every login failure branch that would otherwise skip Argon2's cost"

key-files:
  created:
    - alembic/versions/0004_login_lookup.py
    - tests/identity/test_login_logout.py
    - docs/operations/phase-2-operator-steps.md
  modified:
    - src/morai/api/routes_identity.py
    - src/morai/api/models_identity.py

key-decisions:
  - "Added migration 0004 despite 02-01-SUMMARY's own 'no other Phase 2 plan may touch alembic/versions/' -- found as a Rule 1 bug during Task 1's own RED, not a choice: users' FORCEd self_or_admin policy requires an already-established app.current_user_id, which login cannot have before it authenticates the caller, so an ordinary ORM SELECT returned zero rows for every username, correct or not. A new migration is append-only, matching this project's own citation discipline; editing 0003 in place was never considered."
  - "Rejected a second, wider RLS policy (FOR SELECT USING (no context set)) in favor of a SECURITY DEFINER function -- a policy widens SELECT to every row in users for any code that queries it with no context; the function exposes exactly (id, password_hash) for exactly the one row a username names, and nothing else in users is reachable without an established context."
  - "The client-restart test (Task 1) proves persistence against /gate/user-scoped-probe, not /me -- /me is Task 2's own deliverable and did not exist when Task 1's tests were written and run to red/green, so Task 1 stays fully self-contained."
  - "Logout depends on get_current_user for its 401, not an idempotent delete-if-exists -- a second logout call with an already-invalid cookie gets the identical 401 an unauthenticated request gets, not a silent 204; this is the reading of the plan's 'raises nothing' that fit an already-established, file-wide convention (every other authenticated route in this file uses get_current_user for its 401)."

patterns-established:
  - "A migration that widens what an unauthenticated caller can read documents, in its own module docstring, the alternative it rejected and why -- the same 'honest ceiling' discipline audit.py already established for this phase."

requirements-completed: [AUTH-02, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "A user logs in with username and password and the session survives a browser restart, because the cookie carries an explicit expiry rather than being a session cookie"
    requirement: AUTH-03
    verification:
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_correct_credentials_return_200_and_a_well_formed_cookie"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_persistent_cookie_survives_a_client_restart"
        status: pass
    human_judgment: false
  - id: D2
    description: "The stored session token is a SHA-256 hash, never the raw token; no log record from the login path carries the password, the raw token, or the stored hash"
    requirement: AUTH-03
    verification:
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_stored_token_hash_is_sha256_of_raw_and_raw_appears_nowhere"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_no_log_record_from_login_contains_password_token_or_hash"
        status: pass
    human_judgment: false
  - id: D3
    description: "Wrong password and unknown username are indistinguishable in status and body; a user created but never set up (null password_hash) cannot log in with any password"
    requirement: AUTH-03
    verification:
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_wrong_password_returns_401_with_an_opaque_body"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_unknown_username_returns_a_body_byte_identical_to_wrong_password"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_a_user_never_set_up_cannot_log_in_with_any_password"
        status: pass
    human_judgment: false
  - id: D4
    description: "After logout the session row is gone from the database, and a replayed cookie is rejected because of that absence -- asserted together in one function"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_logout_deletes_the_row_and_the_replayed_cookie_is_rejected"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_logging_out_twice_returns_the_same_result_the_second_time"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_logout_with_no_cookie_returns_401"
        status: pass
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_one_users_logout_does_not_touch_another_users_session"
        status: pass
    human_judgment: false
  - id: D5
    description: "/me returns the caller's own record and no request shape can name another user's"
    requirement: AUTH-04
    verification:
      - kind: integration
        ref: "tests/identity/test_login_logout.py::test_me_returns_the_callers_own_record_and_nothing_names_another"
        status: pass
    human_judgment: false
  - id: D6
    description: "The cookie is built for a same-site UI, with the cross-site (World B) fork written down as three numbered config changes at the set_cookie call site"
    requirement: AUTH-03
    verification:
      - kind: unit
        ref: "src/morai/api/routes_identity.py login() -- the three-item comment beside response.set_cookie"
        status: pass
    human_judgment: false
  - id: D7
    description: "The operator runbook exists, names all four blocked steps in dependency order with exact commands, and states plainly what CI proves versus what nothing has proved yet"
    verification:
      - kind: manual_procedural
        ref: "docs/operations/phase-2-operator-steps.md"
        status: unknown
    human_judgment: true
    rationale: "The runbook itself was written and its structural check (test -f + grep -c 'railway') passed, but running the four steps against the real Railway deployment requires access this session does not have -- a human must actually execute Steps 1-4 to close this out, which is exactly what the runbook says has not happened."

duration: 55min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 6: Login, Logout, and /me Summary

**Login, logout and `/me` over a persistent, opaque session cookie -- plus a `SECURITY DEFINER` Postgres function (migration 0004) that this task discovered was required, since `users`' own row-level security otherwise makes login itself return 401 for every username, correct or not.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-08-31 (session continuation, base commit `a8222b3`)
- **Completed:** 2026-08-31
- **Tasks:** 3
- **Files modified:** 5 (2 created new-migration/doc pairs beyond the plan's own file list, 3 named in the plan's frontmatter)

## Accomplishments

- `POST /login`: verifies against Argon2id, inserts a `sessions` row (SHA-256 token hash, 30-day `expires_at`), sets a persistent `morai_session` cookie, and returns a body naming no identity. Both failure branches (unknown username, wrong password, and a never-set-up account) return the byte-identical 401 and each pays exactly one Argon2 verify -- the real hash on the wrong-password path, a module-level dummy hash everywhere else.
- **Migration 0004** (`login_lookup(text)`, `SECURITY DEFINER`): discovered as a genuine Rule 1 bug during Task 1's own RED-then-implement cycle. `users` carries a `FORCE`d `self_or_admin` RLS policy requiring an already-established `app.current_user_id` -- which login cannot have before it authenticates the caller. An ordinary `select(User).where(username=...)` returned zero rows for every username, confirmed against real local Postgres. The function exposes exactly `(id, password_hash)` for exactly the row a username names, never widening what an unauthenticated caller can read from `users` beyond that -- the alternative (a second, wider `FOR SELECT` RLS policy) was written out and rejected in the migration's own docstring, since Postgres RLS policies see row content and session settings, never a query's `WHERE` clause, so a wider policy would open every row, not one.
- `POST /logout`: deletes the `sessions` row by `token_hash` and clears the cookie (204) -- never a flag. Row-absence and the replayed-cookie 401 are asserted in one test function, matching D2-05's own instruction that splitting them apart lets a client-side-only logout pass.
- `GET /me`: returns the caller's own id, username and admin flag through `get_current_user`'s own RLS-scoped self-read.
- `docs/operations/phase-2-operator-steps.md`: the four Railway steps this session could not run (set `MORAI_APP_DB_PASSWORD`, deploy and confirm the migration chain, create the first admin, the two owed measurements), opening with what CI already proves.

## Task Commits

1. **Task 1: Login -- issue a session, persist it, and answer the same way for both wrong inputs** - `6e9b2fd` (feat)
2. **Task 2: Logout -- the row is gone, and that absence is why the replay fails** - `a4582fe` (feat)
3. **Task 3: The operator runbook** - `317dd8d` (docs)

**Plan metadata:** (this commit)

_Each task's tests were written first, run to a natural red, then implemented to green. Task 1's red: `assert 404 == 200` (no `/login` route existed). Task 2's red: `ImportError: cannot import name 'MeResponse'` (logout/me didn't exist yet). Neither red required scaffolding -- both are the cheapest honest red `.claude/rules/workflow.md` asks for._

## Files Created/Modified

- `alembic/versions/0004_login_lookup.py` - `login_lookup(text)`, a `SECURITY DEFINER` function narrowly exposing `(id, password_hash)` by username for the one read that precedes authentication
- `src/morai/api/models_identity.py` - `LoginRequest`, `LoginResponse`
- `src/morai/api/routes_identity.py` - `login`, `logout`, `me` routes; `MeResponse`; the module-level dummy Argon2 hash and UUID/str-or-None `TypeAdapter`s for the raw-SQL `login_lookup` row
- `tests/identity/test_login_logout.py` - twelve tests (seven login, five logout/`/me`)
- `docs/operations/phase-2-operator-steps.md` - the operator runbook

## Decisions Made

See `key-decisions` in frontmatter. Summary:

- Migration 0004 was necessary, not optional -- login is structurally impossible against `users`' existing RLS policy without an anonymous, narrowly-scoped read path. A `SECURITY DEFINER` function was chosen over a wider RLS policy specifically to avoid opening `users` to any unauthenticated caller, not just the one row a login attempt names.
- `login()` establishes the RLS context itself, immediately after the password verifies, so the lazy Argon2 rehash and every future touch of `users` from this route go through the normal `morai_app`/RLS path -- no second `SECURITY DEFINER` escape hatch was added for that.
- Task 1's persistence test uses `/gate/user-scoped-probe` (already authenticated, already existing) rather than `/me`, so Task 1 does not reach forward into Task 2's own deliverable.
- Logout's second call returns 401 (the same 401 an unauthenticated request gets), not a silent 204 -- chosen because the route depends on `get_current_user` for its auth check, matching every other authenticated route in this file, and because "raises nothing" reads most naturally as "no crash," not "always 204."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `users`' RLS policy makes every login attempt return 401, correct password or not**
- **Found during:** Task 1, first test run after implementing `/login` against `select(User).where(User.username == ...)`
- **Issue:** `users` carries migration 0003's `self_or_admin` policy, `FORCE`d. With no `app.current_user_id` context set -- which is exactly login's situation before it authenticates anyone -- that policy evaluates to `NULL OR NULL` and permits nothing. Every login attempt got zero rows back, confirmed against real local Postgres (not reasoned from the policy text alone).
- **Fix:** Migration 0004 adds `login_lookup(text)`, a `SECURITY DEFINER` function owned by the migration's own superuser role, exposing exactly `(id, password_hash)` for exactly the username requested. `login()` calls it via raw `text()` SQL instead of an ORM `select(User)`, and establishes `app.current_user_id` itself once the password verifies so every subsequent touch of `users` (the lazy rehash) goes through the normal RLS-respecting path.
- **Files modified:** `alembic/versions/0004_login_lookup.py` (new), `src/morai/api/routes_identity.py`
- **Verification:** All twelve tests in `tests/identity/test_login_logout.py` pass; full suite (142 tests) and `tools/gate.sh` (ruff, basedpyright, mypy, pytest) all green.
- **Committed in:** `6e9b2fd` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 -- a real gap in migration 0003's RLS design that this task's own RED surfaced, not designed for by any prior plan).
**Impact on plan:** Necessary for Task 1 to function at all; login cannot exist without an anonymous read path into `users`. Narrowly scoped (two columns, one row, `SELECT` only) rather than widening RLS itself, and documented at length in the migration's own module docstring so a later reader finds the reasoning at the source, not only in this SUMMARY.

## Evidence

**Raw `Set-Cookie` header, observed in a live request against the real app and real local Postgres (not asserted from a description):**

```
morai_session=1FufcVjYiF-8WxpUA2g7nc-KDgcirkeROOqPinV8IHY; HttpOnly; Max-Age=2592000; Path=/; SameSite=lax; Secure
```

`Max-Age=2592000` is `60*60*24*30` seconds -- 30 days, D2-06.

**The combined row-absence and replay assertion** (`test_logout_deletes_the_row_and_the_replayed_cookie_is_rejected`): after `POST /logout` returns 204, the same test function reads `sessions` through the superuser session and asserts `rows == []`, then replays the same cookie against `GET /me` and asserts `401` -- both facts, one function, per D2-05.

**Full verification, this session, local Postgres 18:**

```
$ uv run pytest tests/identity/test_login_logout.py -q -m db -v
............                                                             [100%]
12 passed, 8 warnings in 8.05s

$ uv run pytest -q
........................................................................ [ 50%]
......................................................................   [100%]
142 passed, 25 warnings in 20.42s

$ bash tools/gate.sh
All checks passed!               # ruff
0 errors, 0 warnings, 0 notes    # basedpyright
Success: no issues found in 52 source files   # mypy
142 passed, 25 warnings in 19.84s              # pytest
```

Warnings throughout are httpx's own `DeprecationWarning` on per-request `cookies=`, an existing pattern already used by `test_admin_routes.py` before this plan -- not a regression this plan introduced.

## Issues Encountered

The RLS gap above (see Deviations). No other issues -- local Postgres 18 was reachable throughout; no CI round-trips were needed for any task's red-then-green evidence.

## User Setup Required

Yes -- see `docs/operations/phase-2-operator-steps.md`. Four steps, none of which gate this phase's own correctness (every claim here is proven in CI against real Postgres, both roles under test control):

1. Set `MORAI_APP_DB_PASSWORD` on both Railway services -- blocked by this session's permission classifier.
2. Deploy and confirm the migration chain (0003's role assertion, then 0004's `login_lookup` function) ran.
3. Create the first admin via `tools/create_admin.py`.
4. Run `tools/measure_argon2.py` on the real container and `tools/isolation_smoke.py` against the live deployment -- both owed since Phase 2's start (`02-03-SUMMARY.md`, `02-01-SUMMARY.md`), unchanged by this plan.

None of these four steps have been run. The runbook states this plainly and states why, rather than softening the claim.

## Next Phase Readiness

- The full session lifecycle (login, logout, `/me`) is in place and tested. `AUTH-02`, `AUTH-03`, `AUTH-04` are complete.
- Phase 2's schema now spans two migrations (0003, 0004) rather than the one 02-01-SUMMARY.md predicted -- Phase 3 should read `alembic/versions/0004_login_lookup.py`'s own docstring before touching `users`' RLS policies, since it records the one place this schema deliberately widens what an unauthenticated caller can read and why.
- No blockers for Phase 2's own remaining verification pass. The four operator steps are deployment-only and gate nothing in this phase.

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

## Self-Check: PASSED

All five key files confirmed present on disk (`alembic/versions/0004_login_lookup.py`,
`src/morai/api/models_identity.py`, `src/morai/api/routes_identity.py`,
`tests/identity/test_login_logout.py`, `docs/operations/phase-2-operator-steps.md`).
All three task commit hashes (`6e9b2fd`, `a4582fe`, `317dd8d`) confirmed present in
`git log --oneline --all`. Full suite (142 tests) and `tools/gate.sh` (ruff,
basedpyright, mypy, pytest) all green as of the final commit.

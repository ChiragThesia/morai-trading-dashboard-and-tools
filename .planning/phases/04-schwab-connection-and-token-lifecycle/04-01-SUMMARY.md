---
phase: 04-schwab-connection-and-token-lifecycle
plan: 01
subsystem: auth
tags: [schwab-py, oauth, fastapi, sqlalchemy, alembic, pydantic, rls, envelope-encryption]

requires:
  - phase: 03-encrypted-ledger-and-crypto-shred
    provides: "per-user Phase 3 DEK (user_data_keys), crypto/envelope.py's encrypt_field/decrypt_field, and delete_account's crypto-shred ordering"
  - phase: 02-identity-sessions-and-rls
    provides: "setup_tokens' atomic single-use consume mechanism, get_current_user/RLS context wiring, the ApiModel/return-type-annotation route convention"
provides:
  - "schwab_connections table (migration 0010), RLS ENABLE+FORCE, one admin-free user_isolation policy"
  - "src/morai/vendor/ package: Protocol boundary (SchwabClient, SchwabAuth), the one adapter module that imports schwab-py, and the connection read/write path"
  - "POST /schwab/connect, GET /schwab/callback, GET /schwab/connection"
  - "typings/schwab/ local stub package wired into basedpyright and mypy"
  - "tests/vendor/conftest.py's FakeSchwabAuth/FakeSchwabClient -- built complete for plans 04-02/04-03/04-04 to reuse without touching this file"
affects: [04-02-refresh-lock-and-lifecycle, 04-03-health-and-reauth, 04-04-notification-due]

actuals:
  tokens: 30000
  tasks: 3
  commits: 5

tech-stack:
  added: ["schwab-py==1.5.1"]
  patterns:
    - "Local partial .pyi stub package (typings/schwab/) wired via [tool.basedpyright].stubPath and [tool.mypy].mypy_path -- clears every vendor-untyped diagnostic except one legitimate httpx.Response.json() Any"
    - "Protocol boundary + exactly one importing adapter module, enforced by a git-ls-files gate test (tests/gate/test_vendor_boundary.py), not a code-review convention"
    - "Sync-capture-then-async-persist token write: token_write_func stays a plain def appending to an in-memory holder; the caller's own async code persists explicitly after the vendor call returns -- never an async def closure handed to schwab-py"
    - "UPDATE-first, INSERT-on-zero-rowcount write path (upsert_connection) for a table whose PK is the user_id itself -- repairs in place rather than ON CONFLICT DO UPDATE, matching /setup's own rowcount-guard idiom"

key-files:
  created:
    - alembic/versions/0010_schwab_connections.py
    - src/morai/vendor/protocol.py
    - src/morai/vendor/schwab_adapter.py
    - src/morai/vendor/connections.py
    - src/morai/api/routes_connections.py
    - src/morai/api/models_connections.py
    - typings/schwab/auth.pyi
    - typings/schwab/client.pyi
    - tests/vendor/conftest.py
    - tests/vendor/test_tracer_connect.py
    - tests/gate/test_vendor_boundary.py
    - tests/gate/fixtures/violation_schwab_json_boundary.py
  modified:
    - pyproject.toml
    - src/morai/settings.py
    - src/morai/db/models.py
    - src/morai/identity/setup_tokens.py
    - src/morai/identity/account.py
    - src/morai/api/app.py
    - tests/identity/conftest.py
    - tests/identity/test_account_deletion.py
    - tests/crypto/test_nonce_uniqueness.py
    - tests/test_money_column_naming.py
    - tests/gate/test_type_gate.py

key-decisions:
  - "Renamed the vendor package from 04-RESEARCH.md's proposed src/morai/schwab/ to src/morai/vendor/ -- three things named 'schwab' in one project (a typings/schwab/ stub package, the vendor import, a first-party package) makes 'which schwab is this' a question every reader and grep has to answer; one rename removes the whole class of confusion."
  - "OAuth state TTL set to 15 minutes (_OAUTH_STATE_TTL), named beside routes_connections.py's own constant block, matching routes_identity.py's _SETUP_TOKEN_TTL/_RESET_TOKEN_TTL naming convention -- not a measured constant (Assumptions Log A1)."
  - "AccountNumberEntry given populate_by_name=True (deviation from 04-RESEARCH.md's implied alias-only shape) so the Protocol fake can construct it directly from Python kwargs, while real vendor JSON still validates through the camelCase alias -- avoids the documented Pydantic footgun where a field with an alias and populate_by_name=False silently rejects the plain field name at construction time, which a type checker's synthesized __init__ signature would not catch."
  - "last_synced_at stays NULL throughout this plan, per 04-VALIDATION.md's own scope decision -- the column exists and is queryable; Phase 6 owns writing it once real ingest exists."
  - "read_connection unwraps the DEK by the row's own stored key_version (mirroring read_fills/read_events's per-row lookup), not upsert_connection's 'highest version' _current_dek -- defends against a hypothetical future DEK rotation leaving a stale row unreadable by the wrong key."

requirements-completed: [CONN-01, CONN-02, CONN-03, CONN-04, CONN-05, CONN-07]

coverage:
  - id: D1
    description: "A complete OAuth handshake against the Protocol fake lands one encrypted schwab_connections row, proved by reading it back through an independent superuser session; the stored ciphertext does not contain the plaintext refresh-token bytes."
    requirement: "CONN-01"
    verification:
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_full_handshake_lands_one_encrypted_row_read_back_independently"
        status: pass
    human_judgment: false
  - id: D2
    description: "The OAuth state nonce is single-use: replaying the same callback URL a second time returns 400 and adds no second row."
    requirement: "CONN-02"
    verification:
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_replaying_the_same_callback_returns_400_and_adds_no_second_row"
        status: pass
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_callback_with_no_session_cookie_still_succeeds"
        status: pass
    human_judgment: false
  - id: D3
    description: "The application's own logger never carries the OAuth code or state (NN-34, D4-08). Hypercorn's access-log risk in a real deployment is out of this test's reach."
    requirement: "CONN-03"
    verification:
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_no_log_record_contains_the_code_or_state"
        status: pass
    human_judgment: true
    rationale: "The automated test proves the application's own logger is clean; it structurally cannot observe Hypercorn's real access log on a live server. That gap is recorded as Manual-Only in 04-VALIDATION.md and needs a human to confirm on the deployed service before this requirement is fully closed."
  - id: D4
    description: "GET /schwab/connection reports healthy with expires_at exactly seven days after token_created_at and a null last_synced_at."
    requirement: "CONN-04"
    verification:
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_connection_reads_healthy_with_expires_at_seven_days_out"
        status: pass
    human_judgment: false
  - id: D5
    description: "Re-authorisation repairs the existing connection row rather than duplicating it -- row count stays exactly 1 across a second, genuinely distinct handshake, and token_created_at advances to the new handshake's timestamp."
    requirement: "CONN-05"
    verification:
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_reauth_repairs_the_row_instead_of_duplicating_it"
        status: pass
    human_judgment: false
  - id: D6
    description: "last_synced_at exists on the schema and is queryable, and stays NULL through this plan by deliberate scope decision (CONN-07, D4-16) -- no test claims a sync ever ran."
    requirement: "CONN-07"
    verification: []
    human_judgment: true
    rationale: "This is an absence-of-behavior claim (the column is honestly NULL, nothing populates it yet) rather than something a passing assertion proves; the schema-level proof is migration 0010's own upgrade/downgrade round trip, not a unit test."
  - id: D7
    description: "Deleting an account with a live Schwab connection succeeds (no orphaned foreign key), removes that connection row, and leaves another user's connection untouched."
    requirement: "AUTH-06"
    verification:
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_deleting_an_account_with_a_schwab_connection_leaves_no_orphan_row"
        status: pass
    human_judgment: false
  - id: D8
    description: "Exactly one tracked module imports the vendor package schwab, enforced by a gate test; the tree's only new suppression is the one _response_json() pyright:ignore[reportAny] D4-04 budgets, confirmed against a real basedpyright run."
    verification:
      - kind: unit
        ref: "tests/gate/test_vendor_boundary.py#test_only_the_adapter_module_imports_the_vendor_package"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py#test_checker_rejects_fixture_with_expected_marker[basedpyright-schwab_json_boundary-reportAny]"
        status: pass
      - kind: other
        ref: "uv run basedpyright && uv run mypy src tests (0 errors both)"
        status: pass
    human_judgment: false

duration: 53min
completed: 2026-08-31
status: complete
---

# Phase 4 Plan 1: Schwab OAuth Connection Tracer Summary

**One end-to-end Schwab OAuth handshake against a `Protocol` fake, landing an AES-256-GCM-encrypted token in Postgres under the user's own Phase 3 DEK, proved by an independent superuser read-back -- with the `async def token_write_func` data-loss landmine designed around, not merely documented.**

## Performance

- **Duration:** 53 min
- **Started:** 2026-08-31T18:35:14Z
- **Completed:** 2026-08-31T19:27:50Z
- **Tasks:** 3 (plus two follow-up test additions closing gaps between the plan's declared `requirements` and its own `<behavior>` lists)
- **Files modified:** 28 (17 created, 11 modified)

## Accomplishments

- `schwab-py` 1.5.1 pinned and locked; `typings/schwab/` local partial stubs wired into both checkers so the vendor's untyped surface resolves cleanly except one legitimate `httpx.Response.json()` `Any`.
- `SchwabClient`/`SchwabAuth` `Protocol`s (`src/morai/vendor/protocol.py`) and the one adapter module (`schwab_adapter.py`) that imports `schwab` -- enforced by a new gate test, not a convention.
- Migration 0010 lands `schwab_connections`: RLS `ENABLE`+`FORCE`, one admin-free `user_isolation` policy, grants narrowed to the four verbs needed. `alembic upgrade head` and `downgrade -1` both verified locally.
- `POST /schwab/connect`, `GET /schwab/callback`, `GET /schwab/connection` -- the callback is unauthenticated by design (the consumed `state` is the only credential), and the account hash is resolved once at connect time, never re-resolved.
- `upsert_connection`'s `UPDATE`-first, `INSERT`-on-zero-`rowcount` write path makes re-authorisation a repair-in-place by construction; proved with a genuinely second handshake, not just the minimal replay guard.
- `delete_account` now clears `schwab_connections` in its identity-rows block -- without it, the crypto-shred transaction fails on the new uncascaded foreign key the moment a connection row exists.
- `FakeSchwabAuth`/`FakeSchwabClient` built complete in `tests/vendor/conftest.py`, including the barrier/gate/rotation machinery plans 04-02-04-04 depend on, even though this plan exercises only the success path.

## Task Commits

1. **Task 1: One OAuth handshake, end to end, with the token proved to be in Postgres** - `85cfa14` (feat)
2. **Task 2: Account deletion still ends at `users` with no child row left behind** - `bda508d` (fix)
3. **Task 3: Two gate meta-tests -- the vendor boundary and the suppression budget** - `597c8b7` (test)
4. **Deviation: CONN-03 log-capture proof, closing a gap between the plan's `requirements` and Task 1's `<behavior>` list** - `69d3369` (test)
5. **Deviation: CONN-05 re-auth-repairs-the-row proof, same gap class** - `fc753f8` (test)

## Files Created/Modified

- `alembic/versions/0010_schwab_connections.py` - `schwab_connections` DDL, RLS, grants
- `src/morai/vendor/protocol.py` - `SchwabClient`/`SchwabAuth` Protocols, `ExchangedToken`, `AccountNumberEntry`
- `src/morai/vendor/schwab_adapter.py` - the one module that imports `schwab`; `_response_json`'s single suppression
- `src/morai/vendor/connections.py` - `upsert_connection`/`read_connection`/`derive_connection_health`
- `src/morai/api/routes_connections.py` - the three routes
- `src/morai/api/models_connections.py` - request/response models
- `typings/schwab/{__init__,auth,client}.pyi` - the local stub package
- `tests/vendor/conftest.py` - `FakeSchwabAuth`/`FakeSchwabClient`, `logged_in_client`, `clean_connection_tables`
- `tests/vendor/test_tracer_connect.py` - the tracer's own test suite (7 tests)
- `tests/gate/test_vendor_boundary.py` - D4-02's one-importer gate
- `tests/gate/fixtures/violation_schwab_json_boundary.py` - the unsuppressed-`.json()` fixture
- `src/morai/settings.py` - `schwab_api_key`/`schwab_app_secret`/`schwab_callback_url`, `schwab_credentials` property
- `src/morai/db/models.py` - `SchwabConnection` model
- `src/morai/identity/setup_tokens.py` - `TokenPurpose.OAUTH_STATE`
- `src/morai/identity/account.py` - `delete_account` clears `schwab_connections`
- `src/morai/api/app.py` - registers the connections router
- `tests/identity/conftest.py` - `schwab_connections` added to the truncate list
- `tests/identity/test_account_deletion.py` - orphan-row regression test
- `tests/crypto/test_nonce_uniqueness.py` - new nonce columns added to the collision union query and drift guard
- `tests/test_money_column_naming.py` - new binary columns exempted (not money-carrying)
- `tests/gate/test_type_gate.py` - new `CASES` entry for the boundary fixture

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Two pre-existing security/correctness gates tripped by the new columns**
- **Found during:** Task 1, first full-suite run
- **Issue:** `tests/crypto/test_nonce_uniqueness.py`'s drift guard (CRYPT-05) failed -- `schwab_connections.token_nonce`/`account_hash_nonce` are new per-user-DEK nonce columns the existing collision-detection union query and its schema-drift guard did not yet cover. Separately, `tests/test_money_column_naming.py` failed -- the same four new `_ciphertext`/`_nonce` binary columns tripped the money-unit-suffix check, since an account hash and an OAuth token carry no `_usd`/`_pts` unit.
- **Fix:** Added `schwab_connections.token_nonce`/`account_hash_nonce` to `_NONCE_COLLISION_QUERY`'s UNION and to `_EXPECTED_NONCE_COLUMNS` (the per-user DEK domain, matching D4-11). Added the four `schwab_connections` binary columns to `_UNIT_EXEMPT_BINARY_COLUMNS`, mirroring the existing `fills.quantity_ciphertext` exemption for a dimensionless value.
- **Files modified:** `tests/crypto/test_nonce_uniqueness.py`, `tests/test_money_column_naming.py`
- **Verification:** Both files' full test suites pass; `test_nonce_column_drift_guard_matches_the_union_query` and `test_real_schema_names_every_money_column` are green.
- **Committed in:** `85cfa14` (Task 1 commit)

**2. [Rule 2 - Missing Critical] CONN-03 and CONN-05 named in the plan's `requirements` but not in Task 1's own `<behavior>` list**
- **Found during:** Post-Task-1 review, before writing this SUMMARY
- **Issue:** Task 1's `<behavior>` list covered the replay guard (a reused, already-consumed state) but not a genuinely second, distinct OAuth handshake for the same user -- so `upsert_connection`'s repair-in-place design (CONN-05) was implemented but never exercised by a test where a *second* connect+callback flow actually ran. Separately, no test asserted the application's own logger never carries the OAuth code or state (CONN-03, D4-08) -- the route code follows the discipline, but nothing proved it.
- **Fix:** Added `test_reauth_repairs_the_row_instead_of_duplicating_it` (two distinct handshakes, asserts row count stays 1 and `token_created_at` advances) and `test_no_log_record_contains_the_code_or_state` (caplog-based, scoped to the `morai` logger namespace so `httpx`'s own client-side request logging of the callback URL's query string -- a test-harness artifact of driving the app over `ASGITransport`, not application behaviour -- doesn't produce a false failure).
- **Files modified:** `tests/vendor/test_tracer_connect.py`
- **Verification:** Both new tests pass; full gate green (260 tests, 0 type errors).
- **Committed in:** `69d3369`, `fc753f8`

---

**Total deviations:** 2 auto-fixed (both Rule 2 -- missing critical functionality: two pre-existing correctness gates the new schema tripped, and two requirement-vs-behavior-list gaps in the plan itself). **Impact on plan:** All four fixes close real gaps; no scope creep beyond what CONN-03/CONN-05/CRYPT-05/D-04's own unit-naming check already demand.

## Issues Encountered

- **httpx cookie jar and the `Secure` flag over `http://test`.** `logged_in_client`'s login sets `Secure` (matching `/login`'s existing convention), and httpx's own cookie jar correctly refuses to replay a `Secure` cookie over the fixture's plain `http://test` base URL on later requests within the same client -- every existing identity test works around this by passing `cookies=` explicitly per request. `logged_in_client` instead calls `client.cookies.set(...)` once after login, the same thing a real HTTPS browser session gets for free, so every route call in this plan's own tests can omit the per-request `cookies=` argument.
- **`json.loads`'s `Any` return type would have introduced a second, unaccounted-for suppression.** The first draft of `read_connection` parsed the decrypted token bytes with `json.loads(...)` then `TypeAdapter.validate_python(...)` -- `json.loads` types its return as `Any` in typeshed, which basedpyright's `reportAny` would have flagged as a second `Any`-typed expression outside `_response_json`'s budgeted one (D4-04). Fixed before it ever produced a real diagnostic, by using `TypeAdapter.validate_json()` directly on the decrypted bytes -- no `Any`-typed intermediate.

## User Setup Required

None -- no external service configuration required. `schwab_api_key`/`schwab_app_secret`/`schwab_callback_url` are optional `Settings` fields; nothing in this plan's own test suite or local development needs them set (D4-14).

## Next Phase Readiness

Ready for 04-02 (the per-user refresh lock and 7-day lifecycle proof at its boundaries). `FakeSchwabAuth`/`FakeSchwabClient` already carry the barrier/gate/rotation machinery that plan needs -- built here so three later plans don't serialise behind edits to a shared fixture file.

**Recorded honestly, per the plan's own `<output>` instructions:**
- No live Schwab endpoint was called anywhere in this plan (D4-14) -- every assertion runs against the `Protocol` fake.
- The Hypercorn access-log risk (Common Pitfall 1) is Manual-Only and untested here -- an in-process `ASGITransport` test structurally cannot observe a real server's access log. See `04-VALIDATION.md`'s Manual-Only table.
- The real basedpyright run against `violation_schwab_json_boundary.py` (Task 3) emitted `reportAny`, exactly matching 04-RESEARCH.md's prediction -- no discrepancy to record.
- The vendor package is deliberately named `src/morai/vendor/`, not `src/morai/schwab/` as 04-RESEARCH.md proposed -- see `key-decisions` above and the package's own `__init__.py` docstring for the reason.

## Known Stubs

None. `last_synced_at` and `reauth_notified_at` are honest `NULL` columns by deliberate scope decision (D4-16, D4-13), not stubs standing in for missing behaviour -- both are documented in this plan's own migration docstring and in `04-VALIDATION.md`'s scope-decisions section, with the phase that will populate each named there.

## Self-Check: PASSED

- `alembic/versions/0010_schwab_connections.py` -- FOUND
- `src/morai/vendor/protocol.py` -- FOUND
- `src/morai/vendor/schwab_adapter.py` -- FOUND
- `src/morai/vendor/connections.py` -- FOUND
- `src/morai/api/routes_connections.py` -- FOUND
- `typings/schwab/auth.pyi` -- FOUND
- `tests/vendor/test_tracer_connect.py` -- FOUND
- `tests/gate/test_vendor_boundary.py` -- FOUND
- Commit `85cfa14` -- FOUND in `git log --oneline`
- Commit `bda508d` -- FOUND in `git log --oneline`
- Commit `597c8b7` -- FOUND in `git log --oneline`
- Commit `69d3369` -- FOUND in `git log --oneline`
- Commit `fc753f8` -- FOUND in `git log --oneline`
- Full local gate (`bash tools/gate.sh`): ruff, ruff format, basedpyright, mypy, pytest all green -- 260 passed (baseline 245 + 15 new/changed)

---
*Phase: 04-schwab-connection-and-token-lifecycle*
*Plan: 01*
*Completed: 2026-08-31*

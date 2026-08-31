---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 06
subsystem: database
tags: [rls, postgres, isolation, testing, sqlalchemy]

# Dependency graph
requires:
  - phase: 03-02
    provides: "positions/legs/events (migration 0008) and insert_events(), the tables and write path this plan's isolation proof moves onto"
  - phase: 03-04
    provides: "provision_data_key()/provisioned_users, the data-key lifecycle this plan's five-table guard needs to write fills/events"
provides:
  - "GET /gate/positions, GET /gate/positions/{position_id} -- the deployed isolation-proof route, now backed by the real positions table, plaintext columns only"
  - "tests/test_isolation.py's eleven original guards, repointed from gate_user_scoped_probe onto positions and observed green"
  - "tests/test_isolation.py's three new parametrized guards (cross-tenant select, write-rejection, no-admin-clause) covering user_data_keys, positions, legs, fills and events"
  - "tests/identity/test_app_role.py's RLS enable/force check widened to all five phase-3 tables"
affects: [03-07]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 5980
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Isolation guard widened by parametrize, not by duplicating eleven tests per table -- a two_user_trading_rows fixture seeds one position/leg/fill/event per user (fills/events through their real insert_fills()/insert_events() write paths), then one parametrized cross-tenant-select test and one parametrized write-rejection test cover all five tables from a single assertion body each."
    - "Mechanical no-admin-clause check (pg_policies.qual/with_check text search for 'is_admin') replaces the prior review convention for every table added to the schema going forward, not only the five landed this phase."

key-files:
  created: []
  modified:
    - src/morai/api/routes_identity.py
    - tests/identity/conftest.py
    - tests/identity/test_app_role.py
    - tests/identity/test_tracer_scoped_read.py
    - tests/identity/test_login_logout.py
    - tests/test_isolation.py
    - tools/isolation_smoke.py
    - tests/ledger/test_plaintext_queries.py

key-decisions:
  - "seeded_users (tests/identity/conftest.py) now seeds one positions row per non-admin user in place of the two gate_user_scoped_probe rows it used to seed -- a straight replacement per the plan's own instruction, not an addition alongside the old rows. Nothing in the suite seeds or truncates gate_user_scoped_probe any more, which is what makes 03-07's drop a schema change rather than a coverage loss."
  - "Test function names inside tests/test_isolation.py that mention 'probe' in their own name (test_admin_is_not_exempt_from_the_probe_table_policy, test_admin_gets_404_for_another_users_probe_row_over_http, test_admin_probe_listing_returns_only_the_admins_own_rows) were left unrenamed, per the plan's explicit instruction to keep each test's name while repointing its body and docstring reasoning onto positions."
  - "identity/account.py's delete_account() still references GateUserScopedProbe (03-04's FK-cleanup fix) and tests/identity/test_app_role.py still asserts RLS is enabled+forced on gate_user_scoped_probe -- both left untouched. Neither is coverage that depends on the probe table for its isolation proof (that moved entirely in Tasks 2/3); both are true facts about a table that still physically exists until 03-07's drop migration, and 03-07 will need to touch both files anyway when it removes the table."
  - "The parametrized write-rejection guard uses Core insert(...) statements (insert(Fill).values(...), never Fill(...)) for the same reason the single-table positions guard already did: this is a test of the RLS policy alone, and Fill's own _write_token constructor gate is an unrelated, orthogonal control this guard is not testing."

requirements-completed: [CRYPT-02]

coverage:
  - id: D1
    description: "GET /gate/positions and GET /gate/positions/{position_id} serve the real positions table -- only user_id-scoped rows, plaintext position_id/opened_at, no WHERE user_id clause, 401 without a session, 404 for another user's row"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py#test_authenticated_user_sees_only_their_own_positions"
        status: pass
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py#test_requesting_another_users_row_by_id_returns_404"
        status: pass
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py#test_404_for_absent_row_is_byte_identical_to_404_for_another_users_row"
        status: pass
      - kind: integration
        ref: "tests/identity/test_tracer_scoped_read.py#test_no_cookie_returns_401"
        status: pass
    human_judgment: false
  - id: D2
    description: "All eleven of Phase 2's original isolation guards -- the RLS-cannot-be-bypassed precondition, the cross-tenant select, the superuser positive control, fail-closed on unset/empty context, write-rejection, the two admin-exemption tests, and the three HTTP 404/byte-identical/listing guards -- pass against the real positions table"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/test_isolation.py (11 named tests, verbose run captured this session, all PASSED)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cross-tenant isolation and write-rejection are proven across all five phase-3 tables (user_data_keys, positions, legs, fills, events), and no policy on any of them names the admin setting"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/test_isolation.py#test_cross_tenant_select_excludes_other_users_rows_on_every_new_table[user_data_keys|positions|legs|fills|events]"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py#test_a_write_for_another_user_is_rejected_on_every_new_table[user_data_keys|positions|legs|fills|events]"
        status: pass
      - kind: integration
        ref: "tests/test_isolation.py#test_no_policy_on_a_new_table_names_the_admin_setting[user_data_keys|positions|legs|fills|events]"
        status: pass
      - kind: integration
        ref: "tests/identity/test_app_role.py#test_rls_enable_and_force_match_the_migration[user_data_keys|fills|positions|legs|events]"
        status: pass
    human_judgment: false
  - id: D4
    description: "No reference to the old /gate/user-scoped-probe route or UserScopedProbeResponse remains in src, tests or tools; gate_user_scoped_probe and gate_money_probe still exist unmodified in the schema, ready for 03-07's drop"
    requirement: CRYPT-02
    verification:
      - kind: other
        ref: "grep -rn 'user-scoped-probe|UserScopedProbeResponse' src tests tools -- zero matches"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 6: The Isolation Proof Moves Onto Real Trading Tables Summary

**Phase 2's eleven-guard isolation suite now runs against the real `positions` table instead of `gate_user_scoped_probe`, the deployed `GET /gate/positions` route serves plaintext position data, and three new parametrized guards extend the same cross-tenant, write-rejection and no-admin-clause proof to `user_data_keys`, `legs`, `fills` and `events` -- clearing the gate plan 03-07 needs before it can drop the probe tables.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-31 (session start)
- **Completed:** 2026-08-31T16:25:47Z
- **Tasks:** 3
- **Files modified:** 8 (7 in the plan's own `files_modified`, plus one deviation fix)

## Accomplishments

- `GET /gate/user-scoped-probe`/`{probe_id}` renamed to `GET /gate/positions`/`{position_id}`, backed by the real `positions` table. Returns `position_id`/`opened_at` only -- no ciphertext column, no decryption, matching the route's stated role as a deployed isolation proof, not the start of Phase 5's read API. The load-bearing "do not add a `WHERE user_id` clause" comment carried across verbatim.
- `SeededUsers` (`tests/identity/conftest.py`) now carries `position_a`/`position_b` in place of `probe_a`/`probe_b`, seeded through the superuser session exactly as the probe rows were. Nothing in the suite seeds or truncates `gate_user_scoped_probe` any more.
- All eleven of Phase 2's isolation guards in `tests/test_isolation.py` -- the RLS-bypass precondition, the raw cross-tenant select, the superuser positive control, both fail-closed cases, the write-rejection guard, both admin-exemption tests, and the three HTTP guards (404-not-403, byte-identical bodies, admin listing) -- repointed onto `positions` and observed green, verbose run captured with each test named PASSED.
- Three new parametrized guards widen the same proof to all five phase-3 tables (`user_data_keys`, `positions`, `legs`, `fills`, `events`): a `two_user_trading_rows` fixture seeds one row per table per user, with `fills`/`events` going through their real `insert_fills()`/`insert_events()` write paths (not a hand-built approximation); the cross-tenant-select and write-rejection guards then run once per table via `@pytest.mark.parametrize`, and a mechanical `pg_policies` text search confirms none of the five names `app.is_admin`.
- `tests/identity/test_app_role.py`'s RLS enable/force parametrize extended with the same five tables, all expecting `True`.
- `tests/identity/test_tracer_scoped_read.py`, `test_login_logout.py` and `tools/isolation_smoke.py` all repointed at `/gate/positions` and the `position_id` field name, with `isolation_smoke.py`'s "has not been run against a deployment" honesty statement left untouched.

## Task Commits

1. **Task 1: the deployed gate route serves positions, not a probe** - `b2f2665` (feat)
2. **Task 2: the eleven guards, repointed and observed green** - `4a06ba5` (test)
3. **Task 3: the same guarantee across all five new tables** - `6f97d37` (test)

_All three tasks carried `tdd="true"`. Task 1's red was the pre-existing identity suite failing on the old `/gate/user-scoped-probe` path once call sites were updated first, per the plan's own "natural red" instruction. Task 2's red was `ImportError: cannot import name 'UserScopedProbeResponse'` the moment `tests/test_isolation.py` still referenced the pre-Task-1 name -- observed directly, no scaffolding built to manufacture it. Task 3's red was the parametrize collection referencing `two_user_trading_rows`/`_plant_statement` before either existed. This plan is mostly a move, so several guards (the eleven originals) were green-on-arrival once repointed -- called out here as regression guards, per the plan's own environment note, not a weakened assertion._

## Files Created/Modified

- `src/morai/api/routes_identity.py` - `/gate/positions` routes, `PositionResponse`
- `tests/identity/conftest.py` - `SeededUsers.position_a/position_b`, truncation list widened to the five new tables
- `tests/identity/test_app_role.py` - RLS enable/force parametrize widened to the five new tables
- `tests/identity/test_tracer_scoped_read.py` - repointed at `/gate/positions`
- `tests/identity/test_login_logout.py` - client-restart test repointed at `/gate/positions`
- `tests/test_isolation.py` - eleven guards repointed onto `positions`; `two_user_trading_rows` fixture and three new parametrized guards added
- `tools/isolation_smoke.py` - repointed at `/gate/positions` and `position_id`
- `tests/ledger/test_plaintext_queries.py` - position-count assertion scoped to exclude `seeded_users`'s two stand-in rows (deviation, see below)

## Decisions Made

- **`seeded_users` seeds `positions`, not an addition alongside the retired probe rows.** A straight replacement, per the plan's own instruction -- this is what makes 03-07's drop a schema change rather than a coverage loss.
- **Test names inside `tests/test_isolation.py` that still say "probe" in their own name were left unrenamed** (`test_admin_is_not_exempt_from_the_probe_table_policy` and two others), per the plan's explicit "keeping each test's name" instruction for Task 2. Their docstrings and bodies were updated to reason about `positions` directly.
- **`identity/account.py`'s `GateUserScopedProbe` cleanup and `test_app_role.py`'s `gate_user_scoped_probe` RLS check were left untouched.** Neither is isolation coverage that depends on the probe table (that moved entirely in Tasks 2/3) -- both are true facts about a table that still physically exists until 03-07's drop migration removes it, and 03-07 will need to touch both files anyway at that point.
- **The five-table write-rejection guard uses Core `insert(...)` statements**, never `Fill(...)`, matching the single-table `positions` guard's own reasoning: this proves the RLS policy alone, and `Fill.__init__`'s `_write_token` gate is an orthogonal control this guard isn't testing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `seeded_users`'s new `positions` rows inflated an unrelated ledger test's global count**
- **Found during:** Task 2's full-suite run (`uv run pytest -q`)
- **Issue:** `tests/ledger/test_plaintext_queries.py::test_seed_oracle_produces_52_fills_13_positions_26_legs` asserts a bare `SELECT COUNT(*) FROM positions` equals 13 (the oracle's own calendar count). Once `seeded_users` started seeding two `positions` rows (`position_a`/`position_b`) in place of the retired probe rows, that same fixture chain (`provisioned_users` -> `seeded_users`) fed the oracle test too, and the global count became 15.
- **Fix:** Scoped that test's count to `WHERE id NOT IN (:pa, :pb)`, excluding `provisioned_users.position_a`/`position_b` explicitly, with a comment explaining why. The test's own claim -- what `seed_oracle()` produces -- is unchanged; only the query now isolates it from an unrelated fixture's own seeded rows.
- **Files modified:** `tests/ledger/test_plaintext_queries.py`
- **Verification:** Full local suite green (`uv run pytest -q`, 244 passed); `bash tools/gate.sh` green.
- **Committed in:** `4a06ba5` (part of Task 2's commit)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact on plan:** Necessary side effect of the plan's own explicit instruction to repoint `seeded_users` onto `positions` -- caught by the full-suite run this plan's own environment note requires before each task's done criteria are considered met. No scope creep: the fix is a one-query change confined to the test it broke.

## Issues Encountered

None beyond the deviation above. The suite-wide `asyncio.to_thread` subprocess fix from 03-03 and the ordering/timing guidance from `.claude/rules/workflow.md` held throughout -- no flakiness observed across four full-suite runs during this plan's execution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `AUTH-07`'s isolation proof now runs entirely against real trading tables. `tests/test_isolation.py` no longer has any dependency, seed, or assertion resting on `gate_user_scoped_probe` or its retired route.
- `gate_user_scoped_probe` and `gate_money_probe` still exist, unmodified, exactly as this plan's success criteria require -- plan 03-07 owns dropping them, and can now do so as a pure schema change: the coverage that would otherwise be lost already moved here.
- `identity/account.py`'s `GateUserScopedProbe` delete and `test_app_role.py`'s RLS-shape row for it are the two places 03-07 will need to touch when it removes the table, beyond the migration itself.
- Ready for 03-07.

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- All 8 modified files verified present on disk with the expected content.
- All 3 task commit hashes (`b2f2665`, `4a06ba5`, `6f97d37`) verified present in `git log --oneline`.
- `uv run pytest -q` re-confirmed green (244 passed, exit 0) immediately before writing this summary.
- `bash tools/gate.sh` re-confirmed green (244 passed, ruff/ruff format/basedpyright/mypy clean across 73 source files) immediately before writing this summary.
- `grep -rn "user-scoped-probe|UserScopedProbeResponse" src tests tools` returns zero matches.

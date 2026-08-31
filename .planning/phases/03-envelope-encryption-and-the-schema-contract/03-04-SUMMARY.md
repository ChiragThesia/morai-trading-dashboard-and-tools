---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 04
subsystem: database
tags: [encryption, aes-gcm, key-rotation, crypto-shred, sqlalchemy, rls, postgres]

# Dependency graph
requires:
  - phase: 03-02
    provides: "positions/legs/events (migration 0008) alongside fills (migration 0007), and insert_events()/read_events() -- the second write path this plan's rotation and shred proofs need real ciphertext from"
provides:
  - "POST /admin/users provisions the new user's data key in the same transaction, via a transaction-local RLS context switch to the new user rather than an admin clause on user_data_keys"
  - "src/morai/crypto/rotation.py: rotate_kek() -- re-wraps every user_data_keys row's DEK under a new KEK, touching no trade table, in one transaction"
  - "tools/rotate_kek.py: the operator entry point for KEK rotation, running on the superuser engine, printing only a row count"
  - "src/morai/identity/account.py: delete_account() -- destroys the wrapped data key first, then trade rows, then identity rows, then the user row"
  - "DELETE /me -- crypto-shreds and deletes the caller's own account, no path parameter"
  - "DataKeyMissing (morai.ledger.fills) -- read_fills()/read_events() raise this, not the generic NoResultFound, when a row's key_version has no matching user_data_keys row"
affects: [03-05, 03-06, 03-07, phase-5, phase-6, phase-9]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 5549
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Transaction-local RLS context switch for a privileged-creator write into a user-scoped table, instead of an admin clause on that table's policy -- the /setup precedent generalized to account creation"
    - "One-transaction key rotation: unwrap-then-rewrite per row, no commit inside the function, so a wrong old key's InvalidTag on the first row leaves every row untouched"
    - "Crypto-shred ordering as a documented invariant, not an implementation detail: destroy the key, then delete rows, key destruction commits before any row delete could observably fail partway"
    - "A named domain exception (DataKeyMissing) at the read boundary instead of a generic ORM NoResultFound, so a crypto-shredded account is distinguishable from an empty one by the read path itself"

key-files:
  created:
    - src/morai/crypto/rotation.py
    - src/morai/identity/account.py
    - tools/rotate_kek.py
    - tests/test_key_rotation.py
    - tests/test_crypto_shred.py
    - tests/identity/test_account_deletion.py
  modified:
    - src/morai/api/routes_identity.py
    - src/morai/ledger/fills.py
    - src/morai/ledger/events.py

key-decisions:
  - "gate_user_scoped_probe is deleted by delete_account() even though the plan's own <behavior> block doesn't name it -- Phase 2's isolation scaffolding carries a foreign key to users.id, and seeded_users seeds one probe row per user, so leaving it out makes every deletion in this plan's own test suite fail on a foreign-key violation. A real blocker (Rule 3), not scope creep; 03-VALIDATION.md's own Carried Obligation section already names dropping this table outright as owed elsewhere in this phase."
  - "No kek_version column on user_data_keys -- with exactly one live master key at a time and a single-invocation rotation, there's no concurrent multi-key window to track. Documented as the thing to revisit if the key ever moves to a KMS where more than one key can be live (D3-06)."
  - "DataKeyMissing lives in morai.ledger.fills, imported into events.py -- matching the existing precedent of _encode_decimal/_decode_decimal living in fills.py and being imported rather than duplicated, since it's genuinely one exception both read paths must raise identically."

requirements-completed: [CRYPT-01, CRYPT-04, AUTH-06]

coverage:
  - id: D1
    description: "Account creation and data-key provisioning succeed or fail together (one transaction), and the admin cannot read the resulting key row through the app role"
    requirement: CRYPT-01
    verification:
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_account_creation_provisions_exactly_one_key_at_version_one"
        status: pass
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_the_provisioned_key_unwraps_to_thirty_two_bytes"
        status: pass
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_the_admin_cannot_read_the_new_users_key_through_the_app_role"
        status: pass
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_a_failure_provisioning_the_key_leaves_no_user_row_behind"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every byte of trade ciphertext and every nonce is identical before and after a master-key rotation, while every wrapped data key changed and the unwrapped key bytes did not; a wrong old key raises without writing"
    requirement: CRYPT-04
    verification:
      - kind: integration
        ref: "tests/test_key_rotation.py#test_rotation_touches_no_trade_ciphertext"
        status: pass
      - kind: integration
        ref: "tests/test_key_rotation.py#test_rotating_with_the_wrong_old_key_raises_without_writing"
        status: pass
    human_judgment: false
  - id: D3
    description: "A row written under key_version 1 still decrypts, through the normal write path, after rotating to a new master key"
    requirement: CRYPT-04
    verification:
      - kind: integration
        ref: "tests/test_key_rotation.py#test_rotation_touches_no_trade_ciphertext"
        status: pass
    human_judgment: false
  - id: D4
    description: "With the key destroyed and rows still present, reads raise a named missing-key error; a second user's rows are unaffected"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "tests/test_crypto_shred.py#test_reads_raise_with_the_key_destroyed_and_rows_still_present"
        status: pass
      - kind: integration
        ref: "tests/test_crypto_shred.py#test_a_second_users_rows_still_decrypt_after_the_first_users_key_is_gone"
        status: pass
    human_judgment: false
  - id: D5
    description: "DELETE /me deletes only the caller's own account across every table and clears the session cookie; without a session it is a 401; no route shape names another user"
    requirement: AUTH-06
    verification:
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_delete_account_removes_every_row_across_every_table"
        status: pass
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_delete_me_with_a_valid_session_deletes_the_account_and_clears_cookie"
        status: pass
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_delete_me_without_a_session_returns_401"
        status: pass
      - kind: integration
        ref: "tests/identity/test_account_deletion.py#test_deleting_ones_own_account_does_not_touch_another_users"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 4: The Data Key's Whole Lifecycle -- Provision, Rotate, Crypto-Shred Summary

**A new account's data key provisions inside its own creation transaction via an RLS context switch (never an admin clause); `rotate_kek()` re-wraps every user's DEK in one transaction with a full before/after ciphertext dict comparison proving no trade row moved; `DELETE /me` destroys the wrapped key before the rows it protects, with the middle state -- key gone, rows present, reads raising `DataKeyMissing` -- asserted directly.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-08-31 (session start)
- **Completed:** 2026-08-31
- **Tasks:** 3
- **Files modified:** 9 (6 created, 3 modified)

## Accomplishments

- `POST /admin/users` now provisions the new user's `user_data_keys` row in the same transaction as the user row and its setup token. `user_data_keys` carries a `WITH CHECK` on `app.current_user_id`, which rejects an insert made under the admin's own context -- solved by switching the transaction-local RLS context to the newly created user (mirroring `/setup`'s own precedent) and confirming it took with `require_rls_context`, never by adding an admin clause (D2-08, D3-18 forbid that outright).
- `src/morai/crypto/rotation.py`: `rotate_kek(session, old_kek, new_kek)` -- selects every `user_data_keys` row, unwraps under the old key, re-wraps under the new one, in one transaction so a wrong old key's `InvalidTag` on the first row leaves every row untouched. No statement in the module names a trade table.
- `tools/rotate_kek.py`: the operator entry point, base64-decoding both keys (never logging either), running `rotate_kek()` on the superuser engine, and printing only the count of rows re-wrapped.
- `src/morai/identity/account.py`: `delete_account(session, user_id)` -- destroys `user_data_keys` first, then trade rows (`events`, `legs`, `positions`, `fills`, children before parents), then identity rows (`sessions`, `setup_tokens`, `gate_user_scoped_probe`), then the `users` row last. The ordering is documented as the load-bearing claim, not an implementation detail.
- `read_fills()`/`read_events()` now raise `DataKeyMissing` (defined in `morai.ledger.fills`) instead of the generic `NoResultFound` when a row's `key_version` has no matching `user_data_keys` row -- makes a crypto-shredded account observably different from an empty one.
- `DELETE /me` -- authenticated by the same `get_current_user` every other route uses, no path parameter, clears the session cookie the way `logout` does, returns 204.
- Full proof suite: `tests/identity/test_account_deletion.py` (Task 1 creation tests + Task 3 full-deletion and `DELETE /me` tests, 12 tests), `tests/test_key_rotation.py` (2 tests, including the byte-for-byte full-dict ciphertext comparison), `tests/test_crypto_shred.py` (2 tests proving the middle state directly).

## Task Commits

1. **Task 1: a new account gets its data key in the same transaction** - `81f0dfa` (feat)
2. **Task 2: rotating the master key touches no trade ciphertext** - `c228651` (feat)
3. **Task 3: deleting an account destroys the key first and the rows second** - `247dda6` (feat)

_All three tasks carried `tdd="true"`. Each task's natural red was the cheapest honest one named in the plan: Task 1 asserted against a `user_data_keys` row the route didn't yet write (empty result); Tasks 2 and 3 hit `ModuleNotFoundError` on `morai.crypto.rotation`/`morai.identity.account` respectively. No scaffolding was built to manufacture a more interesting failure -- each was implemented straight to green and committed as a single `feat` commit per this plan's own convention, matching how 03-01's tracer task was committed._

## Files Created/Modified

- `src/morai/crypto/rotation.py` - `rotate_kek()`, the one function, no trade-table statement in it
- `src/morai/identity/account.py` - `delete_account()`, the crypto-shred ordering
- `tools/rotate_kek.py` - the operator entry point for KEK rotation
- `src/morai/api/routes_identity.py` - `create_user`'s key-provisioning addition, `DELETE /me`
- `src/morai/ledger/fills.py` - `DataKeyMissing`, `read_fills()`'s named-error raise
- `src/morai/ledger/events.py` - `read_events()`'s matching named-error raise (imports `DataKeyMissing` from `fills.py`)
- `tests/identity/test_account_deletion.py` - the account's whole key lifecycle, creation through destruction
- `tests/test_key_rotation.py` - the byte-identical-ciphertext rotation proof
- `tests/test_crypto_shred.py` - the middle-state crypto-shred proof

## Decisions Made

- **`gate_user_scoped_probe` is deleted by `delete_account()`**, even though the plan's own `<behavior>` block names only `fills, events, positions, legs, sessions, setup_tokens`. Phase 2's isolation scaffolding carries `user_id -> users.id` with no cascade, and `seeded_users` seeds one probe row per user -- omitting this made `DELETE FROM users` fail with `ForeignKeyViolationError` in this plan's own test suite. Fixed under deviation Rule 3 (blocking issue): documented in `account.py`'s own docstring, pointing at 03-VALIDATION.md's Carried Obligation for the real fix (dropping the table, owed by a different plan).
- **No `kek_version` column.** With exactly one live master key and a single-invocation rotation, there's no concurrent multi-key window to track; the module docstring names revisiting this if the key ever moves to a KMS.
- **`DataKeyMissing` lives in `morai.ledger.fills`, imported into `events.py`** -- one exception both read paths raise identically, matching the existing `_encode_decimal`/`_decode_decimal` sharing precedent rather than duplicating the class.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `delete_account()` needed to also clear `gate_user_scoped_probe`**
- **Found during:** Task 3, first run of `test_delete_account_removes_every_row_across_every_table`
- **Issue:** `users.id` is referenced by `gate_user_scoped_probe.user_id` (Phase 2 scaffolding, no `ON DELETE CASCADE`). `seeded_users`/`provisioned_users` seed a probe row per user, so `DELETE FROM users` raised `ForeignKeyViolationError` for every seeded test user.
- **Fix:** Added `delete(GateUserScopedProbe).where(...)` to `delete_account()`'s identity-rows step, with a docstring note explaining this is a real blocker rather than scope creep, and pointing at the Carried Obligation that ultimately removes this table.
- **Files modified:** `src/morai/identity/account.py`
- **Verification:** `tests/identity/test_account_deletion.py::test_delete_account_removes_every_row_across_every_table` passes; full local gate green.
- **Committed in:** `247dda6` (part of Task 3's commit -- caught before any commit landed)

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact on plan:** Necessary for correctness -- without it, account deletion breaks for any user who was ever seeded with the shared isolation-proof fixture, and in a real deployment any live `gate_user_scoped_probe` row would do the same. No scope creep beyond clearing one leftover foreign key this plan's own deletion path has to satisfy regardless.

## Issues Encountered

Running the full local suite (`uv run pytest -q` / `bash tools/gate.sh`) intermittently showed unrelated failures in `tests/identity/test_admin_routes.py`, `tests/identity/test_login_logout.py`, `tests/identity/test_setup_tokens.py`, `tests/ledger/test_roll_check_constraint.py`, and similar pre-existing files this plan never touched -- foreign-key and cookie-lookup errors consistent with another process truncating/inserting into the same physical `morai` database mid-test. Confirmed non-deterministic (different unrelated files failed on each retry) and confirmed present on a stashed pre-change baseline too, so it predates this plan's changes. This worktree runs concurrently with sibling executors for plans 03-03 and 03-05, all three pointed at the same local Postgres (`postgresql://morai:morai@localhost:5432/morai`) -- the two other active worktrees under `.claude/worktrees/` are the likely source. **Resolved by evidence, not by code change:** repeated full-suite and full-gate runs eventually landed clean (212 passed, 0 failed/errored, `bash tools/gate.sh` exit 0, captured this session), and this plan's own three test modules (`tests/identity/test_account_deletion.py`, `tests/test_key_rotation.py`, `tests/test_crypto_shred.py`, 16 tests total) passed every single time they were run in isolation, with no retries needed.

## User Setup Required

None - no external service configuration required. `MORAI_MASTER_KEY` remains the same local-only env var established in 03-01; `tools/rotate_kek.py` has not been run against Railway and its own docstring says so plainly -- rotating the production KEK is an explicit, separate operator action, not owed by this plan.

## Next Phase Readiness

- The data key's whole lifecycle (provision, rotate, crypto-shred) is proven end to end. Criteria 3 and 5 from `03-VALIDATION.md` both have their required proof shape: byte-identical ciphertext across rotation, and the middle-state assertion (key gone, rows present, reads raising) for the shred.
- `tools/rotate_kek.py` is a committed, runnable script, not yet exercised against a real deployment -- confirming `MORAI_MASTER_KEY` rotation procedure on Railway is a separate, deferred operator step (already named in 03-VALIDATION.md's Manual-Only Verifications).
- Ready for 03-05/03-06/03-07 and the phases that inherit this envelope-encryption boundary (5, 6, 9).

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- All 9 created/modified files verified present on disk with the expected content.
- All 3 task commit hashes (`81f0dfa`, `c228651`, `247dda6`) verified present in `git log --oneline`.
- `bash tools/gate.sh` re-confirmed green (212 passed, exit 0) before this summary was written.
- This plan's own three test modules re-run in isolation immediately before writing this summary: 16/16 passed, 0 failures.

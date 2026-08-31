---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 02
subsystem: database
tags: [encryption, aes-gcm, sqlalchemy, alembic, rls, postgres, ledger]

# Dependency graph
requires:
  - phase: 03-01
    provides: "src/morai/crypto/envelope.py's five AES-256-GCM primitives, the fills/user_data_keys tables (migration 0007), and the insert_fills()/read_fills() write-path shape this plan mirrors"
provides:
  - "positions, legs, events tables (migration 0008), RLS ENABLE+FORCE, admin-free user_isolation policy, verb-narrowed grants -- criterion 6's four-table set complete alongside fills"
  - "roll_has_both_legs CHECK constraint: a ROLL row missing either amount ciphertext is rejected by Postgres itself, proven via raw SQL that never touches application code"
  - "src/morai/ledger/events.py: insert_events()/read_events(), a compound event's two amounts kept split through encryption and decryption, under two distinct nonces"
affects: [03-03, 03-04, 03-05, 03-06, 03-07, phase-5, phase-9]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 5305
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compound-event split enforced at the data layer: roll_has_both_legs CHECK tests NULL-ness only (ciphertext, never a value) -- the migration text and the test module docstring both state that ceiling explicitly"
    - "Write-path insert/read DEK-lookup split, extended: insert_events() reuses fills.py's _current_dek shape (current key_version on write); read_events() does the row-scoped key_version lookup fills.py's own read_fills() already established, duplicated rather than shared, since a row's key_version and the user's current key_version diverge the moment a DEK is ever rotated"
    - "Decimal-as-UTF-8-text serialization shared, not re-implemented: events.py imports fills.py's _encode_decimal/_decode_decimal directly (with a scoped reportPrivateUsage suppression) rather than writing a second format"

key-files:
  created:
    - alembic/versions/0008_positions_legs_events.py
    - src/morai/ledger/events.py
    - tests/ledger/test_schema_contract.py
    - tests/ledger/test_roll_check_constraint.py
  modified:
    - src/morai/db/models.py
    - tests/ledger/conftest.py

key-decisions:
  - "Event carries no _write_token sentinel gate, unlike Fill -- 03-RESEARCH.md's Open Question 2 explicitly defers a compile-time single-writer gate on events to Phase 5, once events are actually derived from fills and a second writer becomes a real temptation. This plan's own files_modified list names no tests/gate/ fixture, confirming the deferral rather than an oversight."
  - "events.py duplicates _current_dek (fills.py's private per-user current-key lookup) rather than importing it, but imports _encode_decimal/_decode_decimal directly. The two serialization helpers are genuinely one format that must never drift (the plan's own instruction: 'reuse... rather than writing a second serialization'); _current_dek's write-time and read-time uses already diverge inside fills.py itself (insert_fills uses the shared current-key helper, read_fills does a separate per-row key_version lookup), so events.py mirrors that same split locally rather than reaching across a module boundary for logic that already has two shapes in its own origin module."
  - "seeded_position fixture inserts through the superuser session, not a insert_positions()/insert_legs() write path -- this plan's scope is the DDL and events' write path only; positions/legs get no dedicated write-path function this phase."

requirements-completed: [LEDGER-04, CRYPT-02, CRYPT-03]

coverage:
  - id: D1
    description: "positions, legs and events exist with RLS ENABLE+FORCE, one admin-free user_isolation policy each, and grants naming only SELECT/INSERT/DELETE (no UPDATE)"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_schema_contract.py#test_rls_enabled_and_forced[positions|legs|events]"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_schema_contract.py#test_exactly_one_admin_free_policy[positions|legs|events]"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_schema_contract.py#test_grants_are_verb_narrowed"
        status: pass
    human_judgment: false
  - id: D2
    description: "legs carries UNIQUE(position_id, leg_role); events.event_type is constrained to OPEN/CLOSE/ROLL/SETTLEMENT"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_schema_contract.py#test_legs_unique_constraint_covers_position_and_leg_role"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_schema_contract.py#test_events_event_type_constrained_to_four_values"
        status: pass
    human_judgment: false
  - id: D3
    description: "A ROLL row missing either amount ciphertext is rejected by Postgres via the roll_has_both_legs CHECK, proven through raw SQL on a connection that never touches application code; the constraint's own name appears in the rejection, not a bare exception type"
    requirement: LEDGER-04
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_roll_missing_close_credit_is_rejected"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_roll_missing_open_debit_is_rejected"
        status: pass
    human_judgment: false
  - id: D4
    description: "The both-populated ROLL, a one-sided OPEN, and an empty SETTLEMENT all insert cleanly -- the constraint binds ROLL alone, and absence is NULL, never a sentinel"
    requirement: LEDGER-04
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_roll_with_both_amounts_is_accepted"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_open_with_only_open_debit_is_accepted"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_settlement_with_both_amounts_null_is_accepted"
        status: pass
    human_judgment: false
  - id: D5
    description: "insert_events() given a ROLL with both Decimal amounts writes both ciphertext/nonce pairs under two distinct nonces, and reading the event back decrypts to the two original Decimals unchanged"
    requirement: CRYPT-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_roll_round_trips_both_amounts_under_distinct_nonces"
        status: pass
    human_judgment: false
  - id: D6
    description: "insert_events() given a ROLL with one amount missing raises before reaching the database -- the CHECK constraint remains the backstop, not the only guard"
    requirement: LEDGER-04
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_insert_events_raises_before_reaching_db_for_one_sided_roll"
        status: pass
    human_judgment: false
  - id: D7
    description: "A SETTLEMENT with no amounts writes four NULLs, and reading it back yields None for both -- never zero"
    requirement: LEDGER-04
    verification:
      - kind: integration
        ref: "tests/ledger/test_roll_check_constraint.py#test_settlement_with_no_amounts_reads_back_as_none"
        status: pass
    human_judgment: false

duration: 32min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 2: positions, legs, events -- the ROLL constraint that can't be bypassed Summary

**Migration 0008 lands the four-table schema criterion 6 names, with a `roll_has_both_legs` database `CHECK` proving the netted-ROLL prohibition holds for a connection that never touches application code, and `insert_events()`/`read_events()` keep a ROLL's two amounts split through encryption under two distinct nonces.**

## Performance

- **Duration:** 32 min
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- Migration `0008_positions_legs_events.py`: `positions`, `legs`, `events` with the same RLS `ENABLE`+`FORCE`, admin-free `user_isolation` policy shape and verb-narrowed grants (`SELECT, INSERT, DELETE`, no `UPDATE`) as `fills` (migration 0007). `legs` carries `UNIQUE(position_id, leg_role)`; `events.event_type` is constrained to `OPEN`/`CLOSE`/`ROLL`/`SETTLEMENT`. `alembic upgrade head` and `alembic downgrade -1` both verified clean locally, twice.
- The `roll_has_both_legs` `CHECK` constraint: `event_type <> 'ROLL' OR (open_debit_usd_ciphertext IS NOT NULL AND close_credit_usd_ciphertext IS NOT NULL)`. Because the amounts are encrypted `bytea`, this can only test presence, never a value -- the migration's own docstring and the test module's own docstring both state that ceiling in plain language, so no comment or test name overclaims what a `CHECK` over ciphertext can prove.
- `tests/ledger/test_roll_check_constraint.py`: five raw-SQL proofs on the superuser session (no ORM, no write path) -- both one-sided ROLL shapes rejected with the constraint's own name in the exception text; both-populated ROLL, a one-sided OPEN and an empty SETTLEMENT all insert. Three more proofs exercise the write path itself: a ROLL's two `Decimal`s round-trip under two distinct nonces; `insert_events()` refuses a one-sided ROLL before the database is even touched; a SETTLEMENT's absent amounts read back as `None`, never zero.
- `src/morai/ledger/events.py`: `insert_events()`/`read_events()`, mirroring `fills.py` in shape. Encryption happens inside the write path; callers hand it `Decimal` and never touch AES. No netted figure is ever computed or stored -- `read_events()` always returns `open_debit_usd`/`close_credit_usd` separately.
- `tests/ledger/test_schema_contract.py` (21 tests, landed with Task 1): every bullet in Task 1's `<behavior>` block -- RLS enabled/forced, one admin-free policy, verb-narrowed grants, the leg uniqueness constraint, the event-type constraint -- proven against `pg_class`/`pg_policies`/`pg_constraint`/`has_table_privilege`.

## Task Commits

1. **Task 1: positions, legs and events -- migration 0008 and its models** - `ac0288a` (feat)
2. **Task 2: a netted-only ROLL cannot be stored** - `f5e6d46` (test)
3. **Task 3: the events write path keeps a compound event's two amounts split** - `87d3a2e` (feat)

_Task 1's red was `NoResultFound` on a `pg_class` query for the missing `positions` relation, observed before the migration existed. Tasks 2 and 3 share one natural red -- `ModuleNotFoundError: No module named 'morai.ledger.events'` -- because the plan's own instruction places the write-path proof in the same test file as the constraint proof, so they were split into two atomic commits by temporarily withholding `events.py` and a trimmed copy of the test file's write-path section, verifying Task 2's five constraint tests pass standing alone against migration 0008 with `events.py` absent from the tree, then restoring both together for Task 3._

## Files Created/Modified

- `alembic/versions/0008_positions_legs_events.py` - `positions`/`legs`/`events` DDL, RLS, grants, the `roll_has_both_legs` and `events_event_type_check` constraints
- `src/morai/db/models.py` - `Position`, `Leg`, `Event` ORM models (no write-token gate on `Event`)
- `src/morai/ledger/events.py` - `insert_events()`, `read_events()`, the AAD helper, the per-user DEK lookup
- `tests/ledger/test_schema_contract.py` - 21 schema-shape assertions (Task 1)
- `tests/ledger/test_roll_check_constraint.py` - 8 tests: 5 constraint proofs (Task 2) + 3 write-path proofs (Task 3)
- `tests/ledger/conftest.py` - `seeded_position` fixture; `positions`/`legs`/`events` added to the truncation fixture

## Decisions Made

- **No `_write_token` sentinel gate on `Event`.** Unlike `Fill`, `Event.__init__` accepts direct construction. `03-RESEARCH.md`'s Open Question 2 explicitly recommends deferring a compile-time single-writer gate on `events` to Phase 5, once events are actually derived from fills and a second writer becomes a real temptation; this plan's own `files_modified` frontmatter names no `tests/gate/` fixture, confirming the deferral was intentional scope, not an oversight.
- **`events.py` duplicates `_current_dek` but imports `_encode_decimal`/`_decode_decimal`.** The plan's action text instructs reusing "the associated-data helper" and avoiding "a second serialization" -- read as targeting the `Decimal`-as-UTF-8-text encoding specifically, since events' AAD content is structurally different from fills' (a single UUID `id`, not a composite key), so a literal shared AAD function isn't possible; a new `_event_associated_data` follows the same `table:column:key` convention instead. `_current_dek`'s write-time ("current key_version") and read-time ("this row's own key_version") uses already diverge inside `fills.py` itself -- `insert_fills` uses the shared helper, `read_fills` does a separate per-row lookup -- so `events.py` mirrors that same split locally, matching the plan's "mirroring `ledger/fills.py` exactly in structure" instruction, rather than reaching across a module boundary for logic that isn't actually shared in its origin module.
- **`seeded_position` inserts through the superuser session.** No `insert_positions()`/`insert_legs()` write path exists -- this plan's scope is their DDL plus the `events` write path only, per the plan's own `files_modified` list.

## Deviations from Plan

None - plan executed exactly as written. The two implementation-detail resolutions above (the AAD-helper reuse scope, `_current_dek`'s duplication) were genuine ambiguities in the plan's prose rather than departures from its stated behavior or success criteria; both are documented above rather than silently resolved.

## Issues Encountered

Two basedpyright `reportAny` findings surfaced during Task 1 (`Leg.__table_args__`'s inferred type, and a tuple-unpacked `pg_policies` row in the schema contract test) and four more in Task 3's test file (`scalar_one()` results assigned to `count` without narrowing). All four resolved with explicit type annotations / `TypeAdapter.validate_python()`, matching the codebase's existing `_INT`/`_BOOL`/`_STR` `TypeAdapter` convention at every other raw-`text()` boundary. Not deviations -- these are exactly the no-`Any` policy doing its job at a new boundary.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `positions`, `legs`, `events` and `fills` (migration 0007) together complete criterion 6's four-table set.
- Plan 03-03's nonce-uniqueness invariant has real encrypted `events` rows to union over (Task 3's ROLL round-trip test already proves two distinct nonces on one row).
- Plan 03-04's crypto-shred work has real `events` ciphertext to prove goes dark.
- Migration chain is at `0008` (head), append-only, D3-19 honored throughout.

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- All 4 created files verified present on disk.
- All 3 task commit hashes (`ac0288a`, `f5e6d46`, `87d3a2e`) verified present in `git log --oneline`.
- Full local gate re-confirmed green before this summary was written: 200 passed, ruff/ruff format/basedpyright/mypy clean across 64 source files.
- `alembic upgrade head` and `alembic downgrade -1` both verified clean, twice, against local Postgres 18.

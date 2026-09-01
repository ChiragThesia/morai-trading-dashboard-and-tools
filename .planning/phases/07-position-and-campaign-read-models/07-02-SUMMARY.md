---
phase: 07-position-and-campaign-read-models
plan: 02
subsystem: database
tags: [sqlalchemy, postgres, alembic, rls, recursive-cte, tdd, closed-state, read-model]

requires:
  - phase: 07-position-and-campaign-read-models
    plan: 01
    provides: "positions.py's plan_positions/create_positions, the write-token sentinels, sync_user wiring"
provides:
  - "src/morai/ledger/positions.py -- LegNet/PositionState/LegRow dataclasses, net_quantity_for_leg (pure), derive_position_state (pure), read_position_state (async shell) -- the closed-state read model, LEDGER-05"
  - "Every reader (routes_identity.py, three test files) moved off the stored positions.opened_at/closed_at columns before migration 0014 drops them"
  - "Migration 0014: drops positions.opened_at/closed_at; adds events.rolled_from_position_id + roll_has_rolled_from_position CHECK; creates campaign_chain, a recursive-CTE VIEW WITH (security_invoker = true) and a native CYCLE clause"
  - "Event.__init__ write-token sentinel (_EVENT_WRITE_TOKEN, ledger/events.py) -- the third sentinel in the D7-14 no-second-writer gate, alongside Position/Leg from 07-01"
affects: [07-03, 07-04 (campaign chain behavioural security_invoker regression test with a real second user), 07-05, phase 8 (repricing), phase 9 (reconciliation), phase 11 (review API)]

actuals:
  tokens: 19741
  tasks: 4
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Pure-function + thin-shell split (derive_position_state/read_position_state), mirroring plan_positions/create_positions and derive_events/sync_events exactly"
    - "A shared-symbol-safe async read shell: read_position_state scopes fills via resolve_fill_positions (not a bare occ_symbol match) and events via a position_id filter, so hard case 1's shared front leg cannot leak a sibling position's fills into this one's derivation"
    - "Recursive-CTE VIEW with WITH (security_invoker = true) and a native CYCLE clause, over an RLS-FORCEd base table owned by a superuser DDL role -- the pattern every future view in this schema over events/positions/legs must copy (Pitfall 1)"
    - "Write-token sentinel defined in a different module than its siblings (_EVENT_WRITE_TOKEN in ledger/events.py, vs _POSITION_WRITE_TOKEN/_LEG_WRITE_TOKEN in ledger/positions.py) -- the AST gate test is parametrized over (module, name, allowed_importers) triples, not a single shared module constant, so each sentinel's own allowed-importer pair is checked independently"

key-files:
  created:
    - tests/ledger/test_closed_state.py
    - alembic/versions/0014_derived_position_state_and_campaign_chain.py
  modified:
    - src/morai/ledger/positions.py
    - src/morai/api/routes_identity.py
    - src/morai/db/models.py
    - src/morai/ledger/events.py
    - tests/ledger/oracle_seed.py
    - tests/ledger/test_pairing_shared_leg.py
    - tests/ledger/test_pairing_no_position_state.py
    - tests/ledger/test_schema_contract.py
    - tests/gate/test_ledger_write_boundary.py
    - tests/ledger/test_roll_check_constraint.py
    - tests/crypto/test_nonce_uniqueness.py
    - tests/test_crypto_shred.py
    - tests/test_key_rotation.py
    - tests/test_pg_dump_confidentiality.py

key-decisions:
  - "read_position_state scopes fills through resolve_fill_positions (the existing order-anchor disambiguation), not a bare occ_symbol match against read_fills -- a shared-leg symbol (hard case 1, calendars 8a63aa81/6303e6af) would otherwise let a sibling position's fills leak into this position's net-quantity computation. No task acceptance criterion exercises this directly, but it is the same correctness class D7-03/NN-11 already govern, so it was applied as Rule 2 (missing critical functionality) rather than left as a known gap."
  - "test_pairing_shared_leg.py's replacement ordering sorts ORACLE_CALENDARS by each calendar's own fixture opened_at field in Python, descending -- not ORDER BY created_at DESC, per the plan's own assumption A3 (seed_oracle inserts in ORACLE_CALENDARS declaration order, and 8a63aa81 is declared before 6303e6af, so a descending created_at sort would silently reverse the intended order)."
  - "test_pairing_no_position_state.py's remaining closed_at read (in the kept synthetic-open-calendar test) was moved onto read_position_state rather than left as a raw SQL SELECT against positions.closed_at -- the plan's action text called it 'unaffected', but the raw SELECT is itself a reader of the column this task's own title targets, and would have broken silently the moment migration 0014 dropped it."
  - "Checkpoint decision: drop (Task 3). The human approved dropping positions.opened_at/closed_at outright, over keep-unwritten or defer. The orchestrator independently corroborated the safety evidence before asking: git log --all -S over insert(Position)/INSERT INTO positions found no production writer under src/, and live local Postgres showed 16 positions rows with 0 non-NULL values in either column. That reasoning is recorded in migration 0014's own docstring, not only here, so a later reader of the migration does not have to re-derive it from a chat transcript."
  - "The roll_has_rolled_from_position CHECK is a biconditional ((event_type = 'ROLL') = (rolled_from_position_id IS NOT NULL)), not an implication -- matching D7-10's exact requirement and composing independently with 0008's existing roll_has_both_legs CHECK (multiple CHECKs on one table are implicitly ANDed; neither references the other's columns)."
  - "campaign_chain is created WITH (security_invoker = true) -- the single highest-risk line in this migration. Without it, every user querying the view through morai_app would silently read every other user's campaign chain, because Postgres applies a view's owner's RLS model by default and this migration's DDL role is a superuser with rolbypassrls. Asserted structurally here (pg_class.reloptions, test_schema_contract.py); 07-04 proves it behaviourally with a real second user."
  - "Event gained a _write_token sentinel gate (_EVENT_WRITE_TOKEN, ledger/events.py) in this plan, not an earlier one. 03-RESEARCH.md's Open Question 2 deliberately left events ungated at migration 0008 because a second writer was not yet a real temptation; Phase 7 adding ROLL and SETTLEMENT writers is exactly that trigger, so the gate lands now rather than being retrofitted later."
  - "Five pre-existing test files construct a ROLL EventWrite/raw-SQL insert without rolled_from_position_id -- a direct, unavoidable consequence of the new CHECK, not itself named in Task 4's file list. Each was fixed with the minimal correct value: a real positions.id via self-reference (position_id doubling as its own rolled_from_position_id) where the test's own claim is unrelated to roll-chain semantics (nonce uniqueness, crypto-shred, key rotation, pg_dump confidentiality), and via a second bare position row only where the test needs to isolate one CHECK's failure from the other (test_roll_check_constraint.py)."

requirements-completed: [LEDGER-05, LEDGER-10]

coverage:
  - id: D1
    description: "A position's closed state is a pure function over net quantity per leg (LegNet/PositionState/derive_position_state), signed from the fill's own side (never abs()), with a gapped leg (unrecognised side or None quantity) making is_closed None -- never False."
    requirement: "LEDGER-05"
    verification:
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_two_legs_each_net_zero_position_closed_at_latest_event_time"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_leg_with_no_offsetting_sell_nets_nonzero_and_stays_open"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_unrecognised_side_makes_leg_net_none_and_neither_open_nor_closed"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_none_quantity_produces_the_same_none_net_for_its_leg"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_opened_at_is_earliest_open_event_time_and_none_without_one"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_closed_state.py#test_sign_convention_never_uses_absolute_value"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 14th synthetic single-OPEN calendar derives to open, and a real fully-unwound oracle calendar derives to closed, through the real async read wrapper (read_position_state) against real seeded fills and events -- replacing the behavioural half of test_pairing_no_position_state.py's retired mutation test."
    requirement: "LEDGER-05"
    verification:
      - kind: integration
        ref: "tests/ledger/test_closed_state.py#test_synthetic_open_calendar_derives_to_open_via_read_position_state"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_closed_state.py#test_fully_unwound_oracle_calendar_derives_to_closed_via_read_position_state"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every reader in src/ and tests/ moved off positions.opened_at/positions.closed_at before migration 0014 drops them -- the full suite stayed green through the whole move, and the /gate/positions route serves the same response shape with opened_at now sourced from the event stream."
    requirement: "LEDGER-05"
    verification:
      - kind: unit
        ref: "grep -c 'row.opened_at' src/morai/api/routes_identity.py == 0"
        status: pass
      - kind: unit
        ref: "grep -c 'ORDER BY opened_at' tests/ledger/test_pairing_shared_leg.py == 0"
        status: pass
      - kind: unit
        ref: "grep -c 'UPDATE positions SET' tests/ledger/test_pairing_no_position_state.py == 0"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_shared_leg.py -- full file, 5/5 tests"
        status: pass
    human_judgment: false
  - id: D4
    description: "Migration 0014 drops positions.opened_at/closed_at, adds events.rolled_from_position_id with the roll_has_rolled_from_position CHECK (non-NULL iff ROLL), and creates the campaign_chain recursive-CTE view -- round-tripped upgrade/downgrade/upgrade against local Postgres 18 with no orphaned view, and every fact asserted structurally in test_schema_contract.py."
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head -- all exit 0"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_schema_contract.py#test_positions_no_longer_has_the_dropped_timestamp_columns"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_schema_contract.py#test_events_has_the_rolled_from_position_check_constraint"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_schema_contract.py#test_campaign_chain_view_exists"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_roll_check_constraint.py#test_roll_missing_the_rolled_from_position_id_is_rejected"
        status: pass
    human_judgment: false
  - id: D5
    description: "campaign_chain carries security_invoker=true in its own pg_class.reloptions, and morai_app holds SELECT on it -- the structural half of Pitfall 1's proof. The behavioural half (a real second user reads zero rows of another user's chain) is 07-04's, named here so a reader of this SUMMARY does not assume it is already proven."
    requirement: "LEDGER-10"
    verification:
      - kind: unit
        ref: "tests/ledger/test_schema_contract.py#test_campaign_chain_view_carries_security_invoker"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_schema_contract.py#test_campaign_chain_view_grants_select_to_morai_app"
        status: pass
    human_judgment: true
    rationale: "The structural check (this SUMMARY's own verification) proves the clause is present in the DDL. It does not itself prove RLS actually isolates a second user's rows through the view at query time -- that is a live-database, two-session behavioural claim 07-04 owns. Routing to human/next-plan judgment rather than auto-passing this specific sub-claim."

duration: ~2h10min
completed: 2026-09-01
status: complete
---

# Phase 7 Plan 2: Closed-State Derivation, Reader Migration, and Migration 0014 Summary

**`derive_position_state` lands as a pure, gap-honest read model; every reader moves off `positions.opened_at`/`closed_at` before migration 0014 drops them for good (human-approved, checkpoint decision `drop`); and the same migration adds `events.rolled_from_position_id` plus the `campaign_chain` recursive-CTE view, created `WITH (security_invoker = true)` so it does not silently leak cross-user data through the DDL role's own RLS bypass.**

## Performance

- **Duration:** ~2h10min (includes the Task 3 checkpoint pause awaiting human approval)
- **Started:** 2026-09-01 (approx.)
- **Completed:** 2026-09-01
- **Tasks:** 4 of 4 completed
- **Files modified:** 16 (2 created, 14 modified)

## Accomplishments

- `src/morai/ledger/positions.py`: `LegNet`/`PositionState`/`LegRow` frozen dataclasses, `net_quantity_for_leg` (pure -- BUY positive/SELL negative, never `abs()`, `None` on any gap), `derive_position_state` (pure -- no `AsyncSession`, no clock, no `Position`/`Leg` import), and `read_position_state` (the async shell -- scopes fills via `resolve_fill_positions` and events via a `position_id` filter, so a shared-leg symbol from hard case 1 cannot leak a sibling position's fills in).
- `tests/ledger/test_closed_state.py` (new): 8 tests -- 6 pure, 2 `db`-marked (14th synthetic single-OPEN calendar stays open; a real fully-unwound oracle calendar derives closed) through the real `read_position_state` wrapper.
- `src/morai/api/routes_identity.py`: `list_positions`/`get_position` derive `opened_at` through `read_position_state` -- same response shape, same route signatures (D7-04).
- `tests/ledger/oracle_seed.py`, `test_pairing_shared_leg.py`, `test_pairing_no_position_state.py`: the three Pitfall-5 repairs (kwargs removed, Python-side ordering off the fixtures' own timestamps, the mutation test retired with its replacement named).
- **Migration 0014** (`alembic/versions/0014_derived_position_state_and_campaign_chain.py`): drops `positions.opened_at`/`closed_at`; adds `events.rolled_from_position_id` (nullable FK to `positions.id`) plus the `roll_has_rolled_from_position` CHECK (a biconditional, composes independently with 0008's `roll_has_both_legs`); creates `campaign_chain`, a `WITH RECURSIVE` view over the ROLL chain, `WITH (security_invoker = true)` and a native `CYCLE position_id` clause, granted `SELECT` to `morai_app`. Round-tripped `upgrade` -> `downgrade` -> `upgrade` against local Postgres 18 with no orphaned view before the suite ran.
- `src/morai/db/models.py`: `Position` drops its two `Mapped[...]` columns and gets an updated docstring; `Event` gains `rolled_from_position_id` and a `__init__` write-token sentinel gate (`_EVENT_WRITE_TOKEN`, mirroring `Fill`/`Position`/`Leg` exactly).
- `src/morai/ledger/events.py`: `_EVENT_WRITE_TOKEN` sentinel; `EventWrite`/`EventRecord` carry `rolled_from_position_id` (defaults to `None` on `EventWrite`, so every existing caller except ROLL-constructing ones needed no change); `insert_events` gained a pre-database `ValueError` guard requiring `rolled_from_position_id` iff `event_type == "ROLL"`, mirroring the existing amount-completeness guard.
- `tests/ledger/test_schema_contract.py`: 6 new assertions covering all three schema changes, including the `security_invoker` `reloptions` check.
- `tests/gate/test_ledger_write_boundary.py`: restructured to parametrize over `(module, name, allowed_importers)` triples -- `_EVENT_WRITE_TOKEN` lives in a different module than `_POSITION_WRITE_TOKEN`/`_LEG_WRITE_TOKEN` and needs its own allowed-importer pair.
- `tests/ledger/test_roll_check_constraint.py`: a new test (`test_roll_missing_the_rolled_from_position_id_is_rejected`) isolates the new CHECK's own rejection path from `roll_has_both_legs`'s; the three pre-existing tests that construct a ROLL row now supply `rolled_from_position_id`.
- Four other pre-existing test files (`test_nonce_uniqueness.py`, `test_crypto_shred.py`, `test_key_rotation.py`, `test_pg_dump_confidentiality.py`) each supply `rolled_from_position_id` on their own ROLL `EventWrite` construction -- a direct, unavoidable consequence of the new CHECK.

## Task Commits

Each task was committed atomically (Task 1 followed RED->GREEN per its `tdd="true"` attribute; Tasks 2 and 4 are each a single commit -- see TDD Gate Compliance below):

1. **Task 1 RED: add failing test for closed-state derivation** - `654d141` (test)
2. **Task 1 GREEN: implement closed-state derivation as pure function over net quantity per leg** - `0e71605` (feat)
3. **Task 2: move every reader off stored positions.opened_at/closed_at** - `051a18b` (refactor)
4. **(interim) SUMMARY through Task 2, halted at Task 3 checkpoint** - `d5174ee` (docs)
5. **Task 3 + Task 4: migration 0014 -- drop timestamps, add roll link, campaign view** - `82a6519` (feat) -- Task 3 is the checkpoint decision itself (`drop`, human-approved, recorded in the migration's own docstring); no code commit is Task 3's own, since the decision only gates Task 4's write.

**Plan metadata:** commit follows this SUMMARY update.

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the full RED->GREEN cycle: `654d141` is a genuine `test(...)` commit whose RED was a real `ImportError` on `LegNet` (no scaffolding built to manufacture a more interesting failure), and `0e71605` is the matching `feat(...)` commit that turned it green. No REFACTOR commit was needed.

Task 2 (`tdd="true"`) was committed as a single `refactor(...)` commit, not RED->GREEN. Rationale: Task 2 is a structural move -- readers change *how* they get `opened_at`/`closed_at`, not *what value* they observe. There is no new externally-observable input/output pair to write a failing test against first; manufacturing an artificial RED here would repeat the exact anti-pattern `.claude/rules/workflow.md` names as having cost Phase 2 four hours.

Task 4 (`tdd="true"`) was likewise committed as a single `feat(...)` commit, not strict RED->GREEN, for a related but distinct reason: this task's real "tests" are the migration's own round-trip (`upgrade`/`downgrade`/`upgrade`, run and shown green before the suite) plus `psql`-driven structural assertions against `pg_class`/`pg_constraint`, which cannot exist as a failing pytest run before the migration file exists -- there is no schema to query against 0013 alone that would exercise `test_schema_contract.py`'s new assertions meaningfully (they would fail with "relation does not exist" style errors, which is a real but uninformative red, not a designed one). The migration, the model changes, and the schema-contract extensions were developed together and verified together: `alembic upgrade head` / `downgrade -1` / `upgrade head` all green, then the full local gate (`bash tools/gate.sh`, 418 passed) before committing. This is flagged here per `gsd-core/references/tdd.md`'s own instruction to record gate-sequence deviations rather than silently skip them.

## Files Created/Modified

- `src/morai/ledger/positions.py` - `LegNet`, `PositionState`, `LegRow`, `net_quantity_for_leg`, `derive_position_state`, `read_position_state`
- `tests/ledger/test_closed_state.py` - 8-test suite for the closed-state read model (new file)
- `src/morai/api/routes_identity.py` - `list_positions`/`get_position` derive `opened_at` via `read_position_state`
- `tests/ledger/oracle_seed.py` - both `insert(Position)` sites drop the `opened_at`/`closed_at` kwargs
- `tests/ledger/test_pairing_shared_leg.py` - Python-side ordering replaces `ORDER BY opened_at DESC`
- `tests/ledger/test_pairing_no_position_state.py` - column-mutation test retired; remaining `closed_at` read moved onto `read_position_state`
- `alembic/versions/0014_derived_position_state_and_campaign_chain.py` - the migration (new file)
- `src/morai/db/models.py` - `Position` drops two columns; `Event` gains `rolled_from_position_id` + sentinel gate
- `src/morai/ledger/events.py` - `_EVENT_WRITE_TOKEN`; `EventWrite`/`EventRecord`/`insert_events`/`read_events` thread `rolled_from_position_id`
- `tests/ledger/test_schema_contract.py` - 6 new schema assertions for migration 0014
- `tests/gate/test_ledger_write_boundary.py` - restructured for a third sentinel in a different module
- `tests/ledger/test_roll_check_constraint.py` - new CHECK's own rejection test; existing ROLL sites supply `rolled_from_position_id`
- `tests/crypto/test_nonce_uniqueness.py`, `tests/test_crypto_shred.py`, `tests/test_key_rotation.py`, `tests/test_pg_dump_confidentiality.py` - ROLL `EventWrite` sites supply `rolled_from_position_id`

## Decisions Made

See `key-decisions` in the frontmatter above -- eight decisions recorded there, covering the shared-leg fill-scoping fix, the ordering-fix source, the moved `closed_at` read, the checkpoint's `drop` decision and its evidence, the CHECK's biconditional shape, `security_invoker`'s non-negotiable status, the timing of `Event`'s sentinel gate, and the minimal-correct fix pattern applied across five pre-existing ROLL-constructing test files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] `read_position_state` scopes fills via `resolve_fill_positions`, not a bare `occ_symbol` filter**
- **Found during:** Task 1, writing `read_position_state`.
- **Issue:** The plan's action text for `read_position_state` does not name the shared-leg disambiguation `resolve_fill_positions` already solves for event derivation. A naive `occ_symbol`-only filter would double-count a shared front leg's fills across both sibling positions (hard case 1).
- **Fix:** `read_position_state` calls `resolve_fill_positions` and filters `read_fills`' output to fills whose resolved `position_id` matches the target position; events are filtered by `position_id` directly.
- **Files modified:** `src/morai/ledger/positions.py`.
- **Verification:** `bash tools/gate.sh` green; existing hard-case-1 tests unaffected and still passing.
- **Committed in:** `0e71605` (Task 1 GREEN).

**2. [Rule 1 - Bug] Moved the remaining raw-SQL `closed_at` read in `test_pairing_no_position_state.py` onto `read_position_state`**
- **Found during:** Task 2, reviewing the two synthetic-open-calendar tests the plan says to "keep... unaffected."
- **Issue:** One of the two kept tests reads `positions.closed_at` via a raw `text()` query -- a direct reader of the column Task 2's own title targets. Migration 0014 (Task 4) would break it with an `UndefinedColumn` error, and Task 4's file list did not include this test file.
- **Fix:** Replaced the raw SQL read with `read_position_state(...)`, asserting `state.closed_at is None`.
- **Files modified:** `tests/ledger/test_pairing_no_position_state.py`.
- **Verification:** targeted test passes; `bash tools/gate.sh` green.
- **Committed in:** `051a18b` (Task 2).

**3. [Rule 1 - Bug] Five pre-existing test files supply `rolled_from_position_id` on ROLL constructions the new CHECK now requires**
- **Found during:** Task 4, running `bash tools/gate.sh` after writing the migration and models -- `tests/ledger/test_roll_check_constraint.py::test_roll_with_both_amounts_is_accepted` failed with `CheckViolationError: ... violates check constraint "roll_has_rolled_from_position"`.
- **Issue:** `roll_has_rolled_from_position` (D7-10) requires `rolled_from_position_id` on every ROLL row. Six existing ROLL-constructing call sites across five test files (`test_roll_check_constraint.py` x3, `test_nonce_uniqueness.py` x2, `test_crypto_shred.py`, `test_key_rotation.py`, `test_pg_dump_confidentiality.py`) predate D7-10 and never set it -- not itself named in Task 4's file list, but a direct, unavoidable consequence of the CHECK Task 4 adds.
- **Fix:** Each site supplies a real `positions.id` as `rolled_from_position_id` -- self-referencing (`position_id` doubling as its own target) where the test's own claim is unrelated to roll-chain semantics, and a second bare position row in `test_roll_check_constraint.py`'s three ROLL tests, where isolating `roll_has_both_legs`'s own failure from the new CHECK's mattered for the assertion's specificity. Added one new test, `test_roll_missing_the_rolled_from_position_id_is_rejected`, proving the new CHECK's own rejection path in isolation.
- **Files modified:** `tests/ledger/test_roll_check_constraint.py`, `tests/crypto/test_nonce_uniqueness.py`, `tests/test_crypto_shred.py`, `tests/test_key_rotation.py`, `tests/test_pg_dump_confidentiality.py`.
- **Verification:** `bash tools/gate.sh` -- 418 passed.
- **Committed in:** `82a6519` (Task 4).

---

**Total deviations:** 3 auto-fixed (1 missing-critical, 2 bugs).
**Impact on plan:** All three fixes are necessary for correctness -- the first prevents a real cross-position data leak in a hard case this project has already paid for once; the second prevents a landmine Task 4 was never assigned to defuse; the third is the direct, unavoidable ripple of the new CHECK constraint onto pre-existing fixtures. No scope creep beyond what each fix required.

## Issues Encountered

None beyond the three deviations above, all fully documented there.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROADMAP criterion 1 holds: closed state is computed from net quantity per leg, and no column exists anywhere that could disagree with it.
- Migration 0014 is applied, round-trips cleanly, and carries all three schema changes as one revision (D7-15).
- `campaign_chain`'s `security_invoker` clause is asserted structurally here; **07-04 owns the behavioural proof** with a real second user -- do not assume that proof already exists from this plan alone.
- `Event`, `Position` and `Leg` each carry a write-token sentinel with an AST gate proving only two modules import each.
- `bash tools/gate.sh` exits 0 -- 418 passed.
- No blockers for 07-03, 07-04, or 07-05.

## Self-Check: PASSED

All created/modified files verified present on disk: `src/morai/ledger/positions.py`,
`tests/ledger/test_closed_state.py`, `src/morai/api/routes_identity.py`,
`tests/ledger/oracle_seed.py`, `tests/ledger/test_pairing_shared_leg.py`,
`tests/ledger/test_pairing_no_position_state.py`,
`alembic/versions/0014_derived_position_state_and_campaign_chain.py`,
`src/morai/db/models.py`, `src/morai/ledger/events.py`,
`tests/ledger/test_schema_contract.py`, `tests/gate/test_ledger_write_boundary.py`,
`tests/ledger/test_roll_check_constraint.py`, this SUMMARY. All five commit hashes
(`654d141`, `0e71605`, `051a18b`, `d5174ee`, `82a6519`) verified present in
`git log --oneline --all`.

---
*Phase: 07-position-and-campaign-read-models*
*Completed: 2026-09-01*

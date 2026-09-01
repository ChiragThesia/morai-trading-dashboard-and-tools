---
phase: 05-fill-pairing-and-the-oracle-gate
plan: 02
subsystem: ledger
tags: [fill-pairing, order-anchor, position-state, occ-symbol, detect-roll, decimal]

requires:
  - phase: 05-fill-pairing-and-the-oracle-gate
    provides: >-
      plan 01's src/morai/ledger/pairing.py -- RESOLVE_FILL_POSITIONS_SQL
      (user_id-scoped), the pure derive_events core, and the
      resolve_fill_positions/sync_events shell, already proven end to end
      on one real calendar
provides:
  - "Hard case 1, both layers, proved through sync_events: the shared
    front-leg calendars converge to their own correct figures under an
    unscoped sweep and under a per-position replay in the real
    processing order (opened_at descending), with zero orphans on a
    second idempotent replay"
  - "The explicitly-unresolved negative case (NN-11) and cross-user
    isolation (T-05-02) on the identical shared symbol"
  - "The 14th synthetic fixture and its seeding helper
    (seed_synthetic_open_calendar), seeded through insert_fills"
  - "Behavioural proof that no derivation path reads position state:
    rewriting every seeded position's opened_at/closed_at to a sentinel
    and re-deriving from a freshly-cleared events scope reproduces a
    byte-identical event set"
  - "parse_occ_symbol/OccContract and detect_roll as real, callable
    predicates -- the negative guard only, per D5-01"
affects: [05-03-the-oracle-gate]

actuals:
  tokens: 8756
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Cross-session TRUNCATE inside a test deadlocks against another
      session's still-open transaction on the same table -- use DELETE
      on the session already touching that table instead (discovered
      this plan, documented in test_pairing_no_position_state.py)."
    - "OCC symbol parsing tries the longer root alternative first
      (SPXW before SPX) in the regex so the shorter root never
      swallows part of the longer one's suffix."

key-files:
  created:
    - tests/ledger/test_pairing_shared_leg.py
    - tests/ledger/test_pairing_no_position_state.py
    - tests/ledger/test_pairing_roll_guard.py
  modified:
    - src/morai/ledger/pairing.py
    - tests/ledger/oracle_seed.py

key-decisions:
  - "detect_roll ships as the negative guard only (D5-01): no derivation
    path calls it, and no positive ROLL fixture exists this phase to
    verify a positive path against."
  - "The position-state mutation test deletes events via app_db_session
    itself (DELETE FROM events WHERE user_id = :uid) rather than
    TRUNCATE via a second session -- a cross-session TRUNCATE needs an
    ACCESS EXCLUSIVE lock that app_db_session's own still-open
    transaction (holding a lock from the prior sync_events/read_events
    calls) blocks until commit, which deadlocked the first version of
    this test against Postgres."
  - "The sentinel timestamp for the position-state mutation is
    2099-01-01: no oracle calendar's opened_at/closed_at falls anywhere
    near the year 2099 (all 13 real calendars and the 14th synthetic
    fixture sit in 2026), so a leaked position column into an event's
    own timestamp would surface immediately as a divergent event_time."

requirements-completed: [LEDGER-02, LEDGER-03]

coverage:
  - id: D1
    description: >-
      8a63aa81 and 6303e6af -- sharing the identical front contract
      SPXW260618P07275000 -- both derive to their own correct figures
      (10.20/10.55 and 46.00/47.00) under an unscoped sweep, and again
      under a per-position replay in the real processing order
      (positions descending by opened_at, 8a63aa81 before 6303e6af),
      with zero unresolved fills on a second idempotent replay.
    requirement: LEDGER-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_pairing_shared_leg.py#test_unscoped_sweep_resolves_both_shared_front_leg_calendars_correctly"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_shared_leg.py#test_per_position_replay_in_real_processing_order_converges_with_zero_orphans"
        status: pass
    human_judgment: false
  - id: D2
    description: >-
      Two positions sharing both leg symbols leave every fill in their
      shared order explicitly unresolved, contributing to zero events
      -- never guessed. User A's derivation over a shared symbol never
      resolves to user B's position.
    requirement: LEDGER-03
    verification:
      - kind: integration
        ref: "tests/ledger/test_pairing_shared_leg.py#test_two_positions_sharing_both_legs_leave_fills_explicitly_unresolved"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_shared_leg.py#test_cross_user_derivation_never_resolves_to_the_other_users_position"
        status: pass
    human_judgment: false
  - id: D3
    description: >-
      Rewriting every seeded position's opened_at/closed_at to an
      implausible sentinel and re-deriving from a freshly-cleared
      events scope reproduces a byte-identical event set, event_time
      included -- no derivation path reads position state.
    requirement: LEDGER-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_pairing_no_position_state.py#test_mutating_position_state_and_rederiving_reproduces_identical_events"
        status: pass
    human_judgment: false
  - id: D4
    description: >-
      The 14th synthetic fixture (one OPENING order, no CLOSE order
      anywhere) derives to exactly one OPEN event of 40.00 and zero
      CLOSE events, with closed_at staying NULL, both alone and
      alongside all 13 real calendars.
    requirement: LEDGER-02
    verification:
      - kind: integration
        ref: "tests/ledger/test_pairing_no_position_state.py#test_synthetic_open_calendar_derives_to_one_open_event_and_stays_open"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_no_position_state.py#test_synthetic_open_calendar_stays_open_alongside_the_13_real_calendars"
        status: pass
    human_judgment: false
  - id: D5
    description: >-
      parse_occ_symbol round-trips all 26 oracle symbols and raises
      ValueError on a malformed one; detect_roll is False for every
      fill pair inside broker order 1006797510202, which derives to a
      43.22 CLOSE on 60c46a57 and a 41.52 OPEN on 24f1e72e with zero
      ROLL rows in events.
    requirement: LEDGER-02
    verification:
      - kind: unit
        ref: "tests/ledger/test_pairing_roll_guard.py#test_parse_occ_symbol_round_trips_all_26_oracle_symbols"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_roll_guard.py#test_parse_occ_symbol_raises_on_malformed_symbol"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_roll_guard.py#test_detect_roll_is_false_for_every_pair_within_the_shared_order"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_pairing_roll_guard.py#test_shared_order_derives_to_two_close_and_two_open_events_never_a_roll"
        status: pass
    human_judgment: false

duration: 41min
completed: 2026-09-01
status: complete
---

# Phase 5 Plan 2: Both hard cases -- the shared front leg and the position column that cannot lie Summary

**Both documented hard cases proved through `sync_events`: the shared front-month leg converges correctly under both a full sweep and the real per-position replay order, and no derivation path reads position state -- proved structurally (05-01's AST gate) and now behaviourally, by mutation.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-09-01 (task 1 start)
- **Completed:** 2026-09-01
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- Hard case 1's second layer (`L061`) proved directly: `8a63aa81` and
  `6303e6af` share the identical front contract
  `SPXW260618P07275000`. An unscoped sweep converges to 10.20/10.55 and
  46.00/47.00, zero orphans -- and, the harder claim, replaying the real
  processing order (positions descending by `opened_at`, which puts
  `8a63aa81` before `6303e6af`) and deriving each position scoped to
  only its own two order ids still converges, because `sync_events`'s
  resolution read is whole-user by construction. Idempotent on a second
  replay: same row count, same `fill_ids_hash` set.
- The negative case (`NN-11`) and cross-user isolation (`T-05-02`) both
  proved: two positions sharing both legs leave both fills explicitly
  unresolved with zero events; user A's derivation over `8a63aa81` never
  resolves to user B's `6303e6af`, despite sharing the identical front
  symbol.
- Criterion 2 (`D5-02`) satisfied behaviourally, completing 05-01's
  structural AST gate: rewriting every seeded position's `opened_at`/
  `closed_at` to an implausible sentinel (`2099-01-01`) and re-deriving
  from a freshly-cleared `events` scope reproduces a byte-identical
  event set, `event_time` included.
- The 14th synthetic fixture landed (`seed_synthetic_open_calendar`,
  seeded through `insert_fills`, the one write path): one OPENING
  order, no CLOSE anywhere, derives to exactly one OPEN event of 40.00
  and zero CLOSE events, `closed_at` staying NULL, both alone and
  alongside all 13 real calendars.
- `parse_occ_symbol`/`OccContract` and `detect_roll` landed as real,
  callable predicates. The parser round-trips all 26 oracle symbols and
  raises `ValueError` naming a malformed one. `detect_roll` is False
  across every fill pair in order `1006797510202` (closes `60c46a57` at
  strike 7425, opens `24f1e72e` at strike 7475 -- same root and option
  type, different strike), which derives to a 43.22 CLOSE and a 41.52
  OPEN with zero `ROLL` rows in `events`. Per D5-01, this ships as the
  negative guard only -- no derivation path calls it, no positive ROLL
  path exists this phase.

## Task Commits

Each task was committed atomically, RED before GREEN (or documented
honestly where green on arrival):

1. **Task 1: Hard case 1, both layers**
   - `e0edd15` `test(05-02): prove hard case 1's both layers over the shared front leg` -- RED was the file not existing (collection error); 05-01's `sync_events` already implements the whole-user resolution read plus Python-side `order_ids` narrowing this task proves, so all four tests passed green on arrival. No companion `feat` commit, per the project's own red-ceremony rule.
2. **Task 2: Position state absence and the 14th fixture**
   - `71a5395` `test(05-02): add failing test for position-state absence and the 14th fixture` -- RED, observed: `ImportError` -- `SYNTHETIC_OPEN_DEBIT_USD`/`SYNTHETIC_OPEN_POSITION_ID`/`seed_synthetic_open_calendar` did not exist in `oracle_seed.py` yet.
   - `ad01308` `feat(05-02): add the 14th synthetic fixture and prove position state is unread` -- GREEN
3. **Task 3: `detect_roll`'s negative guard**
   - `c97df16` `test(05-02): add failing test for detect_roll's negative guard` -- RED, observed: `ImportError` -- `detect_roll`/`parse_occ_symbol` did not exist in `pairing.py` yet.
   - `57d7f3c` `feat(05-02): implement parse_occ_symbol and detect_roll's negative guard` -- GREEN

**Plan metadata:** (this commit)

## Files Created/Modified

- `tests/ledger/test_pairing_shared_leg.py` -- hard case 1's both layers, the negative case, cross-user isolation
- `tests/ledger/test_pairing_no_position_state.py` -- position-state mutation proof, the 14th fixture's own tests
- `tests/ledger/test_pairing_roll_guard.py` -- `parse_occ_symbol` round-trip, `detect_roll`'s negative guard, the end-to-end db proof
- `src/morai/ledger/pairing.py` -- adds `OccContract`, `parse_occ_symbol`, `detect_roll`; updates the module docstring's now-inaccurate "nothing here builds a ROLL-detection guard" line
- `tests/ledger/oracle_seed.py` -- adds `seed_synthetic_open_calendar` and the 14th fixture's own exposed constants (`SYNTHETIC_OPEN_POSITION_ID`, `SYNTHETIC_OPEN_DEBIT_USD`, etc.)

## Decisions Made

- **`detect_roll` ships as the negative guard only.** No derivation path
  calls it this phase; no positive ROLL fixture exists in the oracle to
  verify a positive path against, and building one now, checked only
  against fixtures written by the same reasoning that wrote the code,
  would reproduce the exact conditions of the original −$319,850 loss
  (`D5-01`).
- **The position-state mutation test deletes `events` on `app_db_session`
  itself, not `TRUNCATE` on a second session.** The first version of
  this test used `TRUNCATE TABLE events` on `superuser_db_session` and
  deadlocked: `app_db_session`'s own still-open transaction (holding a
  lock from the earlier `sync_events`/`read_events` calls in the same
  test) blocked the cross-session `TRUNCATE`'s required `ACCESS
  EXCLUSIVE` lock indefinitely. `DELETE FROM events WHERE user_id =
  :uid` on `app_db_session` itself (the app role's `DELETE` grant on
  `events`, migration 0008) avoids the cross-session lock entirely.
  Recorded here and in the test's own comment as a real trap for the
  next multi-session db test this suite writes.
- **The sentinel timestamp is `2099-01-01`.** No oracle calendar's
  `opened_at`/`closed_at` falls anywhere near the year 2099 (every real
  and synthetic fixture sits in 2026), so a leaked position column into
  an event's own `event_time` would surface immediately as a divergent
  timestamp, not a coincidental match.
- **`_seed_unresolvable_order` was imported from `test_plaintext_queries.py`
  rather than duplicated.** It is the same negative-control shape this
  task needs, and the leading underscore is a test-internal convention
  in this codebase, not a real access boundary between files in the
  same suite (the same pattern `test_isolation.py` already uses for
  `_seed_session`).

## Deviations from Plan

None — plan executed exactly as written for every task's code. The one
correction made mid-task (`TRUNCATE` deadlock -> `DELETE` on
`app_db_session`) was a bug in this plan's own first test draft, fixed
before any commit landed carrying it -- not a deviation from the plan's
own instructions, which never specified `TRUNCATE` at all.

## Issues Encountered

**A `TRUNCATE TABLE events` cross-session deadlock**, discovered while
first writing Task 2's position-state mutation test. Diagnosed via
`pg_stat_activity` (`wait_event_type = 'Lock'`, `wait_event =
'relation'`) showing the `TRUNCATE` blocked against `app_db_session`'s
own still-open transaction. Resolved by switching to a same-session
`DELETE`, documented above and in the test's own comment. No production
code was affected -- this was purely a test-authoring pitfall.

## User Setup Required

None -- no external service configuration required.

## Known Stubs

None. `detect_roll`'s absence of a positive ROLL path is a documented
scope boundary (`D5-01`), not a stub: it is a real, tested, callable
predicate proving the one negative case the oracle contains, and its
own docstring states plainly that no positive path is built and why.

## TDD Gate Compliance

RED and GREEN gate commits are present for Tasks 2 and 3: `71a5395`
(test) precedes `ad01308` (feat); `c97df16` (test) precedes `57d7f3c`
(feat). Task 1 carries only a `test(05-02)` commit (`e0edd15`) with no
companion `feat` -- documented above as an honest "green on arrival"
case: 05-01's `sync_events` already satisfied every assertion this
task's test writes, so no implementation change was needed or made
after the test was written.

## Next Phase Readiness

- `src/morai/ledger/pairing.py`'s `parse_occ_symbol`/`OccContract`/
  `detect_roll` are ready for 05-03's full 13-calendar oracle gate to
  build on, or ignore, as that plan's own scope requires.
- The `TRUNCATE`-vs-`DELETE` cross-session lock lesson is carried
  forward for any later plan writing a multi-session db test that
  mutates a table another open session has already touched.
- No blockers.

## Self-Check: PASSED

- Created files verified on disk: `tests/ledger/test_pairing_shared_leg.py`,
  `tests/ledger/test_pairing_no_position_state.py`,
  `tests/ledger/test_pairing_roll_guard.py` (all `FOUND`).
- Modified files verified on disk: `src/morai/ledger/pairing.py`,
  `tests/ledger/oracle_seed.py` (both `FOUND`).
- All five task commit hashes verified in `git log`: `e0edd15`,
  `71a5395`, `ad01308`, `c97df16`, `57d7f3c`.
- `bash tools/gate.sh`: ruff, ruff format, basedpyright (95 files, 0
  errors), mypy (95 files, success) all green; **302 passed** (baseline
  291 + 11 new), 41.72s wall clock (baseline ~46s for the full gate).

---
*Phase: 05-fill-pairing-and-the-oracle-gate*
*Completed: 2026-09-01*

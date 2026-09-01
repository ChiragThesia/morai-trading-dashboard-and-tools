---
phase: 05-fill-pairing-and-the-oracle-gate
plan: 01
subsystem: ledger
tags: [fill-pairing, ledger-events, decimal, sqlalchemy, ast-gate, idempotency]

requires:
  - phase: 03-trading-tables-and-envelope-encryption
    provides: >-
      fills/positions/legs/events tables, the single write paths
      (insert_fills, insert_events) and the order-anchor disambiguation SQL,
      already proven against real oracle data in test_plaintext_queries.py
provides:
  - "src/morai/ledger/pairing.py: RESOLVE_FILL_POSITIONS_SQL (promoted,
    user_id-scoped), the pure derive_events core, and the
    resolve_fill_positions/sync_events shell"
  - "One real oracle calendar (65aac62e) proven end to end: fills already
    in Postgres -> resolved -> classified -> netted -> written as OPEN/CLOSE
    events, idempotently re-derivable"
  - "An AST-based purity/no-broker-call gate over pairing.py's own imports"
affects: [05-02-shared-legs-and-the-detect-roll-guard, 05-03-the-oracle-gate]

actuals:
  tokens: 9229
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Pure/shell split (derive_events vs resolve_fill_positions/sync_events),
      mirroring vendor/connections.py's derive_connection_health precedent:
      no AsyncSession, no clock, no broker import inside the pure core."
    - "Read-compare-skip idempotency over events.fill_ids_hash, not
      delete-then-reinsert (events grants no UPDATE, L069/L005)."
    - "AST-walk meta-tests (ast.parse + ast.walk over the module's own
      source) to prove an architectural absence -- no vendor import, no
      Position reference -- structurally, not by convention."

key-files:
  created:
    - src/morai/ledger/pairing.py
    - tests/ledger/test_pairing_tracer.py
    - tests/ledger/test_pairing_pure.py
    - tests/ledger/test_pairing_idempotency.py
  modified:
    - tests/ledger/test_plaintext_queries.py

key-decisions:
  - "The order-anchor disambiguation SQL was promoted verbatim from
    test_plaintext_queries.py's private copy into
    morai.ledger.pairing.RESOLVE_FILL_POSITIONS_SQL, with exactly the one
    change the plan specified: WHERE user_id = :user_id added to both the
    position_legs and fill_candidates CTEs."
  - "sync_events reads the whole user's fills and resolutions on every
    call and only narrows by order_ids afterward, in Python -- never a
    query scoped to one position's own legs before resolution (L061's
    second-layer bug)."
  - "The Event._write_token single-writer gate (T-05-01) was deliberately
    not built this plan -- see Threat Flags below."

requirements-completed: [LEDGER-01, LEDGER-09, LEDGER-12]

coverage:
  - id: D1
    description: >-
      Calendar 65aac62e derives end to end from stored fills into two
      events rows reading back 32.35 (OPEN) and 36.35 (CLOSE) as exact
      Decimal, with event_time equal to each order's own execution time
      and the two fill_ids_hash values distinct.
    requirement: LEDGER-01
    verification:
      - kind: integration
        ref: "tests/ledger/test_pairing_tracer.py#test_one_calendar_derives_open_and_close_events_end_to_end"
        status: pass
    human_judgment: false
  - id: D2
    description: >-
      derive_events is pure (no AsyncSession, no clock, no broker import
      reachable from pairing.py) and correctly leaves unresolved/
      unclassified fills out of every event; commission_usd is always
      None; fill_ids_hash is order-independent.
    requirement: LEDGER-12
    verification:
      - kind: unit
        ref: "tests/ledger/test_pairing_pure.py#test_derive_events_no_session_or_db_reproduces_oracle_figures"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_pure.py#test_pairing_imports_no_vendor_broker_or_http_module"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_pure.py#test_pairing_never_imports_or_references_position"
        status: pass
      - kind: unit
        ref: "tests/ledger/test_pairing_pure.py#test_hash_fill_ids_is_order_independent"
        status: pass
    human_judgment: false
  - id: D3
    description: >-
      Re-deriving events for the same (user, order_id) scope is
      idempotent -- a second and third sync_events run insert no new rows
      and leave the fill_ids_hash set unchanged.
    requirement: LEDGER-09
    verification:
      - kind: integration
        ref: "tests/ledger/test_pairing_idempotency.py#test_repeated_sync_events_over_one_scope_inserts_nothing_new"
        status: pass
    human_judgment: false
  - id: D4
    description: >-
      The promoted RESOLVE_FILL_POSITIONS_SQL constant is the single
      definition of the order-anchor disambiguation query, and Phase 3's
      own proof tests now exercise that production constant instead of a
      private copy.
    requirement: LEDGER-01
    verification:
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_disambiguation_query_resolves_shared_front_leg_calendars"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_plaintext_queries.py#test_disambiguation_query_leaves_unanchored_order_unresolved"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-08-31
status: complete
---

# Phase 5 Plan 1: One-calendar tracer -- fills to OPEN/CLOSE events Summary

**One real oracle calendar's four stored fills resolved via the promoted order-anchor SQL, netted into an exact-Decimal OPEN debit and CLOSE credit through a pure derivation core, and written idempotently through `insert_events`.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-31T23:12:56-05:00 (base commit)
- **Completed:** 2026-08-31T23:24:29-05:00 (last task commit)
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `src/morai/ledger/pairing.py` created: `RESOLVE_FILL_POSITIONS_SQL` (the
  disambiguation SQL, promoted and scoped by `user_id`), the pure
  `derive_events`/`classify_fill`/`_signed_leg_amount`/`_net_amount`/
  `hash_fill_ids` core, and the `resolve_fill_positions`/`sync_events`
  shell.
- Calendar `65aac62e` proven end to end: its four fills, already in
  Postgres through `insert_fills`, derive to exactly two `events` rows --
  OPEN `open_debit_usd = 32.35` and CLOSE `close_credit_usd = 36.35`, both
  exact `Decimal`, both `event_time` equal to their own order's own time,
  both `fill_ids_hash` present and distinct, zero unresolved/unclassified
  fills.
- Purity proven structurally: `derive_events` runs with no `AsyncSession`
  and no database marker; an AST walk of `pairing.py`'s own imports finds
  nothing under `morai.vendor`, `schwab` or `httpx`, and no reference to
  `Position` anywhere in the module (LEDGER-12, D5-02's structural half).
- `sync_events` is idempotent: a second and third run over the same scope
  insert no new rows, via read-compare-skip over
  `(position_id, event_type, fill_ids_hash)` triples -- never
  delete-then-reinsert (`events` grants no `UPDATE`).
- `test_plaintext_queries.py`'s two disambiguation tests now exercise the
  production constant `RESOLVE_FILL_POSITIONS_SQL` instead of a private
  copy, with their assertions unchanged.

## Task Commits

Each task was committed atomically, RED before GREEN:

1. **Task 1 (tracer): One calendar end to end**
   - `fff8881` `test(05-01): add failing test for one-calendar OPEN/CLOSE derivation` -- RED: `ModuleNotFoundError: No module named 'morai.ledger.pairing'` (the module did not exist yet; the cheapest honest red, no scaffolding built)
   - `1b8ce3c` `feat(05-01): derive OPEN/CLOSE events from one calendar's stored fills` -- GREEN
2. **Task 2 (auto, tdd): purity and no-broker-call gate**
   - `cf860d0` `test(05-01): prove derive_events is pure and imports no broker module` -- RED was the test file not existing (pytest `file or directory not found`); no separate GREEN/feat commit was needed, since Task 1's pure core already satisfies every assertion here with no further implementation change (see Deviations)
3. **Task 3 (auto, tdd): idempotent re-derivation**
   - `3672b50` `test(05-01): add failing test for idempotent sync_events re-derivation` -- RED, observed: `assert 4 == 2` after two `sync_events` runs (no existence check yet)
   - `b27c850` `feat(05-01): make sync_events idempotent via read-compare-skip` -- GREEN

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/morai/ledger/pairing.py` -- disambiguation SQL constant, pure derivation core, DB shell
- `tests/ledger/test_pairing_tracer.py` -- one-calendar end-to-end proof
- `tests/ledger/test_pairing_pure.py` -- purity + AST import gates
- `tests/ledger/test_pairing_idempotency.py` -- re-derivation proof
- `tests/ledger/test_plaintext_queries.py` -- now imports and exercises the promoted `RESOLVE_FILL_POSITIONS_SQL`

## Decisions Made

- **Promote, don't re-derive:** the disambiguation SQL is taken verbatim
  from `test_plaintext_queries.py`'s former private copy, with exactly one
  change -- an explicit `WHERE user_id = :user_id` on both CTEs, matching
  `read_fills`'s own both-belts discipline against relying on RLS alone.
- **Whole-user read, Python-side narrowing:** `sync_events` always calls
  `resolve_fill_positions`/`read_fills` for the whole user and only
  filters by `order_ids` afterward, in Python. This is the mechanism that
  keeps the `L061` scoped-read bug (the one that actually reached
  production) structurally unreachable -- plan 05-02 proves it under the
  real shared-front-leg ambiguity.
- **Grouping includes `order_id`:** `derive_events` groups survivors by
  `(position_id, role, order_id)`, not just `(position_id, role)`, so a
  re-derivation scoped to one order produces exactly the rows a full
  sweep would. Documented as an untested equivalence to per-position
  grouping with the oracle's own one-order-per-role data -- an honest
  limit, not a proven one.
- **Read-compare-skip, not delete-then-reinsert:** `sync_events`'s
  idempotency check is a pre-insert existence check against stored
  `(position_id, event_type, fill_ids_hash)` triples. Chosen because
  `events` has no `UPDATE` grant and a two-step wipe-then-reingest is not
  atomic across the step boundary (`L069`).
- **`commission_usd` is always `None` this phase**, per D5-04 -- the
  arithmetic is deliberately fee-free, and a gap is `None`, never `0`
  (`NN-16`). It has no column in `events` and is not persisted.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written for every task's code.

### Honest note on Task 2's TDD shape

Task 2 asked for a RED-then-GREEN cycle, but by the time it ran, Task 1's
pure `derive_events` core already satisfied every behavior Task 2's test
asserts (purity, the AST import gates, unresolved/unclassified handling,
`hash_fill_ids` order-independence, `commission_usd` always `None`). The
RED was genuine and cheap -- the test file itself did not exist yet, so
`pytest tests/ledger/test_pairing_pure.py` failed with a real "file or
directory not found" collection error. Writing the file then went straight
to green with zero changes to `pairing.py`. Per this project's own
red-ceremony rule ("if something is green on arrival, say so honestly
rather than weakening an assertion to manufacture a red"), this is
recorded here rather than disguised behind a synthetic implementation
commit. This is not a deviation from the plan's intent -- the plan's own
Task 1 already specified building the pure core with LEDGER-12's
constraints in mind, and Task 2 is the proof of that, not new work.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** None -- plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: T-05-01 (accept, per plan) | src/morai/ledger/events.py, src/morai/db/models.py | `Event` still carries no `_write_token` single-writer gate, unlike `Fill`. This plan adds exactly one caller into `insert_events` (`sync_events`), so the second-writer risk stays theoretical this plan, but it is now a real temptation the moment anything else writes an `Event`. Per the plan's own threat register this is accepted, not mitigated, this plan -- recorded here as the plan's own SUMMARY-level follow-up flag rather than left only in the threat model table. |

## TDD Gate Compliance

RED and GREEN gate commits are both present for Task 1 and Task 3:
`fff8881` (test) precedes `1b8ce3c` (feat); `3672b50` (test) precedes
`b27c850` (feat). Task 2 carries only a `test(05-01)` commit
(`cf860d0`) with no companion `feat` -- documented above as an honest
"green on arrival" case, not a missing gate: no implementation change was
needed or made after that test was written.

## Next Phase Readiness

- `src/morai/ledger/pairing.py` and its `derive_events`/`sync_events`
  shapes are ready for plan 05-02 (the shared-front-leg hard case and the
  `detect_roll` negative guard) and plan 05-03 (the full 13-calendar
  oracle gate and the seeded-fault suite) to build directly on -- no
  interface changes anticipated.
- The two honest limits recorded in `pairing.py`'s own docstrings --
  per-order grouping's untested equivalence to per-position grouping, and
  `sync_events`'s behavior when a stored event's hash differs from a
  fresh draft's -- are carried forward for whichever later plan first
  needs to confront them.
- No blockers.

## Self-Check: PASSED

- Created files verified on disk: `src/morai/ledger/pairing.py`,
  `tests/ledger/test_pairing_tracer.py`, `tests/ledger/test_pairing_pure.py`,
  `tests/ledger/test_pairing_idempotency.py` (all `FOUND`).
- Modified file verified on disk: `tests/ledger/test_plaintext_queries.py`
  (`FOUND`).
- All five task commit hashes verified in `git log`: `fff8881`, `1b8ce3c`,
  `cf860d0`, `3672b50`, `b27c850`.
- `uv run pytest -q && bash tools/gate.sh`: 291 passed (baseline 283 + 8
  new), gate exit 0, 46.33s wall clock (baseline ~46s).

---
*Phase: 05-fill-pairing-and-the-oracle-gate*
*Completed: 2026-08-31*

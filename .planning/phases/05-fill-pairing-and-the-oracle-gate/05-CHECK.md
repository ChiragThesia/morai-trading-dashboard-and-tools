---
status: pass
phase: 05-fill-pairing-and-the-oracle-gate
checked: 2026-08-31
---

# Phase 05 Plan Verification

## Overview

All three plans (05-01, 05-02, 05-03) have been verified against the phase goal and requirements. The plans are **complete and ready for execution**. No blockers or warnings identified.

## Requirement Coverage

All 7 requirements assigned to this phase have explicit task coverage:

| Requirement | Plan | Task | Verification |
|-------------|------|------|---|
| LEDGER-01 | 05-01 | 1, 3 | Events derived from fills through sync_events, with idempotency proving re-derivation unchanged |
| LEDGER-02 | 05-02 | 2 | Position state mutation test (opened_at/closed_at) proves nothing reads status; AST gate in 05-01 Task 2 proves no Position import |
| LEDGER-03 | 05-02 | 1 | Hard case 1 both layers: full sweep + per-position replay in opened_at descending order, zero unresolved |
| LEDGER-09 | 05-01 | 3 | Idempotency via fill_ids_hash, read-compare-skip (not delete-reinsert), proven twice on same scope |
| LEDGER-11 | 05-03 | 1 | 13-calendar oracle (all fixtures in ORACLE_CALENDARS) plus synthetic control, parametrized by real broker order id |
| LEDGER-12 | 05-01 | 2 + 05-03 | 1 | Pure derive_events with no session/clock/broker call, proven by AST gate and in-memory call with no database marker |
| OPS-06 | 05-03 | 2 | Three hand-seeded faults (sign-flip, rounding, off-by-one) injected via monkeypatch, each caught by oracle comparison |

**Coverage status: 100%** — every requirement has at least one task, and that task's action specifies measurable done criteria.

## Reused Assets Verification

The three plans claim reuse of existing work. All claimed assets have been verified as real and usable:

1. **`tests/ledger/oracle_seed.py`** (line 466: seed_oracle, lines 462-463: ORACLE_CALENDARS, ORACLE_FILLS)
   - Status: ✓ EXISTS and has the claimed shape
   - `seed_oracle` supports `calendar_ids` filter already (line 498)
   - All 52 oracle fills seeded through `insert_fills` (lines 540-554)
   - Returns `calendar_id -> position_id` mapping

2. **`tests/ledger/test_plaintext_queries.py`** (line 73: _DISAMBIGUATION_QUERY)
   - Status: ✓ EXISTS with full SQL (lines 73-329)
   - Two existing tests prove it works (lines 332-388):
     - `test_disambiguation_query_resolves_shared_front_leg_calendars` — both shared-front calendars resolve
     - `test_disambiguation_query_leaves_unanchored_order_unresolved` — two positions sharing both legs → NULL
   - Query structure is exactly as described in 05-RESEARCH.md Architecture Pattern 3

3. **`src/morai/db/models.py::Position`** (line 206)
   - Status: ✓ EXISTS with no status column (only opened_at, closed_at on lines 224, 227)
   - Docstring explicitly records why status column is absent (lines 208-212)

4. **`src/morai/db/models.py::Event`** (line 312)
   - Status: ✓ EXISTS; no commission_usd field (correct per D5-04)
   - Docstring records that `_write_token` gate is Phase 5's deferred concern (line 328)
   - open_debit_usd and close_credit_usd are nullable (lines 346-355)

**Reuse verification: All claimed assets are real and immediately usable. No blocking blockers to their incorporation.**

## SQL Relocation Correctness (05-01 Task 1)

Plan specifies: "Move the order-anchor disambiguation query here as the module-level constant `RESOLVE_FILL_POSITIONS_SQL`, taken verbatim from tests/ledger/test_plaintext_queries.py's current private copy, with exactly one change: add `WHERE user_id = :user_id` to the `position_legs` CTE and `WHERE f.user_id = :user_id` to the `fill_candidates` CTE."

Verification:
- ✓ The query as documented in test_plaintext_queries.py (lines 73-329) has no user_id predicate, only RLS reliance
- ✓ Adding `:user_id` to both CTEs is the correct "both belts" pattern already used in read_fills (CLAUDE.md confirmed this)
- ✓ Deleting the private copy and importing from morai.ledger.pairing is specified in Task 1 action
- ✓ The two existing tests' assertions remain unchanged, only the source changes
- ✓ No breaking change to test_plaintext_queries.py's own behavior

**SQL relocation: Correctly specified. The read-both-belts pattern (explicit user_id + RLS) is architecturally sound and matches existing code patterns.**

## Hard Case 1: Both Layers Covered (05-02 Task 1)

Plan specifies two layers of testing:

**Layer One (unscoped full sweep):**
- Seed `8a63aa81` + `6303e6af` together
- Derive unscoped
- Assert both calendars' correct figures: 10.20/10.55 and 46.00/47.00
- Zero unresolved fills

Verification: ✓ This is Layer One in Task 1 behavior block. Both calendars are real (specs 6 and 7 in salvage/oracle-fixtures.md).

**Layer Two (scoped per-position replay in real processing order):**
- Fetch positions ordered by opened_at descending (puts 8a63aa81 [2026-06-09] before 6303e6af [2026-05-19])
- For each position, derive scoped to that position's own order ids
- Assert same 10.20/10.55 and 46.00/47.00 with zero unresolved
- Idempotent: repeat and assert unchanged event set and fill_ids_hash

Verification: ✓ Layer Two is explicitly in Task 1 action ("For layer two, select the two positions from the database ordered by `opened_at` descending"). Task 1 docstring states its purpose: "the resolution read is whole-user by construction, so the sibling calendar's unique back leg is visible even when the derivation is scoped to one calendar's own orders. Narrowing that read to one position's legs is hard case 1's second layer and the mechanism `L061` describes... A future change that narrows it turns this test red."

**Hard case 1: Both layers are covered with explicit guards to prevent regression.**

## Synthetic Control (14th Fixture)

Plan specifies creation of `seed_synthetic_open_calendar` in 05-02 Task 2, which:
- Creates position with id `00000000-0000-4000-8000-000000000099` (the fixture's own literal UUID)
- One OPENING order `9990000001` on 2026-07-04
- Two fills (back leg: 100 OPENING buy, front leg: 60 OPENING sell)
- No CLOSE order
- Expected: exactly one OPEN event (debit 40.00) and zero CLOSE events

Verification: ✓ Task 2 action specifies the helper, includes expected figure as module-level data (same discipline as `ORACLE_CALENDARS`), and never uses a fixture-only path (goes through `insert_fills`). Task 2 in 05-03 then uses it alongside the 13 real calendars, asserting "27 events across 14 positions" (2 per real calendar + 1 for synthetic).

**Synthetic fixture: Correctly designed as a negative control, properly isolated through insert_fills, and wired into the oracle gate.**

## 2-vs-4 Events Translation

Salvage doc asserts "exactly 4 events per calendar" (v1's leg-level model).
Phase 5 schema has 2 events per calendar (position-level, both legs netted into one row).

Plan's handling:
- ✓ 05-01 Task 1: Module docstring for pairing.py records "proven against the 13 real oracle calendars and the synthetic control, never against Schwab's live payload shape"
- ✓ 05-03 Task 1: Explicit action section: "Put the event-count translation in the module docstring, plainly... This schema's events row is position-level, netting both legs into one open_debit_usd or one close_credit_usd, so the same trade is 2 rows here rather than 4. The other two global invariants — 52 fills stored and zero orphans — carry over unchanged. Do not edit the salvage file; it records what was."

**Translation: Correctly recorded in test docstrings, not in salvage file (which is read-only per workflow.md). The three global invariants (52 fills, zero orphans, OPEN/CLOSE only) are asserted unchanged.**

## TDD Ordering

All tasks specify `tdd="true"`. The environment block includes guidance:
"Take the cheapest honest red. `ModuleNotFoundError` on `morai.ledger.pairing`, then `AttributeError` on a function not yet written, are real reds and cost nothing. Never build temporary scaffolding to manufacture a more interesting one."

Verification:
- ✓ 05-01 Task 1: Tracer. Natural red is import failure on pairing.py (not yet created), then AttributeError on sync_events. Observable red is the canonical shape.
- ✓ 05-01 Task 2: Pure derivation. Red is ImportError on derive_events or AttributeError on AST walk helper. Test written first, then module created.
- ✓ 05-01 Task 3: Idempotency gate. Red is AttributeError on sync_events before the gate exists. Gate added to an already-working sync_events, then test proves it.
- ✓ All 05-02 and 05-03 tasks follow the same pattern

**TDD: All tasks correctly prioritize honest red (imports, AttributeError) over scaffolding. This is the pattern mandated by .claude/rules/workflow.md and enforced here.**

## Wave and Dependency Assignment

Wave 1 (05-01): depends_on: []
Wave 2 (05-02): depends_on: ["05-01"]
Wave 3 (05-03): depends_on: ["05-01", "05-02"]

Rationale:
- 05-01 creates src/morai/ledger/pairing.py, tests/ledger/test_pairing_*.py
- 05-02 modifies src/morai/ledger/pairing.py (adds detect_roll, parse_occ_symbol), tests/ledger/oracle_seed.py (adds seed_synthetic_open_calendar), creates new tests
- 05-03 modifies tests/ledger/oracle_seed.py (adds oracle_fill_records, assert_matches_oracle helpers), creates test_oracle_gate.py and test_pairing_seeded_faults.py

Verification: ✓ Sequential waves correctly enforce:
1. No two plans can run parallel (all touch src/morai/ledger/pairing.py or shared test helpers)
2. 05-02 needs 05-01's pairing.py to exist
3. 05-03 needs both previous plans' work to test against

Environment note confirms: "Do not run a second `pytest -m db` process while one is in flight (`V093`). This plan's sweep is the heaviest fixture in the suite — 14 positions, 28 legs, 54 fills through `insert_fills`, all encrypted — so a concurrent truncate is guaranteed to produce phantom failures in unrelated files."

**Wave assignment: Correctly ordered to prevent race conditions on shared mutable state (the database and the pairing.py module).**

## Locked Decisions Honored

### D5-01 (OPEN/CLOSE only; ROLL as negative guard)
- ✓ 05-01 Task 1 builds classify_fill returning FillRole (OPEN, CLOSE, UNKNOWN)
- ✓ 05-02 Task 3 builds detect_roll predicate with strict same-strike/type/root requirement
- ✓ Test on order 1006797510202 (closes 60c46a57 at strike 7425, opens 24f1e72e at strike 7475) proves different strikes → not a roll → four ordinary fills
- ✓ 05-03 Task 1 counts event_type values: zero ROLL rows after full sweep
- ✓ No positive ROLL path is built; deferral is explicit in docstrings

### D5-02 (criterion 2 by absence, not decoy column)
- ✓ 05-01 Task 2: AST gate proves no import of Position model and no reference to it in pairing.py
- ✓ 05-02 Task 2: Mutation test overwrites opened_at and closed_at to sentinel, re-derives from emptied events table, asserts identical event set
- ✓ Synthetic control with no CLOSE order must produce zero CLOSE events (proven in 05-03)
- ✓ No decoy status column added (would reintroduce the exact field that caused the bug)

### D5-03 (seeded-fault suite, not full mutation tool)
- ✓ 05-03 Task 2: Hand-inject three faults (sign-flip, rounding, off-by-one) via monkeypatch
- ✓ Each fault caught by oracle comparison assertion
- ✓ No mutation tool (mutmut, cosmic-ray) is pinned
- ✓ Deferral is explicit: "Do not pin a mutation-testing tool. D5-03 defers `mutmut` and `cosmic-ray` explicitly, and no time-budget data exists yet to justify one."

### D5-04 (fee-free arithmetic, commission as explicit None)
- ✓ 05-01 Task 1 action: "commission_usd is typed `Decimal | None` and is always `None` this phase, with a docstring saying so and why: per D5-04 the arithmetic here is deliberately fee-free, so the fee is a known gap and a gap is `None`, never `0` (`NN-16`). It has no column in `events` and is not persisted this phase — that is deliberate, and Phase 9's reconciliation is what has to confront it at a typed boundary rather than absorb it. State that in the field's own docstring so Phase 9 does not rediscover it."
- ✓ 05-03 Task 1 action: "State the phase-level fact D5-04 hands to Phase 9 — the derivation is fee-free by decision, commission is an explicit `None` and never a zero, so the cash-delta reconciliation in `RECON-01` will differ from these figures by roughly two to three cents per leg and must confront that at a typed boundary rather than absorb it."

**All four locked decisions are implemented with full task coverage. Docstrings and threat model record deliberate scope choices.**

## Deliberate Omissions Recorded

### _write_token Gate on Event

Plan 05-01 threat model entry T-05-01:
"Tampering | A second write path into `events` bypassing `insert_events`' ROLL guard | medium | accept | This plan adds exactly one writer and it routes through `insert_events`; migration 0008's `roll_has_both_legs` CHECK remains the database-level backstop. `Event` carries no `_write_token` gate, unlike `Fill`. 05-RESEARCH.md names this phase as the trigger for adding one — record it as a follow-up in the SUMMARY rather than building it here, where no second writer exists."

Plan 05-01 output section specifies:
"State plainly in it: ... that the `_write_token` gate on `Event` was deliberately not built and why (T-05-01)..."

Verification: ✓ The deferral is recorded at two levels (threat model AND output summary) so Phase 6+ readers cannot mistake the gate's absence for an oversight.

### Unresolved Fill Handling Ceiling

05-01 Task 1 action: "Note in the docstring that with the oracle's data every position has exactly one order per role, so this grouping and a per-position grouping are indistinguishable here — that is an honest limit, not a proven equivalence."

05-01 Task 3 action: "Record the honest limit in the function's docstring: a draft whose `position_id` and `event_type` already exist under a *different* hash is inserted as a second row rather than replacing the first, because correcting a stored event would need a delete-then-reinsert this phase deliberately does not own. Fills are immutable, so this phase cannot reach that path; naming it is what stops a later reader from assuming it was handled."

Verification: ✓ Both architectural limits are named in docstrings with explicit ceilings and upgrade paths.

**Deliberate omissions are recorded with explicit reasoning, preventing silent reintroduction and guiding future phases.**

## Scope Sanity Check

Task count and complexity:
- 05-01: 3 tasks (tracer, pure gate, idempotency gate) ✓ Within target
- 05-02: 3 tasks (hard case 1, hard case 2 + synthetic, roll guard) ✓ Within target
- 05-03: 2 tasks (oracle gate, fault suite) ✓ Within target

Files modified:
- 05-01: 5 files (pairing.py new, 4 test files new)
- 05-02: 4 files (pairing.py modified, oracle_seed.py modified, 2 test files new)
- 05-03: 3 files (oracle_seed.py modified, 2 test files new)

Estimation: Each plan has an estimate block with low confidence. Token budgets (95k, 105k, 90k) are within the project's smart-zone calibration.

**Scope: All three plans are appropriately scoped for single-context execution. Task counts within healthy range (2-3). File modifications are focused on the ledger domain.**

## Key Link Verification

05-01 Task 1 must_haves key_links:
- "read_fills -> derive_events -> insert_events: fills are the only input and events are the only output, so events are derived and never a second source of truth (LEDGER-01)." ✓ Task action specifies this flow
- "RESOLVE_FILL_POSITIONS_SQL -> tests/ledger/test_plaintext_queries.py: the query Phase 3 proved against real oracle data is now the query production runs, not a sibling of it." ✓ Task action moves the constant and rewires the tests
- "sync_events -> whole-user resolve + whole-user read_fills, narrowed by order_id only in Python afterwards: the scoped-read bug L061 describes is unreachable because no read is ever scoped to one position's own legs." ✓ Task action documents why whole-user reading is required
- "fill_ids_hash -> read_events -> skip: the idempotency decision is made from what is already stored, never from a delete-then-reinsert (L069)." ✓ Task 3 implements read-compare-skip pattern

05-03 Task 1 must_haves key_links:
- "ORACLE_CALENDARS -> assert_matches_oracle -> both the stored-row oracle and the in-memory fault suite: one comparison helper, so a fault proved fatal to one is proved fatal to the other." ✓ Task action creates the shared helper
- "_signed_leg_amount -> monkeypatch -> assert_matches_oracle raises: the seam the three fault classes are injected through is the same module-level function the real derivation calls." ✓ Task 2 uses monkeypatch on _signed_leg_amount to inject faults
- "seed_oracle + seed_synthetic_open_calendar -> insert_fills -> read_fills -> derive_events -> insert_events: the whole path, 14 positions, 54 fills, in one sweep." ✓ Task 1 action specifies this end-to-end wiring

**Key links: Explicitly wired in must_haves; task actions implement each link.**

## Context Compliance

Phase 5 has a CONTEXT.md with four locked decisions (D5-01 through D5-04) and a "Claude's Discretion" section.

Verification:
- ✓ D5-01 implemented (verified above)
- ✓ D5-02 implemented (verified above)
- ✓ D5-03 implemented (verified above)
- ✓ D5-04 implemented (verified above)

No tasks implement deferred ideas (positive ROLL/SETTLE, fee-inclusive arithmetic, mutation tool, last_synced_at writes).

Discretion areas (oracle fill representation, pure/shell split, idempotency mechanism, unresolved fill representation, decimal comparison) are left to implementation but task actions make specific, justified choices for each.

**Context compliance: 100%. All locked decisions honored. Deferred ideas excluded. Discretion areas exercised with explicit rationale in task actions.**

---

## Verification Outcome

### Status: **PASS**

All success criteria from the phase definition are addressed:

1. ✓ One real calendar's four fills derive end to end (65aac62e → 32.35 / 36.35)
2. ✓ derive_events runs with no session, no clock, no vendor import (AST gate)
3. ✓ Disambiguation SQL has one definition in pairing.py; Phase 3 tests prove it
4. ✓ Second and third sync_events runs over the same scope write nothing
5. ✓ Every derived event's commission is `None`
6. ✓ Bash tools/gate.sh exits 0 (verification will measure this post-execution)
7. ✓ 13-calendar oracle passes (all expectations in ORACLE_CALENDARS)
8. ✓ Hard cases included: 8a63aa81/6303e6af (shared front leg both layers), 65aac62e (stale status)
9. ✓ Synthetic control (14th fixture) derives one OPEN, no CLOSE
10. ✓ Three seeded faults caught; zero survive

### No Blockers

All claimed assets exist and are immediately usable. All requirements have task coverage. All decisions are honored. Dependencies are correct. Scope is appropriate.

### No Warnings

TDD ordering is correct. Context compliance is 100%. Deliberate omissions are recorded. Key links are wired. SQL relocation is sound.

---

## Execution Readiness

The three plans form a coherent, well-structured phase that will deliver the oracle gate and the fill-pairing core. The reused assets from Phase 3 are real and current. The test suites are designed to fail naturally (red) before implementation exists. The wave ordering enforces sequential execution necessary for database isolation.

**Recommendation: Proceed to `/gsd-execute-phase 05`.**

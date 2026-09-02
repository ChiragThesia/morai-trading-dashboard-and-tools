---
phase: 07-position-and-campaign-read-models
plan: 04
subsystem: database
tags: [sqlalchemy, postgres, recursive-cte, rls, tdd, campaign-chain, read-model]

requires:
  - phase: 07-position-and-campaign-read-models
    plan: 02
    provides: "migration 0014 -- events.rolled_from_position_id, its CHECK, and the campaign_chain WITH (security_invoker = true) recursive-CTE view"
provides:
  - "src/morai/ledger/campaigns.py -- CampaignLink dataclass, read_campaign_chain(session, user_id), read_campaign_for_position(session, position_id) -- the campaign-chain read model, LEDGER-10's read half"
  - "Behavioural proof that campaign_chain's security_invoker clause actually isolates a second user, with a firing negative control (T-07-17)"
  - "Behavioural proof that DROP VIEW campaign_chain + re-issuing the migration's own CREATE VIEW yields the identical chain row-for-row (ROADMAP criterion 4, literal)"
affects: [07-05 (derived ROLL rows -- this module's chain-walk is what 07-05's end-to-end assertion reads through), phase 8 (repricing), phase 9 (reconciliation), phase 11 (review API)]

actuals:
  tokens: 5754
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Thin read-model wrapper over a recursive-CTE view, mirroring resolve_fill_positions's both-belts discipline (ledger/pairing.py): the view's own security_invoker clause is the real RLS filter, an explicit WHERE p.user_id = :user_id in READ_CAMPAIGN_CHAIN_SQL is the second belt, never the first"
    - "Loading an alembic migration module by file path (importlib.util.spec_from_file_location) to re-issue its own CREATE VIEW SQL verbatim in a test, rather than retyping it -- the only way to keep a recompute test from silently drifting from the migration it proves equivalent to"
    - "A cyclic-chain test needs a genuine root leading into the loop, not just the two mutually-pointing ROLL events alone -- campaign_chain's base case excludes any position that is ever a ROLL target, so a pure two-position mutual pair is never reachable from the base case at all and would pass a naive 'returns fast' assertion vacuously, without ever exercising the CYCLE clause"

key-files:
  created:
    - src/morai/ledger/campaigns.py
    - tests/ledger/test_campaigns.py
  modified: []

key-decisions:
  - "read_campaign_chain joins to positions for its explicit user_id scope, since campaign_chain itself carries no user_id column -- the view's recursion walks events/positions only, so the second belt has to reach through a join rather than a bare WHERE on the view."
  - "read_campaign_for_position takes no user_id parameter at all -- it relies purely on the caller's own RLS context (the same convention read_position_state follows for events/fills), since the function is never handed a user_id to check against."
  - "The cyclic-chain test (Task 1 Test 5) uses three positions and three ROLL events, not the plan's literally-stated two -- a two-position mutual pair (each the target of the other's ROLL) is never reachable from campaign_chain's base case at all, so it would return zero rows regardless of whether the CYCLE clause exists, proving nothing. A third root position leading into the mutual pair is what makes the test a real proof of the guard rather than an accidental pass. Documented inline in the test's own docstring."
  - "Both plan tasks were implemented as one RED (all 8 tests, a single ModuleNotFoundError) then one GREEN (campaigns.py plus the test fixes below) rather than two separate RED/GREEN cycles -- Task 2's tests exercise the same read wrapper Task 1 builds and share every fixture and helper with it; splitting them into two artificial red/green cycles over the same file would have meant either a second manufactured red or writing Task 2's tests against an already-passing Task 1, neither of which is the cheapest honest red (.claude/rules/workflow.md's own instruction). Recorded as a TDD Gate Compliance deviation below."

requirements-completed: [LEDGER-10]

coverage:
  - id: D1
    description: "A campaign returns as a chain of rolled positions computed from events, not a separately maintained table -- roots, depths, independent chains, and read-from-any-member all proven through the real view against real seeded ROLL events."
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_three_position_chain_returns_depths_0_1_2_at_one_root"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_position_with_no_roll_anywhere_is_its_own_campaign_at_depth_0"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_two_independent_chains_for_one_user_never_interleave"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_read_campaign_for_position_from_any_member_returns_the_whole_chain"
        status: pass
    human_judgment: false
  - id: D2
    description: "A cyclic roll chain terminates the query instead of hanging it, via Postgres's own CYCLE clause, with a wall-clock bound."
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_cyclic_chain_terminates_instead_of_hanging"
        status: pass
    human_judgment: false
  - id: D3
    description: "Dropping the campaign read model and recomputing it from events (a literal DROP VIEW, re-issuing the migration's own CREATE VIEW) yields the identical chain row-for-row -- ROADMAP criterion 4, taken literally, not a metaphor."
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_recompute_from_events_matches_original_row_for_row"
        status: pass
    human_judgment: false
  - id: D4
    description: "A second user querying campaign_chain through morai_app sees zero of the first user's chain (Pitfall 1's behavioural proof, the highest-severity check in this phase), and the same query returns the second user's own chain when they have one -- a firing negative control, not a vacuous pass."
    requirement: "LEDGER-10"
    verification:
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_campaign_view_respects_rls"
        status: pass
      - kind: integration
        ref: "tests/ledger/test_campaigns.py#test_campaign_view_returns_own_chain_not_vacuously_empty"
        status: pass
    human_judgment: true
    rationale: "This is a live-database, two-role, real-second-user proof of the single highest-severity security claim in this phase (T-07-17). Automated status is pass and the negative control fired correctly, but a claim of this severity (cross-tenant financial-ledger data disclosure) is flagged for human confirmation rather than silently auto-passed, per this phase's own threat model language ('A code read alone does not prove it works')."

duration: ~45min
completed: 2026-09-01
status: complete
---

# Phase 7 Plan 4: Campaign Chain Read Model Summary

**`src/morai/ledger/campaigns.py` -- a thin read wrapper over the `campaign_chain` recursive-CTE view, with the two hardest claims of the phase proven behaviourally: drop-and-recompute equivalence (ROADMAP criterion 4, literal) and cross-user RLS isolation with a firing negative control (Pitfall 1, T-07-17).**

## Performance

- **Duration:** ~45min
- **Started:** 2026-09-01 (approx.)
- **Completed:** 2026-09-01T17:52:52Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 2 (both new)

## Accomplishments

- `src/morai/ledger/campaigns.py`: `CampaignLink` frozen dataclass (`campaign_root_id`, `position_id`, `depth`); `READ_CAMPAIGN_CHAIN_SQL`/`READ_CAMPAIGN_FOR_POSITION_SQL` as module-level named constants (never inline SQL, mirroring `pairing.py`'s `RESOLVE_FILL_POSITIONS_SQL`); `read_campaign_chain(session, user_id)` (whole-user, explicit `WHERE p.user_id` as the second belt behind the view's own `security_invoker`); `read_campaign_for_position(session, position_id)` (whole chain from any member, RLS-only scope, no `user_id` parameter). Both select from `campaign_chain` and narrow the untyped `text()` boundary through `TypeAdapter` -- no recursion reimplemented in Python.
- `tests/ledger/test_campaigns.py` (new, 8 tests, all `db`-marked): Task 1's five behaviours (three-position chain at depths 0/1/2; a lone position is its own campaign at depth 0; two independent chains never interleave; `read_campaign_for_position` returns the whole chain from any member; a cyclic chain terminates under 10s via Postgres's native `CYCLE` clause) plus Task 2's two proofs (criterion 4's literal drop-and-recompute equivalence, restoring the view in a `finally`; Pitfall 1's behavioural cross-user isolation with a firing negative control).
- Every seeded chain goes through `insert_events` (the one write path), never raw SQL -- the ROLL CHECK guards (migration 0014) are part of what makes a seeded chain trustworthy the same way a production chain would be.

## Task Commits

1. **Task 1+2 RED: add failing tests for campaign chain read model** - `a07905a` (test)
2. **Task 1+2 GREEN: the campaign chain read wrapper over campaign_chain** - `95539d6` (feat)

**Plan metadata:** commit follows this SUMMARY update.

## TDD Gate Compliance

Both plan tasks were implemented as one RED (`a07905a`, all 8 tests, a single genuine `ModuleNotFoundError` on `morai.ledger.campaigns` -- the cheapest honest red, no scaffolding built to manufacture a more interesting one) then one GREEN (`95539d6`, `campaigns.py` plus the test fixes discovered while turning the suite green), rather than two separate RED/GREEN cycles split across Task 1 and Task 2. Task 2's tests (the recompute proof, the RLS proof, its negative control) exercise the identical `read_campaign_chain` wrapper Task 1 builds and share every fixture and helper with it; running Task 1's tests to green first and only then writing Task 2's tests against an already-passing module would not have produced a more honest red for Task 2 -- the module already existing is not itself a red. Writing all eight up front, observing the single real `ImportError`, and implementing once is the shape `.claude/rules/workflow.md`'s own "cheapest honest red" instruction points to. Flagged here per `gsd-core/references/tdd.md`'s instruction to record gate-sequence deviations rather than silently skip them.

## Files Created/Modified

- `src/morai/ledger/campaigns.py` (new) - `CampaignLink`, `READ_CAMPAIGN_CHAIN_SQL`, `READ_CAMPAIGN_FOR_POSITION_SQL`, `read_campaign_chain`, `read_campaign_for_position`
- `tests/ledger/test_campaigns.py` (new) - 8-test suite: the read wrapper (5 tests) and the two proofs (3 tests)

## Decisions Made

See `key-decisions` in the frontmatter above -- four decisions recorded there: the explicit-scope join shape for `read_campaign_chain`, the RLS-only scope for `read_campaign_for_position`, the three-position (not two) shape needed to make the cyclic-chain test a real proof rather than a vacuous one, and the combined RED/GREEN cycle across both plan tasks.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The cyclic-chain test needed a third, genuine root position, not the plan's literally-stated two mutually-pointing ROLL events alone**
- **Found during:** Task 1, writing the cyclic-chain test (Test 5).
- **Issue:** `campaign_chain`'s base case excludes any position that is ever the target of a ROLL event (`NOT EXISTS (... e.position_id = p.id)`), evaluated globally, not per recursion path. Two positions that ROLL into each other (A targeted by B's ROLL, B targeted by A's ROLL) are therefore *both* excluded from the base case -- neither can ever start the recursion, so this pair is entirely unreachable through the view. A test built exactly as the plan's action text describes ("two ROLL events pointing at each other") would return zero rows instantly regardless of whether the `CYCLE` clause exists at all, which would pass the "returns rather than hanging" acceptance criterion vacuously without ever exercising the guard it claims to prove.
- **Fix:** Added a third, genuine root position (`p0`, never itself a ROLL target) that ROLLs into the mutually-cycling pair (`p1`/`p2`). This gives the recursion a real entry point, so the walk actually reaches the loop (`p0 -> p1 -> p2 -> p1`, cycle detected on the second visit to `p1`) and the `CYCLE` clause has something real to terminate. Documented inline in the test's own docstring so a future reader does not reintroduce the vacuous two-position version.
- **Files modified:** `tests/ledger/test_campaigns.py`.
- **Verification:** `test_cyclic_chain_terminates_instead_of_hanging` passes in well under 10s and asserts the chain contains exactly 4 rows with `p1` appearing twice (once at depth 1, once at the cycle-terminated depth 3) -- proof the recursion actually ran and was cut off, not proof that it never started.
- **Committed in:** `95539d6` (Task 1+2 GREEN).

**2. [Rule 1 - Bug] Several assertions needed to scope to the chain each test itself seeded, not assume exclusive ownership of `read_campaign_chain`'s result**
- **Found during:** Task 1, first GREEN run -- `test_three_position_chain_returns_depths_0_1_2_at_one_root` failed with an unexpected extra `CampaignLink` at depth 0.
- **Issue:** `provisioned_users` (via `seeded_users`, `tests/identity/conftest.py`) already seeds one bare, ROLL-less position per user as part of its own fixture setup -- a legitimate trivial campaign (itself, depth 0) that was never in scope for this plan's own claims but is real data `read_campaign_chain` correctly returns.
- **Fix:** Filtered `read_campaign_chain`'s result down to the `campaign_root_id`(s) each test itself seeded before asserting exact chain contents (three-position chain, single-position chain, two-independent-chains, cyclic-chain tests). The RLS tests (Task 2) were changed from asserting a blanket empty/non-empty result to asserting set membership/disjointness against the specific position ids each test seeded -- a more precise proof of isolation than "zero rows" was ever going to be once real incidental data exists.
- **Files modified:** `tests/ledger/test_campaigns.py`.
- **Verification:** `bash tools/gate.sh` -- 426 passed, full suite green.
- **Committed in:** `95539d6` (Task 1+2 GREEN).

**3. [Rule 1 - Bug] `app.current_user_id`'s `SET LOCAL`-equivalent scope ends on every commit, and one test's own read held a lock that deadlocked the drop-and-recompute proof**
- **Found during:** Task 2, first GREEN run of the full test file.
- **Issue:** `set_config('app.current_user_id', ..., true)` is transaction-local (the third argument makes it `SET LOCAL`-equivalent). Any `commit()` on `app_db_session` -- including `_seed_chain`'s own internal commit after `insert_events`, and the recompute test's intermediate commit -- ends that scope, so a read immediately after needs `_set_current_user` called again first; without it, RLS-dependent SQL fails with `invalid input syntax for type uuid: ""` (the unset GUC). Separately, the recompute test's own `read_campaign_chain` call left `app_db_session` in an open, uncommitted transaction holding an `AccessShareLock` on `campaign_chain`; the superuser session's subsequent `DROP VIEW campaign_chain` then blocked indefinitely waiting on that same session's own lock -- a real deadlock, not a timing flake.
- **Fix:** Added the missing `_set_current_user` call in the cyclic-chain test (the one place it was omitted after an intermediate commit) and, in the recompute test, committed `app_db_session` immediately after reading `chain_before` (releasing the view's read lock before the `DROP VIEW`) and re-set the RLS context before the post-recreate read.
- **Files modified:** `tests/ledger/test_campaigns.py`.
- **Verification:** Full suite (`uv run pytest -q`) completes in ~13s locally with no hang; `bash tools/gate.sh` green.
- **Committed in:** `95539d6` (Task 1+2 GREEN).

---

**Total deviations:** 3 auto-fixed (all Rule 1 - bugs in the test suite discovered while turning RED to GREEN; `campaigns.py` itself needed no fixes after its first draft).
**Impact on plan:** All three fixes are corrections to the test suite's own correctness, not scope changes to the plan's deliverable. The cyclic-chain fix is the most significant: without it, Test 5 would have been a vacuous pass that never exercised the `CYCLE` clause it claims to prove, which is exactly the kind of false-green this phase's threat model warns against.

## Issues Encountered

None beyond the three deviations above, all fully documented there.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROADMAP criterion 4's read half holds: a campaign returns as a chain of rolled positions computed from events, and dropping and recomputing the read model yields the identical chain, proven as a runnable test, not a metaphor (D7-11).
- Pitfall 1's `security_invoker` clause (07-02) is now proven behaviourally, not only structurally: a real second user sees zero of another user's chain, with a firing negative control proving the check is not vacuous.
- No stored copy of the campaign chain exists anywhere -- `campaigns.py` holds no state, matching `must_haves.prohibitions`.
- `bash tools/gate.sh` exits 0 -- 426 passed (ruff, basedpyright, mypy, full local Postgres suite).
- `git diff --stat tests/ledger/test_oracle_gate.py` reports no change.
- 07-05 (derived ROLL rows) can build directly on this module: its end-to-end assertion reads the same `read_campaign_chain`/`read_campaign_for_position` wrapper against chains it derives rather than seeds directly.

## Self-Check: PASSED

All created files verified present on disk: `src/morai/ledger/campaigns.py`, `tests/ledger/test_campaigns.py`,
this SUMMARY. Both commit hashes (`a07905a`, `95539d6`) verified present in `git log --oneline --all`.

---
*Phase: 07-position-and-campaign-read-models*
*Completed: 2026-09-01*

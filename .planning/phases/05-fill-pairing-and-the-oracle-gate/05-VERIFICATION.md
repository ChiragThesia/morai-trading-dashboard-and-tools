---
phase: 05-fill-pairing-and-the-oracle-gate
verified: 2026-09-01T11:43:35Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
must_haves:
  truths:
    - "All 13 real Schwab calendars produce their expected openNetDebit/closeNetCredit at exact Decimal equality, plus the 14th synthetic negative control."
    - "A fill's OPEN/CLOSE role comes from the broker's own positionEffect; no derivation path reads position state."
    - "A fill on a contract shared by two positions resolves through order-anchor intersection, and is left explicitly unresolved rather than guessed when no single anchor exists."
    - "Re-running derivation over the same (user, order_id) scope produces an identical event set; derivation makes no broker call."
    - "Seeded-fault suite (sign-flip, rounding, off-by-one) reports zero surviving faults."
  artifacts:
    - src/morai/ledger/pairing.py
    - tests/ledger/test_oracle_gate.py
    - tests/ledger/test_pairing_seeded_faults.py
    - tests/ledger/test_pairing_shared_leg.py
    - tests/ledger/test_pairing_idempotency.py
    - tests/ledger/test_pairing_no_position_state.py
    - tests/ledger/test_pairing_roll_guard.py
    - tests/ledger/oracle_seed.py
  key_links:
    - "read_fills -> derive_events -> insert_events: events derived, never a second source of truth"
    - "RESOLVE_FILL_POSITIONS_SQL -> test_plaintext_queries.py: production query is the proven query, not a sibling copy"
    - "sync_events -> whole-user resolve + whole-user read_fills: the L061 scoped-read bug is structurally unreachable"
---

# Phase 5: Fill Pairing and the Oracle Gate Verification Report

**Phase Goal:** The broker's individual leg fills are paired into events with the correct net
debit and credit — correctly enough to pass the only genuine oracle this project owns, before
any real Schwab connection exists.

**Verified:** 2026-09-01T11:43:35Z
**Status:** passed
**Re-verification:** No — initial verification

## Independently-Run Evidence (not taken from SUMMARY.md)

```
export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai"
export MORAI_APP_DB_PASSWORD="localdevpassword"
export MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ="
export MORAI_ENV_FILE=""
uv run python -m pytest            # 325 passed, 36 warnings in 47.54s
bash tools/gate.sh                 # ruff clean (97 files), basedpyright 0/0/0,
                                    # mypy clean, pytest 325 passed
uv run python -m pytest tests/ledger/ -v
                                    # 85 passed in 5.18s
uv run python -m pytest tests/ledger/test_oracle_gate.py -v
                                    # 15 passed in 1.77s
```

Numbers match `05-REVIEW-FIXES.md`'s own reported baseline exactly (325 total, 85 in
`tests/ledger/`, 15 in the oracle gate file) — confirmed by re-running, not by reading the
claim. Note: `uv run pytest -q` alone truncated its own final summary line in this shell
environment for reasons unrelated to the suite (confirmed harmless — `-v` and `python -m
pytest` both print the summary and agree with each other and with the gate's own run).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All 13 real calendars match `openNetDebit`/`closeNetCredit` at exact `Decimal` equality; 14th synthetic control fails as designed | ✓ VERIFIED | `tests/ledger/test_oracle_gate.py::test_calendar_derives_to_its_recorded_figures[*]` — 13 parametrized cases, each `id=`'d by real order id, exact equality via `assert_matches_oracle` (no `pytest.approx`, `oracle_seed.py:532-538` docstring states this explicitly). Hand-verified 5 of 13 transcribed figures (`65aac62e` 32.35/36.35, `60c46a57` 44.2/43.22, `24f1e72e` 41.52/45.0, `8a63aa81` 10.2/10.55, `6303e6af` 46.0/47.0) against `salvage/oracle-fixtures.md` line-by-line — all match exactly, including order ids, prices, and dates. 14th control asserted to produce exactly 1 OPEN, 0 CLOSE (`test_synthetic_open_calendar_derives_to_one_open_event_and_stays_open`). Global invariants read back from Postgres, not tallied in memory: 54 fills, 27 events (2×13 + 1), zero unresolved/unclassified, zero non-OPEN/CLOSE event types (`test_full_sweep_global_invariants`). The 54/27 vs. `salvage/oracle-fixtures.md`'s stated "4 events per calendar" is correctly reconciled in the test file's own header docstring: v1 was leg-level (4 rows/calendar), this schema is position-level (2 rows/calendar) — same underlying fact, different row model, not a weakened check. |
| 2 | OPEN/CLOSE role from broker's own `positionEffect`; mutating position status changes no derived event | ✓ VERIFIED | `classify_fill(position_effect)` (`pairing.py:170-181`) takes only `position_effect`, never `side` — confirmed by signature and by `derive_events`'s call site. Phase 3's `positions` table genuinely has no status column (`opened_at`/`closed_at` only) — confirmed via `src/morai/db/models.py`. Criterion satisfied two ways per `D5-02`: (a) structural AST gate `test_pairing_never_imports_or_references_position` walks `pairing.py`'s real AST and fails on any import or bare reference to `Position`; (b) behavioral `test_mutating_position_state_and_rederiving_reproduces_identical_events` overwrites every seeded position's `opened_at`/`closed_at` with an implausible 2099 sentinel, deletes and re-derives, and asserts the resulting event set (including `event_time`) is byte-identical to the pre-mutation set. Both independently re-run and pass. |
| 3 | Shared-contract fill resolves through order-anchor intersection; left unresolved (never guessed) when no single anchor exists | ✓ VERIFIED | Two distinct unresolved shapes both proven, matching the "what matters most" scrutiny on CR-01: (a) zero-anchor case — `test_two_positions_sharing_both_legs_leave_fills_explicitly_unresolved`, both legs shared, no anchor anywhere, 2 fills unresolved, 0 events; (b) two-anchor-conflict case — `test_two_anchor_conflict_leaves_shared_leg_unresolved_without_raising`, a genuine 3-leg/2-anchor shape (leg X anchors position 1, leg Y anchors position 2, leg Z shared by both — read directly at `test_pairing_shared_leg.py:95-194`), asserts `sync_events` does not raise, leg Z's fill lands unresolved, and legs X/Y still resolve to their own positions with correct dollar amounts. Confirmed the CR-01 SQL fix is real: `RESOLVE_FILL_POSITIONS_SQL`'s scalar subquery now reads `CASE WHEN COUNT(*) = 1 THEN MIN(oa.position_id::text)::uuid END` (`pairing.py:102-111`), collapsing a >1-row conflict to `NULL` instead of raising `CardinalityViolationError`. Also confirmed both layers of hard-case-1 (shared-front-leg): the unscoped-sweep proof and the L061 scoped-read regression proof (`RESOLVE_FILL_POSITIONS_SQL`'s `position_legs` CTE is deliberately never narrowed per-position, with an in-code comment naming why). Cross-user isolation also proven (`test_cross_user_derivation_never_resolves_to_the_other_users_position`). |
| 4 | Re-derivation over `(user, order_id)` is idempotent; whole derivation completes with no broker call | ✓ VERIFIED | Idempotency: `test_repeated_sync_events_over_one_scope_inserts_nothing_new` — 3 runs (unscoped, unscoped again, scoped to the open order id), row count and `fill_ids_hash` set unchanged across all three. `hash_fill_ids` proven order-independent (`test_hash_fill_ids_is_order_independent`). No-broker-call: AST-walk gate `test_pairing_imports_no_vendor_broker_or_http_module` finds no `morai.vendor`/`schwab`/`httpx` import anywhere in `pairing.py`'s real import statements (not a text grep). Concurrency (CR-02) independently confirmed real: `test_two_concurrent_sync_events_calls_write_exactly_one_event_set` runs two `sync_events` calls on two independent engines/sessions, each genuinely blocking on `await asyncio.wait_for(barrier.wait(), timeout=5)` immediately before its own call (both sides await the same size-2 `asyncio.Barrier`, confirmed by direct read of `test_pairing_idempotency.py:100-158` — not a barrier created but left unawaited on one side), and asserts exactly 2 events / 2 distinct hashes survive. The fix itself (`pg_advisory_xact_lock(hashtext(:uid))` at the top of `sync_events`, `pairing.py:402-405`) is present and precedes the read-compare-skip window. |
| 5 | Mutation-testing pass reports zero surviving mutants for seeded sign-flip, rounding, off-by-one faults | ✓ VERIFIED | Per the locked `D5-03` decision (no mutation tool pinned this phase — a hand-seeded fault suite instead), `tests/ledger/test_pairing_seeded_faults.py` genuinely patches the module-global `pairing._signed_leg_amount` via `monkeypatch.setattr` — confirmed effective because `_net_amount` looks the name up at call time in the module's own global namespace, not a bound reference captured at import (read both functions directly). All three fault wrappers (`_sign_flipped`, `_rounded_to_whole_dollars`, `_off_by_one_quantity`) call the real function over the real or a copied/mutated input, never reimplement arithmetic, so each differs from truth by exactly its one named defect. Control runs first and last (`test_control_passes_with_no_fault_injected` / `test_control_passes_again_after_the_parametrized_faults`), proving the harness itself is sound and `monkeypatch` reverted cleanly. All three parametrized cases assert `assert_matches_oracle` raises `AssertionError` — confirmed by direct run, all pass. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/morai/ledger/pairing.py` | Disambiguation SQL, pure core, session shell | ✓ VERIFIED | 527 lines. `RESOLVE_FILL_POSITIONS_SQL`, `classify_fill`, `_signed_leg_amount`, `_net_amount`, `derive_events`, `resolve_fill_positions`, `sync_events`, `detect_roll`/`parse_occ_symbol` all present and substantive, not stubs. |
| `tests/ledger/test_oracle_gate.py` | 13-calendar oracle + invariants | ✓ VERIFIED | 231 lines, 15 collected tests, all pass. |
| `tests/ledger/test_pairing_seeded_faults.py` | 3 fault classes | ✓ VERIFIED | 157 lines, 5 collected tests, all pass. |
| `tests/ledger/test_pairing_shared_leg.py` | Both hard-case-1 layers + both unresolved shapes | ✓ VERIFIED | 5 collected tests, all pass, including the post-review CR-01 addition. |
| `tests/ledger/test_pairing_idempotency.py` | Idempotency + concurrency | ✓ VERIFIED | 2 collected tests, all pass, including the post-review CR-02 addition. |
| `tests/ledger/test_pairing_no_position_state.py` | Structural + behavioral criterion-2 proof | ✓ VERIFIED | 3 collected tests, all pass. |
| `tests/ledger/test_pairing_roll_guard.py` | `detect_roll` negative guard | ✓ VERIFIED | 4 collected tests, all pass. |
| `tests/ledger/oracle_seed.py` | 13 real calendars + 14th synthetic, transcribed | ✓ VERIFIED | Spot-checked 5 of 13 calendars' order ids, dates, and prices against `salvage/oracle-fixtures.md` line-by-line — exact match. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `read_fills` | `derive_events` | `sync_events` shell | ✓ WIRED | Fills are the only input, events the only output; no second source of truth. |
| `RESOLVE_FILL_POSITIONS_SQL` (production constant) | `test_plaintext_queries.py` | direct import | ✓ WIRED | `from morai.ledger.pairing import RESOLVE_FILL_POSITIONS_SQL` — confirmed, not a private copy. |
| `sync_events` | whole-user `resolve_fill_positions` + whole-user `read_fills`, Python-side order_id filter | scoped-read avoidance (L061) | ✓ WIRED | Confirmed by reading `sync_events`'s own body: both calls are unscoped, filtering happens only after, in Python. |
| `pg_advisory_xact_lock` | `sync_events`'s read-compare-skip window | CR-02 fix | ✓ WIRED | Lock acquired before `resolve_fill_positions`/`read_fills`/derive/read-existing/insert sequence; transaction-scoped. |

### Review-Cycle Fix Verification (CR-01, CR-02, WR-01)

All three were independently re-derived from source, not accepted from `05-REVIEW-FIXES.md`'s
narrative:

- **CR-01** — confirmed the SQL change is exactly `CASE WHEN COUNT(*) = 1 THEN MIN(...) END`
  (collapse-to-NULL on conflict), and confirmed a new regression test exists reproducing the real
  three-leg, two-anchor shape the review described, asserting no raise and correct partial
  resolution. Did not weaken any existing guard: the zero-anchor negative-control test is
  unchanged and still passes.
- **CR-02** — confirmed the advisory lock is present and precedes the read-compare-skip window,
  and confirmed the concurrency test uses two independent engines with both coroutines genuinely
  blocking on the same `asyncio.Barrier(2)` before their own `sync_events` call (not a
  create-but-don't-await pattern on either side).
- **WR-01** — confirmed `_signed_leg_amount` now returns `None` for a `side` outside
  `("BUY", "SELL")`, with a dedicated regression test for both `EventType.OPEN` and
  `EventType.CLOSE`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| LEDGER-01 | 05-01 | Events derived from stored fills, never a second source of truth | ✓ SATISFIED | `sync_events`/`derive_events` structure; `read_fills -> derive_events -> insert_events` is the only path. |
| LEDGER-02 | 05-02 | OPEN/CLOSE from `positionEffect`, never a status column | ✓ SATISFIED | Truth 2 above. |
| LEDGER-03 | 05-02 | Shared-contract fill resolves via order anchor; unresolved, never guessed | ✓ SATISFIED | Truth 3 above, including the post-review CR-01 fix. |
| LEDGER-09 | 05-01 | Re-derivation over `(user, order_id)` is idempotent | ✓ SATISFIED | Truth 4 above. |
| LEDGER-11 | 05-03 | 13-calendar oracle passes, including both hard cases | ✓ SATISFIED | Truth 1 above. |
| LEDGER-12 | 05-01/05-03 | Recompute is a pure function; no broker call | ✓ SATISFIED | AST gate + `test_pure_derive_events_reproduces_the_same_26_figures`. |
| OPS-06 | 05-03 | Mutation testing against the ledger, surviving mutants reported | ✓ SATISFIED (per D5-03's locked, in-scope decision) | Seeded-fault suite substitutes for a pinned mutation tool; see note below. |

**Note on OPS-06 and the premature Complete marking:** Git history shows
`.planning/REQUIREMENTS.md` was updated to mark all 7 of this phase's requirements Complete at
commit `fe70cc7`, **before** the code review (`32f4cd5`) that found CR-01 and CR-02 — both real,
reproducible bugs in the exact function (`resolve_fill_positions`/`sync_events`) LEDGER-03 and
LEDGER-09 name. The marking was premature at the time it was made. Re-checked against the
codebase as it now stands, after the review-fix cycle (`f5026a5`), all 7 are genuinely satisfied
— this is not a currently-open gap, but the sequencing itself (mark-complete before review) is a
process finding worth naming, since it is exactly the pattern that let two blockers reach a
"Complete" checkbox undetected until a second pass caught them.

No orphaned requirements: `LEDGER-04/05/06/07/10` remain correctly `Pending`, mapped to Phase 3/7,
not this phase — matching `D5-01`'s explicit scope exclusion (ROLL/SETTLE deferred).

### Anti-Patterns Found

None. Scanned all phase-touched files (`pairing.py`, all `tests/ledger/test_pairing_*.py`,
`oracle_seed.py`, `test_oracle_gate.py`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` —
zero matches. No stub returns, no empty handlers, no hardcoded-empty data flowing to output.

### Behavioral Spot-Checks / Probe Execution

Not applicable in the CLI sense (no server, no HTTP endpoint yet — this phase is pure derivation
over stored rows, per its own `05-VALIDATION.md`: "the absence of an external dependency is
itself the thing under test"). Instead, ran the actual test suite directly (see "Independently-
Run Evidence" above) rather than trusting SUMMARY.md's reported numbers — all figures
independently reproduced.

### Human Verification Required

None. This is the first phase in this rebuild with full automated coverage of every stated
criterion, per `05-VALIDATION.md`'s own claim, and independent verification confirms that claim
holds — no runtime behavior asserted here needs a human, an external service, or the app running.

### Gaps Summary

None. All 5 must-have truths verified against the actual codebase and independently re-run test
evidence, not against SUMMARY.md's narrative. Both post-review blockers (CR-01, CR-02) and the
one warning (WR-01) are confirmed genuinely fixed, with their regression tests confirmed to
reproduce the real described bug shapes rather than a decorative placeholder. The one process
observation — REQUIREMENTS.md marked Complete before the review that found two blockers — does
not affect the current pass/fail determination, since the code as it now stands (post-fix) does
satisfy every requirement checked.

---

_Verified: 2026-09-01T11:43:35Z_
_Verifier: Claude (gsd-verifier)_

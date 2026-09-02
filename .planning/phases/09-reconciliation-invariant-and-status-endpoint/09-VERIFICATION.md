---
phase: 09-reconciliation-invariant-and-status-endpoint
verified: 2026-09-02T06:00:00Z
status: human_needed
score: 4/4 success criteria verified (2 unresolved Manual-Only items carried forward, not gaps)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "On the first live Schwab get_transactions call, dump one stored broker_transactions.raw_ciphertext payload and compare its keys against settings.schwab_tx_net_amount_field ('netAmount') and settings.schwab_tx_commission_field ('commission')."
    expected: "The named keys exist on the real payload with the assumed sign convention (net_amount fee-inclusive, commission a positive fee cost) — or the constants get corrected in one place before the first real reconciliation run."
    why_human: "09-VALIDATION.md's own Manual-Only table: schwab-py 1.5.1's installed source contains zero references to netAmount/fees/commission, and no fixture or public source settles it. Genuinely unverifiable without live vendor data. Failure mode is bounded (an unrecognised/absent key routes the window to indeterminate, never a wrong passed/failed verdict per D9-08/NN-16), so this does not block the phase, but it is a real open item this run cannot close."
  - test: "Inspect a real post-expiry Schwab transaction list to determine whether a cash-settled SETTLEMENT produces its own broker_transactions row."
    expected: "Confirms or corrects the assumption that an OTM expiration posts no same-day broker-cash transaction — the case CR-01's fix (union of event days and broker-cash days in closed_trading_days) exists to handle."
    why_human: "Same 09-VALIDATION.md Manual-Only item. Subsumed either way by D9-11 (an unpriced settlement is indeterminate, never a false passed), so bounded risk, not a gap."
---

# Phase 9: Reconciliation Invariant and Status Endpoint Verification Report

**Phase Goal:** The core value is enforced and queryable — realised P&L equals the broker's cash
delta, checked every ingest cycle.
**Verified:** 2026-09-02T06:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (the four ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Over any closed window, realised P&L equals broker cash delta (net of transfers) | ✓ VERIFIED | `reconcile_window` (`src/morai/ledger/reconciliation.py:298-458`): `signed_difference_usd = realised_pnl_usd - commissions_usd - cash_delta_usd`, exact `Decimal` equality, zero `epsilon`/`quantize`/`round`/`float`/`abs` in the module (grep confirms none). "Net of transfers" is `CASH_TRANSACTION_TYPES` (`{TRADE, RECEIVE_AND_DELIVER}`), an **allow-list**, not a deny-list — `EXCLUDED_TRANSACTION_TYPES` names the 13 known non-cash types, and anything in neither set routes to `UNRECOGNISED_TRANSACTION_TYPE` (`indeterminate`), never silently admitted. Hand-derived fixture `_balanced_fixture()` (`tests/ledger/test_reconciliation.py:148-184`) balances to the cent and is independently re-derived in this verification (realised P&L -1473.34, commissions 1.30, cash delta -1474.64, signed difference 0.00 — checks out). **CR-01's fix confirmed:** `closed_trading_days(events, broker_cash)` (`reconciliation.py:172-197`) takes the union of event days and broker-cash days as candidates; closure remains driven by the newest broker-cash day. Verified via `git show f85b4f7` — the regression test `test_an_event_only_day_becomes_a_candidate_and_closes` (added in the fix commit) seeds a SETTLEMENT-only day with no same-day broker transaction and asserts it is now a candidate and reconciles to `SETTLEMENT_UNPRICED` rather than being silently skipped. |
| 2 | The check runs automatically at the end of every ingest cycle, per user, as a test; a seeded one-cent discrepancy fails it | ✓ VERIFIED | `sync_user` (`src/morai/ingest/schwab_sync.py:472-473`) calls `await sync_events(...)` then `await run_reconciliation(session, user_id, as_of=now)` on the same session/transaction, immediately before `return`. Proven reachable through the **real** production path, not a direct call: `test_sync_user_job_writes_a_reconciliation_run` (`tests/ingest/test_sync_tracer.py:264-`) defers the real Procrastinate `sync_user` task by name and drains a real worker, then asserts a `reconciliation_runs` row landed — this is exactly the CR-01-shaped guard Phase 7 lacked. Seeded one-cent discrepancy: `test_a_seeded_one_cent_discrepancy_fails` moves the broker's closing net amount by exactly `Decimal("0.01")` and asserts `verdict is FAILED` and `signed_difference_usd == Decimal("0.01")`; `test_verdict_across_a_discrepancy_sweep` (4-point parametrize: `0`, `+0.01`, `-0.01`, `+1000.00`) proves no constant/epsilon implementation can pass — only the zero case passes. `test_a_seeded_fault_in_the_comparison_makes_the_passing_case_fail` monkeypatches `_event_contribution` (the one seam every event's money routes through) and confirms the passing fixture breaks — the anti-vacuous-pass control this project's own record (8 prior defects) makes mandatory. |
| 3 | A failure names the failing window, not a bare boolean | ✓ VERIFIED | `ReconciliationResult`/`ReconciliationRunRecord` carry `trading_day`, `window_start`, `window_end`, and all four money fields (`realised_pnl_usd`, `commissions_usd`, `cash_delta_usd`, `signed_difference_usd`) together with `verdict`/`reason`. `test_failure_names_the_window_and_both_sides` asserts every one of these is populated on a `FAILED` result. Migration 0016's `reconciliation_runs_amounts_present_check` CHECK constraint enforces the same at the database layer (all four money columns non-null unless `indeterminate`). `GET /reconciliation/status`'s `unresolved_run` field (`ReconciliationRunSummary`) names WHICH window is unresolved when `trustworthy` is false — `test_older_unresolved_window_makes_trustworthy_false_despite_newer_pass` confirms `unresolved_run.trading_day` is the older, unrepaired window even though a newer window passed. |
| 4 | Reconciliation status is its own endpoint, cheap enough to poll, and the API marks dependent numbers untrustworthy while reconciliation fails | ✓ VERIFIED | `GET /reconciliation/status` (`src/morai/api/routes_reconciliation.py:164-187`) takes no path or query parameter — confirmed by `test_route_accepts_no_path_or_query_parameter`, which walks the real FastAPI route table (`app.routes` via `_IncludedRouter.original_router`) and asserts exactly one path, `/reconciliation/status`. `reconciliation_standing` makes exactly one `await` (`await read_window_verdicts(...)`) — confirmed both by reading the function body and by the AST-based test `test_reconciliation_standing_makes_exactly_one_awaited_read`, which walks the function's AST and asserts `len(awaits) == 1`. It reads a persisted row and never recomputes: `test_no_recompute_when_events_and_broker_transactions_are_emptied` deletes `events`/`broker_transactions` and asserts the response is unchanged. `trustworthy` derives from **each window's own latest verdict** (`read_window_verdicts`'s `DISTINCT ON (trading_day) ... ORDER BY trading_day, checked_at DESC`), not the single newest row — confirmed by `test_older_unresolved_window_makes_trustworthy_false_despite_newer_pass` (an old unrepaired failure keeps the whole caller untrustworthy despite a newer pass) and its inverse `test_superseded_window_restores_trustworthy_true` (a later `passed` re-check for the *same* `trading_day`, `is_reopening=True`, restores `trustworthy: true` — proves D9-03's reopening does not create a permanent false alarm). `DependentNumbersModel(ApiModel)` (`src/morai/api/models.py:18-33`) carries `trustworthy: bool`; `PositionResponse` and `ReconciliationStatusResponse` both derive from it (checked programmatically by `test_ledger_derived_response_models_derive_from_dependent_numbers_model`, not by eye), and `/gate/positions`/`/gate/positions/{id}` populate it from one call each to `reconciliation_trustworthy` (AST-checked at exactly two call sites). |

**Score:** 4/4 truths verified (0 present-but-behavior-unverified).

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `alembic/versions/0016_reconciliation_runs.py` | `reconciliation_runs` table, RLS, grant, six CHECK constraints | ✓ VERIFIED | `ENABLE`+`FORCE ROW LEVEL SECURITY`, one `FOR ALL user_isolation` policy (no admin clause), `GRANT SELECT, INSERT, DELETE` (no `UPDATE` — append-only per D9-03), six named CHECK constraints (`verdict_check`, `reason_check`, `reason_iff_indeterminate_check`, `amounts_present_check`, `passed_iff_zero_check`, `window_order_check`), one dual-purpose index. |
| `src/morai/ledger/reconciliation.py` | Pure comparison core + async shell | ✓ VERIFIED | `trading_day_for`, `window_bounds`, `closed_trading_days` (union-of-days, CR-01 fixed), `extract_broker_cash`, `reconcile_window`, `run_reconciliation`. No `float`/`abs`/`round`/`quantize` anywhere in the module (grepped directly). |
| `src/morai/ingest/reconciliation_runs.py` | Run-ledger read/write path | ✓ VERIFIED | `record_reconciliation_run` (no commit — caller owns the transaction, matching `sync_runs.py`), `read_latest_run_for_trading_day`, `read_window_verdicts`. Both reads carry `checked_at DESC, created_at DESC` (WR-02's fix — confirmed present in both functions). |
| `src/morai/api/routes_reconciliation.py` | Status endpoint | ✓ VERIFIED | `GET /reconciliation/status`, `reconciliation_standing`, `reconciliation_trustworthy`. |
| `run_reconciliation` wired into `sync_user` | The CR-01 seam | ✓ VERIFIED | `src/morai/ingest/schwab_sync.py:473`, immediately after `sync_events`, same session, no commit. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `sync_user` (real Procrastinate task) | `run_reconciliation` | direct call, same session | WIRED | Proven through a deferred real job + drained worker (`test_sync_user_job_writes_a_reconciliation_run`), not a direct unit call — the exact class of gap CR-01 named in Phase 7. |
| `routes_identity.py` (`PositionResponse`) | `reconciliation_trustworthy` | one call per route, not per row | WIRED | AST-checked at exactly two call sites; `test_positions_trustworthy_is_computed_from_the_callers_own_runs` confirms per-user scoping. |
| `reconciliation_status` route | `reconciliation_runs` table | `read_window_verdicts` via RLS, no `WHERE user_id` in the route | WIRED | `test_cross_user_isolation_a_never_sees_bs_row` confirms user B's row is invisible to user A's poll. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| RECON-01 | 09-01, 09-02 | Realised P&L equals broker cash delta, net of transfers, over a closed window | ✓ SATISFIED | `reconcile_window` + CR-01 fix; 37 tests in `test_reconciliation.py` |
| RECON-02 | 09-01, 09-02 | Runs every ingest cycle, per user, as a test | ✓ SATISFIED | Real deferred-job tracer test; window-edge tests (DST, closure, reopening) |
| RECON-03 | 09-02, 09-03 | Failure names the failing window, not a bare boolean | ✓ SATISFIED | `ReconciliationResult`/DB CHECK constraints; `unresolved_run` field on the status response |
| RECON-04 | 09-03 | Dependent numbers marked untrustworthy while failing | ✓ SATISFIED | `DependentNumbersModel`, per-window `trustworthy` derivation, both directions tested (Test 11/Test 12) |
| API-01 | 09-03 | Status endpoint, cheap, no recompute | ✓ SATISFIED | One `await`, no-recompute test, AST-checked route shape |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any of the phase's `src/` files. No `console.log`-equivalent stubs, no hardcoded-empty returns on any path that reaches production.

### Specific-Checks Verdicts (from the verification brief)

- **Criterion 1 exactness:** Confirmed no epsilon/quantize/round/float/abs anywhere in `reconciliation.py`. Allow-list (not deny-list) confirmed at `CASH_TRANSACTION_TYPES`/`EXCLUDED_TRANSACTION_TYPES`, with `test_transaction_type_sets_cover_the_vendor_enum_exactly` proving the two sets are disjoint and together cover the vendor's own 15-member enum. CR-01's fix (union of event days + broker-cash days) confirmed in code and by its regression test.
- **Criterion 2 teeth + reachability:** Four-point sweep confirmed genuinely non-satisfiable by a constant/epsilon (only `0` passes). `run_reconciliation` confirmed called from `sync_user` and reached via a real deferred Procrastinate job in `test_sync_user_job_writes_a_reconciliation_run` — not merely unit-tested in isolation (the exact Phase-7-repeat risk named in the brief).
- **Criterion 3 window naming:** `reconciliation_runs` persists window bounds, both sides, signed difference, and verdict+reason (six CHECK constraints enforce this at the DB layer). `unresolved_run` names which window when `trustworthy` is false.
- **Criterion 4 per-window trustworthy + inverse:** `DISTINCT ON (trading_day) ... ORDER BY trading_day, checked_at DESC` confirmed, not the single newest row. The inverse (a `failed` then `passed` re-check on the SAME window restores trust) is directly tested (`test_superseded_window_restores_trustworthy_true`) and passed. `reconciliation_standing` confirmed to make exactly one `await` both by inspection and by an AST-based test. Status route confirmed to take no path/query parameter, both by inspection and by a route-table-walking test.
- **D9-08 three verdicts / five indeterminate reasons:** All three verdicts and all five `IndeterminateReason` members are individually tested; the cause-check order in `reconcile_window` runs entirely before any Decimal sum is computed, so no code path can reach a `PASSED`/`FAILED` verdict on missing input — structurally, not just by test coverage.
- **D5-04 resolution held:** `git diff --exit-code 7c7dfa7 HEAD -- src/morai/ledger/pairing.py src/morai/ledger/events.py tests/ledger/oracle_seed.py tests/ledger/test_oracle_gate.py salvage/oracle-fixtures.md` exits 0 (byte-identical). The 13-calendar oracle gate passes as part of the 659-test full suite run performed for this verification.
- **Commission sign convention (independently re-derived, not just trusted to the reviewer):** Re-computed `_balanced_fixture()`'s arithmetic by hand: open debit 4485.67, close credit 3012.33 → realised P&L −1473.34. Commission 0.65+0.65 = 1.30. Broker net (fee-inclusive): open −4486.32 (= −(4485.67+0.65)), close 3011.68 (= 3012.33−0.65) → cash delta −1474.64. `signed_difference = −1473.34 − 1.30 − (−1474.64) = 0.00`. This is internally self-consistent (a positive `commission_usd` reduces net cash on both legs, matching a fee-inclusive broker net amount) — a sign error in either direction would break `test_a_window_that_agrees_to_the_cent_passes`, which is exercised in the 659-test suite run. The actual vendor field names/signs remain unverified against live data (see Human Verification below), which is a distinct, already-documented, and bounded gap (routes to `indeterminate`, never a false `passed`).
- **Tenant isolation:** RLS `ENABLE`+`FORCE`, single `user_isolation` policy, `GRANT SELECT, INSERT, DELETE` (no `UPDATE`, append-only per D9-03) all confirmed directly in migration 0016 and exercised by `test_rls_enabled_and_forced`, `test_exactly_one_admin_free_policy`, `test_grants_are_verb_narrowed`, `test_a_row_inserted_for_user_a_is_invisible_to_user_b` (schema-level) and `test_cross_user_isolation_a_never_sees_bs_row` (route-level).

### Review Findings — Resolution Confirmed

`09-REVIEW.md` recorded 1 BLOCKER (CR-01) and 2 Warnings (WR-01, WR-02). All three have dedicated fix commits, independently verified in this run:

- **CR-01** (`f85b4f7`): `closed_trading_days` now unions event days into the candidate set; regression test `test_an_event_only_day_becomes_a_candidate_and_closes` added and passing.
- **WR-01** (`98aabb7`): the two previously-unproven CHECK constraints (`reconciliation_runs_reason_check`, `reconciliation_runs_window_order_check`) now each have a dedicated `IntegrityError`-asserting test — confirmed present in `tests/ingest/test_reconciliation_schema.py`.
- **WR-02** (`538a3a6`): `created_at DESC` tiebreaker added to both `read_latest_run_for_trading_day` and `read_window_verdicts` — confirmed present in both functions' `ORDER BY` clauses.

### Full Suite / Gate

`uv run pytest -q` (with the local Postgres env vars per `CLAUDE.md`): **659 passed, 0 errors, 0 failures** (confirmed via `--junitxml`, since this machine's plain-terminal summary line is known-flaky per the plan's own recorded issue). `bash tools/gate.sh`: **659 passed**, ruff clean, basedpyright `0 errors, 0 warnings, 0 notes`, mypy clean (a second identical gate invocation timed out on this machine's 2-minute tool budget after already reporting the same clean basedpyright result — not treated as a new signal, since the first full run had already completed and reported clean).

### Human Verification Required

Both items below are `09-VALIDATION.md`'s own Manual-Only table, carried forward here rather than closed on inference (per this brief's explicit instruction not to pass them on inference). Neither blocks the phase's success criteria — both degrade to `indeterminate`, never a false `passed`, per `D9-08`/`D9-11`/`NN-16` — but they are genuinely open and worth a human decision on when/how to close them against live data:

1. **Schwab transaction field names for net cash amount and commission/fees** (RECON-01). `schwab-py` 1.5.1's installed source names neither `netAmount` nor `commission`/`fees`; no fixture or public source settles it. Test: on the first live `get_transactions` call, dump one stored `raw_ciphertext` payload and compare against `schwab_tx_net_amount_field`/`schwab_tx_commission_field`. Expected: the named keys (and the assumed fee-inclusive-net / positive-commission sign convention this verification independently re-derived above) match the real payload, or get corrected in the one place they're defined.
2. **Whether a cash-settled SETTLEMENT produces its own `broker_transactions` row** (RECON-01). Unknown without live data; subsumed by `D9-11`'s `indeterminate` fallback either way. Test: inspect a real post-expiry transaction list for a settled position.

### Gaps Summary

No blocking gaps. The one BLOCKER and two Warnings the code review found were all fixed with dedicated commits and regression tests, independently confirmed against the live code and a fresh full-suite run in this verification (not inferred from SUMMARY.md claims). The phase's four ROADMAP success criteria and all five requirements (RECON-01..04, API-01) are backed by evidence traced to actual code, actual tests, and an actual passing gate run performed during this verification — not merely claimed. Status is `human_needed` solely because of the two pre-existing, already-documented, bounded-risk Manual-Only items that cannot be closed without live Schwab data; per this project's own verification discipline ("an honest `human_needed` beats a generous `passed`"), they are surfaced rather than silently passed.

---

_Verified: 2026-09-02T06:00:00Z_
_Verifier: Claude (gsd-verifier)_

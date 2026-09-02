---
phase: 08-snapshot-capture
verified: 2026-09-02T00:26:36Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Run one real capture slot against a live, authenticated Schwab connection and compare the stored raw `snapshot_observations` payload against `parse_quote_payload`'s own output for the same row."
    expected: "Either the parser's field-path guesses (`quote.mark`, `quote.underlyingPrice`) match the real `get_quotes` OPTION response shape and a real mark lands, or they don't and every leg gets an honest `no_market_data` gap -- never a wrong number, never a raise. This project has never called `get_quotes` live; `08-RESEARCH.md` rates the exact response schema LOW confidence."
    why_human: "No live Schwab OAuth connection or vendor credentials exist in this local/CI environment. `08-VALIDATION.md`'s own Manual-Only Verifications table names this exact check and it cannot be closed by a verifier reading code or querying a local database."
  - test: "Deploy the worker to Railway, stop it for more than ten minutes spanning at least one 30-minute RTH slot boundary, restart it, and confirm `snapshot_runs`/`missing_capture_slots` names the dropped slot, then run `repair_snapshot_marks`/`backfill_uncaptured_slot_gaps` (via the task or the CLI) and confirm it writes an honest `slot_not_captured` gap rather than fabricating a mark."
    expected: "Procrastinate's `PeriodicDeferrer.MAX_DELAY = 600` (read directly from the installed 3.9.0 source) means a worker down more than ten minutes across a slot boundary produces no job at all for that slot -- not even a failed one. `missing_capture_slots` should surface the hole from `snapshot_runs` alone (no row for that slot), and the repair path should backfill it as a `slot_not_captured` gap, never a value."
    why_human: "This is a real-deployment-only scheduler behavior; nothing in a local Postgres/pytest environment reproduces a genuine worker outage against Procrastinate's own in-memory catch-up tracking. `08-VALIDATION.md`'s own Manual-Only Verifications table names this exact check. The *mechanism* is proven locally (`test_missing_capture_slots_names_a_simulated_outage_and_hands_off_to_backfill` deletes rows to simulate the shape and both functions recover correctly), but the real Procrastinate `MAX_DELAY` trigger itself was not observed live."
---

# Phase 8: Snapshot Capture Verification Report

**Phase Goal:** Every open position is repriced on the 30-minute RTH cadence from day one, and a
slot without data is recorded as a gap rather than invented.
**Verified:** 2026-09-02T00:26:36Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP.md Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every open position under a healthy connection has a mark row for each 30-minute RTH slot, on the cadence inherited from Phase 6's execution model. | ✓ VERIFIED | `worker/app.py:124` — `@app.periodic(cron="0,30 * * * *")` on `capture_all_connected_users_task`, gated at runtime by `rth_slot_for` (`zoneinfo`, `America/New_York`, weekday + 09:30–16:00 + 30-min grid check — read live from `src/morai/ingest/snapshots.py:263-281`). The tracer test (`test_snapshot_capture.py::test_snapshot_user_job_reprices_both_open_legs_end_to_end`) defers `snapshot_user` onto the real `worker.app.app` via `app.configure_task("snapshot_user").defer_async(...)` and drains it with `run_worker_async(wait=False)` — a genuine deferred Procrastinate job, not a direct function call (confirmed by reading the test source directly). The fan-out itself (`capture_all_connected_users`) also calls `defer_async` per user, mirroring `sync_all_connected_users`. D6-01's long-running worker (not Railway native cron) is the execution model — inherited, not re-decided, per `D8-07`. |
| 2 | A slot with no market data stores an explicit gap; no row anywhere carries an interpolated, fabricated, or carried-forward value (`NN-16`). | ✓ VERIFIED | Live-queried against the running Postgres instance: `snapshot_marks_gap_xor_mark_check` and `snapshot_observations_gap_xor_payload_check` CHECK constraints exist and were independently re-evaluated by this verifier against both invalid shapes (gap-with-value, value-with-no-gap-reason) — both correctly evaluate `false`. CR-01's non-finite fix (`_to_decimal`'s `is_finite()` guard, `src/morai/ingest/snapshots.py:204-217`) was independently re-verified live: `parse_quote_payload` given bare JSON `NaN`/`Infinity`/`-Infinity` tokens (which `json.loads` accepts by default) returns `gap_reason=NO_MARKET_DATA`, `mark_usd=None` for all three, confirmed by direct interpreter invocation, not by trusting the SUMMARY. The Hypothesis property test's `allow_nan=False, allow_infinity=False` exclusion (the original review defect) is confirmed removed — `st.floats()` with no exclusion is now used. |
| 3 | A later real observation heals a gap, a real observation is never replaced by a gap, and an upsert never silently no-ops a corrected backfill (`NN-6`). | ✓ VERIFIED | The four-cell truth table (`tests/ingest/test_snapshot_gap_upsert.py`, 15 tests) passes against real Postgres. This verifier independently re-ran the review's positive control: inverted the `where=` clause's second disjunct in `src/morai/ingest/snapshots.py` (both `write_snapshot_observations` and `write_snapshot_marks`), re-ran `test_gap_blocked_by_real_leaves_row_unchanged`, and reproduced the exact failure the review reported (`AssertionError: assert 'no_market_data' == None` — a gap overwrote a real row under the inverted clause), then reverted the change and confirmed `git diff` was empty and all 15 tests passed again. This is a genuine, independently-reproduced positive control, not a claim taken on trust. Corrective-backfill (`test_corrective_backfill_replaces_real_with_real`) and adjacency (`test_adjacency_gap_is_not_healed_by_a_neighbouring_slots_observation`, D8-12) both pass. |
| 4 | The repair path is runnable and rebuilds marks from the raw observations actually stored, and it ships in this phase alongside the writer rather than a phase later. | ✓ VERIFIED | `src/morai/ingest/snapshot_repair.py` imports nothing from `morai.vendor`/`schwab` (confirmed by direct `grep` of every import in the file — only `morai.crypto`, `morai.db`, `morai.ingest.snapshots`, `morai.ledger`, stdlib, `pydantic`, `sqlalchemy`). `repair_snapshot_marks` re-parses stored `snapshot_observations` rows through the identical `parse_quote_payload`/`to_schwab_wire_symbol` the live writer uses, making no vendor call. Two entry points confirmed live: `worker/app.py::repair_snapshot_marks_task` (Procrastinate task, no `@app.periodic`) and `tools/repair_snapshots.py` (CLI), both calling `snapshot_repair.repair_snapshot_marks(...)` through the module object (not an aliased import). This verifier ran the CLI directly: `uv run python tools/repair_snapshots.py --help` (exit 0, lists `user_id`, `--since`, `--backfill-gaps`) and `uv run python tools/repair_snapshots.py not-a-uuid` (exit 2, rejects without echoing the value). `backfill_uncaptured_slot_gaps` writes an honest `slot_not_captured` gap (the fourth gap-vocabulary value, present in the migration's own CHECK from day one) for a slot Procrastinate's own `MAX_DELAY` (600s) dropped entirely, never a fabricated mark — confirmed by reading the function body. All landed in this phase's 08-03 plan, in the same wave as the writer (08-01/08-02), not a later phase. |
| 5 | A user whose connection is expired gets an honest gap row for that slot rather than a skipped row that later reads as if the position did not exist. | ✓ VERIFIED | `test_expired_connection_writes_gap` passes in isolation (`fake_auth.last_client is None` — the vendor client was never built at all) and confirmed to reflect real `capture_user_snapshot` behavior: the connection-health branch (`connection_expired`/missing-connection) runs entirely before any call to `get_schwab_auth()`/`build_client`, verified by reading `src/morai/ingest/snapshots.py`'s `capture_user_snapshot`. The orchestrator-resolved vendor-error case (`test_vendor_call_failure_writes_gap_and_raises`) independently confirmed: a whole-`get_quotes` failure writes a `vendor_error` gap per leg AND fails the Procrastinate job (`status is Status.FAILED`), so `procrastinate_jobs` and the data agree. See the "Test-Suite Reliability Note" below for a genuine, independently-discovered flake in this specific test *when run as a narrow subset* — its root cause is unrelated to Phase 8's own production code (see below) and it does not reproduce in the actual gating command. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `alembic/versions/0015_snapshot_capture.py` | Three tables, gap-xor CHECKs, RLS, grants | ✓ VERIFIED | Read in full; independently re-queried live against Postgres (`\d+`, `pg_policies`, `pg_constraint`) — RLS `ENABLE`+`FORCE` and `user_isolation` policies confirmed on all three tables; both gap-xor CHECKs confirmed present and independently re-evaluated as correct. |
| `src/morai/ingest/snapshots.py` | Wire codec, `parse_quote_payload`, RTH arithmetic, asymmetric writers, `capture_user_snapshot` | ✓ VERIFIED | Read in full; CR-01 fix live-confirmed; asymmetric `where=` clause live re-derived and positive-control re-run by this verifier. |
| `src/morai/ingest/snapshot_repair.py` | `repair_snapshot_marks`, `backfill_uncaptured_slot_gaps`, no vendor import | ✓ VERIFIED | Read in full; import list independently confirmed vendor-free; both functions traced end to end. |
| `tools/repair_snapshots.py` | Runnable CLI over the shared repair function | ✓ VERIFIED | Invoked live (`--help`, invalid-UUID rejection) by this verifier, not merely read. |
| `src/morai/ingest/snapshot_runs.py` | `snapshot_runs` writer, `classify_snapshot_error`, `missing_capture_slots` | ✓ VERIFIED | Read in full; `test_a_stalled_slot_and_a_vendor_outage_are_distinguishable_by_one_query` (three-state distinguishability, `L043`) read and confirmed to assert what it claims. |
| `src/morai/worker/app.py` | Periodic capture task, `snapshot_user_task`, `repair_snapshot_marks_task`, RLS assertions | ✓ VERIFIED | `assert_connection_cannot_bypass_rls` confirmed present at all three worker entry points plus both CLI entry points (`grep`-confirmed, 11 call sites total across the two files). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `capture_all_connected_users_task` (periodic, cron) | `snapshot_user` (Procrastinate task) | `capture_all_connected_users` → `app.configure_task("snapshot_user").defer_async(...)` per connected user | ✓ WIRED | Confirmed by reading `src/morai/ingest/snapshots.py:735-759` — no direct call to `capture_user_snapshot` from the fan-out. |
| `snapshot_user_task` | `capture_user_snapshot` | direct call inside a `morai_app`-role session, after `assert_connection_cannot_bypass_rls` | ✓ WIRED | Confirmed by reading `worker/app.py:252-onwards`. |
| `write_snapshot_observations`/`write_snapshot_marks` | Postgres | `pg_insert(...).on_conflict_do_update(..., where=...)` | ✓ WIRED, asymmetry proven | Independently re-derived and positive-controlled by this verifier (see Criterion 3 above). |
| `repair_snapshot_marks_task` / CLI `_repair_one_user` | `snapshot_repair.repair_snapshot_marks` | module-qualified call (`from morai.ingest import snapshot_repair; snapshot_repair.repair_snapshot_marks(...)`) | ✓ WIRED | Both call sites confirmed to use the module-qualified form, not an aliased import — the exact shape the plan's own anti-drift test requires. |
| `backfill_uncaptured_slot_gaps` | `write_snapshot_observations`/`write_snapshot_marks` | direct call, `SLOT_NOT_CAPTURED` gap reason | ✓ WIRED | Confirmed by reading `snapshot_repair.py:365-381`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01 fix: NaN/Infinity degrade to a gap, never a real mark | Direct Python invocation of `parse_quote_payload` with bare `NaN`/`Infinity`/`-Infinity` JSON tokens | All three return `gap_reason=NO_MARKET_DATA`, `mark_usd=None` | ✓ PASS |
| gap-xor-payload CHECK blocks both invalid shapes | Direct SQL boolean evaluation of the CHECK expression against a gap-with-value row and an all-null row | Both evaluate `false` | ✓ PASS |
| Asymmetric upsert positive control | Inverted `where=` clause's second disjunct, re-ran `test_gap_blocked_by_real_leaves_row_unchanged`, reverted | Test failed exactly as the review claimed (`'no_market_data' == None`), reverted cleanly (`git diff` empty) | ✓ PASS |
| Repair CLI is runnable | `uv run python tools/repair_snapshots.py --help` / `... not-a-uuid` | Exit 0 with full option list / exit 2 without echoing the bad value | ✓ PASS |
| Full test suite | `uv run pytest -q` (twice, with `procrastinate_jobs` truncated between runs) | 587 passed, 0 failed, both times | ✓ PASS |
| Full gate | `bash tools/gate.sh` | ruff, ruff format, basedpyright strict, mypy strict, pytest — all clean, 587 passed | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SNAP-01 | 08-01, 08-04 | Every open position repriced and snapshotted on a 30-min RTH cadence | ✓ SATISFIED | Periodic cron + `rth_slot_for` + tracer test + `snapshot_runs` writer, all independently confirmed above. |
| SNAP-02 | 08-01, 08-02 | A slot with no market data stores an explicit gap, never fabricated/interpolated/carried-forward | ✓ SATISFIED | Gap-xor CHECK (live-confirmed) + CR-01 non-finite fix (live-confirmed) + `vendor_error`/partial-response isolation tests. |
| SNAP-03 | 08-02 | A gap can be healed by a later real observation; a real observation is never replaced by a gap | ✓ SATISFIED | Four-cell truth table + independently re-run positive control (this verifier). |
| SNAP-04 | 08-03 | The snapshot writer ships with a runnable repair path rebuilding from raw observations | ✓ SATISFIED | No-vendor-import confirmed; CLI invoked live by this verifier; both entry points confirmed module-qualified. |
| SNAP-05 | 08-02 | Capture runs for a healthy connection and records an honest gap for one that is not | ✓ SATISFIED | `last_client is None` for the expired branch confirmed correct via code read and isolated test run; vendor-error branch confirmed to both fail the job and write gaps. |

No orphaned requirements — `REQUIREMENTS.md`'s Phase 8 mapping (SNAP-01..05) matches exactly what the four plans' frontmatter jointly claim.

### Anti-Patterns Found

None. Scanned every file this phase created or modified (`snapshots.py`, `snapshot_repair.py`, `snapshot_runs.py`, `repair_snapshots.py`, `worker/app.py`, `data_keys.py`, migration `0015`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/empty-implementation patterns. The one `"placeholder"` string match (`worker/app.py:106`) is in a comment about Phase 1's own pre-existing heartbeat cron, explicitly documented as "not a preview of the real one" — unrelated to Phase 8's own capture cadence, which is the real `"0,30 * * * *"` cron. No debt markers, no empty implementations, no hardcoded-empty stub patterns in any file this phase touched.

### Test-Suite Reliability Note (not a phase-goal gap)

While independently re-running `test_expired_connection_writes_gap` and its siblings as a narrow `-k`-selected subset (repeated ~15 times, including with `procrastinate_jobs` freshly truncated before each attempt), this verifier reproduced a genuine, intermittent (~1-in-8 to 1-in-9) failure: `fake_auth.last_client` was non-`None` with an empty `.calls` list, even though `capture_user_snapshot`'s own connection-health branch never calls `get_schwab_auth()`/`build_client`.

Root-caused by reading `worker/app.py` and the test fixture: Phase 1's own heartbeat (`@app.periodic(cron="* * * * *")` on `sync_all_connected_users_task`) is registered on the *same* shared Procrastinate `app` object every test in `test_snapshot_capture.py` opens via `async with app.open_async(): ... await app.run_worker_async(wait=False)`. If a real wall-clock minute boundary is crossed during a test's worker run, Procrastinate's own periodic deferrer fires the heartbeat for real, fanning out a genuine `sync_user` job for the connection the test just seeded — and `sync_user_task` resolves `get_schwab_auth()` fresh at call time, which is monkeypatched (for the duration of that one test) to the *same* `fake_auth` instance the snapshot test constructed. `sync_user`'s own vendor path then calls `fake_auth.build_client(...)`, setting `last_client` to a real (if unused) client object — contaminating an assertion that belongs to an unrelated task.

This is a test-isolation gap (an unrelated periodic task sharing the same app instance and the same monkeypatched auth seam), not a defect in Phase 8's own production code — confirmed independently three ways: (1) direct code reading shows `capture_user_snapshot`'s connection-health branch runs entirely before any vendor call; (2) the test passes reliably (8/9+ observed runs) in isolation and as part of the full, ordered test file; (3) `uv run pytest -q` (full suite) and `bash tools/gate.sh` — the actual gating commands — both passed cleanly, twice each, across separate invocations in this verification session. It fails in the safe direction (false test failure, not a false pass), and it was only reproducible under repeated, narrow, back-to-back `-k`-filtered invocations that this verifier ran deliberately to stress the test's isolation — not under the project's own gating command. Recorded here for the record since a future CI run could hit it by coincidence; not treated as a gap against any of the five success criteria, all of which were independently confirmed true through direct code reading, live database queries, and a reproduced positive control.

### Human Verification Required

Both items below are the same two the phase's own `08-VALIDATION.md` names in its "Manual-Only Verifications" table, and could not be closed by this verifier for the reasons stated — consistent with the project's own workflow rule ("when you cannot verify something, say so explicitly rather than softening the claim").

1. **Live `get_quotes` response shape against a real Schwab connection**
   - **Test:** Run one real capture slot against a live, authenticated Schwab connection; compare the stored raw payload in `snapshot_observations` against `parse_quote_payload`'s own parsed output for the same row.
   - **Expected:** Either the field-path guesses (`quote.mark`, `quote.underlyingPrice`) are correct and a real mark lands, or they are wrong and every leg gets an honest `no_market_data` gap — never a wrong number, never a raise.
   - **Why human:** This project has never called `get_quotes` live (`08-RESEARCH.md`: LOW confidence on the exact OPTION response schema). No live Schwab OAuth connection exists in this environment.

2. **Procrastinate `MAX_DELAY` behavior on a real worker outage**
   - **Test:** On the real Railway deployment, stop the worker for more than ten minutes spanning an RTH slot boundary, restart it, and confirm `missing_capture_slots` names the dropped slot with no `snapshot_runs` row at all, then confirm the repair path backfills it as an honest `slot_not_captured` gap.
   - **Expected:** No job at all for the missed slot (not even a failed one); the repair path recovers it as a gap, never a fabricated mark.
   - **Why human:** A genuine worker outage against Procrastinate's own in-memory catch-up tracking cannot be reproduced in a local pytest/Postgres environment. The *mechanism* is proven locally via a simulated-outage test (row deletion, not a real scheduler gap), but the real trigger was not observed live.

### Gaps Summary

None against the phase's five roadmap success criteria — all five were independently verified true through direct code reading, live Postgres queries, a reproduced positive control on the asymmetric upsert, and live invocation of the repair CLI, not by trusting SUMMARY.md claims. `bash tools/gate.sh` is green (587 passed, ruff/basedpyright/mypy clean). The four code-review findings (CR-01, WR-01, WR-02, IN-01) were all confirmed fixed in the live source, not merely claimed fixed in `08-REVIEW-FIX.md`.

Status is `human_needed` rather than `passed` solely because two Manual-Only items named in the phase's own `08-VALIDATION.md` — a live Schwab `get_quotes` schema check and a real Railway worker-outage observation — remain genuinely unverifiable in this local environment and were not closed here on inference, per this project's own verification discipline.

---

_Verified: 2026-09-02T00:26:36Z_
_Verifier: Claude (gsd-verifier)_

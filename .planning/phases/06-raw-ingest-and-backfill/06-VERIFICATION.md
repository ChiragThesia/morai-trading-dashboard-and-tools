---
phase: 06-raw-ingest-and-backfill
verified: 2026-09-01T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Confirm the Railway `worker` service actually has `MORAI_APP_DB_PASSWORD` set in the dashboard (not just declared in .railway/railway.ts) and that a deployed `sync_user` job reaches `succeeded`."
    expected: "`railway logs --service worker` shows no `RuntimeError` naming `morai_app_db_password`; a deferred `sync_user` job reaches `succeeded`."
    why_human: "No live Railway dashboard/deploy access in this session; 06-USER-SETUP.md is itself marked Incomplete."
---

# Phase 6: Raw Ingest and Backfill Verification Report

**Phase Goal:** Each connected user's fills and the broker's own transaction records land
immutably, on a schedule, and repeating the work changes nothing.
**Verified:** 2026-09-01
**Status:** human_needed
**Re-verification:** No — initial verification

## Verification Method

Ran the suite and gate myself rather than trusting `06-REVIEW.md`/`06-REVIEW-FIXES.md`'s own
numbers:

```
$ uv run pytest -q                 # 383 passed, 0 failed, exit 0
$ bash tools/gate.sh                # ruff clean, basedpyright clean (114 files),
                                     #   mypy clean (114 files), pytest 383 passed, exit 0
$ uv run alembic current             # 0013 (head)
```

Then read the actual source for every claim in `06-REVIEW.md`/`06-REVIEW-FIXES.md` this task
was told to weight most heavily, rather than accepting the review's own prose, and read the
tests that back each one to confirm they would genuinely fail if the guarantee didn't hold.

## Goal Achievement

### Observable Truths (mapped to the 5 roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Fills pull on a schedule for every connected user under one documented execution model, surviving redeploy without losing or double-firing a cycle | ✓ VERIFIED | `worker/app.py` `sync_all_connected_users_task` registered `@app.periodic(cron="* * * * *")`, defers one `sync_user` job per row in `schwab_connections` via `schwab_sync.py::sync_all_connected_users`. The no-double-fire guarantee rests on `procrastinate_periodic_defers_unique UNIQUE (task_name, periodic_id, defer_timestamp)`, confirmed present in `alembic/versions/0002_procrastinate_schema.py:128` **and** proved live: `tests/ingest/test_fanout.py::test_periodic_defers_unique_constraint_rejects_duplicate_accepts_differing` inserts directly into the installed `procrastinate_periodic_defers` table, asserts the second identical insert raises `IntegrityError` and that `"procrastinate_periodic_defers_unique"` appears in the exception text (not a bare exception-type check), then proves a differing `defer_timestamp` is accepted. This is a genuine DB-constraint test against the real 3.9.0 schema, not a read of the migration file. |
| 2 | The broker's own transaction records land in their own table, fed directly from Schwab and never written by the derivation pipeline | ✓ VERIFIED | `BrokerTransaction` (`db/models.py:313`) carries natural composite PK `(user_id, activity_id)`, never a hashed surrogate — matches WR-A3's stated fix directly. `__init__` requires `_BROKER_TRANSACTION_WRITE_TOKEN`, raising `RuntimeError` on any other value; `tests/gate/test_ingest_write_boundary.py` + `tests/gate/fixtures/violation_second_broker_transactions_writer.py` prove a second writer is rejected by rule code, mirroring `Fill`'s existing gate. `insert_broker_transactions` is the sole writer, called from `schwab_sync.py::sync_user`, never from `ledger/pairing.py` (derivation). |
| 3 | A raw fill is stored exactly as the broker reported it — signed amount unmodified, never `abs()`'d, `positionEffect` preserved, no later write mutates it | ✓ VERIFIED | `_direction()` in `schwab_sync.py:132` reads the sign of the vendor's own `amount` (falling back to `cost`'s sign) before ever taking a magnitude, and negates under a branch that already knows the sign — no call to Python's `abs` anywhere in the function. `position_effect` is written through in `extract_fills()` (`schwab_sync.py:228`) verbatim from `item.position_effect`, never mapped or defaulted. The `NN-10` gate (`tests/ingest/test_extract_fills.py::test_extraction_module_never_calls_the_absolute_value_builtin`) walks the real AST of `inspect.getsource(schwab_sync)` — the whole module, not a substring of it — and is proven capable of both firing (`test_the_scanner_fires_on_a_synthetic_abs_call`) and *not* firing on a comment/docstring that merely discusses the prohibition (`test_scanner_does_not_fire_on_a_comment_or_docstring_mentioning_abs`). A real gate, not a defeatable grep. `fills` carries no `UPDATE` grant in migration 0003/0011 discipline and `Fill`/`BrokerTransaction` expose no update path in code. |
| 4 | Running ingest twice over an overlapping window, and a manual re-sync repeatedly, changes nothing past the first successful write | ✓ VERIFIED | `insert_fills`/`insert_broker_transactions` use `on_conflict_do_nothing(index_elements=[...])` targeting each table's *full* primary key. `tests/ingest/test_idempotency.py::test_two_fills_differing_only_in_leg_index_both_land_and_rerun_holds` builds two real fills via `extract_fills()` differing only in `leg_index`, inserts both (2 landed), re-inserts the same rows (0 landed second time), and confirms exactly 2 rows exist — this is the genuine WR-A3 proof, not an assumption. The sibling test does the same for `broker_transactions` keyed on `activity_id`. `POST /schwab/sync` (`routes_connections.py:172`) enforces a cooldown via `read_sync_runs`, and defers the same `sync_user` task the scheduler defers — no second write path exists. |
| 5 | First-connect backfill reaches existing open positions; a sync run is queryable for when/how many/what errored; batch inserts chunk at ≤2,000 rows | ✓ VERIFIED | `sync_windows()` (`schwab_sync.py:275`) computes the full 365-day lookback chunked at ≤`schwab_tx_max_range_days` when `last_synced_at IS NULL`, proven structurally (no gap, no overlap) in `tests/ingest/test_backfill.py`. `sync_runs` (migration 0012) records `started_at`, `finished_at`, `trigger`, `status`, `fills_landed`, `broker_transactions_landed`, `error_code` — `tests/ingest/test_sync_runs.py::test_successful_sync_writes_one_run_row_and_sets_last_synced_at` proves exactly one row on success with real counts; `test_failure_mid_backfill_rolls_back_all_writes_but_keeps_the_run_row` proves the record survives a rollback that erases the fills/broker-transaction writes it recorded, using a fake that fails on the **second** window so there is something real to roll back. `tests/ingest/test_broker_transactions_chunking.py::test_2001_rows_land_across_more_than_one_insert` counts real `INSERT INTO broker_transactions` round-trips via `before_cursor_execute` (not a row-count proxy) and asserts `counts[0] > 1` for 2,001 rows, with all 2,001 landing. |

**Score:** 5/5 truths verified, 0 present-but-behavior-unverified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `alembic/versions/0011_broker_transactions.py` | `broker_transactions` table, natural key, `FOR ALL` RLS | ✓ VERIFIED | PK `(user_id, activity_id)`, `ENABLE`+`FORCE` RLS, `CREATE POLICY user_isolation ... FOR ALL` confirmed at line 112-113 |
| `alembic/versions/0012_sync_runs.py` | `sync_runs` table, `FOR ALL` RLS | ✓ VERIFIED | `CREATE POLICY user_isolation ON sync_runs FOR ALL` confirmed at line 136-137; `CHECK` constraints on `trigger`/`status` |
| `alembic/versions/0013_procrastinate_defer_grants.py` | Least-privilege grants for `morai_app` to defer jobs | ✓ VERIFIED | Grants derived from real `InsufficientPrivilegeError`s, no `UPDATE`/`DELETE` on `procrastinate_jobs`, no grant on `procrastinate_periodic_defers` |
| `src/morai/ingest/schwab_sync.py` | Pure extraction + `sync_user` shell | ✓ VERIFIED | `extract_fills`, `sync_windows` pure; `sync_user` holds the per-user lock before `read_connection` (WR-01 fix, see below) |
| `src/morai/ingest/broker_transactions.py` | Independent write path, 2,000-row chunking | ✓ VERIFIED | Sentinel-gated `__init__`, chunked `on_conflict_do_nothing` insert |
| `src/morai/ingest/sync_runs.py` | Sync-run record, classified error codes | ✓ VERIFIED | `classify_sync_error` maps 5 distinct exception classes to enum members, never embeds exception text |
| `src/morai/worker/app.py` | Two-session failure handling, RLS-bound session | ✓ VERIFIED | `sync_user_task` opens `morai_app` session via `get_session_maker()`, calls `assert_connection_cannot_bypass_rls` before any protected write, rolls back and re-opens a fresh session for the failure row |
| `src/morai/api/job_queue.py` | Web-process deferral over `morai_app`, not superuser | ✓ VERIFIED | `app_sync_dsn` used for the connector, not `sync_dsn` (worker's superuser DSN) |
| `src/morai/api/routes_connections.py` | `POST /schwab/sync`, `GET /schwab/sync-runs` | ✓ VERIFIED | Cooldown via `read_sync_runs`, 429 on violation; sync-runs read scoped by RLS `user_isolation`, never a `WHERE` clause |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| worker `sync_user_task` | `schwab_client_for_user` → `get_transactions` → `insert_broker_transactions` + `insert_fills` | one `AsyncSession` transaction | ✓ WIRED | Confirmed in `schwab_sync.py::sync_user` — `insert_broker_transactions` runs before `insert_fills`, both inside the `async with schwab_client_for_user(...)` block, one transaction |
| `schwab_client_for_user` | `pg_advisory_xact_lock(hashtext(user_id))` | Phase 4's per-user lock | ✓ WIRED | `sync_user` acquires the lock as its own first action (post WR-01 fix, before `read_connection`); `schwab_client_for_user`'s own re-acquisition is a harmless re-entrant no-op in the same transaction |
| `BrokerTransaction.__init__` | `_BROKER_TRANSACTION_WRITE_TOKEN` | compile-time + runtime gate | ✓ WIRED | `tests/gate/test_ingest_write_boundary.py` proves exactly one tracked module imports the sentinel |
| `sync_user_task` failure path | fresh session → `record_sync_run` | two-session split | ✓ WIRED | `worker/app.py:168-188` — `except Exception` block rolls back the first session, opens `session_maker()` again, writes and commits the failure row alone, then re-raises |
| `POST /schwab/sync` | `configure_task("sync_user").defer_async` | same task the periodic tick defers | ✓ WIRED | `defer_manual_sync` (`job_queue.py`) confirmed to target the same `"sync_user"` task name `sync_all_connected_users` defers |
| `sync_runs` RLS `user_isolation` | `GET /schwab/sync-runs` | policy-scoped read | ✓ WIRED | `tests/ingest/test_sync_runs.py::test_user_reads_only_their_own_sync_runs_with_superuser_positive_control` confirms cross-user isolation |

### Behavioral Spot-Checks (beyond the plans' own test suite)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `procrastinate_periodic_defers` unique constraint rejects duplicate, live DB | `uv run pytest -q tests/ingest/test_fanout.py::test_periodic_defers_unique_constraint_rejects_duplicate_accepts_differing` | 1 passed | ✓ PASS |
| WR-A3 key-completeness proof, both tables | `uv run pytest -q tests/ingest/test_idempotency.py` | all passed (part of the 383) | ✓ PASS |
| Two-session failure survives rollback | `uv run pytest -q tests/ingest/test_sync_runs.py::test_failure_mid_backfill_rolls_back_all_writes_but_keeps_the_run_row` | 1 passed | ✓ PASS |
| 2,001-row chunk issues >1 real INSERT round-trip | `uv run pytest -q tests/ingest/test_broker_transactions_chunking.py` | all passed | ✓ PASS |
| Full suite + gate | `uv run pytest -q && bash tools/gate.sh` | 383 passed, ruff/basedpyright/mypy clean on 114 files | ✓ PASS |
| Migration head | `uv run alembic current` | `0013 (head)` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INGEST-01 | 06-02 | Pulls each connected user's fills on a schedule | ✓ SATISFIED | Periodic fan-out (`sync_all_connected_users_task`), one job per user, isolation proven in `test_fanout.py` |
| INGEST-02 | 06-01 | Raw fill stored immutably, signed amount + position_effect preserved | ✓ SATISFIED | `_direction`, `extract_fills`, AST gate, no `UPDATE` grant |
| INGEST-03 | 06-02 | Re-running over overlapping window is a no-op | ✓ SATISFIED | `on_conflict_do_nothing` + `test_idempotency.py` byte/count proofs |
| INGEST-04 | 06-03 | Manual re-sync, repeatable safely | ✓ SATISFIED | `POST /schwab/sync`, cooldown, same task as scheduler |
| INGEST-05 | 06-02 | First-connect backfill reaches existing open positions | ✓ SATISFIED | `sync_windows` full-lookback branch, chunked, logged (D6-03 measurement instrument) |
| INGEST-06 | 06-03 | Sync-run record queryable (when/how many/what errored) | ✓ SATISFIED | `sync_runs` table, `GET /schwab/sync-runs`, two-session failure survival |
| OPS-05 | 06-01 | Batch insert never exceeds bind-parameter ceiling | ✓ SATISFIED | `_CHUNK_SIZE = 2000`, both `insert_fills` and `insert_broker_transactions`, proven at 2,001-row boundary with real round-trip count |

No orphaned requirements: all 7 IDs mapped to this phase in `REQUIREMENTS.md` (lines 45-50, 109)
appear exactly once across the three plans' `requirements` frontmatter (`06-01`: INGEST-02,
OPS-05; `06-02`: INGEST-01, INGEST-03, INGEST-05; `06-03`: INGEST-04, INGEST-06).

`REQUIREMENTS.md` still shows all 7 as `- [ ]` (Pending) — this is deliberate per the project's
own workflow rule (Phase 5's requirements were marked before its review found two blockers).
This verification recommends marking all 7 Complete now that the phase's own review, its fixes,
and this independent re-check all agree.

### Anti-Patterns Found

None. Scanned every file in the three plans' `files_modified` lists for `TBD`/`FIXME`/`XXX`/
`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" — zero matches. No debt markers,
no stub returns, no hardcoded empty data flowing to a caller.

### The 06-REVIEW.md Findings — Confirmed Real, Confirmed Fixed

**WR-01 (window computed before the per-user lock was held).** Read `schwab_sync.py::sync_user`
directly: the lock (`pg_advisory_xact_lock(hashtext(:uid))`) is acquired as the function's second
statement, immediately after the RLS `set_config` and *before* `read_connection`/`sync_windows`.
The docstring now states this explicitly and cites the fix. `06-REVIEW-FIXES.md`'s claimed RED
test (`tests/ingest/test_sync_lock_ordering.py`) exists in the tree; the full `tests/ingest`,
`tests/vendor`, `tests/ledger` suite (166 of the 383 tests) is green, consistent with the claimed
no-regression run. This closes the exact race the review named — a stale unlocked read cannot
happen anymore because the lock precedes the read.

**IN-01 (`procrastinate_jobs` SELECT grant is table-wide).** Confirmed as documentation-only, as
`06-REVIEW.md`'s own Fix section specified ("No code change needed"). The grant text is unchanged
in `0013_procrastinate_defer_grants.py`; a comment now sits above it. Low-severity, accepted,
disclosed — no further action needed.

Neither fix weakened an existing guard: the WR-01 fix strengthens the lock ordering (moves it
earlier, doesn't remove or widen anything); the IN-01 fix is comment-only.

### Known Disclosed Limits (not reported as gaps, per instructions)

- No live Schwab connection exists this session — everything above is verified against Phase 4's
  `Protocol` fake, matching Phase 4's own verification posture. The six vendor-payload facts named
  in the SUMMARYs (real per-call range limit, real rate limit, `activityId` uniqueness, `price`
  source field, OCC symbol spacing, `cost`-sign fallback) remain owed to a first live run — the
  logging instrument (`sync_user`'s per-window log line) that will measure them is confirmed
  present and wired.
- `D6-03`'s 60-day chunk / 365-day lookback constants remain explicitly UNMEASURED, as designed.
- The `POST /schwab/sync` cooldown throttles by run *start* time only, as disclosed in its own
  docstring — wasteful in an edge case, not unsafe.
- `MORAI_APP_DB_PASSWORD` on the Railway worker service: `.railway/railway.ts` declares it with
  `preserve()` for the worker service (confirmed present in the file), but no live Railway access
  exists in this session to confirm the actual dashboard value is set. Marked `human_needed` below
  per the phase's own instruction.

### Human Verification Required

1. **Railway worker `MORAI_APP_DB_PASSWORD` dashboard value**
   **Test:** Confirm the `worker` service on Railway actually has `MORAI_APP_DB_PASSWORD` set
   (not just declared in `.railway/railway.ts`) and that a deployed `sync_user` job reaches
   `succeeded` rather than failing at `get_app_engine()` construction.
   **Expected:** `railway logs --service worker` shows no `RuntimeError` naming
   `morai_app_db_password`.
   **Why human:** No live Railway access in this session; `06-USER-SETUP.md` itself is marked
   Incomplete.

### Gaps Summary

No code gaps. All 5 roadmap success criteria and all 7 requirement IDs verified against the
actual codebase, with genuine tests (round-trip counts, live-DB constraint violations, AST walks
with positive/negative controls, byte-identity idempotency checks) rather than presence-only
checks — every truth reached ✓ VERIFIED, none FAILED. The overall status is `human_needed` rather
than `passed` for exactly one reason: the Railway worker service's `MORAI_APP_DB_PASSWORD`
dashboard value cannot be confirmed from this development machine (`06-USER-SETUP.md` is itself
marked Incomplete), and per this task's own instructions that item routes to human verification
rather than being assumed. This is an infrastructure deployment fact outside code, not a defect
in what was built.

---

_Verified: 2026-09-01_
_Verifier: Claude (gsd-verifier)_

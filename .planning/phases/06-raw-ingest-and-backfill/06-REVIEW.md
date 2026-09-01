---
phase: 06-raw-ingest-and-backfill
reviewed: 2026-09-01T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/morai/ingest/schwab_sync.py
  - src/morai/ingest/broker_transactions.py
  - src/morai/ingest/sync_runs.py
  - src/morai/ingest/__init__.py
  - src/morai/worker/app.py
  - src/morai/api/job_queue.py
  - src/morai/api/routes_connections.py
  - src/morai/api/models_connections.py
  - src/morai/ledger/fills.py
  - src/morai/db/models.py
  - src/morai/settings.py
  - alembic/versions/0011_broker_transactions.py
  - alembic/versions/0012_sync_runs.py
  - alembic/versions/0013_procrastinate_defer_grants.py
  - tests/ingest/conftest.py
  - tests/ingest/test_sync_tracer.py
  - tests/ingest/test_extract_fills.py
  - tests/ingest/test_idempotency.py
  - tests/ingest/test_backfill.py
  - tests/ingest/test_fanout.py
  - tests/ingest/test_sync_runs.py
  - tests/ingest/test_sync_route.py
  - tests/gate/test_ingest_write_boundary.py
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-09-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 20 source files + 3 gate/support tests explicitly named for verification
**Status:** issues_found (1 warning, 1 info — no blockers)

## Summary

Reviewed the raw-ingest path end to end: the pure `extract_fills`/`sync_windows` functions,
the `sync_user` shell, the two new tables (`broker_transactions`, `sync_runs`) and their
migrations, the worker's RLS boundary crossing, the manual-resync route, and the test suite
that exercises all of it. Also ran the actual verification commands rather than trusting the
plan's own claims: `uv run pytest -q tests/ingest tests/gate` (96 tests, all green),
`uv run basedpyright`/`mypy`/`ruff` against every reviewed `src/` file (clean on all three),
against a live local Postgres 18.

The project-specific checks this phase most cares about hold up:

- **NN-10/NN-9 (no `abs()` on a signed vendor amount).** `_direction` in `schwab_sync.py`
  negates a known-signed value under a branch that already knows the sign; it never calls
  the builtin. The gate proving this (`tests/ingest/test_extract_fills.py`, not
  `tests/gate/`) walks the real AST of `inspect.getsource(schwab_sync)` — the whole module,
  not just `_direction` — and carries both a positive control (fires on a synthetic `abs()`
  call) and a negative control (does not fire on a comment/docstring mentioning `abs`). This
  is a real gate, not a defeatable grep.
- **WR-A3 / `ON CONFLICT DO NOTHING`.** No hashed surrogate key anywhere in this phase.
  `broker_transactions`' primary key is the natural `(user_id, activity_id)`; `fills`' key
  (reused from Phase 3/5, unchanged here) is `(user_id, order_id, occ_symbol, leg_index,
  execution_time)`. Both `on_conflict_do_nothing(index_elements=[...])` calls target their
  table's full primary key exactly. `test_two_fills_differing_only_in_leg_index_both_land`
  and `test_two_broker_transactions_differing_only_in_activity_id_both_land` prove the
  do-nothing clause does not collide two real, distinct rows.
- **The RLS boundary.** `sync_user_task` (`worker/app.py:161-163`) opens its session via
  `get_session_maker()` → `get_app_engine()` (`morai_app`, not superuser) and calls
  `assert_connection_cannot_bypass_rls(session)` before touching any protected table — a
  real call in the real code path, confirmed by reading `identity/rls.py`, not a test-only
  stand-in. `broker_transactions` and `sync_runs` (migrations 0011, 0012) both carry
  `FOR ALL` policies, not `INSERT`-only, matching `V092`'s stated reason (their own
  `RETURNING`-based insert helpers need the implicit `SELECT`).
- **The failure record surviving rollback.** `sync_user_task` writes the failure row on a
  second, freshly-opened session after `await session.rollback()` on the first, and re-raises
  afterward so `procrastinate_jobs` and `sync_runs` cannot disagree about what happened.
  `test_failure_mid_backfill_rolls_back_all_writes_but_keeps_the_run_row` proves this against
  a fake that fails on the *second* window, so there is something real to roll back, not just
  an empty transaction. The reverse also holds: a successful run writes exactly one
  `record_sync_run` call, on the same session, no separate write path exists that could double
  it.
- **Migration 0013's grants.** Every grant matches a quoted `InsufficientPrivilegeError`
  from the migration's own docstring; nothing broader than what `defer_async` needs was
  added, and no `UPDATE`/`DELETE` on `procrastinate_jobs` means `morai_app` cannot mark a job
  done — it can defer, never run, jobs. (See Info-1 below for one narrow, low-severity
  side effect of the `SELECT` grant this migration correctly needed to add.)
- **NN-16 (honest gaps).** `sync_runs.fills_landed`/`broker_transactions_landed`/`error_code`
  are nullable everywhere they're read or written (model, migration CHECK constraints,
  `SyncRunRecord`, `SyncRunResponse`) and are never defaulted to `0`/empty string on failure.
  `schwab_connections.last_synced_at` stays `NULL` until a genuinely successful run.
- **NN-5/OPS-05 (2,000-row chunking).** `insert_broker_transactions` chunks identically to
  `insert_fills`, and `tests/ingest/test_broker_transactions_chunking.py` proves the boundary
  at exactly 2,000 rows in one call, plus the bind-parameter-ceiling derivation.
- **Typing.** No `Any`, `cast`, or bare `# type: ignore` found in any reviewed file. Ran
  basedpyright, mypy, and ruff directly against every reviewed `src/` file — all three exit
  clean.

Two things worth fixing, neither a blocker today:

## Warnings

### WR-01: `sync_user`'s window computation reads `last_synced_at` before the per-user lock is held, contradicting its own docstring

**File:** `src/morai/ingest/schwab_sync.py:374-391`

**Issue:** `sync_user`'s own docstring states: *"Opens `schwab_client_for_user`, which already
holds this user's own `pg_advisory_xact_lock` for the whole body ... no second lock
acquisition here, the same reuse `sync_events`'s own docstring documents for the identical
race."* That claim is not what the code does. `read_connection(session, user_id)` and the
resulting `sync_windows(connection.last_synced_at, now, settings)` call both run **before**
`schwab_client_for_user` is entered:

```python
connection = await read_connection(session, user_id)      # <- unlocked read
...
windows = sync_windows(connection.last_synced_at, now, settings)  # <- decided unlocked
...
async with schwab_client_for_user(session, user_id, auth) as client:  # <- lock acquired here
```

`schwab_client_for_user` (`vendor/connections.py:330-397`) acquires
`pg_advisory_xact_lock(hashtext(:uid))` as its *first* action and only *then* re-reads the
connection row for the token. So the value that actually decides which windows get synced
(`last_synced_at`) is read outside the critical section the surrounding code and its own
comments claim protects it.

Today this is masked, not fixed: the deployed worker starts with
`procrastinate --app morai.worker.app.app worker` (`.railway/railway.ts:69`, no
`--concurrency` flag), which defaults to Procrastinate's `concurrency=1` — verified against
the installed 3.9.0 package per this phase's own research and cited by
`routes_connections.py`'s cooldown docstring. At concurrency 1 the whole worker processes one
job at a time, system-wide, so two `sync_user` runs for the same user cannot literally be
in-flight together, and the race this ordering would otherwise permit cannot fire.

The gap is real the moment that assumption changes — worker concurrency is a CLI flag, not
something enforced anywhere in code, and horizontal worker scaling is a normal Railway
operation. If two `sync_user` runs for the same user ever do overlap: both would compute
identical windows from the same stale `last_synced_at` (harmless — idempotent writes just
no-op on the second run's insert), but whichever run **commits last** sets
`schwab_connections.last_synced_at = started_at` unconditionally
(`worker/app.py:200-203`), with no comparison against the value already stored. If that
run's own `started_at` is earlier than the other run's, `last_synced_at` regresses backward.
Not data loss (the next cycle's overlap window and idempotent inserts absorb it), but it is
exactly the class of bug the lock exists to make impossible, and the code's own comments
assert it already is.

**Fix:** Either move the `last_synced_at` read that feeds `sync_windows` inside the locked
section (e.g., have `sync_user` acquire the lock first, or have `schwab_client_for_user`
hand back the `ConnectionRecord` it already re-reads under lock so `sync_windows` is computed
from that value instead of the earlier unlocked one), or make the final `last_synced_at`
write monotonic (`SET last_synced_at = GREATEST(last_synced_at, :started_at)`) so a
late-committing, earlier-started run cannot regress it. The second is the smaller diff; the
first is what the existing docstring already claims is true.

## Info

### IN-01: `procrastinate_jobs` SELECT grant is table-wide, not scoped to the granting session's own inserted rows

**File:** `alembic/versions/0013_procrastinate_defer_grants.py:74`, `src/morai/api/job_queue.py`

**Issue:** Migration 0013 grants `morai_app` `SELECT` on `procrastinate_jobs`, correctly
earned by a real `InsufficientPrivilegeError` from the `RETURNING id` clause
`procrastinate_defer_jobs_v1` uses. Postgres has no primitive that scopes a `RETURNING`-only
`SELECT` to just the rows a given `INSERT` produced — the grant is table-wide. `procrastinate_jobs`
carries no RLS policy (it is Procrastinate's own internal schema, not one this project owns),
so any code running under the `morai_app` role — today, only `job_queue.py`'s
deferral-only `App`, which never issues a raw `SELECT` itself — is nonetheless *capable* of
querying every user's queued/historical `sync_user` job arguments (`user_id`, `trigger`), not
just its own. This mirrors the cross-tenant read `sync_all_connected_users` already discloses
and accepts explicitly in its own docstring ("this function reads exactly one column,
`user_id`, and touches no encrypted value") — the same reasoning applies here and the actual
exposure is the same shape (a UUID and an enum value, no secrets, no ciphertext) — but unlike
that function, this scope isn't named anywhere near the grant itself.

**Fix:** No code change needed — the grant is exactly what `RETURNING` requires and nothing
broader, and the data it exposes is low-sensitivity. Worth a one-line comment on the grant
(mirroring `sync_all_connected_users`'s own disclosure) so a future reader doesn't have to
re-derive that this is an accepted, bounded cross-tenant read rather than an oversight.

---

_Reviewed: 2026-09-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

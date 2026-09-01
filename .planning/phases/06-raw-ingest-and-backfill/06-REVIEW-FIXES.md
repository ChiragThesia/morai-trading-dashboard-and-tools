# Phase 6 Review Fixes

Fixes both findings in `06-REVIEW.md` (1 warning, 1 info; no criticals). Each landed as its own
commit; the warning's test landed as a separate RED commit ahead of its fix, per the red ceremony
rule.

## WR-01 — `sync_user`'s window computation read `last_synced_at` before the per-user lock

**File:** `src/morai/ingest/schwab_sync.py`

**What changed:** Moved the `pg_advisory_xact_lock(hashtext(:uid))` acquisition to `sync_user`'s
own first action, immediately after the RLS `set_config` and before `read_connection` /
`sync_windows`. `schwab_client_for_user`'s own acquisition of the same lock (unchanged) is now a
harmless re-entrant no-op within the same transaction rather than the only acquisition. Corrected
the docstring, which previously claimed the lock already covered the whole body — it did not; the
window computation ran unlocked. Matches `sync_events`'s identical shape
(`ledger/pairing.py`, CR-02, `05-REVIEW.md`), cited in the new docstring.

**RED evidence (before the fix):** `tests/ingest/test_sync_lock_ordering.py`, added first and run
against the pre-fix code:

```
E       assert datetime.datetime(2025, 6, 20, 0, 1, tzinfo=datetime.timezone.utc) == datetime.datetime(2026, 6, 19, 0, 0, tzinfo=datetime.timezone.utc)
tests/ingest/test_sync_lock_ordering.py:147: AssertionError
```

Two overlapping `sync_user` calls for the same user, deterministically ordered with
`asyncio.Event`-based gates (not a timing-dependent `sleep` alone — the fake's own
`entered_refresh` event confirms call A already holds the lock before call B starts; a real
wall-clock sleep then gives B's own pre-lock code time to run before A is released). Call B's
first requested window started 365 days before its own `now` (the first-connect lookback,
computed from the stale unlocked read of `last_synced_at = NULL`) instead of one day before call
A's own `started_at` (the overlap-based window a locked, fresh read would have produced) — a
genuine natural red against the current ordering, not a manufactured one.

**GREEN evidence (after the fix):**

```
$ uv run pytest -q tests/ingest/test_sync_lock_ordering.py
.                                                                        [100%]
```

Full regression check — `tests/ingest`, `tests/vendor`, `tests/ledger` (166 tests, the areas
touching this lock and its sibling in `sync_events`): all green, no assertion changed.

**Judgement call:** `06-REVIEW.md`'s own Fix section offered two options — move the lock earlier
(what landed), or make the final `last_synced_at` write monotonic
(`SET last_synced_at = GREATEST(last_synced_at, :started_at)`) in `worker/app.py`. The
orchestrator's dispatch prompt scoped this fix explicitly to the first option, matching what the
existing (corrected) docstring now claims and what `sync_events` already does — so
`worker/app.py`'s own unconditional `last_synced_at` write was left untouched, as instructed and
within scope. The test therefore targets the property this fix actually changes (the window
computed by an overlapping call is derived from a locked read, not a stale unlocked one) rather
than an artificial commit-order race on `last_synced_at`'s own value, which is a worker-layer
concern this fix does not touch.

**Commits:**
- `test(06-fix): add failing test for WR-01 sync_user lock ordering` (`cb2673f`)
- `fix(06): acquire sync_user's per-user lock before read_connection` (`9c57013`)

## IN-01 — `procrastinate_jobs` SELECT grant is table-wide, undocumented at its own grant site

**File:** `alembic/versions/0013_procrastinate_defer_grants.py`

**What changed:** Documentation only, as `06-REVIEW.md`'s own Fix section specified ("No code
change needed"). Added a comment directly above the `GRANT INSERT, SELECT ON procrastinate_jobs`
statement explaining why the `SELECT` must be table-wide (Postgres has no `RETURNING`-scoped grant
primitive, and `procrastinate_jobs` carries no RLS policy of its own), what it exposes (a UUID and
an enum value, no secrets, no ciphertext), and that this mirrors the accepted, bounded cross-tenant
read `sync_all_connected_users` already discloses in its own docstring. The grant text itself
(`GRANT INSERT, SELECT ON procrastinate_jobs TO morai_app`) is byte-for-byte unchanged, and no
other grant in the migration was touched.

**No test required:** documentation-only change, no logic to gate against a red. Verified with a
syntax check (`python3 -c "import ast; ast.parse(...)"`) and `ruff check` (both clean), and
confirmed the diff touches only a comment via `git diff`.

**Commit:**
- `fix(06): document IN-01 cross-tenant SELECT scope at its own grant site` (`86b4c23`)

## Verification

Ran from the main worktree, local Postgres 18, migration head `0013` (unchanged):

```
$ uv run pytest -q                 # 383 passed, 36 warnings (pre-existing deprecation warnings,
                                    #   unrelated to this change), exit 0 -- 382 baseline + 1 new
$ bash tools/gate.sh                # ruff clean, basedpyright clean (114 files),
                                    #   mypy clean (114 files), pytest 383 passed, exit 0
```

No assertion in any pre-existing test changed. No file under `salvage/`, `STATE.md`, or
`ROADMAP.md` was touched.

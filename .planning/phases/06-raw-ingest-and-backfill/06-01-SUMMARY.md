---
phase: 06-raw-ingest-and-backfill
plan: 01
subsystem: ingest
tags: [procrastinate, sqlalchemy, rls, schwab, alembic, pydantic]

requires:
  - phase: 04-schwab-connection-and-token-lifecycle
    provides: schwab_client_for_user, upsert_connection/read_connection, the per-user pg_advisory_xact_lock, the SchwabClient/SchwabAuth Protocols and Phase 4's Protocol fake
  - phase: 03-envelope-encryption-and-the-schema-contract
    provides: the per-user DEK (encrypt_field/decrypt_field, _current_dek), the Fill sentinel-gate pattern this plan mirrors for BrokerTransaction
provides:
  - One connected user, one deferred sync_user job, drained by a real Procrastinate worker run, landing one broker_transactions row and its option legs as fills rows -- proving D6-01's execution model end to end
  - broker_transactions table, independent of the derivation pipeline by construction (D6-02): natural (user_id, activity_id) key, FOR ALL RLS, no UPDATE grant, __init__ sentinel gate, AST-scanned single-writer boundary
  - insert_fills retrofitted to ON CONFLICT DO NOTHING with a landed-count return (INGEST-03's idempotency, ahead of plan 06-02)
  - The worker's ingest session routed through morai_app with assert_connection_cannot_bypass_rls as a real call in the code path -- the security finding this phase exists to close
affects: [06-02-scheduled-fan-out-and-idempotent-resync, 06-03-sync-runs-and-manual-resync, 09-reconciliation]

actuals:
  tokens: 6301
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Core batch insert with pg_insert(...).on_conflict_do_nothing().returning(...), one session.execute() per 2,000-row chunk -- both insert_fills and insert_broker_transactions now follow this shape, replacing insert_fills's former session.add()-loop-plus-flush"
    - "A Procrastinate task with no DI framework gets a module-level get_schwab_auth() seam, monkeypatched in tests -- the closest equivalent to FastAPI's dependency_overrides for a plain-function task"
    - "AST-based gate scanners (ast.parse + ast.walk) for multi-line import shapes a line regex cannot see, and for a no-builtin-call prohibition a text search could be fooled by a comment discussing it"

key-files:
  created:
    - alembic/versions/0011_broker_transactions.py
    - src/morai/ingest/__init__.py
    - src/morai/ingest/broker_transactions.py
    - src/morai/ingest/schwab_sync.py
    - tests/ingest/__init__.py
    - tests/ingest/conftest.py
    - tests/ingest/test_sync_tracer.py
    - tests/ingest/test_extract_fills.py
    - tests/ingest/test_broker_transactions_chunking.py
    - tests/gate/fixtures/violation_second_broker_transactions_writer.py
    - tests/gate/test_ingest_write_boundary.py
  modified:
    - src/morai/db/models.py
    - src/morai/identity/account.py
    - src/morai/ledger/fills.py
    - src/morai/settings.py
    - src/morai/worker/app.py
    - tests/identity/conftest.py
    - tests/ledger/test_tracer_encrypted_fill.py
    - tests/crypto/test_nonce_uniqueness.py
    - tests/test_money_column_naming.py
    - tests/gate/test_type_gate.py

key-decisions:
  - "insert_fills and insert_broker_transactions both chunk via one pg_insert(...).values([...]).on_conflict_do_nothing().returning(...) execute per 2,000-row chunk, never session.add()+flush() -- matches the plan's explicit instruction and makes INGEST-03's idempotency (a duplicate composite key is a no-op) hold for both tables identically"
  - "The write-sentinel scanner (test_ingest_write_boundary.py) walks each file's AST for both an ast.Assign (the sentinel's definition, in broker_transactions.py) and an ast.ImportFrom (db/models.py's own local import) -- a line regex, this project's usual convention for import-boundary scanners, cannot see the sentinel because db/models.py's import is deliberately multi-line, the same shape Fill.__init__ already uses"
  - "get_schwab_auth() is a new module-level seam in worker/app.py, monkeypatched by the tracer test -- Procrastinate tasks are plain functions with no dependency-injection framework, so this mirrors api/routes_connections.py::get_schwab_auth's FastAPI dependency_overrides convention as closely as a non-FastAPI process can"
  - "Round-trip counting for the chunking test uses a Core-level before_cursor_execute connection event, not Session before_flush/after_flush -- measured this session: the ORM flush events never fire for a Core session.execute(pg_insert(...)) call, since no object is ever added to the session's identity map"

patterns-established:
  - "A table meant to be a Phase-9 comparison source independent of the derivation pipeline gets: a natural composite primary key (never a hashed surrogate, WR-A3), a FOR ALL RLS policy (never INSERT-only, V092), no UPDATE grant, and a constructor sentinel gate scanned by both an AST-Assign and an AST-ImportFrom check"

requirements-completed: [INGEST-02, OPS-05]

coverage:
  - id: D1
    description: "One deferred sync_user job, drained by a real Procrastinate worker run, lands one broker_transactions row and two fills rows for one user; the job's session cannot bypass RLS; a user with no connection writes nothing"
    requirement: "INGEST-02"
    verification:
      - kind: integration
        ref: "tests/ingest/test_sync_tracer.py#test_sync_user_job_lands_one_broker_transaction_and_two_fills"
        status: pass
      - kind: integration
        ref: "tests/ingest/test_sync_tracer.py#test_missing_connection_fails_the_job_and_writes_nothing"
        status: pass
    human_judgment: false
  - id: D2
    description: "Direction comes from the vendor's own signed amount (with a cost-sign fallback), position_effect is preserved verbatim, and the absolute-value builtin is unreachable in the extraction module"
    requirement: "INGEST-02"
    verification:
      - kind: unit
        ref: "tests/ingest/test_extract_fills.py#test_direction_from_signed_amount_or_cost_fallback"
        status: pass
      - kind: unit
        ref: "tests/ingest/test_extract_fills.py#test_extraction_module_never_calls_the_absolute_value_builtin"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both write paths chunk at 2,000 rows with the arithmetic derived from the real column count, and a second writer into broker_transactions fails both type checkers by rule code"
    requirement: "OPS-05"
    verification:
      - kind: integration
        ref: "tests/ingest/test_broker_transactions_chunking.py#test_2001_rows_land_across_more_than_one_insert"
        status: pass
      - kind: integration
        ref: "tests/gate/test_type_gate.py#test_checker_rejects_fixture_with_expected_marker[basedpyright-second_broker_transactions_writer-reportCallIssue]"
        status: pass
    human_judgment: false

duration: ~75min
completed: 2026-09-01
status: complete
---

# Phase 6 Plan 1: Raw Ingest Tracer Summary

**One deferred `sync_user` job, drained by a real Procrastinate worker run through the `morai_app` role, lands one Schwab TRADE as one `broker_transactions` row and two `fills` rows -- proving D6-01's execution model and closing the RLS-bypass security finding this phase exists to fix.**

## Performance

- **Duration:** ~75 min (no literal start timestamp was captured before the initial read pass; this is an honest estimate, not a measured figure)
- **Completed:** 2026-09-01T13:01:45Z
- **Tasks:** 3 (all executed; Tasks 2 and 3 landed green on arrival against Task 1's implementation)
- **Files modified:** 21 (11 created, 10 modified)

## Accomplishments

- Migration 0011 lands `broker_transactions`: natural `(user_id, activity_id)` primary key (never a hashed surrogate -- WR-A3's exact production incident forbids it by name in the migration docstring), `FOR ALL` RLS (not INSERT-only, `V092`), no `UPDATE` grant (immutable table).
- `src/morai/ingest/broker_transactions.py`: the table's one write path -- `insert_broker_transactions`, chunked at 2,000 rows, `ON CONFLICT DO NOTHING` on the full primary key, its own `_write_token` sentinel gate on `BrokerTransaction.__init__`.
- `src/morai/ingest/schwab_sync.py`: the typed vendor boundary (`_Transaction`/`_TransferItem`/`_Instrument`, extras ignored -- the whole element is stored verbatim in `broker_transactions` regardless of type); `extract_fills` (direction from the vendor's own signed `amount`, a `cost`-sign fallback, never `abs()`); `sync_windows` (pure chunker); the `sync_user` shell writing both tables from one `get_transactions` response in one transaction.
- `src/morai/ledger/fills.py::insert_fills` retrofitted from a `session.add()`+`flush()` loop to the same `pg_insert(...).on_conflict_do_nothing().returning(...)` shape, returning the landed count -- ahead of plan 06-02's own idempotency requirement (INGEST-03), because the plan's own action text required it in this same commit.
- `src/morai/worker/app.py::sync_user_task`: opens its session from `get_app_engine()` (via `get_session_maker()`), calls `assert_connection_cannot_bypass_rls` before touching a protected table -- a real call in the code path, not a comment. `get_schwab_auth()` is a new monkeypatch seam mirroring `routes_connections.py`'s own FastAPI `dependency_overrides` convention, since a Procrastinate task has no DI framework of its own.
- An AST-based single-writer scanner (`tests/gate/test_ingest_write_boundary.py`) proves exactly two tracked modules touch the sentinel -- its definition site and the one legitimate importer -- walking `ast.Assign`/`ast.ImportFrom` rather than a line regex, because the real import in `db/models.py` is deliberately multi-line.

## Task Commits

1. **Task 1: One transaction end to end** -- RED: `e4fed73` (`test(06-01-01)`), GREEN: `b4b09ec` (`feat(06-01-01)`)
2. **Task 2: Raw fidelity** -- `9609392` (`test(06-01-02)`) -- green on arrival, no companion feat
3. **Task 3: The ceiling and the gate** -- `b069275` (`test(06-01-03)`) -- green on arrival, no companion feat

_TDD note: Task 1's RED was verified as a genuine, unmanufactured red -- `src/morai/ingest/` and `alembic/versions/0011_broker_transactions.py` were temporarily moved out of the tree, `uv run pytest tests/ingest/` was run and observed to fail collection with `ModuleNotFoundError: No module named 'morai.ingest'` (quoted from the real run, in `e4fed73`'s own commit message), then both were restored before the GREEN commit. Tasks 2 and 3 were genuinely green against Task 1's already-correct implementation on first run -- documented as such per the plan's own red-ceremony rule, with no manufactured red._

## Files Created/Modified

- `alembic/versions/0011_broker_transactions.py` -- the table, `FOR ALL` RLS, no `UPDATE`
- `src/morai/db/models.py` -- `BrokerTransaction`, mirroring `Fill.__init__`'s sentinel gate
- `src/morai/ingest/broker_transactions.py` -- the one write path, 2,000-row chunks
- `src/morai/ingest/schwab_sync.py` -- typed boundary, `extract_fills`, `sync_windows`, `sync_user`
- `src/morai/ledger/fills.py` -- `insert_fills` retrofit (`ON CONFLICT DO NOTHING`, landed-count return)
- `src/morai/settings.py` -- three D6-03 settings, marked unverified in their own comment
- `src/morai/worker/app.py` -- `sync_user` task, `get_schwab_auth()` seam, updated pool-budget docstring
- `src/morai/identity/account.py` -- `broker_transactions` added to `delete_account`'s crypto-shred block
- `tests/ingest/` (new package) -- conftest with `TxFakeSchwabAuth`, tracer, extraction, chunking tests
- `tests/gate/test_ingest_write_boundary.py` + `violation_second_broker_transactions_writer.py` -- the AST single-writer scanner and its negative-control fixture
- `tests/identity/conftest.py`, `tests/ledger/test_tracer_encrypted_fill.py`, `tests/crypto/test_nonce_uniqueness.py`, `tests/test_money_column_naming.py`, `tests/gate/test_type_gate.py` -- updated for the new schema (see Deviations)

## Decisions Made

- **`insert_fills`'s duplicate-key test changed meaning, not just its assertion.** `test_duplicate_composite_key_raises_integrity_error` asserted `pytest.raises(IntegrityError)` before this plan; the plan's own action text mandates `ON CONFLICT DO NOTHING` on `insert_fills` in this same commit, which makes a duplicate composite key a silent no-op instead. Renamed to `test_duplicate_composite_key_is_a_no_op` and reasserts the new, correct behavior (first call lands 1, second lands 0, exactly one row on disk).
- **Round-trip counting for the chunking test uses a connection-level event, not a session-level one.** Measured directly this session: `before_flush`/`after_flush` never fire for a Core `session.execute(pg_insert(...))` call (confirmed empirically -- see Deviations). `before_cursor_execute` on the underlying sync `Engine` (`session.get_bind()` returns it directly for an `AsyncSession`) counts real round-trips regardless of ORM/Core shape.
- **The write-boundary scanner walks two AST node kinds, not one.** `broker_transactions.py` *defines* the sentinel, it does not import it; `db/models.py` imports it. A pure import-only scan (matching `test_vendor_boundary.py`'s own `_VENDOR_IMPORT` regex shape) would find only one of the two legitimate touchpoints the plan's own action text asks for. Scanning for `ast.Assign` (definition) and `ast.ImportFrom` (import) finds both.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `insert_fills`'s duplicate-key test asserted the pre-retrofit behavior**
- **Found during:** Task 1, running the full suite after retrofitting `insert_fills`
- **Issue:** `tests/ledger/test_tracer_encrypted_fill.py::test_duplicate_composite_key_raises_integrity_error` asserted `pytest.raises(IntegrityError)` on a duplicate insert -- exactly the behavior the plan's own action text requires `insert_fills` to stop having (`ON CONFLICT DO NOTHING`, ahead of INGEST-03)
- **Fix:** Renamed to `test_duplicate_composite_key_is_a_no_op`; asserts the first call lands 1 row, the second lands 0, and exactly one row exists after both
- **Files modified:** `tests/ledger/test_tracer_encrypted_fill.py`
- **Verification:** `uv run pytest tests/ledger/test_tracer_encrypted_fill.py -q` -- 8 passed
- **Committed in:** `e4fed73` (test commit)

**2. [Rule 3 - Blocking] The nonce-collision drift guard did not name the new table's nonce column**
- **Found during:** Task 1, full-suite run
- **Issue:** `tests/crypto/test_nonce_uniqueness.py::test_nonce_column_drift_guard_matches_the_union_query` failed -- `broker_transactions.raw_nonce` is a genuine per-user-DEK-domain nonce column (same domain as `fills`/`events`/`schwab_connections`) that `_NONCE_COLLISION_QUERY`'s `UNION ALL` and `_EXPECTED_NONCE_COLUMNS` did not yet cover
- **Fix:** Added a `UNION ALL` branch for `broker_transactions.raw_nonce` to `_NONCE_COLLISION_QUERY`, and the `(broker_transactions, raw_nonce)` tuple to `_EXPECTED_NONCE_COLUMNS`
- **Files modified:** `tests/crypto/test_nonce_uniqueness.py`
- **Verification:** `uv run pytest tests/crypto/test_nonce_uniqueness.py -q` -- 8 passed
- **Committed in:** `e4fed73` (test commit)

**3. [Rule 3 - Blocking] The money-column unit-suffix gate flagged `raw_ciphertext`/`raw_nonce`**
- **Found during:** Task 1, full-suite run
- **Issue:** `tests/test_money_column_naming.py::test_real_schema_names_every_money_column` flagged `broker_transactions.raw_ciphertext`/`raw_nonce` as money-carrying `LargeBinary` columns missing a `_usd`/`_pts` unit suffix. Neither carries a single unit -- the column is the whole raw vendor element (money and non-money fields alike) serialized as one JSON blob, the same shape `schwab_connections.token_ciphertext` is already exempted for
- **Fix:** Added `broker_transactions.raw_ciphertext`/`raw_nonce` to `_UNIT_EXEMPT_BINARY_COLUMNS` with a comment citing the reasoning
- **Files modified:** `tests/test_money_column_naming.py`
- **Verification:** `uv run pytest tests/test_money_column_naming.py -q` -- 4 passed
- **Committed in:** `e4fed73` (test commit)

**4. [Rule 3 - Blocking] `identity/conftest.py`'s truncate list did not include the new table**
- **Found during:** Task 1, writing `tests/ingest/conftest.py`
- **Issue:** `clean_identity_tables`'s `TRUNCATE TABLE` list predates `broker_transactions`; without it, ingest tests would leak rows across runs
- **Fix:** Added `broker_transactions` to the truncate list
- **Files modified:** `tests/identity/conftest.py`
- **Verification:** full suite green, no cross-test leakage observed
- **Committed in:** `e4fed73` (test commit)

**5. [Rule 1 - Bug] `AsyncSession.execute`'s own overloaded, internally-typed signature made a monkeypatch-based round-trip counter untypeable without an explicit `Any`**
- **Found during:** Task 3, writing the chunking test's round-trip counter
- **Issue:** The first design wrapped `session.execute` directly with a `*args: object, **kwargs: object` shim and called through to the real bound method -- basedpyright reported `reportCallIssue`/`reportUnknownVariableType` against `AsyncSession.execute`'s own overloaded, internally-aliased signature (`_CoreAnyExecuteParams`, `OrmExecuteOptionsParameter`), and no clean suppression-free typing was achievable
- **Fix:** Switched the counting mechanism to a `before_cursor_execute` connection-level event on the session's underlying sync `Engine` (`session.get_bind()`), which SQLAlchemy types as a plain `str` for the SQL text -- no `Any`, no suppression, and it counts real round-trips regardless of ORM/Core call shape (measured this session: `before_flush`/`after_flush` never fire for a Core `session.execute(pg_insert(...))` call at all, since nothing is added to the identity map)
- **Files modified:** `tests/ingest/test_broker_transactions_chunking.py`
- **Verification:** `uv run basedpyright tests/ingest/test_broker_transactions_chunking.py` -- 0 errors; `uv run pytest tests/ingest/test_broker_transactions_chunking.py -q` -- 3 passed
- **Committed in:** `b069275` (test commit)

**6. [Rule 3 - Blocking] The write-boundary scanner's first design (line regex, `ast.ImportFrom`-only) could not see the model's own multi-line import**
- **Found during:** Task 3, first run of `test_ingest_write_boundary.py`
- **Issue:** `db/models.py::BrokerTransaction.__init__` imports the sentinel across three lines (`from ... import (\n    _TOKEN,\n)`), the same shape `Fill.__init__` already uses. An `ast.ImportFrom`-only scan correctly found `db/models.py` but never found `broker_transactions.py` itself, since that module *defines* the sentinel rather than importing it -- the plan's own action text asks for exactly two allowed paths
- **Fix:** The scanner now walks both `ast.Assign` (catches the definition, in `broker_transactions.py`) and `ast.ImportFrom` (catches the import, in `db/models.py`)
- **Files modified:** `tests/gate/test_ingest_write_boundary.py`
- **Verification:** `uv run pytest tests/gate/test_ingest_write_boundary.py -q` -- 5 passed, including the negative controls
- **Committed in:** `b069275` (test commit)

---

**Total deviations:** 6 auto-fixed (4 Rule 3 - blocking pre-existing gates against the new schema, 1 Rule 3 - blocking test-tooling typing, 1 Rule 1 - bug in the scanner's own coverage).
**Impact on plan:** All six were necessary to make the plan's own explicit instructions (retrofit `insert_fills`, add `broker_transactions`, gate its single writer) pass the project's existing invariant suite. No scope creep -- nothing outside this plan's own file list was touched except the test files these gates live in.

## Issues Encountered

None beyond the deviations above.

## User Setup Required

**External service requires manual configuration.** See [06-USER-SETUP.md](./06-USER-SETUP.md) if generated by the orchestrator, or configure directly: the Railway **worker** service now requires `MORAI_APP_DB_PASSWORD` (the same value already set on the `web` service), declared via this plan's frontmatter `user_setup` block. Without it, the worker boots but every `sync_user` job fails at `get_app_engine()` construction. Declare it with `preserve()` in `.railway/railway.ts` alongside the web service's own declaration.

## Next Phase Readiness

Ready for plan 06-02 (scheduled fan-out and idempotent resync) and 06-03 (sync-run records and manual resync) -- both build directly on `sync_user`, `insert_broker_transactions`, and the retrofitted `insert_fills` landed here.

**Facts this plan could not verify without a live Schwab connection -- each owed to the first live run, not guessed here:**

- **The real per-call transaction range limit.** `D6-03`'s carried-forward `SCHWAB_TX_MAX_RANGE_DAYS = 60` is the installed `schwab-py` 1.5.1 SDK's own default/docstring claim, not a value confirmed against Schwab's real API. `sync_user` logs the requested window bounds and the returned element count on every call (`logger.info("sync_user user_id=%s window=%s..%s elements=%d", ...)`), which is the instrument the first live run reads.
- **The real rate limit on `get_transactions`.** Unmeasured this session; only observable once several connected users' fan-out (plan 06-02) runs against the live vendor.
- **`activityId`'s real uniqueness guarantee.** The `(user_id, activity_id)` primary key is built to be safe either way (`NN-1`) -- if Schwab's `activityId` is not in fact unique per user, the first live-run `IntegrityError` on this constraint (or, since the conflict clause is `DO NOTHING`, a silently-absorbed row) is the measurement that closes this question, per `06-RESEARCH.md`'s own Open Question 1.
- **Whether `transferItems[].price` is the right source field for `price_usd`.** Assumption A3 in `06-RESEARCH.md` -- recalled, not cited from any source read this session. Confirm against the first live payload.
- **The real OCC symbol spacing Schwab sends.** `extract_fills` strips all spaces (`instrument.symbol.replace(" ", "")`) on the assumption Schwab pads with spaces the way the test fixture's `"SPXW  260618P07275000"` does; no live payload has confirmed this.
- **The `cost`-sign fallback (`_direction`'s second branch).** Carried from `salvage/vendor-notes.md`'s citation of the deleted v1 adapter, unverified against a live payload this session. Exercised by `tests/ingest/test_extract_fills.py`'s own parametrized cases, but only against synthetic data.

---
*Phase: 06-raw-ingest-and-backfill*
*Plan: 01*
*Completed: 2026-09-01*

## Self-Check: PASSED

- All 13 files listed under Key Files (created/modified) confirmed present on disk with `[ -f ]`/`ls`.
- All 4 commit hashes (`e4fed73`, `b4b09ec`, `9609392`, `b069275`) confirmed present via `git log --oneline --all`.
- Full suite (`bash tools/gate.sh`): 351 passed, exit 0, 48.31s wall-clock.
- Migration reversibility (`uv run alembic downgrade 0010` then `upgrade head`): both exit 0.

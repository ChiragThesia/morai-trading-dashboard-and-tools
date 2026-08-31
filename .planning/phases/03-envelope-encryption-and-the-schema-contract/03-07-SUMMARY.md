---
phase: 03-envelope-encryption-and-the-schema-contract
plan: 07
subsystem: database
tags: [alembic, migration, rls, encryption, sqlalchemy, postgres, decimal]

# Dependency graph
requires:
  - phase: 03-06
    provides: "the isolation and Decimal proofs repointed onto positions/legs/fills/events/user_data_keys and observed green -- the gate this plan's drop was blocked on"
  - phase: 03-04
    provides: "src/morai/identity/account.py's delete_account() and the GateUserScopedProbe FK-cleanup step this plan removes"
provides:
  - "migration 0009 -- drops gate_money_probe and gate_user_scoped_probe, reversibly, discharging the obligation db/models.py carried since Phase 1/Phase 2"
  - "tests/test_money_roundtrip.py's Decimal round-trip proof, repointed onto insert_fills/read_fills (encrypted) plus the UsdField JSON leg and a precision-rejection check"
  - "tests/test_money_column_naming.py's unit-suffix gate, widened to LargeBinary (ciphertext/nonce) columns with an explicit unit-exempt list and a widened vacuity guard"
affects: [phase-5, phase-6, phase-9]

# Actuals (#2632) -- pairs with the plan's estimate to calibrate future estimates.
# Same estimateTokens scale (chars/4 over the realized diff), never a harness token count.
actuals:
  tokens: 6162
  tasks: 3
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A unit-suffix check that walks SQLAlchemy's in-memory MetaData now checks LargeBinary columns as well as Numeric ones, with an explicit enumerated exemption list (key material, dimensionless quantities) rather than pattern-matching around them -- D3-12's 'the unit is a property of the value, not its storage type' generalized past NUMERIC."
    - "A retired money round-trip route's proof moves onto a local Pydantic model built from the same UsdField/StrictDecimalField the route used, rather than reaching for the route's own now-deleted request/response models -- keeps the JSON-leg proof alive independent of any one endpoint."

key-files:
  created:
    - alembic/versions/0009_drop_gate_probe_tables.py
  modified:
    - src/morai/db/models.py
    - src/morai/api/app.py
    - src/morai/api/models.py
    - src/morai/worker/app.py
    - src/morai/identity/account.py
    - tests/conftest.py
    - tests/test_money_roundtrip.py
    - tests/test_money_column_naming.py
    - tests/identity/test_app_role.py
    - tests/test_decimal_canary.py

key-decisions:
  - "src/morai/identity/account.py was edited even though it is not in this plan's own files_modified list -- 03-04 added a delete(GateUserScopedProbe) step to delete_account() to clear a foreign key the probe table carried, and dropping the table in this plan without also touching that import/statement would break every test in the suite (an unconditional ImportError on module load, not a narrow test failure). Removed the import and the delete statement; the module docstring now explains why the step existed and why its justification is gone, rather than deleting the reasoning silently."
  - "tests/test_decimal_canary.py's docstring (not in files_modified) was updated in Task 3 -- it named POST /gate/money-roundtrip as 'the route this canary guards', which became stale the moment that route was removed in the same task. A one-paragraph accuracy fix (Rule 1), not new scope: the canary's own assertions are unchanged."
  - "The money round-trip's JSON-leg proof and its precision-rejection proof are built from local, test-only Pydantic models (_MoneyValue, _MoneyValueWithSchema) wrapping UsdField, rather than reusing the retired MoneyRoundtripRequest/Response -- those classes are deleted in Task 3, and Task 1's own files_modified list is test-only, so the JSON-leg proof needed to stand on morai.money.api_types.UsdField directly to survive past Task 3."
  - "tests/test_money_roundtrip.py's DB-backed test reuses tests.ledger.conftest's provisioned_users/app_db_session/superuser_db_session fixtures (the established convention tests/test_crypto_shred.py and tests/test_key_rotation.py already use for a top-level test file) for the write and the seeded user/data-key setup, and tests/conftest.py's own renamed db_session fixture -- a genuinely separate engine -- for the independent read-back, so 'a connection independent of the writer's own' is a literal second engine, not merely a second fixture wrapping the same one."

requirements-completed: [CRYPT-02, CRYPT-03]

coverage:
  - id: D1
    description: "gate_money_probe and gate_user_scoped_probe are dropped by an explicit, reversible migration (0009); the module docstring in db/models.py records the discharged obligation instead of restating it as still owed"
    requirement: CRYPT-02
    verification:
      - kind: other
        ref: "alembic upgrade head -> alembic downgrade -1 -> alembic upgrade head, exercised locally against Postgres 18; downgrade confirmed to recreate both tables with their original columns, RLS enable+force, policy (user_isolation) and grants via a direct pg_catalog query"
        status: pass
      - kind: integration
        ref: "tests/identity/test_app_role.py#test_rls_enable_and_force_match_the_migration (gate_user_scoped_probe row removed; the five phase-3 tables cover the same shape)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Decimal round-trip proof survives the drop and covers a longer trip: Decimal -> insert_fills (AES-GCM encrypt) -> Postgres bytea -> read_fills (decrypt) on an independent connection -> the same Decimal, plus the JSON leg through UsdField and a precision-rejection check"
    requirement: CRYPT-03
    verification:
      - kind: integration
        ref: "tests/test_money_roundtrip.py#test_decimal_survives_the_encrypted_fill_path_and_an_independent_read[9999999999.9999|1234567890.1234]"
        status: pass
      - kind: unit
        ref: "tests/test_money_roundtrip.py#test_the_json_leg_survives_the_strict_decimal_boundary"
        status: pass
      - kind: unit
        ref: "tests/test_money_roundtrip.py#test_a_value_with_more_precision_than_the_schema_allows_is_rejected"
        status: pass
      - kind: unit
        ref: "tests/test_decimal_canary.py (3 tests, docstring repointed off the retired route)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The unit-suffix gate covers ciphertext money columns as well as NUMERIC ones, with an explicit exemption list for key material and a dimensionless quantity, and the vacuity guard counts both column types so it cannot pass vacuously once no Numeric column remains"
    requirement: CRYPT-02
    verification:
      - kind: unit
        ref: "tests/test_money_column_naming.py#test_real_schema_names_every_money_column"
        status: pass
      - kind: unit
        ref: "tests/test_money_column_naming.py#test_fills_price_usd_ciphertext_passes"
        status: pass
      - kind: unit
        ref: "tests/test_money_column_naming.py#test_unsuffixed_numeric_column_is_reported"
        status: pass
      - kind: unit
        ref: "tests/test_money_column_naming.py#test_unsuffixed_binary_money_column_is_reported"
        status: pass
    human_judgment: false
  - id: D4
    description: "No executable reference to either probe table or model remains anywhere in src/, tests/ or tools/ -- only historical prose (docstrings/comments) and the migrations that created and dropped the tables (0001, 0003, 0009)"
    requirement: CRYPT-02
    verification:
      - kind: other
        ref: "grep -rn 'GateMoneyProbe|GateUserScopedProbe|gate_money_probe|gate_user_scoped_probe' src tests tools -- every remaining match is inside a docstring/comment or a migration file"
        status: pass
    human_judgment: false
  - id: D5
    description: "The loss of the deployed money-round-trip surface (POST /gate/money-roundtrip, the only proof of OPS-03 against the live Railway service) is stated plainly, not softened, and no replacement surface is invented"
    requirement: CRYPT-03
    verification: []
    human_judgment: true
    rationale: "Whether the SUMMARY and docstrings (src/morai/api/app.py, tests/test_money_roundtrip.py) state this loss plainly rather than softening it is a prose-quality judgment, not something a test can assert. No automated check for 'stated plainly' is meaningful here."

duration: ~20min
completed: 2026-08-31
status: complete
---

# Phase 3 Plan 7: Migration 0009 Drops Both Gate Probe Tables Summary

**`gate_money_probe` and `gate_user_scoped_probe` are dropped by a reversible migration (0009); the Decimal round-trip proof moves onto the encrypted `insert_fills`/`read_fills` path plus a `UsdField` JSON-leg and precision-rejection check; the unit-suffix gate now covers `LargeBinary` ciphertext columns with a widened vacuity guard -- and `POST /gate/money-roundtrip`'s loss as the only proof of OPS-03 on the deployed Railway service is recorded, not replaced.**

## Performance

- **Duration:** ~20 min (commit-to-commit span; git log shows 11:44:22 to 12:03:07 local time)
- **Started:** 2026-08-31
- **Completed:** 2026-08-31
- **Tasks:** 3
- **Files modified:** 11 (1 created, 10 modified -- 2 of the 10, `src/morai/identity/account.py` and `tests/test_decimal_canary.py`, were unplanned but required, see Decisions below)

## Accomplishments

- **`alembic/versions/0009_drop_gate_probe_tables.py`**, `down_revision = "0008"`. `upgrade()` drops the `user_isolation` policy, revokes both tables' grants (including `gate_money_probe`'s sequence grant), then drops both tables. `downgrade()` recreates both with their original columns, RLS enable+force, policy and grants -- exercised locally against Postgres 18 both ways (`alembic upgrade head` -> `alembic downgrade -1` -> `alembic upgrade head`), with the downgrade's recreated state confirmed directly against `pg_catalog`/`pg_policies`/`has_table_privilege`, and the full suite green after the final upgrade.
- **`src/morai/db/models.py`**: `GateMoneyProbe` and `GateUserScopedProbe` removed. The module docstring no longer instructs a future reader to drop these tables -- it records that the obligation existed and was discharged, and points at migration 0009 and plan 03-06 (which moved the proofs first) for the history.
- **`src/morai/api/app.py`** / **`src/morai/api/models.py`**: `POST /gate/money-roundtrip` and its `MoneyRoundtripRequest`/`MoneyRoundtripResponse` models removed. This is the one surface that proved `OPS-03` on the *deployed* Railway service rather than only in CI, and it is not replaced here -- a deployed money surface belongs to Phase 5's read API or Phase 6's ingest, both out of this phase's scope. Stated plainly in `app.py`'s own module docstring and in this SUMMARY (T-03-37, accepted per the plan's threat register as T-03-39).
- **`tests/test_money_roundtrip.py`**: repointed onto `insert_fills`/`read_fills`. The round trip it now proves is strictly longer than the retired one: `Decimal` -> `str` -> UTF-8 bytes -> AES-GCM ciphertext -> Postgres `bytea` -> decryption -> `Decimal`, read back through `read_fills` on `tests/conftest.py`'s `db_session` fixture -- a genuinely separate engine from the one that wrote the row, via `tests.ledger.conftest`'s `app_db_session`. A local `_MoneyValue` model (wrapping `UsdField`) proves the JSON leg survives independent of any route; a second local model with `Field(max_digits=14, decimal_places=4)` proves an over-precise value is rejected, not silently rounded.
- **`tests/test_money_column_naming.py`**: the unit-suffix walker now covers `LargeBinary` columns ending in `_ciphertext`/`_nonce`, with `_UNIT_EXEMPT_BINARY_COLUMNS` naming the two binary columns that carry no unit at all (`user_data_keys.wrapped_dek`/`wrap_nonce` -- key material; `fills.quantity_ciphertext`/`quantity_nonce` -- a dimensionless count). The vacuity guard (`_money_column_count`) now counts both column types, so it cannot pass vacuously once `gate_money_probe.amount_usd` -- the schema's only remaining `Numeric` column -- is gone. `test_gate_money_probe_amount_usd_passes` is replaced by `test_fills_price_usd_ciphertext_passes`; a new negative control (`test_unsuffixed_binary_money_column_is_reported`) proves the `LargeBinary` half of the check has teeth.
- **`src/morai/identity/account.py`** (unplanned, required -- see Decisions): the `GateUserScopedProbe` import and its `delete(...)` step removed from `delete_account()`; the module docstring explains that the foreign key which made the step necessary is gone with the table, not merely that the step is no longer needed.
- **`tests/identity/test_app_role.py`**: `gate_user_scoped_probe`'s row removed from the RLS enable/force parametrize -- the five phase-3 tables 03-06 added already cover the same shape.
- **`src/morai/worker/app.py`**: stale `gate_money_probe` mention removed from the heartbeat task's docstring.
- **Confirmed by grep**: `GateMoneyProbe|GateUserScopedProbe|gate_money_probe|gate_user_scoped_probe` across `src/`, `tests/`, `tools/` now resolves to historical prose only (docstrings/comments explaining the move) and the three migrations that created/dropped the tables (0001, 0003, 0009) -- no executable reference, import, or ORM model remains.

## Task Commits

1. **Task 1: the Decimal round-trip moves onto the real money path** - `51a0d04` (test)
2. **Task 2: the unit suffix survives onto ciphertext columns** - `7278fdf` (test, RED) + `a5e06c6` (feat, GREEN)
3. **Task 3: drop both probe tables and their models** - `891e414` (feat)

_All three tasks carried `tdd="true"`. Task 1's repointed test passed green on first run against the real Postgres/encryption stack -- a regression guard for existing, proven infrastructure (`insert_fills`/`read_fills`, `tests.ledger.conftest`'s fixtures), the same "green on arrival" pattern 03-06's own summary names for a move rather than new behavior; no scaffolding was built to force a more interesting failure. Task 2 took a genuine RED (`test_unsuffixed_binary_money_column_is_reported` failed with `AssertionError: [] == ['synthetic_probe.amount_ciphertext']` before the walker was widened) and a genuine GREEN after widening it. Task 3's own natural-red instruction ("run the suite with the models removed and before the migration is applied") could not be observed as written: `tests/conftest.py`'s session-scoped `migrated_db` fixture runs `alembic upgrade head` automatically the moment any DB-marked test collects, so by the time the first DB test in this session ran, migration 0009 was already applied -- the code-removal and the migration-application steps are not separable through this test harness. Confirmed by direct `alembic current` check (reported `0009 (head)` immediately after the model removal, before I had run `alembic upgrade head` myself). This is reported honestly rather than papered over; no scaffolding was built to force the two apart._

## Files Created/Modified

- `alembic/versions/0009_drop_gate_probe_tables.py` - the drop, reversible
- `src/morai/db/models.py` - `GateMoneyProbe`/`GateUserScopedProbe` removed, docstring updated
- `src/morai/api/app.py` - `POST /gate/money-roundtrip` removed
- `src/morai/api/models.py` - `MoneyRoundtripRequest`/`MoneyRoundtripResponse` removed
- `src/morai/worker/app.py` - stale docstring mention removed
- `src/morai/identity/account.py` - `GateUserScopedProbe` cleanup step removed (unplanned, required)
- `tests/conftest.py` - `clean_gate_money_probe` renamed `clean_fills_table`, repointed at `fills`
- `tests/test_money_roundtrip.py` - repointed onto the encrypted fill path
- `tests/test_money_column_naming.py` - widened to `LargeBinary` columns
- `tests/identity/test_app_role.py` - `gate_user_scoped_probe` row removed from parametrize
- `tests/test_decimal_canary.py` - docstring accuracy fix (unplanned, minor)

## Decisions Made

- **`src/morai/identity/account.py` edited despite not being in this plan's `files_modified`.** Verified by the orchestrator before dispatch (see plan prompt's coupling note): 03-04 added a `delete(GateUserScopedProbe)` step to clear a foreign key the probe table carried. Dropping the table without also removing this import/statement breaks module import for the whole test suite, not one narrow test. Fixed as part of Task 3; docstring records why the step existed and why it left.
- **`tests/test_decimal_canary.py` docstring updated**, also outside `files_modified`. It named the now-removed route as "the route this canary guards" -- stale the instant Task 3 removed that route. A one-paragraph fix; the file's actual assertions (bit-inexactness through `float`) are untouched.
- **The JSON-leg and precision-rejection proofs use local, test-only Pydantic models** (`_MoneyValue`, `_MoneyValueWithSchema`) wrapping `UsdField` directly, rather than the retired `MoneyRoundtripRequest`/`Response` -- those classes don't exist after Task 3, and Task 1's `files_modified` is test-only, so the proof needed to stand on `morai.money.api_types.UsdField` itself to survive the whole plan.
- **The independent-connection read-back reuses two separate fixture ecosystems deliberately**: `tests.ledger.conftest`'s `app_db_session`/`provisioned_users` (the established multi-file convention `tests/test_crypto_shred.py` and `tests/test_key_rotation.py` already use for a top-level test file) for the write and setup, and `tests/conftest.py`'s own renamed `db_session` fixture -- a literal second engine -- for the read. This makes "a connection independent of the writer's own" true in the strongest sense available, not merely a second fixture over the same DSN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Ruff line-length violations in two new test functions**
- **Found during:** Task 1's and Task 2's full-suite/gate runs
- **Issue:** A long async test function name in `tests/test_money_roundtrip.py` (91 chars including signature) and a chained boolean expression in `tests/test_money_column_naming.py` (91 chars) both exceeded ruff's 88-character line limit, caught by `tests/gate/test_type_gate.py::test_fixtures_excluded_from_real_gate_run`'s own real `ruff check` invocation.
- **Fix:** Shortened the test function name (`test_decimal_survives_insert_fills_encryption_postgres_and_an_independent_read` -> `test_decimal_survives_the_encrypted_fill_path_and_an_independent_read`); reformatted the boolean expression across three lines.
- **Files modified:** `tests/test_money_roundtrip.py`, `tests/test_money_column_naming.py`
- **Verification:** `bash tools/gate.sh` green after each fix.
- **Committed in:** `51a0d04`, `a5e06c6` (part of each task's own commit)

**2. [Rule 2 - Missing critical] `src/morai/identity/account.py`'s `GateUserScopedProbe` import and delete step**
- **Found during:** Reading the orchestrator's coupling note before starting Task 3 (not discovered mid-task -- flagged in advance)
- **Issue:** Dropping `GateUserScopedProbe` from `db/models.py` without also removing this file's import of it and its `delete(GateUserScopedProbe)` statement would break module import for the entire application and test suite.
- **Fix:** Removed the import and the delete statement; updated the module docstring and `delete_account()`'s own step-3 docstring to explain why the step existed and why its justification is now gone, per the orchestrator's explicit instruction not to delete the reasoning silently.
- **Files modified:** `src/morai/identity/account.py`
- **Verification:** Full local suite green (243 passed); `bash tools/gate.sh` green.
- **Committed in:** `891e414` (part of Task 3's commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical). **Impact on plan:** Both necessary for correctness -- the line-length fixes are cosmetic and confined to the new test code; the `account.py` fix is required for the application to import at all once the model is removed. No scope creep beyond what dropping two production tables directly requires.

## Issues Encountered

**Task 3's prescribed "natural red" could not be observed as literally described.** The plan's instruction was to "run the suite with the models removed and before the migration is applied, and take the resulting failures as the red." In practice, `tests/conftest.py`'s session-scoped `migrated_db` fixture runs `alembic upgrade head` automatically the first time any DB-marked test is collected in a session -- so the instant I ran the suite after removing the models, migration 0009 was already being applied as a side effect, and `alembic current` confirmed `0009 (head)` before I had manually run `alembic upgrade head` myself. The suite passed green on that first run; there was no separable "models removed, migration not yet applied" window to observe a natural failure in. Reported honestly per this project's own rule against manufacturing scaffolding to produce a more satisfying red -- no workaround was built to force the two states apart.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Every carried obligation this phase inherited from Phase 1/Phase 2 (`GateMoneyProbe`/`GateUserScopedProbe`, both named explicitly in their own docstrings as temporary) is discharged. `03-VALIDATION.md`'s "Carried Obligation" section is fully resolved.
- The Decimal round-trip and unit-suffix proofs both now run against the real, permanent schema (`fills`, `events`, `user_data_keys`) rather than retired probe tables -- there is no remaining test in the suite whose passing depends on scaffolding from an earlier phase.
- **Deployed money round-trip coverage on the live Railway service is genuinely absent** until Phase 5's read API or Phase 6's ingest lands a real endpoint that can carry the same proof. This is the one open item this plan deliberately does not close (T-03-39, accepted).
- This is the final plan of Phase 3 (`03-envelope-encryption-and-the-schema-contract`). Ready for phase verification and the next phase.

---
*Phase: 03-envelope-encryption-and-the-schema-contract*
*Completed: 2026-08-31*

## Self-Check: PASSED

- All 10 modified files and 1 created file verified present on disk with the expected content.
- All 4 commit hashes (`51a0d04`, `7278fdf`, `a5e06c6`, `891e414`) verified present in `git log --oneline`.
- `uv run pytest -q` re-confirmed green (243 passed) immediately before writing this summary.
- `bash tools/gate.sh` re-confirmed green (243 passed, ruff/ruff format/basedpyright/mypy clean across 73 source files) immediately before writing this summary.
- `alembic upgrade head` -> `alembic downgrade -1` -> `alembic upgrade head` cycle re-confirmed working against local Postgres, with the downgraded state's tables, RLS, policy and grants directly queried and confirmed present.
- `grep -rn "GateMoneyProbe|GateUserScopedProbe|gate_money_probe|gate_user_scoped_probe" src tests tools` returns only docstring/comment prose and migrations 0001/0003/0009.

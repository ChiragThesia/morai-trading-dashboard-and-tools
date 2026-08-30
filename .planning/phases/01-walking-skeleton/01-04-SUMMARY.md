---
phase: 01-walking-skeleton
plan: 04
subsystem: database
tags: [sqlalchemy, decimal, money, unit-typing, tdd]

requires:
  - phase: 01-walking-skeleton
    provides: "D-01's Usd/IndexPoints NewTypes in src/morai/money/units.py; GateMoneyProbe with amount_usd already suffixed correctly (01-03)"
provides:
  - "points_to_usd(pts, multiplier) -- required multiplier, no default (D-02)"
  - "SPX_CONTRACT_MULTIPLIER as the sole src/-scoped occurrence of the literal 100"
  - "A metadata-walk test that fails any Numeric column without a _usd/_pts suffix (D-04), with a negative control and a non-zero-column-count guard against vacuous passing"
affects: [phase-3-ledger, phase-5-fills]

actuals:
  tokens: 1818
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "TDD stub pattern for pure-test tasks: helper functions raise NotImplementedError for the RED commit, then get real bodies for GREEN, when the task's only file is the test file itself"
    - "src/-scoped grep test to pin a single-source-of-truth literal, deliberately excluding tests/ and docs/ so legitimate discussion of the number doesn't break the test"

key-files:
  created:
    - tests/test_money_units.py
    - tests/test_money_column_naming.py
  modified:
    - src/morai/money/units.py

key-decisions:
  - "points_to_usd's multiplier has no default (D-02) -- verified both by a runtime TypeError test and by basedpyright/mypy flagging a missing-arg call as a type error"
  - "The missing-multiplier test calls through a Callable[..., Usd] reference rather than a direct mistyped call site, so the test itself stays type-clean under strict basedpyright/mypy while still proving the runtime TypeError"
  - "The column-naming guard's real-schema import goes through 'import morai.db.models as _models; assert _models' rather than a bare unused import -- avoids both ruff's F401 and basedpyright's reportUnusedImport without a suppression comment"

requirements-completed: [LEDGER-08, OPS-02]

coverage:
  - id: D1
    description: "points_to_usd converts index points to dollars and requires the caller to name the multiplier"
    requirement: LEDGER-08
    verification:
      - kind: unit
        ref: "tests/test_money_units.py#test_points_to_usd_converts_correctly"
        status: pass
      - kind: unit
        ref: "tests/test_money_units.py#test_points_to_usd_requires_the_multiplier"
        status: pass
    human_judgment: false
  - id: D2
    description: "The SPX contract multiplier literal appears in exactly one file under src/"
    requirement: LEDGER-08
    verification:
      - kind: unit
        ref: "tests/test_money_units.py#test_contract_multiplier_literal_appears_in_exactly_one_file"
        status: pass
    human_judgment: false
  - id: D3
    description: "Any Numeric column added anywhere without a _usd or _pts suffix fails a test, proven against a real newly-added bad column and a synthetic negative control"
    requirement: OPS-02
    verification:
      - kind: unit
        ref: "tests/test_money_column_naming.py#test_real_schema_names_every_money_column"
        status: pass
      - kind: unit
        ref: "tests/test_money_column_naming.py#test_unsuffixed_numeric_column_is_reported"
        status: pass
    human_judgment: false

duration: ~7min
completed: 2026-08-30
status: complete
---

# Phase 1 Plan 4: Money Units and the Column-Naming Guard Summary

**`points_to_usd` with a required (never-defaulted) multiplier, and a SQLAlchemy-metadata walk that fails any `Numeric` column not suffixed `_usd`/`_pts` -- both pure Python, no database.**

## Performance

- **Duration:** ~7 min (first RED commit `b6ead21` 18:02:43 to final GREEN commit `5078812` 18:06:33, local time)
- **Tasks:** 2
- **Files modified:** 3 (1 modified, 2 created)

## Accomplishments

- `points_to_usd(pts, multiplier)` added to `src/morai/money/units.py` -- multiplier has no default, so a caller can never inherit a wrong contract. Verified both at runtime (`TypeError` on a missing-arg call) and statically (basedpyright/mypy both treat the missing arg as a type error; the test calls through a `Callable[..., Usd]` reference specifically so it doesn't itself contain a mistyped call site).
- `SPX_CONTRACT_MULTIPLIER = 100` is the module's sole definition of the contract multiplier; a `src/`-scoped grep test (excluding `units.py` itself) proves the literal `100` occurs nowhere else under `src/`.
- `tests/test_money_column_naming.py` walks `Base.metadata` in memory (no engine, no connection) and fails any `Numeric` column whose name doesn't end in `_usd` or `_pts`. Carries a synthetic negative control (an unsuffixed `Numeric` column in a throwaway `MetaData()`) and an explicit non-zero column-count assertion so the guard cannot pass vacuously if `Base.metadata` is ever empty.
- Manually proved the guard catches a *real* future violation: temporarily added `amount_broken` (an unsuffixed `Numeric` column) to `GateMoneyProbe`, re-ran the test, watched it fail with `AssertionError: ... 'gate_money_probe.amount_broken'`, then reverted `models.py` to a clean (zero-diff) state. See "Column-Naming Guard: Proof It Has Teeth" below.

## Task Commits

Each task followed red -> green (D-08):

1. **Task 1: points_to_usd** -- `b6ead21` (test, RED: `ImportError: cannot import name 'points_to_usd'`) -> `113b16e` (feat, GREEN)
2. **Task 2: Column-naming guard** -- `9258bee` (test, RED: helpers raise `NotImplementedError`) -> `5078812` (feat, GREEN)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `src/morai/money/units.py` -- added `SPX_CONTRACT_MULTIPLIER` and `points_to_usd`
- `tests/test_money_units.py` -- created; conversion behaviour, required-multiplier, single-literal enforcement
- `tests/test_money_column_naming.py` -- created; metadata walk, real-schema check, negative control, vacuous-pass guard

## Decisions Made

- **Required-multiplier test avoids a statically-mistyped call site.** Calling `points_to_usd(pts)` directly in the test would itself be flagged by strict basedpyright/mypy as a type error at collection/typecheck time -- correct behaviour for the function, but it would mean either suppressing a checker (banned) or the test file failing `uv run basedpyright`/`mypy` even though the runtime behaviour is exactly what's wanted. Routed the call through a `fn: Callable[..., Usd] = points_to_usd` reference instead, which accepts any arguments statically while the actual call still raises `TypeError` at runtime -- proving the runtime half of D-02's claim without a suppression comment.
- **`morai.db.models` import for its side effect uses `import ... as _models; assert _models`, not a bare `import morai.db.models` with a `noqa`.** A bare unused import trips ruff's F401; a `# noqa: F401` silences ruff but basedpyright doesn't read ruff's suppression syntax and separately flags `reportUnusedImport`. Assigning to `_models` and asserting on it makes the import a genuinely used expression under both checkers with no suppression comment anywhere.
- **TDD RED for Task 2 used `NotImplementedError` stubs, not a missing implementation file.** This task's only file is the test file itself (the "implementation" is the metadata-walk helper functions living inside it), so RED was produced by writing the test assertions and the negative control first, with the two helper functions raising `NotImplementedError`, confirming a real failure before filling in the actual walk logic for GREEN.

## Deviations from Plan

None -- plan executed exactly as written. `points_to_usd`'s docstring names the concrete v1 bug per the plan's instruction; the multiplier literal grep is scoped to `src/` per D-02; the column-naming guard imports `Base` from `morai.db.base` and `morai.db.models` per the plan's `key_links`.

## Column-Naming Guard: Proof It Has Teeth

In addition to the synthetic negative control committed in the test file, the guard was verified against a real schema change during this task (not committed -- reverted before the final commit):

1. Temporarily added `amount_broken: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False, default=0)` to `GateMoneyProbe` in `src/morai/db/models.py`.
2. Ran `uv run pytest tests/test_money_column_naming.py -x -v` -- failed as expected:
   ```
   AssertionError: assert ['gate_money_probe.amount_broken'] == []
     Left contains one more item: 'gate_money_probe.amount_broken'
   ```
3. Reverted `src/morai/db/models.py` to its original content (confirmed `git diff src/morai/db/models.py` empty against `HEAD`), re-ran the test suite -- 3/3 passing again.

This is the specific claim in the plan's `<behavior>` list -- "walking metadata rather than hardcoding today's table list" -- demonstrated against a column that did not exist when the test was written.

## Issues Encountered

None.

## Verification Evidence

```
$ uv run pytest tests/test_money_units.py tests/test_money_column_naming.py -v
collected 7 items
tests/test_money_units.py ....                                           [ 57%]
tests/test_money_column_naming.py ...                                    [100%]
============================== 7 passed in 0.02s ===============================

$ grep -rln '\b100\b' src/morai --include="*.py"
src/morai/money/units.py

$ uv run basedpyright
0 errors, 0 warnings, 0 notes

$ uv run mypy src tests
Success: no issues found in 19 source files

$ uv run ruff check src tests && uv run ruff format --check src tests
All checks passed!
19 files already formatted

$ uv run pytest -m "not db"
17 passed, 6 deselected in 0.05s
```

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- LEDGER-08 is now fully landed: D-01's Python-side `NewType` distinction (01-03) plus D-02's required-multiplier conversion and D-04's SQL-side naming guard (this plan).
- Any later phase (3, 5, 7, 9) adding a `Numeric` column to the schema is caught by `tests/test_money_column_naming.py` automatically -- no per-table maintenance needed.
- No blockers for the remaining Wave 4 plans or later phases.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-08-30*

## Self-Check: PASSED

---
phase: 01-walking-skeleton
plan: 05
subsystem: testing
tags: [basedpyright, mypy, ruff, pytest, ci-gate, negative-control, secrets, icloud]

requires:
  - phase: 01-walking-skeleton
    provides: "pyproject.toml gate config (basedpyright/mypy/ruff strict, tests/gate/fixtures exclusion), Usd/IndexPoints NewTypes, tools/gate.sh"
provides:
  - "tests/gate/ meta-test proving basedpyright, mypy and ruff each genuinely reject their targeted violation, asserted by rule code"
  - "tests/gate/test_suppressions.py enforcing D-06's reason-comment requirement on every rule-coded suppression"
  - "tests/test_repo_hygiene.py guarding against the iCloud ` 2` collision pattern (V091) and a committed Postgres credential"
affects: [ci-gate, phase-2, phase-3, any-phase-adding-a-suppression]

actuals:
  tokens: 4718
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "Negative-control meta-testing: a fixture that deliberately violates one rule, run as a subprocess, asserting the specific rule code fired -- not merely a non-zero exit"
    - "Shape-based secret detection (length + digit + letter) instead of a hardcoded value or an exclusion list, so legitimate test fixtures with fake passwords never trip the guard"
    - "Runtime-assembled sentinel string (reason marker built from two string parts) so a self-referential scanner cannot match its own source"

key-files:
  created:
    - tests/gate/__init__.py
    - tests/gate/fixtures/violation_explicit_any.py
    - tests/gate/fixtures/violation_cast.py
    - tests/gate/fixtures/violation_bare_ignore.py
    - tests/gate/fixtures/violation_unit_confusion.py
    - tests/gate/test_type_gate.py
    - tests/gate/test_suppressions.py
    - tests/test_repo_hygiene.py
  modified: []

key-decisions:
  - "tests/gate/fixtures is excluded from basedpyright/mypy/ruff even when a fixture's path is passed explicitly on the command line, not only via glob discovery -- measured this session, contradicting the plan's own assumed mechanism. Each checker case copies its fixture into tmp_path before invoking the checker, with the repo as cwd, so the copy still resolves the project's pyproject.toml and the installed morai package but is not excluded."
  - "mypy does not flag an explicit typing.Any (pyproject.toml deliberately omits disallow_any_explicit -- it false-positives on every pydantic BaseModel/BaseSettings subclass). No mypy-vs-explicit-Any case is asserted. In its place, the bare-ignore fixture gets a second real case: basedpyright's own PGH003 mirror, reportIgnoreCommentWithoutRule -- confirmed by hand before being pinned, same as every other marker in this plan."
  - "The suppression-reason marker is built from two string parts at runtime (# + why:) rather than written as one literal, and the scanner excludes its own file path -- both, per plan -- so the scanner cannot match its own source."
  - "Committed-secret detection uses a shape heuristic (password >=16 chars, containing both a letter and a digit) instead of an exclusion list of known test files. This clears every already-committed placeholder (.env.example's 'password', CI's 'morai', tests/conftest.py's 'placeholder', tests/test_settings.py's 'sekret-password') without needing to enumerate them, while still catching a real vendor-issued credential's shape."
  - "The credential scan additionally excludes docs/, knowledge-base/ and .planning/ outright (not just by shape) per the plan's explicit instruction, so a learnings entry legitimately discussing a connection-string shape can never fail the build."

patterns-established:
  - "A checker exclusion in pyproject.toml applies to explicit CLI paths too, not just glob discovery -- any future negative-control fixture must be checked via a tmp-dir copy, not a direct path into the excluded directory."

requirements-completed: [OPS-01, OPS-02, LEDGER-08]

coverage:
  - id: D1
    description: "Meta-test proves basedpyright rejects explicit Any (reportExplicitAny, reportAny) and ruff rejects it (TID251)"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[basedpyright-explicit_any-reportExplicitAny]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[basedpyright-explicit_any-reportAny]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[ruff-explicit_any-TID251]"
        status: pass
    human_judgment: false
  - id: D2
    description: "Meta-test proves ruff rejects typing.cast (TID251) and a bare '# type: ignore' (PGH003), and basedpyright rejects the same bare ignore (reportIgnoreCommentWithoutRule)"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[ruff-cast-TID251]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[ruff-bare_ignore-PGH003]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[basedpyright-bare_ignore-reportIgnoreCommentWithoutRule]"
        status: pass
    human_judgment: false
  - id: D3
    description: "Passing an IndexPoints value where Usd is expected fails type-check before the process runs (criterion 4's second half)"
    requirement: "LEDGER-08"
    verification:
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[basedpyright-unit_confusion-reportArgumentType]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[mypy-unit_confusion-arg-type]"
        status: pass
    human_judgment: false
  - id: D4
    description: "The four violating fixtures do not break the real gate run (basedpyright/mypy/ruff stay clean over src+tests with fixtures on disk)"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_fixtures_excluded_from_real_gate_run"
        status: pass
    human_judgment: false
  - id: D5
    description: "A rule-coded suppression missing a written reason is reported by path:line; a justified one and a clean line are not; the scanner excludes its own source and the fixtures directory"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "tests/gate/test_suppressions.py::test_real_tree_has_no_unjustified_suppressions"
        status: pass
      - kind: unit
        ref: "tests/gate/test_suppressions.py::test_scanner_reports_a_synthetic_offending_line"
        status: pass
      - kind: unit
        ref: "tests/gate/test_suppressions.py::test_justified_suppression_is_not_reported"
        status: pass
      - kind: unit
        ref: "tests/gate/test_suppressions.py::test_scanner_excludes_its_own_source_and_the_fixtures_directory"
        status: pass
    human_judgment: false
  - id: D6
    description: "No tracked path matches the iCloud ' 2' collision pattern (V091), .env/.env.local are untracked and absent from all history, no tracked file carries a real-looking Postgres password, and .env.example holds placeholders only"
    requirement: "OPS-01"
    verification:
      - kind: unit
        ref: "tests/test_repo_hygiene.py::test_no_tracked_path_matches_icloud_collision_pattern"
        status: pass
      - kind: unit
        ref: "tests/test_repo_hygiene.py::test_collision_matcher_fires_on_a_synthetic_offending_path"
        status: pass
      - kind: unit
        ref: "tests/test_repo_hygiene.py::test_env_and_env_local_are_untracked"
        status: pass
      - kind: unit
        ref: "tests/test_repo_hygiene.py::test_env_never_reached_git_history"
        status: pass
      - kind: unit
        ref: "tests/test_repo_hygiene.py::test_no_tracked_file_carries_a_real_looking_postgres_password"
        status: pass
      - kind: unit
        ref: "tests/test_repo_hygiene.py::test_env_example_holds_placeholders_only"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-08-30
status: complete
---

# Phase 1 Plan 05: Type Gate Negative Controls Summary

**Four deliberately-violating fixtures plus a subprocess meta-test proving basedpyright/mypy/ruff each reject their target with the specific rule code, a runtime-built suppression-reason scanner, and iCloud/secret repo-hygiene guards.**

## Performance

- **Duration:** 8min (span between the first and last commit; exploration/hand-verification before the first commit not included)
- **Started:** 2026-08-30T18:06:27-05:00
- **Completed:** 2026-08-30T18:13:51-05:00
- **Tasks:** 3
- **Files modified:** 8 (all new)

## Accomplishments

- Proved the type gate has teeth: 8 checker/fixture cases in `tests/gate/test_type_gate.py`, each asserting a non-zero exit **and** the specific rule marker that fired (`reportExplicitAny`, `reportAny`, `TID251`, `PGH003`, `reportIgnoreCommentWithoutRule`, `reportArgumentType`, `arg-type`) — not merely "some error occurred"
- Proved criterion 4's second half: `needs_usd(IndexPoints(...))` fails both basedpyright (`reportArgumentType`) and mypy (`arg-type`) before the process runs
- Proved the exclusion is real: `pyproject.toml`'s `tests/gate/fixtures` exclusion keeps the real gate clean with all four violating fixtures on disk, and — the actually load-bearing part — a fixture's *explicit path* is silently skipped too, which is why each meta-test case copies its fixture to a tmp directory before invoking the checker
- Built `tests/gate/test_suppressions.py`: a rule-coded suppression (`# type: ignore[code]`, `# pyright: ignore[code]`, ruff's own rule-code comment) missing a written reason on the same line is reported by `path:lineno`; the reason marker is assembled from two string parts at runtime and the scanner excludes its own file, so it cannot match itself
- Built `tests/test_repo_hygiene.py`: no tracked path matches the iCloud ` 2` collision shape (V091), `.env`/`.env.local` are untracked and absent from all git history, and no tracked file carries a Postgres URL whose password *looks* real (16+ chars, letters and digits both present) — a shape check, not a value comparison, so the real credential never needed to be written anywhere in this test

## Task Commits

Each task followed red-then-green (D-08):

1. **Task 1: Violating fixtures and the meta-test** — `7c042c2` (test: red, fixtures absent) → `74a9eb0` (feat: fixtures added, all 9 cases green)
2. **Task 2: Suppression-reason scanner** — `ff3c304` (test: red, scanner stubbed with `NotImplementedError`) → `5ae4880` (feat: real scanner, 5 cases green)
3. **Task 3: Repo hygiene guards** — `00b86ce` (test: red, collision regex neutered + credential heuristic stubbed) → `b7405e9` (feat: both real, 6 cases green)

## Files Created/Modified

- `tests/gate/__init__.py` — package marker
- `tests/gate/fixtures/violation_explicit_any.py` — deliberate `typing.Any` import + annotation
- `tests/gate/fixtures/violation_cast.py` — deliberate `typing.cast` call
- `tests/gate/fixtures/violation_bare_ignore.py` — a genuine type error suppressed with a bare `# type: ignore`
- `tests/gate/fixtures/violation_unit_confusion.py` — `IndexPoints` passed where `Usd` is required
- `tests/gate/test_type_gate.py` — the 9-case meta-test (8 marker assertions + 1 exclusion proof)
- `tests/gate/test_suppressions.py` — D-06's reason-comment scanner and its 5 tests
- `tests/test_repo_hygiene.py` — V091 collision guard + committed-secret guard, 6 tests

## Decisions Made

- **Fixture exclusion applies to explicit paths too (measured, not assumed).** `pyproject.toml`'s `exclude`/`extend-exclude` for `tests/gate/fixtures` filters a fixture even when its path is passed directly on the checker's command line, confirmed by hand: `basedpyright tests/gate/fixtures/violation_explicit_any.py` reports 0 errors, but the same file copied outside that directory (same cwd, same project config) reports the expected 3 errors. Every meta-test case therefore copies its fixture into `tmp_path` first. This contradicts the plan's stated mechanism ("the config exclusion governs the default include set, not an explicit argument") — recorded here as the actual measured behavior, per the plan's own instruction to confirm markers against real output rather than trust memory.
- **Dropped the mypy-vs-explicit-Any case; substituted a real one.** The orchestrator's brief was explicit that mypy does not catch explicit `Any` here (`disallow_any_explicit` is deliberately unset — it false-positives on every pydantic model). I did not write that assertion. In its place, hand-verification found basedpyright's `reportIgnoreCommentWithoutRule` genuinely fires on the bare-ignore fixture (it's the basedpyright-side mirror of ruff's `PGH003`, already present in `pyproject.toml`), giving 8 real cases instead of 7 real + 1 false one.
- **Secret detection by shape, not by an exclusion list.** The plan asked to exclude only `.env.example` and the scanning test's own source, but the real tree already carries several legitimate fake-credential fixtures (`tests/conftest.py`'s `placeholder:placeholder`, `tests/test_settings.py`'s `user:sekret-password`, CI's `morai:morai`) that a naive Postgres-URL regex would flag. Rather than hand-enumerating every current and future test fixture, the check requires the password segment to look real (>=16 chars, mixing letters and digits) — every placeholder above is short and letters-only, so all clear without being named, while a genuine Railway-issued secret's shape would not.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/gate/test_type_gate.py`'s own docstring failed `ruff` line-length (E501) and a `# noqa`-shaped comment fragment**
- **Found during:** Task 1, running the file against the gate for self-compliance (the file lives under `tests/gate/`, not `tests/gate/fixtures/`, so it is itself subject to the strict gate)
- **Issue:** A docstring line exceeded 88 columns
- **Fix:** Rewrapped the line
- **Files modified:** `tests/gate/test_type_gate.py`
- **Verification:** `uv run ruff check src tests` clean
- **Committed in:** `74a9eb0`

**2. [Rule 1 - Bug] `pytest.ParameterSet` type annotation broke both checkers**
- **Found during:** Task 1, running `basedpyright`/`mypy` against the new test file
- **Issue:** Annotating `CASES: list[pytest.ParameterSet]` failed mypy (`pytest.ParameterSet` is not a public name) and produced `reportUnknownVariableType`/`reportUnknownMemberType` under basedpyright
- **Fix:** Dropped the explicit annotation — `CASES` infers cleanly from the `pytest.param(...)` calls without it
- **Files modified:** `tests/gate/test_type_gate.py`
- **Verification:** `uv run basedpyright` and `uv run mypy src tests` both clean
- **Committed in:** `74a9eb0`

**3. [Rule 1 - Bug] A prose comment containing "# noqa" was mistaken by ruff's own comment scanner for a directive**
- **Found during:** Task 2, running `ruff check` against `tests/gate/test_suppressions.py`
- **Issue:** A comment reading "...or ruff's own `# noqa: CODE`." was parsed by ruff as a malformed `noqa` directive, producing a warning (not a failure, but confusing)
- **Fix:** Reworded the comment to avoid the literal `noqa` token adjacent to a colon
- **Files modified:** `tests/gate/test_suppressions.py`
- **Verification:** `uv run ruff check src tests` — no warning
- **Committed in:** `5ae4880`

**4. [Rule 1 - Bug] `git ls-files 'src/**/*.py' 'tests/**/*.py'` under-enumerates: it silently drops depth-1 files under `tests/`**
- **Found during:** Task 2, verifying the enumeration the plan's action text suggested
- **Issue:** That exact pathspec (copied from the plan) omits `tests/conftest.py`, `tests/test_settings.py`, `tests/test_decimal_canary.py`, `tests/test_money_roundtrip.py`, and `tests/__init__.py` — git's `**` glob requires at least one intervening directory component, so top-level files under `tests/` never match. The plan's own success criterion ("covers every tracked `.py` file under `src/` and `tests/`") would silently not hold.
- **Fix:** Used `git ls-files -- src tests`, filtered to `.py` suffix in Python, instead of the glob pathspec
- **Files modified:** `tests/gate/test_suppressions.py`
- **Verification:** Enumeration now includes all 12 `src/` and 12 `tests/`-tree `.py` files (confirmed by hand before writing the scanner)
- **Committed in:** `5ae4880`

---

**Total deviations:** 4 auto-fixed (all Rule 1 — self-compliance bugs and one enumeration-coverage bug found while implementing, none architectural)
**Impact on plan:** No scope creep. Three are gate-compliance fixes within files this plan owns; the fourth corrects an under-enumeration that would have left the suppression scanner covering less than the plan's own stated goal.

## Issues Encountered

None beyond the deviations above.

## Known Stubs

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The type gate is now proven, not merely configured: any future loosening of `reportAny`/`reportExplicitAny`/`TID251`/`PGH003` in `pyproject.toml` breaks a test in `tests/gate/test_type_gate.py`, rather than silently stopping firing.
- `tests/gate/test_suppressions.py` is live for every future phase that reaches for a suppression — a rule-coded ignore without a reason now fails the suite immediately, before it reaches review.
- `tests/test_repo_hygiene.py` guards the two structural hazards named in `CLAUDE.md` (iCloud collisions, public-repo secrets) for every phase from here forward.
- No blockers for the sibling plans in this wave (`routes_negative_control.py`, `test_api_boundary.py`) — this plan touched no file outside its own list.

## Self-Check: PASSED

All 8 claimed files confirmed present on disk; all 6 claimed commit hashes confirmed in `git log`.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-08-30*

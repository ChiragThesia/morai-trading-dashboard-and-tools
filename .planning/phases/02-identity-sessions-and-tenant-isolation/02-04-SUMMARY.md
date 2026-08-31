---
phase: 02-identity-sessions-and-tenant-isolation
plan: 04
subsystem: auth
tags: [postgres, row-level-security, sqlalchemy, type-gate, basedpyright, mypy]

requires:
  - phase: 02-identity-sessions-and-tenant-isolation
    provides: "Migration 0003 (plan 02-01): audit_log table, its INSERT-only append_only RLS policy, no SELECT policy; users' self_or_admin policy; morai_app role; seeded_users/app_db_session/superuser_db_session fixtures"
provides:
  - "src/morai/identity/audit.py -- AuditedRead capability, open_audited_read() factory, get_user_for_management() (the one privileged cross-user read in this phase)"
  - "tests/gate/fixtures/violation_unaudited_read.py -- proves the natural bypass (a bare UUID where AuditedRead belongs) fails both basedpyright and mypy by name"
  - "The honest-ceiling statement (three paragraphs, in audit.py's module docstring): what type-checks, what falls back to a runtime guard, what neither covers"
affects: [02-05, 02-06]

actuals:
  tokens: 2974
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Capability-object audit pattern: a privileged read's only parameter of the right type is producible by one factory that writes the audit row first, on the caller's own session, without committing"
    - "Raw text() SQL for an INSERT against a table with an INSERT-only RLS policy and no SELECT policy -- SQLAlchemy's insert(Model) construct silently appends an implicit RETURNING for server-generated PKs, and RETURNING is itself a read RLS will reject if no SELECT policy exists"

key-files:
  created:
    - src/morai/identity/audit.py
    - tests/identity/test_audit.py
    - tests/gate/fixtures/violation_unaudited_read.py
  modified:
    - tests/gate/test_type_gate.py

key-decisions:
  - "The honest ceiling is stated in three paragraphs in audit.py's own module docstring, not just this plan: what type-checks (the natural bypass), what falls back to a runtime guard (a forged capability), what neither covers (a reviewer failing to notice a new privileged surface needs this pattern at all)"
  - "open_audited_read() does not commit -- the caller's own commit covers both the audit row and the read, or neither (D2-12), proven by a rollback test asserting zero rows, not merely that a commit produces one"
  - "audit_log's INSERT-only RLS policy means the app role cannot read its own trail back -- verification of written rows goes through superuser_db_session, which migration 0003 documents superusers always bypass RLS for, FORCE ROW LEVEL SECURITY notwithstanding"
  - "5 tests, not the plan's stated 6 -- the plan's <behavior> section names exactly five distinct Test: bullets and each is covered once; <done> says six, which reads as this plan's own off-by-one rather than a sixth behavior actually specified anywhere in the plan text"

patterns-established:
  - "Where a table's RLS policy is deliberately INSERT-only (no SELECT), write via text() SQL, not insert(Model).values(...) -- the ORM construct's implicit RETURNING for server-generated columns is itself a read"

requirements-completed: [AUTH-08]

coverage:
  - id: D1
    description: "AuditedRead is constructible only via open_audited_read(), which writes the audit row and the read it unlocks in the same transaction (commit or rollback covers both)"
    requirement: AUTH-08
    verification:
      - kind: integration
        ref: "tests/identity/test_audit.py::test_open_audited_read_commit_writes_one_row_naming_reader_subject_and_time"
        status: pass
      - kind: integration
        ref: "tests/identity/test_audit.py::test_open_audited_read_rollback_leaves_zero_rows"
        status: pass
      - kind: integration
        ref: "tests/identity/test_audit.py::test_get_user_for_management_returns_subject_row_for_admin_reader"
        status: pass
      - kind: unit
        ref: "tests/identity/test_audit.py::test_constructing_auditedread_directly_raises_runtime_error"
        status: pass
      - kind: integration
        ref: "tests/identity/test_audit.py::test_repr_excludes_token_value"
        status: pass
    human_judgment: false
  - id: D2
    description: "The natural bypass -- calling get_user_for_management with a bare UUID instead of an AuditedRead -- fails basedpyright (reportArgumentType) and mypy (arg-type) by name, proven against a copied fixture, not merely a non-zero exit"
    requirement: AUTH-08
    verification:
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[basedpyright-unaudited_read-reportArgumentType]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_checker_rejects_fixture_with_expected_marker[mypy-unaudited_read-arg-type]"
        status: pass
      - kind: unit
        ref: "tests/gate/test_type_gate.py::test_fixtures_excluded_from_real_gate_run"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-08-31
status: complete
---

# Phase 2 Plan 4: The Audited-Read Capability Summary

**`AuditedRead` capability object (AUTH-08): the natural bypass of a privileged cross-user read fails basedpyright and mypy by name, a forged capability raises `RuntimeError` at the call site, and the audit row shares the read's own transaction -- with a three-paragraph docstring saying plainly which of those three is a compile-time guarantee and which is not.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-31T00:04:57-05:00 (first read of context)
- **Completed:** 2026-08-31T00:26:00-05:00 (CI green)
- **Tasks:** 2
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `src/morai/identity/audit.py`: `AuditedRead` (frozen dataclass, private factory-sentinel
  token typed `object`, never `Any`), `open_audited_read()` (writes the `audit_log` row,
  does not commit), `get_user_for_management()` (the one privileged cross-user read this
  phase has, exactly one signature).
- `tests/gate/fixtures/violation_unaudited_read.py` plus two new `CASES` entries in
  `tests/gate/test_type_gate.py`: basedpyright reports `reportArgumentType`, mypy reports
  `arg-type`, both confirmed by hand against the copied fixture (not assumed from the
  existing `violation_unit_confusion.py` markers, though they turned out to match).
- Five tests in `tests/identity/test_audit.py` covering the commit case, the D2-12 rollback
  case, the capability actually unlocking the RLS-gated admin read, the forged-capability
  runtime guard, and `repr()` excluding the token.
- The three-paragraph honest-ceiling statement, written into `audit.py`'s module docstring
  as instructed, plus the Pitfall 4 warning that trading data never gets an `AuditedRead`
  path -- only RLS.

## Task Commits

Each task was committed atomically, plus two follow-on fixes surfaced by CI:

1. **Task 1: The capability object, its factory, and the same-transaction guarantee** -
   `ba5d168` (feat)
2. **Task 2: A gate fixture proving both checkers reject the natural bypass by name** -
   `99e120f` (test)
3. **Fix: raw `INSERT` for the audit row -- implicit `RETURNING` tripped RLS** - `583d77d`
   (fix, Rule 1 -- real bug, found in CI, not locally reproducible)
4. **Fix: assert before commit -- `expire_on_commit` tripped `MissingGreenlet`** - `72fd395`
   (fix, Rule 1 -- test-file bug, also found in CI)

**Plan metadata:** this commit (docs: complete plan)

## Files Created/Modified

- `src/morai/identity/audit.py` - `AuditedRead`, `open_audited_read()`, `get_user_for_management()`, the honest-ceiling docstring
- `tests/identity/test_audit.py` - five tests: commit, rollback (D2-12), capability unlocks admin read, forged capability raises, repr excludes token
- `tests/gate/fixtures/violation_unaudited_read.py` - the natural-bypass negative control
- `tests/gate/test_type_gate.py` - two new `CASES` entries pinning the fixture's markers

## Decisions Made

- Verification via `superuser_db_session`, not `app_db_session`, for reading back
  `audit_log` rows: the table's own INSERT-only policy means the app role cannot `SELECT`
  its own trail, by design (migration 0003). Superusers bypass RLS regardless of `FORCE
  ROW LEVEL SECURITY`, which is what migration 0003's own docstring documents and this
  plan's tests rely on.
- Raw `text()` SQL for the audit `INSERT`, not `insert(AuditLog).values(...)` -- see
  Deviations below.
- Five tests, not the plan's stated "six" -- see `key-decisions` in frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `insert(AuditLog).values(...)` failed at runtime against real RLS**

- **Found during:** Task 1 verification, first CI push (run `33359952830`)
- **Issue:** All four db-marked tests in `test_audit.py` failed with
  `sqlalchemy.exc.ProgrammingError` wrapping
  `asyncpg.exceptions.InsufficientPrivilegeError: new row violates row-level security
  policy for table "audit_log"`. Basedpyright, mypy and the local non-db test run had all
  passed clean -- this bug only exists at the intersection of SQLAlchemy's own DML
  compilation and Postgres RLS, and is invisible to both a type checker and a suite that
  cannot reach a real database. `AuditLog.id` carries `server_default=func.gen_random_uuid()`,
  and SQLAlchemy's `insert(Model)` construct silently appends `RETURNING audit_log.id` to
  fetch the generated value -- a `RETURNING` clause is itself a read, and `audit_log`
  deliberately has no `SELECT` policy (INSERT-only, migration 0003, by design). The write
  itself was never rejected; the implicit read tacked onto it was.
- **Fix:** Switched `open_audited_read()`'s insert to plain `text("INSERT INTO audit_log
  (reader_id, subject_id) VALUES (:reader_id, :subject_id)")`, which SQLAlchemy passes
  through unaugmented -- no implicit `RETURNING` is generated.
- **Files modified:** `src/morai/identity/audit.py`
- **Verification:** Re-pushed; CI run `33360143910` got past this failure (3 of 4 db tests
  passed; see deviation 2 for the remaining one).
- **Committed in:** `583d77d`

**2. [Rule 1 - Bug] Test asserted ORM attributes after `commit()`, tripping `MissingGreenlet`**

- **Found during:** Task 1 verification, second CI push (run `33360143910`)
- **Issue:** `test_get_user_for_management_returns_subject_row_for_admin_reader` read
  `subject.id`/`subject.username` after `await app_db_session.commit()`. `app_db_session`
  (from `tests/identity/conftest.py`) is a plain `AsyncSession(engine)` with the default
  `expire_on_commit=True`, unlike `get_db_session`'s own sessionmaker which sets it
  `False` -- so the commit expired the ORM object's attributes, and the subsequent
  synchronous attribute access triggered a lazy-refresh query outside an awaited context:
  `sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called`.
- **Fix:** Moved the assertions before the commit. No production code involved -- this was
  a bug in the test's own statement ordering, not in `audit.py`.
- **Files modified:** `tests/identity/test_audit.py`
- **Verification:** Re-pushed; CI run `33360245448` (`gh run watch --exit-status`) passed
  all four jobs, `90 passed, 5 warnings in 16.41s`.
- **Committed in:** `72fd395`

---

**Total deviations:** 2 auto-fixed (both Rule 1, both surfaced only by CI, since there is
no reachable local database on this machine).
**Impact on plan:** Both fixes were necessary for correctness; neither changed the plan's
design (the capability shape, the factory, the same-transaction guarantee, and the gate
fixture are all exactly as planned). No scope creep.

## Issues Encountered

None beyond the two deviations above, both resolved via the plan's own required workflow
(push, `gh run view --log`, fix, re-push) since there is no reachable local database.

## Checker Output for the Two New Gate Cases (verbatim, confirmed by hand)

basedpyright against the copied fixture:

```
tests/gate/fixtures/violation_unaudited_read.py:20:11 - error: Function "_call" is not accessed (reportUnusedFunction)
tests/gate/fixtures/violation_unaudited_read.py:21:44 - error: Argument of type "UUID" cannot be assigned to parameter "proof" of type "AuditedRead" in function "get_user_for_management"
    "UUID" is not assignable to "AuditedRead" (reportArgumentType)
2 errors, 0 warnings, 0 notes
```

`reportUnusedFunction` is a distinct, non-colliding rule (the fixture's wrapper function is
never called, only analyzed) -- it does not satisfy the `reportArgumentType` assertion for
the wrong reason; `reportArgumentType` fires specifically and only for the wrong-type
argument, confirmed above.

mypy against the copied fixture:

```
tests/gate/fixtures/violation_unaudited_read.py:21: error: Argument 2 to "get_user_for_management" has incompatible type "UUID"; expected "AuditedRead"  [arg-type]
Found 1 error in 1 file (checked 1 source file)
```

mypy's output is clean of any unrelated diagnostic -- exactly one error, `arg-type`, for
exactly the intended reason.

Both CI runs (local push of task 2, and the final green run `33360245448`) additionally
confirm `tests/gate/` (31 tests) and the real `basedpyright`/`mypy src tests`/`ruff check
src tests` gate all stay clean with the new fixture on disk.

## The Honest-Ceiling Statement (as written into `audit.py`'s module docstring)

> **What type-checks (a real "does not compile"):** `get_user_for_management(session,
> proof: AuditedRead)` has exactly one signature. A caller who reaches for the obvious
> thing -- `get_user_for_management(session, subject_id)` -- passes a `UUID` where an
> `AuditedRead` is required, and both basedpyright and mypy reject it. This is the same
> class of guarantee as `needs_usd(IndexPoints(...))` in this repo's own
> `tests/gate/fixtures/violation_unit_confusion.py`, and it is proved the identical way,
> by `tests/gate/fixtures/violation_unaudited_read.py`.
>
> **What does not type-check (falls back to a runtime guard):** a caller who *forges* an
> `AuditedRead` by constructing one directly with some other sentinel gets a
> `RuntimeError`, not a type error. Type checkers verify shapes, not provenance -- an
> `AuditedRead` built by hand has the right shape, so nothing here is a static-analysis
> problem for them to catch. This is tested as a unit test, not claimed as a compile-time
> guarantee.
>
> **What neither covers:** whether a reviewer notices that a brand-new privileged surface
> should route through this pattern at all. That is D2-11's own explicit fallback rung
> ("beats a review convention"). The pattern reduces how much rests on review; it does not
> remove review. No docstring, comment, commit message or test name anywhere in this
> module may claim the audit log "cannot be bypassed" -- that is not what is true.

No docstring, test name, or commit message in this plan's work claims the audit log
"cannot be bypassed." Commit messages describe what each fix actually does; test names
describe the specific behavior each test proves.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

`AuditedRead`/`open_audited_read`/`get_user_for_management` are ready for plan 02-05's
admin account-management routes (setup-link issuance, password reset) to call. No
blockers. One thing worth flagging forward: any future privileged cross-user read must
either route through this same capability pattern or be refused outright per D2-08 --
trading data gets no `AuditedRead` path, ever, per this plan's own docstring warning.

---
*Phase: 02-identity-sessions-and-tenant-isolation*
*Completed: 2026-08-31*

## Self-Check: PASSED

All created files confirmed present on disk (`src/morai/identity/audit.py`,
`tests/identity/test_audit.py`, `tests/gate/fixtures/violation_unaudited_read.py`,
`tests/gate/test_type_gate.py`, this SUMMARY). All four task/fix commits (`ba5d168`,
`99e120f`, `583d77d`, `72fd395`) confirmed present in `git log --oneline --all`.

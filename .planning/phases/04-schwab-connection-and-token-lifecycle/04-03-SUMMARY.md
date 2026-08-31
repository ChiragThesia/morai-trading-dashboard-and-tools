---
phase: 04-schwab-connection-and-token-lifecycle
plan: 03
subsystem: auth
tags: [schwab-py, postgres, advisory-lock, asyncio, pydantic, concurrency]

requires:
  - phase: 04-schwab-connection-and-token-lifecycle
    provides: "plan 04-01's SchwabAuth/SchwabClient Protocol, schwab_adapter.py's sole-importer boundary, connections.py's upsert_connection/read_connection, and tests/vendor/conftest.py's FakeSchwabAuth/FakeSchwabClient"
provides:
  - "SchwabAuth.build_client -- the third Protocol method, built over schwab-py's client_from_access_functions, taking plain synchronous token_read_func/token_write_func closures"
  - "TokenHolder and WrappedToken (protocol.py) -- the shared shapes a caller and the vendor exchange a token through"
  - "schwab_client_for_user (connections.py) -- the async context manager that holds a user's own pg_advisory_xact_lock(hashtext(user_id)) for the whole body, reads-then-yields-then-persists, never commits"
  - "FakeSchwabAuth.build_client and .entered_refresh (tests/vendor/conftest.py) -- the fake's matching implementation, reusing its own refresh()/refresh_gate/invalid_grant machinery, plus a signal a test can wait on to know the critical section has genuinely been entered"
affects: [04-04-notification-due]

actuals:
  tokens: 5874
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "pg_advisory_xact_lock(hashtext(:uid)) acquired before the token read, released by the caller's own commit -- transaction-scoped, no separate unlock path (mirrors tools/create_admin.py's existing precedent)"
    - "TokenHolder: a mutable holder over a plain object token value, exposing plain (never async def) read()/write() closures -- schwab-py's own token_write_func/token_read_func wrapping never awaits them, even under asyncio=True"
    - "asyncio.Event-based critical-section-entered signalling (entered_refresh) instead of a fixed sleep or pg_sleep, to deterministically prove one flow is inside its lock before starting a second"

key-files:
  created:
    - tests/vendor/test_refresh_lock.py
  modified:
    - src/morai/vendor/protocol.py
    - src/morai/vendor/schwab_adapter.py
    - src/morai/vendor/connections.py
    - tests/vendor/conftest.py

key-decisions:
  - "WrappedToken moved from schwab_adapter.py (private _WrappedToken) into protocol.py as a public shape -- TokenHolder's own read/write closures need the same {'creation_timestamp', 'token'} shape schwab-py's token_write_func already validates, and duplicating that model in two files was exactly the class of drift this project's docstrings elsewhere warn against."
  - "TokenHolder carries the token as an opaque object, not a decomposed (token, created_at) pair -- 'small mutable holder' per the plan's own wording; the wrap-on-the-way-in / unwrap-on-the-way-out logic lives in schwab_client_for_user, which is the only place that needs to reason about the token_created_at column."
  - "FakeSchwabAuth.build_client reuses the existing refresh() method rather than duplicating its rotation/invalid_grant logic -- refresh()'s docstring, which had incorrectly attributed itself to 'plan 04-02', is corrected to reflect that build_client (this plan, CONN-06) is its real caller."
  - "Added a new entered_refresh: asyncio.Event field to FakeSchwabAuth, set the instant refresh() is called, before any check or gate wait -- the plan's own text ('wait until the fake records that A has entered its critical section') implied a signal the pre-existing refresh_gate/CallRecord machinery did not yet expose (CallRecord is only appended after the gate opens)."

requirements-completed: [CONN-06]

coverage:
  - id: D1
    description: "Two concurrent refreshes of one user's token, on two independent engines, serialise -- neither raises invalid_grant, their critical sections (proven via the fake's own entry/exit timestamps) do not overlap, and the rotated token is durable with token_created_at unchanged."
    requirement: "CONN-06"
    verification:
      - kind: integration
        ref: "tests/vendor/test_refresh_lock.py#test_two_concurrent_refreshes_of_one_user_serialise_and_neither_fails"
        status: pass
    human_judgment: false
  - id: D2
    description: "User B's refresh completes and commits while user A is still inside its own critical section (an asyncio.Event the test controls, not a fixed sleep), asserted on ordering rather than eventual success -- the weaker assertion a single global lock also passes. The two users' lock keys are asserted distinct."
    requirement: "CONN-06"
    verification:
      - kind: integration
        ref: "tests/vendor/test_refresh_lock.py#test_user_bs_refresh_does_not_wait_behind_user_as"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-08-31
status: complete
---

# Phase 4 Plan 3: Per-User Token-Refresh Lock Summary

**A `pg_advisory_xact_lock(hashtext(user_id))`-scoped async context manager (`schwab_client_for_user`) that serialises one user's own token refreshes while leaving every other user's refresh unblocked, proven with a real negative control that fails under a constant lock key.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2
- **Files modified:** 5 (1 created, 4 modified)
- **Commits:** 2

## Accomplishments

- `SchwabAuth.build_client` added to the real `Protocol` (three methods now, all three called), taking plain synchronous `token_read_func`/`token_write_func` closures mirroring `client_from_access_functions`'s own parameter shape -- verified against the real 1.5.1 wheel, neither closure is ever awaited by schwab-py.
- `TokenHolder`/`WrappedToken` in `protocol.py`, shared by the real adapter and the fake -- `WrappedToken` was previously a private, duplicated shape inside `schwab_adapter.py`; moved to the one shared home for vendor-JSON shapes.
- `schwab_client_for_user` (`connections.py`): acquires the per-user advisory lock *before* reading the stored token (reading first is the exact bug this ordering exists to prevent), yields a client built over a `TokenHolder`, and -- only after the body returns normally -- re-encrypts and persists a rotated token, touching `token_ciphertext`/`token_nonce`/`key_version` only. Never commits; the caller's own transaction is what releases the lock.
- `FakeSchwabAuth.build_client` reuses the pre-existing `refresh()`/`refresh_gate`/`_rotated_refresh_tokens` machinery from plan 04-01 rather than duplicating it, and gains a new `entered_refresh: asyncio.Event` so a test can detect "the critical section has genuinely been entered" without a fixed sleep or `pg_sleep`.
- Two tests in `tests/vendor/test_refresh_lock.py`, both driving `schwab_client_for_user` directly on independent `app_async_dsn` engines (mirroring `test_setup_tokens.py`'s own two-engine-plus-`asyncio.gather` shape): one proving two refreshes of the same user serialise with no `invalid_grant`, one proving user B's refresh completes while user A is still inside its own critical section -- the actual content of CONN-06, since "both eventually succeed" is exactly the shape a single global lock also passes.

## Task Commits

Both plan tasks landed across two commits (the source implementation, then the test file, since the plan's own two tasks name the same shared test file and splitting it further added no signal):

1. **Task 1 + implementation:** `589c52d` (feat) -- `SchwabAuth.build_client`, `TokenHolder`/`WrappedToken`, `schwab_client_for_user`, and `FakeSchwabAuth.build_client`/`entered_refresh`.
2. **Task 1 + Task 2 tests:** `21c30e7` (test) -- both tests in `tests/vendor/test_refresh_lock.py`.

## Files Created/Modified

- `src/morai/vendor/protocol.py` -- `WrappedToken`, `TokenHolder`, `SchwabAuth.build_client`
- `src/morai/vendor/schwab_adapter.py` -- real `build_client` over `client_from_access_functions`; `_WrappedToken` removed in favour of the shared `WrappedToken`
- `src/morai/vendor/connections.py` -- `schwab_client_for_user`, `ConnectionNotFound`
- `tests/vendor/conftest.py` -- `FakeSchwabAuth.build_client`, `entered_refresh` field, corrected `refresh()` docstring
- `tests/vendor/test_refresh_lock.py` -- the two tests (new file)

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale docstring claim in `tests/vendor/conftest.py`**
- **Found during:** Task 1, while wiring `FakeSchwabAuth.build_client` to reuse `refresh()`
- **Issue:** `refresh()`'s own docstring said "refresh is plan 04-02's own concern" and the module docstring said "none of [04-02/04-03/04-04] touches this file" -- both became false the moment this plan added `build_client` to the real `Protocol`, which the fake must implement to type-check.
- **Fix:** Corrected both docstrings to name `build_client` (this plan, CONN-06) as `refresh()`'s real caller, and to describe what actually changed.
- **Files modified:** `tests/vendor/conftest.py`
- **Verification:** Read-only correction; no behavior change; full gate green.
- **Committed in:** `589c52d`

**2. [Rule 3 - Blocking] `@asynccontextmanager` + `AsyncIterator` return annotation is deprecated under the pinned basedpyright**
- **Found during:** Task 1, first basedpyright run on `connections.py`
- **Issue:** `reportDeprecated` fired on `-> AsyncIterator[SchwabClient]` -- basedpyright now requires `-> AsyncGenerator[SchwabClient]` for an `@asynccontextmanager`-decorated function.
- **Fix:** Changed the import and return annotation from `AsyncIterator` to `AsyncGenerator`.
- **Files modified:** `src/morai/vendor/connections.py`
- **Verification:** `basedpyright` 0 errors afterward.
- **Committed in:** `589c52d`

**3. [Rule 1 - Bug] Two `reportAny` leaks in the new test file's raw `hashtext()` reads**
- **Found during:** Post-implementation basedpyright pass on `tests/vendor/test_refresh_lock.py`
- **Issue:** `scalar_one()` on a raw `text("SELECT hashtext(:uid)")` result types as `Any`, same untyped-boundary shape the rest of the codebase already guards against with a module-level `TypeAdapter`.
- **Fix:** Added `_INT: TypeAdapter[int] = TypeAdapter(int)` and validated both `key_a`/`key_b` through it.
- **Files modified:** `tests/vendor/test_refresh_lock.py`
- **Verification:** `basedpyright`/`mypy` 0 errors; `ruff check`/`ruff format --check` clean.
- **Committed in:** `21c30e7`

---

**Total deviations:** 3 auto-fixed (1 stale-docs bug, 1 blocking type-checker version drift, 1 missing-boundary-narrowing bug). **Impact on plan:** All three are corrections to code this plan itself introduced or a doc claim this plan's own change made false; no scope creep.

## Issues Encountered

**Shared local Postgres contention from a sibling worktree agent, not a defect in this plan's code.** While verifying, several `uv run pytest` invocations failed with `UniqueViolationError: duplicate key value violates unique constraint "users_username_key"` and one with `DeadlockDetectedError` on concurrent `TRUNCATE`s. Diagnosis: `ls .claude/worktrees/` showed a second active agent worktree (`agent-a6662db65c750f4f0`, almost certainly the parallel 04-02 executor in this same wave) running its own test suite against the identical `DATABASE_URL=postgresql://morai:morai@localhost:5432/morai` -- there is no per-worktree database isolation, so two agents' `clean_identity_tables`/`seeded_users` fixtures raced each other's `TRUNCATE`/`INSERT` on the shared `users` table. Every failure of this shape reproduced identically regardless of which files were touched, and disappeared on retry once the sibling's window passed; isolated single-file runs of `tests/vendor/test_refresh_lock.py` and the full `bash tools/gate.sh` both went fully green (262 passed) once contention cleared. Not fixed here -- out of this plan's scope (multi-worktree DB isolation is an infra gap, not a token-refresh-lock concern) -- but recorded so a future flaky-test report against these tests is diagnosed correctly rather than re-litigated as a lock bug.

**Verified as a real negative control, not asserted on faith.** Before finalizing, the lock statement in `schwab_client_for_user` was temporarily pointed at a constant key (`hashtext('constant-negative-control')`) instead of `hashtext(:uid)`. Under that sabotage, `test_user_bs_refresh_does_not_wait_behind_user_as` failed with a `TimeoutError` -- user B's refresh genuinely blocked behind user A's held lock, exactly the v1 global-lock mistake CONN-06 exists to catch. The fix was reverted immediately afterward and the full gate re-run clean. This satisfies the plan's own bar: "a serialised-by-accident implementation must FAIL Task 2's positive control, not pass it."

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

Ready for 04-04 (notification-due). `schwab_client_for_user` is the primitive that plan will call when it needs a live, correctly-locked client for a given user; no further changes to `protocol.py`/`schwab_adapter.py`/`connections.py` are anticipated for that plan based on this one's shape.

**Recorded honestly, per the plan's own `<output>` instructions:**
- `invalid_grant` is modelled entirely by `FakeSchwabAuth`; it has never been observed against the real Schwab vendor in this phase (D4-14). No live Schwab call happens anywhere in this plan's test suite.
- The real seven-day refresh window is not observed here and cannot be from a single test run (D4-15). What is proven is the locking and the arithmetic (`derive_connection_health`, proven in plan 04-01, is unchanged by this plan): two refreshes of one user serialise correctly, and one user's refresh never blocks another's, for the pair of `(token_created_at, now)` values these tests actually exercise.

## Known Stubs

None.

## Self-Check: PASSED

- `src/morai/vendor/protocol.py` -- FOUND
- `src/morai/vendor/schwab_adapter.py` -- FOUND
- `src/morai/vendor/connections.py` -- FOUND
- `tests/vendor/conftest.py` -- FOUND
- `tests/vendor/test_refresh_lock.py` -- FOUND
- Commit `589c52d` -- FOUND in `git log --oneline`
- Commit `21c30e7` -- FOUND in `git log --oneline`
- Full local gate (`bash tools/gate.sh`): ruff, ruff format, basedpyright (84 files, 0 errors), mypy (84 files, success), pytest all green -- 262 passed (baseline 260 + 2 new)

---
*Phase: 04-schwab-connection-and-token-lifecycle*
*Plan: 03*
*Completed: 2026-08-31*

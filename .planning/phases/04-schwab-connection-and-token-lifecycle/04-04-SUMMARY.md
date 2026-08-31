---
phase: 04-schwab-connection-and-token-lifecycle
plan: 04
subsystem: auth
tags: [schwab-py, postgres, pydantic, health-derivation, honest-gaps]

requires:
  - phase: 04-schwab-connection-and-token-lifecycle
    provides: "plan 04-01's derive_connection_health, ConnectionRecord, read_connection, GET /schwab/connection; plan 04-03's schwab_client_for_user (the per-user advisory-lock refresh context manager) and its own stored-token_created_at-unchanged proof"
provides:
  - "tests/vendor/test_health.py -- 14 tests proving criterion 5: three health bands with both boundaries asserted on both sides (pure function and through the route), a real refresh leaving GET /schwab/connection's reported expires_at unchanged, and last_synced_at/reauth_notified_at reading null in Postgres and in the API after both a connect and a refresh"
  - "reauth_notified_at exposed as nullable on ConnectionRecord/read_connection/ConnectionResponse/GET /schwab/connection -- previously stored and migrated (04-01) but never read back through the route"
  - "derive_connection_health's own docstring stating D4-15 (the seven-day window has never been observed against a live Schwab connection) where a reader meets the function directly, not only in the module docstring or a plan"
affects: []

actuals:
  tokens: 1930
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Boundary-pair parametrization: every threshold gets two pytest.param cases, one second before and one second after, sharing named ids ('healthy-1s-before-...' / 'expiring_soon-1s-after-...') so a failure names which side of which boundary moved"
    - "Private-constant cross-import with an inline pyright:ignore[reportPrivateUsage] + why: comment (matching tests/crypto/test_envelope.py's existing convention) -- the test imports _REFRESH_TOKEN_LIFETIME/_EXPIRING_SOON_THRESHOLD directly from connections.py rather than hand-copying the seven-day/twelve-hour values, so a future change to either constant cannot silently desync the test from the code it tests"

key-files:
  created:
    - tests/vendor/test_health.py
  modified:
    - src/morai/vendor/connections.py
    - src/morai/api/models_connections.py
    - src/morai/api/routes_connections.py

key-decisions:
  - "reauth_notified_at's route/response wiring, though not explicitly separated into its own task in 04-04-PLAN.md, is required by Task 2's own <behavior> list ('The response model types both as nullable') -- added as part of Task 2's implementation, not treated as a deviation, since the plan's own behavior spec named it."
  - "The anchor test and the two refresh-gap tests drive schwab_client_for_user directly on an independent engine/session (the same shape test_refresh_lock.py::_refresh_over_own_engine already establishes) rather than through an HTTP route -- no route in this phase triggers a refresh, so this is the only way to exercise a real refresh end to end."

requirements-completed: [CONN-04, CONN-07]

coverage:
  - id: D1
    description: "Three health bands (healthy, expiring_soon, expired) with both boundaries -- the twelve-hour threshold and the seven-day expiry -- asserted on both sides, one second either way, as a pure-function parametrized test with named case ids."
    requirement: "CONN-04"
    verification:
      - kind: unit
        ref: "tests/vendor/test_health.py#test_health_bands_and_boundaries"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same three bands, read back through GET /schwab/connection after ageing the stored token_created_at, so the route and the unit proof cannot drift apart."
    requirement: "CONN-04"
    verification:
      - kind: integration
        ref: "tests/vendor/test_health.py#test_connection_health_bands_read_through_the_route"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real refresh through schwab_client_for_user leaves the expires_at GET /schwab/connection reports unchanged -- the anchor is token_created_at, not the moment of the last refresh."
    requirement: "CONN-04"
    verification:
      - kind: integration
        ref: "tests/vendor/test_health.py#test_refresh_does_not_move_the_reported_expires_at"
        status: pass
    human_judgment: false
  - id: D4
    description: "last_synced_at and reauth_notified_at read back null, in Postgres and in the API response, after a complete connect flow and again after a real refresh -- an honest gap, not a fabricated value."
    requirement: "CONN-07"
    verification:
      - kind: integration
        ref: "tests/vendor/test_health.py#test_last_synced_at_and_reauth_notified_at_are_null_after_connect"
        status: pass
      - kind: integration
        ref: "tests/vendor/test_health.py#test_last_synced_at_and_reauth_notified_at_stay_null_after_refresh"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-08-31
status: complete
---

# Phase 4 Plan 4: Connection Health Bands and the Two Honest Gaps Summary

**Three health bands with both boundaries asserted on both sides, a refresh proven not to move the reported `expires_at`, and `last_synced_at`/`reauth_notified_at` proven null through connect and refresh -- with `reauth_notified_at` newly wired onto `GET /schwab/connection`, which had never read it back before this plan.**

## Performance

- **Duration:** 35 min
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)
- **Commits:** 2

## Accomplishments

- `tests/vendor/test_health.py` (14 tests): 8 pure-function boundary cases over `derive_connection_health`, 3 API-level band cases read through `GET /schwab/connection` with the stored `token_created_at` aged via the superuser session, 1 anchor test proving a real refresh through `schwab_client_for_user` leaves the route's reported `expires_at` unchanged, and 2 tests proving `last_synced_at`/`reauth_notified_at` are null after both a connect and a refresh.
- `derive_connection_health` gained its own docstring (it previously had none -- only the module docstring covered its behavior) stating D4-15 plainly at the point a future reader meets the function directly: proven correct for arbitrary `(token_created_at, now)` pairs, never observed against a real Schwab window.
- `reauth_notified_at` is now exposed end to end: `ConnectionRecord`, `read_connection`, `ConnectionResponse`, and the `connection` route all carry it, typed nullable, alongside `last_synced_at`. It existed on the table and in the migration since 04-01 but `GET /schwab/connection` never read it back until this plan.
- The module docstring in `connections.py` gained a short paragraph naming both permanently-null columns and their owners (Phase 6 for `last_synced_at`, a later notification-delivery phase for `reauth_notified_at`), so a reader finding two NULL columns finds the reason next to them.

## Task Commits

1. **Task 1 + Task 2 (RED, mixed):** `73f8e05` (test) -- all 14 tests added; 12 (Task 1's bands/boundaries/anchor) passed green-on-arrival since 04-01/04-03 already implemented the arithmetic and locking correctly; 2 (Task 2's gap tests) genuinely failed with `AttributeError: 'ConnectionResponse' object has no attribute 'reauth_notified_at'`.
2. **Task 2 (GREEN):** `e84e142` (feat) -- wired `reauth_notified_at` through `ConnectionRecord`/`read_connection`/`ConnectionResponse`/the route, turning both RED tests green; added `derive_connection_health`'s own docstring and the module docstring's gap-ownership paragraph.

**Plan metadata:** commit follows this SUMMARY.

## Files Created/Modified

- `tests/vendor/test_health.py` -- the plan's own 14-test file (new)
- `src/morai/vendor/connections.py` -- `reauth_notified_at` added to `ConnectionRecord`/`read_connection`; `derive_connection_health`'s own docstring; module docstring's gap-ownership paragraph
- `src/morai/api/models_connections.py` -- `ConnectionResponse.reauth_notified_at: datetime | None`
- `src/morai/api/routes_connections.py` -- `connection` route now returns `reauth_notified_at`

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

None - plan executed exactly as written. `reauth_notified_at`'s route wiring was explicitly named in Task 2's own `<behavior>` list ("The response model types both as nullable"), so implementing it is following the plan, not a deviation from it.

## Issues Encountered

None.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

Ready for whatever plan next reads `reauth_notified_at` to decide a notification is due, and for Phase 6, which owns writing `last_synced_at` on a genuinely successful sync for the first time.

**Recorded honestly, per the plan's own `<output>` instructions:**
- Nothing writes `last_synced_at` in this phase, and the column is null by design -- criterion 5's last-sync half is satisfied by a queryable honest gap, proven both in Postgres and through the API response after a connect and after a refresh, not by a value.
- The seven-day expiry is proven as arithmetic only: `derive_connection_health` is correct for every `(token_created_at, now)` pair this suite exercises, including both sides of both boundaries. The real seven-day window has never been observed against a live Schwab connection (D4-15) and cannot be inside a test run -- that limit is now stated in the function's own docstring, not only in this plan.
- No live Schwab call happened anywhere in this plan's test suite (D4-14) -- every assertion runs against `FakeSchwabAuth`/`FakeSchwabClient`.

## Known Stubs

None. `last_synced_at` and `reauth_notified_at` remain honest `NULL` columns by deliberate scope decision (D4-16, D4-13), documented in this plan's own module-docstring addition and in `04-VALIDATION.md`'s scope-decisions section.

## Self-Check: PASSED

- `tests/vendor/test_health.py` -- FOUND
- `src/morai/vendor/connections.py` -- FOUND (modified)
- `src/morai/api/models_connections.py` -- FOUND (modified)
- `src/morai/api/routes_connections.py` -- FOUND (modified)
- Commit `73f8e05` -- FOUND in `git log --oneline`
- Commit `e84e142` -- FOUND in `git log --oneline`
- `uv run pytest -q tests/vendor/test_health.py -x` (Task 1's own verify): 14 passed
- `uv run pytest -q tests/vendor -x` (Task 2's own verify): all vendor tests passed
- Full local gate (`bash tools/gate.sh`): ruff, ruff format, basedpyright (0 errors), mypy (0 issues), pytest all green -- 281 passed (baseline 267 + 14 new)

---
*Phase: 04-schwab-connection-and-token-lifecycle*
*Plan: 04*
*Completed: 2026-08-31*

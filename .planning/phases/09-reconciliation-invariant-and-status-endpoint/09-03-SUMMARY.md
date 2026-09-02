---
phase: 09-reconciliation-invariant-and-status-endpoint
plan: 03
subsystem: api
tags: [fastapi, pydantic, reconciliation, rls, sqlalchemy]

requires:
  - phase: 09-reconciliation-invariant-and-status-endpoint
    provides: "plan 09-01's read_window_verdicts, ReconciliationRunRecord, record_reconciliation_run, and the reconciliation_runs schema/index"
provides:
  - "GET /reconciliation/status: one indexed read of the caller's own reconciliation state, never a recompute"
  - "DependentNumbersModel(ApiModel): the trustworthy: bool base every ledger-derived response now derives from (D9-14)"
  - "reconciliation_standing/reconciliation_trustworthy: the per-window trustworthiness signal, shared by the status route and /gate/positions"
  - "tests/api/: the API route test package, created for the first time"
affects: []

actuals:
  tokens: 3666
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Per-window latest-verdict aggregation (DISTINCT ON already in 09-01) reduced to trustworthy/latest/oldest_unresolved in one Python pass over one query result, never a second query per signal"
    - "TypeAdapter[dict[str, JsonValue]] to narrow a raw JSON body for a wire-format proof, reserved for the one assertion (money-as-string) where parsing through the real Pydantic model would hide the defect it exists to catch"

key-files:
  created:
    - src/morai/api/routes_reconciliation.py
    - tests/api/__init__.py
    - tests/api/conftest.py
    - tests/api/test_reconciliation_status.py
  modified:
    - src/morai/api/app.py
    - src/morai/api/models.py
    - src/morai/api/routes_identity.py

key-decisions:
  - "trustworthy is derived from every window's own latest verdict (via read_window_verdicts, already one DISTINCT ON scan), never from the single newest row -- an earlier draft's ceiling would have let an old unrepaired failure be cleared by any later window that passed, which is exactly the failure RECON-04 forbids. Implemented as originally specced by the plan, with the naive latest-row version built first, on purpose, to produce Test 11's real RED before the fix (see Issues Encountered)."
  - "FastAPI 0.141.1's include_router wraps each router in a private _IncludedRouter on app.routes rather than flattening routes directly (measured this session -- undocumented anywhere in the version's own changelog available locally). Test 10 and the acceptance-criteria route-table check both walk .original_router.routes recursively to reach the real APIRoute objects."
  - "Task 1's tests parse the response through the real ReconciliationStatusResponse model (typed, no Any) for every assertion except the money-as-JSON-string proof, which narrows the raw body through TypeAdapter[dict[str, JsonValue]] instead -- parsing through the real model would let UsdField's BeforeValidator silently coerce a numeric literal on the wire into Decimal, hiding the exact regression that assertion exists to catch."

patterns-established:
  - "A response model carrying any ledger-derived number derives from DependentNumbersModel, not ApiModel directly -- checked programmatically (issubclass, 'trustworthy' in model_fields) rather than by eye, so Phase 11's review surface inherits the rule at the type checker rather than by convention alone."
  - "A route needing the caller's trustworthiness signal calls reconciliation_trustworthy once per request, never once per row -- AST-checked at exactly two call sites in routes_identity.py."

requirements-completed: [RECON-03, RECON-04, API-01]

coverage:
  - id: D1
    description: "GET /reconciliation/status returns the caller's own latest verdict, the earliest unresolved window, and both sides plus the signed difference, in one indexed read that never recomputes"
    requirement: "API-01"
    verification:
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_no_recompute_when_events_and_broker_transactions_are_emptied"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_reconciliation_standing_makes_exactly_one_awaited_read"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_route_accepts_no_path_or_query_parameter"
        status: pass
    human_judgment: false
  - id: D2
    description: "trustworthy is false while any window is unresolved, not merely while the newest one is; a window is resolved only when a later run for that same trading_day passed"
    requirement: "RECON-04"
    verification:
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_older_unresolved_window_makes_trustworthy_false_despite_newer_pass"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_superseded_window_restores_trustworthy_true"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_earliest_unresolved_window_is_named_when_two_are_outstanding"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_indeterminate_window_counts_as_unresolved_like_failed"
        status: pass
    human_judgment: false
  - id: D3
    description: "The unresolved window is named in the response, so a failure discovered through trustworthy is answerable without a second call"
    requirement: "RECON-03"
    verification:
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_failed_row_reports_trustworthy_false_with_signed_difference"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every response carrying a ledger-derived number (PositionResponse, ReconciliationStatusResponse) derives from DependentNumbersModel and carries trustworthy inside its own envelope"
    requirement: "RECON-04"
    verification:
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_ledger_derived_response_models_derive_from_dependent_numbers_model"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_positions_list_carries_trustworthy_false_while_latest_verdict_failed"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_position_detail_matches_list_trustworthy_value"
        status: pass
    human_judgment: false
  - id: D5
    description: "No request shape can name another user's row (no path/query parameter); an unauthenticated request gets 401; one user's trustworthy is computed from that user's own runs alone"
    verification:
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_cross_user_isolation_a_never_sees_bs_row"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_unauthenticated_request_gets_401"
        status: pass
      - kind: integration
        ref: "tests/api/test_reconciliation_status.py#test_positions_trustworthy_is_computed_from_the_callers_own_runs"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-09-02
status: complete
---

# Phase 9 Plan 3: Reconciliation Status Endpoint Summary

**`GET /reconciliation/status` and `trustworthy` on every ledger-derived response, both reading the per-window latest verdict from one indexed scan and never recomputing.**

## Performance

- **Duration:** ~22 min (worktree base merge to final commit)
- **Started:** 2026-09-01T23:37:29-05:00 (worktree base merge)
- **Completed:** 2026-09-01T23:59:40-05:00
- **Tasks:** 2
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `GET /reconciliation/status` composed of `reconciliation_standing` (one call to `read_window_verdicts`, no second query) and `summarise_run`, returning `trustworthy`, `last_run`, and `unresolved_run` -- proven not to recompute both behaviourally (deleting `events`/`broker_transactions` leaves the response byte-identical) and structurally (an AST check that the route module imports nothing from `morai.ledger.reconciliation` but the two verdict enums).
- `trustworthy` derives from every window's own latest verdict, not the newest row alone: an older `failed` or `indeterminate` window keeps the whole caller untrustworthy even after a newer window passes, and is cleared only when a later run for that *same* `trading_day` returns `passed` (`D9-03`'s reopening-is-a-new-row rule). `unresolved_run` names the earliest such window, stable across repeated polls.
- `DependentNumbersModel(ApiModel)` added to `api/models.py` (`D9-14`); `PositionResponse` and `ReconciliationStatusResponse` both derive from it, checked programmatically rather than by eye. `/gate/positions` and `/gate/positions/{id}` populate `trustworthy` from one call each to `reconciliation_trustworthy` -- AST-checked at exactly two call sites, never once per position.
- `tests/api/` created for the first time -- `__init__.py`, `conftest.py` re-exporting the full fixture chain from `tests/ingest/conftest.py`, and `test_reconciliation_status.py` with 22 tests covering both tasks.

## Task Commits

1. **Task 1: A client can poll the caller's own reconciliation verdict, and the read never recomputes** - `11b38cf` (feat)
2. **Task 2: Every response carrying a ledger-derived number says whether to trust it** - `d3f8766` (feat)

## Files Created/Modified

- `src/morai/api/routes_reconciliation.py` - the status route, `ReconciliationRunSummary`/`ReconciliationStatusResponse`, `reconciliation_standing`/`reconciliation_trustworthy`
- `src/morai/api/models.py` - `DependentNumbersModel(ApiModel)` (`trustworthy: bool`)
- `src/morai/api/app.py` - `app.include_router(reconciliation_router)`
- `src/morai/api/routes_identity.py` - `PositionResponse` derives from `DependentNumbersModel`; both position routes populate `trustworthy`
- `tests/api/__init__.py` - new package
- `tests/api/conftest.py` - fixture re-exports (`logged_in_client`, `provisioned_users`, `seeded_position`, `clean_reconciliation_tables`, and their own transitive dependency chain)
- `tests/api/test_reconciliation_status.py` - 22 tests: the status route's 14 named behaviours plus the one-await cost proof (Task 1), and the 7 `/gate/positions` trustworthy behaviours plus the programmatic `DependentNumbersModel` check (Task 2)

## Decisions Made

- **`trustworthy` reads every window's own latest verdict, not the newest row.** This is what the plan itself specifies (a correction already made during planning, not a deviation found during execution) -- see `key-decisions` above and Issues Encountered below for how the naive version was built first, deliberately, to produce Test 11's real RED.
- **FastAPI 0.141.1's `include_router` wraps included routers in a private `_IncludedRouter`.** `app.routes` no longer flattens included routes directly (a change from the FastAPI behaviour this codebase's own docstrings were written against). Test 10 and the route-table acceptance check both walk `.original_router.routes` recursively — a `# pyright: ignore[reportPrivateUsage]` names why, matching this codebase's own convention for touching a private name from a cooperating module.
- **Money-as-JSON-string proof narrows the raw body through `TypeAdapter[dict[str, JsonValue]]`, not the real response model.** Parsing through `ReconciliationStatusResponse` would let `UsdField`'s `BeforeValidator` silently accept a numeric literal on the wire (Pydantic's own strict-mode dict-path Decimal validator only runs after the validator normalises the type), which would defeat the exact assertion `D-03` requires.

## Deviations from Plan

None requiring Rules 1-4. The plan's own `<flagged_assumptions>` already specified the corrected (per-window) `trustworthy` semantics; this plan built exactly that. The `_IncludedRouter` discovery is a measured fact about the installed FastAPI version, not a plan deviation — the route-table check's *shape* (walk the route table, assert one path with no parameter) is unchanged from the plan's own acceptance criteria; only the traversal needed adjusting to reach it.

## Issues Encountered

- **Test 11's RED was produced by building the naive (latest-row-only) `reconciliation_standing` first, deliberately, per the plan's own TDD instruction.** Command and real output:

  ```
  $ uv run pytest tests/api/test_reconciliation_status.py::test_older_unresolved_window_makes_trustworthy_false_despite_newer_pass -q
  ...
      response = await logged_in_client.get("/reconciliation/status")
      body = response.json()
      assert body["last_run"]["trading_day"] == "2026-06-18"
  >   assert body["trustworthy"] is False
  E   assert True is False

  tests/api/test_reconciliation_status.py:486: AssertionError
  FAILED tests/api/test_reconciliation_status.py::test_older_unresolved_window_makes_trustworthy_false_despite_newer_pass
  ```

  The naive implementation read only the single most recent run's own verdict; an older `failed` window (2026-06-10) was cleared the moment a newer `passed` window (2026-06-18) landed, reporting `trustworthy: true` — exactly the failure `RECON-04` forbids. `reconciliation_standing` was then rewritten to derive `trustworthy`/`unresolved_run` from every window's own latest verdict (via `read_window_verdicts`, already one query), and the full suite (including Test 12, the superseded-window guard) went green.
- **FastAPI 0.141.1 wraps `include_router` output in a private `_IncludedRouter`** (see Decisions Made above) — discovered when the naive route-table assertion (`route.path for route in app.routes`) returned zero matches despite the route answering real HTTP requests correctly. Resolved by walking `.original_router.routes` recursively.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `GET /reconciliation/status` and `trustworthy` on `/gate/positions` are both live and reading through the real write path this phase's plan 09-01 built. Phase 11's review surface inherits `DependentNumbersModel` rather than re-deciding whether a response needs a trustworthiness signal.
- Plan 09-02 (the seeded-discrepancy arithmetic proof against `reconcile_window`) runs in a separate worktree this same wave; this plan did not touch `src/morai/ledger/reconciliation.py` or `tests/ledger/test_reconciliation.py` (confirmed via `git diff --exit-code`), and read only the two verdict enums from that module.
- `bash tools/gate.sh` is green at 619 tests (597 baseline entering this phase + 22 new in `tests/api/test_reconciliation_status.py`).
- No blockers.

---
*Phase: 09-reconciliation-invariant-and-status-endpoint*
*Completed: 2026-09-02*

## Self-Check: PASSED

- FOUND: src/morai/api/routes_reconciliation.py
- FOUND: tests/api/__init__.py
- FOUND: tests/api/conftest.py
- FOUND: tests/api/test_reconciliation_status.py
- FOUND: .planning/phases/09-reconciliation-invariant-and-status-endpoint/09-03-SUMMARY.md
- FOUND commit: 11b38cf
- FOUND commit: d3f8766

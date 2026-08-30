---
phase: 01-walking-skeleton
plan: 06
subsystem: api
tags: [fastapi, pydantic, response-validation, error-handling, security]

requires:
  - phase: 01-walking-skeleton (01-03)
    provides: "the tracer app (src/morai/api/app.py) with /health and /gate/money-roundtrip, ApiModel, StrictDecimalField"
provides:
  - "src/morai/api/errors.py: request-id middleware plus opaque ResponseValidationError/Exception handlers (D-10)"
  - "tests/gate/routes_negative_control.py: deliberately-broken routes proving criterion 5's actual gap (D-07 applied to API-07)"
  - "tests/gate/test_api_boundary.py: 15 assertions covering the opaque envelope, request-id/log correlation, NN-34, D-09/D-11/D-12"
affects: [phase-2-auth, phase-4-schwab-integration]

actuals:
  tokens: 5440
  tasks: 2
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Request-id propagation via contextvars.ContextVar[str], never request.state (State.__getattr__ returns Any, which reportAny flags on every read)"
    - "A negative-control response model overrides model_config with revalidate_instances='always' so FastAPI actually re-validates a model_construct()'d return value instead of skipping it as already-the-declared-type"
    - "response.json() consumed only through an immediate typed Pydantic model_validate() boundary or response.text, never stored as an indexed raw dict (reportAny discipline)"

key-files:
  created:
    - src/morai/api/errors.py
    - tests/gate/routes_negative_control.py
    - tests/gate/test_api_boundary.py
  modified:
    - src/morai/api/app.py

key-decisions:
  - "Request-id middleware and both exception handlers wired via one install_error_handling(app) call at construction, not inline in app.py, so app.py stays a route file"
  - "The catch-all Exception handler is registered at the bare Exception key, which FastAPI/Starlette routes to the outer ServerErrorMiddleware (always re-raises after sending the response); tests observe that response via httpx ASGITransport(raise_app_exceptions=False) rather than fighting the re-raise"
  - "Negative-control response models locally set revalidate_instances='always' (not on the shared ApiModel) -- otherwise model_construct() bypasses re-validation entirely and FastAPI returns 200 with a silently wrong body, which is exactly the D-09/criterion-5 gap these routes exist to prove closed"

patterns-established:
  - "Deliberately-broken routes must type-check clean; runtime wrongness comes from model_construct() plus (for the extra-field case) a direct __dict__ merge bypassing frozen=True, never from returning a structurally-mismatched type"
  - "D-11 conformance (no response_model= kwarg under src/morai/api/) checked via ast.parse + Call/keyword inspection over git ls-files output, not a text grep -- a text grep also matches this file's own docstrings naming the keyword in prose"

requirements-completed: [API-07, OPS-02]

coverage:
  - id: D1
    description: "A response-validation failure (missing field or forbidden extra field) returns an opaque {error, request_id} body, never the raw Pydantic detail"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_response_validation_failure_returns_opaque_body_with_request_id"
        status: pass
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_missing_field_response_raises"
        status: pass
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_extra_field_response_raises"
        status: pass
    human_judgment: false
  - id: D2
    description: "The full Pydantic detail reaches the server log, keyed by the same request id returned to the client"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_response_validation_failure_logs_full_detail_keyed_by_request_id"
        status: pass
    human_judgment: false
  - id: D3
    description: "A secret-shaped value in scope at the moment of a response-validation failure reaches the server log and never the client body (NN-34)"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_response_validation_failure_never_echoes_a_secret_shaped_value"
        status: pass
    human_judgment: false
  - id: D4
    description: "An unhandled exception of any other type produces the same opaque 500 shape, keyed and logged the same way"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_unhandled_exception_returns_same_opaque_shape"
        status: pass
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_unhandled_exception_logs_full_detail_keyed_by_request_id"
        status: pass
    human_judgment: false
  - id: D5
    description: "The 422 request-validation path is untouched by the opaque envelope"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_request_validation_422_keeps_normal_detail"
        status: pass
    human_judgment: false
  - id: D6
    description: "Request bodies reject a coerced value for a typed field (strict int, strict Decimal float/int) and an unknown key, all 422 not a silent 200"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_strict_int_rejects_coerced_string"
        status: pass
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_strict_decimal_rejects_a_json_float"
        status: pass
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_strict_decimal_rejects_a_json_int"
        status: pass
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_unknown_request_key_is_rejected"
        status: pass
    human_judgment: false
  - id: D7
    description: "StrictDecimalField still accepts D-03's own wire format (a JSON string) -- the one negative control that must succeed"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_strict_decimal_accepts_the_json_string_form"
        status: pass
    human_judgment: false
  - id: D8
    description: "No route under src/morai/api/ declares the response_model= keyword (D-11)"
    requirement: "API-07"
    verification:
      - kind: unit
        ref: "tests/gate/test_api_boundary.py#test_no_route_under_src_morai_api_declares_response_model"
        status: pass
    human_judgment: false
  - id: D9
    description: "Both type checkers (basedpyright strict, mypy --strict) stay clean across src and tests, including the deliberately-broken negative-control router"
    requirement: "OPS-02"
    verification:
      - kind: unit
        ref: "uv run basedpyright && uv run mypy src tests"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-08-30
status: complete
---

# Phase 1 Plan 6: API Boundary -- Request ID, Opaque Errors, Routes That Must Fail Summary

**Opaque two-key error envelope keyed by a `contextvars`-propagated request id, plus negative-control routes proving `response_model`'s real gap (silently-dropped extra fields and undetected type mismatches, not missing-field validation) is closed by strict/forbid response models.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2
- **Files modified:** 4 (`src/morai/api/errors.py` and `tests/gate/routes_negative_control.py` created; `tests/gate/test_api_boundary.py` created and extended twice; `src/morai/api/app.py` modified by 2 lines)

## Accomplishments

- `src/morai/api/errors.py`: a request-id middleware (`uuid4().hex` per request, propagated via `contextvars.ContextVar[str]`) plus two exception handlers -- one for `ResponseValidationError`, one catch-all `Exception` -- both returning exactly `{"error": "internal", "request_id": "..."}`. Full Pydantic detail (and, for the catch-all, the traceback via `exc_info`) goes to the server log only, keyed by the same id. The 422 (`RequestValidationError`) path is untouched.
- `tests/gate/routes_negative_control.py`: an `APIRouter` mounted only in tests, with two response-side negative controls (missing required field, forbidden extra field -- both proving criterion 5's actual gap, since FastAPI's own `revalidate_instances='never'` default would otherwise let a `model_construct()`'d bad response through as a 200) and two request-side negative controls (`StrictIntRequest`, `StrictDecimalRequest`) exercising `ApiModel`'s `strict=True`/`extra="forbid"`.
- `tests/gate/test_api_boundary.py`: 15 tests -- opaque envelope shape and log correlation, a direct NN-34 proof that a secret-shaped value reaches the log but never the client body, the 422-untouched case, strict-int/strict-Decimal request validation (including the one case that must succeed: the JSON string form), the two response-side negative controls, and an `ast`-based scan proving zero `response_model=` usages under `src/morai/api/`.
- `src/morai/api/app.py`: wired with `install_error_handling(app)` at construction. `/health` and `/gate/money-roundtrip` (the tracer, DB-marked) are unaffected -- confirmed by importing the real app and inspecting its route table, and by `tests/test_money_roundtrip.py` still collecting its 6 db-marked tests cleanly.

## Task Commits

Both tasks followed the plan's TDD requirement with separate red and green commits:

1. **Task 1: Request id and opaque error envelope**
   - `caf74fe` (test) -- 6 tests for the opaque envelope; `install_error_handling` a stub. Red: 5 failed, 1 passed (the 422 test passes trivially, since it needs nothing from this plan).
   - `3d540d6` (feat) -- real `errors.py` implementation, wired into `app.py`. Green: 6 passed.
2. **Task 2: Routes that are supposed to fail**
   - `bbbd1f7` (test) -- extended `test_api_boundary.py` to import `tests.gate.routes_negative_control`, which does not exist yet. Red: collection error (`ModuleNotFoundError`).
   - `8379155` (feat) -- `routes_negative_control.py` created. Green: 14 passed.
3. **Additional: secret-shaped-value proof** (requested explicitly by the calling context, beyond the plan's literal task list; scoped to the same files, no plan deviation)
   - `dcf488e` (test) -- `test_response_validation_failure_never_echoes_a_secret_shaped_value`, a direct NN-34 assertion. Passed on the first run (the mechanism built in the two commits above already generalises).

_No separate "docs: complete plan" metadata commit was made prior to this summary; STATE.md/ROADMAP.md/REQUIREMENTS.md updates and the final metadata commit follow this summary per the execute-plan workflow._

## Files Created/Modified

- `src/morai/api/errors.py` -- request-id middleware, `ResponseValidationError`/`Exception` handlers, `install_error_handling(app)`
- `src/morai/api/app.py` -- calls `install_error_handling(app)` at construction (2-line change)
- `tests/gate/routes_negative_control.py` -- deliberately-broken `APIRouter`, mounted only in tests
- `tests/gate/test_api_boundary.py` -- 15 tests over a throwaway app; no database

## Decisions Made

- **Request-id propagation via `contextvars.ContextVar[str]`, not `request.state`.** `starlette.datastructures.State.__getattr__` is typed to return `Any` on every read, which basedpyright's `reportAny` (set to `error` in this repo's `pyproject.toml`) flags. A `ContextVar[str]` is fully typed and, because Starlette runs a request through one `await` chain with no new `asyncio.Task`, stays visible to the `ResponseValidationError` handler (nested inside this middleware's own `call_next` via `ExceptionMiddleware`) -- so the response header and body share one id on that path. The catch-all `Exception` handler is dispatched differently: FastAPI routes the bare-`Exception` key to Starlette's *outer* `ServerErrorMiddleware`, which sits outside this middleware and always re-raises after sending the response (so a process supervisor still sees the crash). By the time that handler runs, this middleware's `finally` has already reset the context var, so it falls back to a fresh id -- correct, since no header was written for that response either.
- **`raise_app_exceptions=False` on the test client's `ASGITransport`.** Confirmed empirically (`httpx/_transports/asgi.py`): `ServerErrorMiddleware` re-raises after sending the response for any handler registered at the bare `Exception`/500 key, and httpx's default (`raise_app_exceptions=True`) re-raises that to the caller instead of returning the response. Without this, the catch-all-exception test would raise `RuntimeError` in the test itself rather than observing the 500.
- **Negative-control response models set `revalidate_instances='always'` locally, not on the shared `ApiModel`.** Confirmed empirically: FastAPI skips re-validating a return value that is already an instance of the declared response type (pydantic's default is `revalidate_instances='never'`), so `model_construct()` alone produces a silent 200 with a wrong body -- not a `ResponseValidationError`. This override is what makes the missing-field and extra-field negative controls actually exercise D-09's fix rather than accidentally proving nothing.
- **D-11 conformance checked with `ast`, not a text search.** A naive substring search for `"response_model"` false-positived on this project's own docstrings (`app.py`, `models.py`, `errors.py` all name the keyword in prose per D-11's own writeup). Parsing with `ast` and checking `Call.keywords` for `arg == "response_model"` catches only actual keyword-argument usage.
- **The extra-field negative control attaches the forbidden key via `object.__setattr__(obj, "__dict__", {**obj.__dict__, "unexpected": "oops"})`, not via `model_construct(..., unexpected=...)`.** Confirmed empirically: under `extra="forbid"`, `model_construct()` silently discards an unrecognised kwarg rather than storing it, so the direct `__dict__` merge (bypassing `frozen=True`'s `__setattr__`) is the only way to get a genuinely-extra attribute onto an instance of a model that forbids one.

## Deviations from Plan

**One addition beyond the plan's literal task list, not a deviation from it:** the calling context's report-back instructions explicitly asked for "proof a secret-shaped input does not appear in the error response," which the plan's `<behavior>`/`<verify>` blocks describe qualitatively (NN-34, the threat register's `T-01-22`) but do not spell out as a discrete test. Added `test_response_validation_failure_never_echoes_a_secret_shaped_value` plus its supporting route (`secret_in_scope_route`) inside the already-owned `tests/gate/test_api_boundary.py` -- no new file, no scope change to `src/`. Passed on the first run against the existing implementation, confirming the mechanism from Task 1 generalises without route-specific handling.

No other deviations. Plan executed as written, including the TDD red-then-green commit pairs for both tasks.

## Issues Encountered

- **`revalidate_instances='never'` (pydantic's default) meant `model_construct()` alone was insufficient to trigger `ResponseValidationError`** -- the first implementation attempt returned a silent 200 for both the missing-field and extra-field negative controls, which would have proven nothing. Resolved by giving the negative-control response models a local `revalidate_instances='always'` override, confirmed by direct experimentation against the real FastAPI/pydantic versions in this venv before writing the tests.
- **`extra="forbid"` silently discards an unrecognised `model_construct()` kwarg** rather than raising or storing it -- confirmed empirically. Resolved via the `object.__setattr__(obj, "__dict__", ...)` technique documented above.
- **A naive text-based `response_model` grep false-positived on this project's own docstrings.** Resolved by switching to `ast`-based `Call`/`keyword` inspection.
- **`ServerErrorMiddleware` always re-raises after sending a response for a bare-`Exception` handler**, which would have made the catch-all-exception test raise instead of observing the 500 through httpx's default `ASGITransport`. Resolved with `raise_app_exceptions=False` on this file's own `client` fixture (this file owns its fixture; `conftest.py` was not touched).

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- The opaque error envelope and request-id correlation are in place and will carry forward unchanged into Phase 4, when real Schwab tokens start flowing through routes that can fail response validation.
- `tests/gate/` now holds two files (this plan's) alongside whatever sibling wave-4 plans added to the same directory in parallel; `tests/gate/__init__.py` was deliberately not created or touched by this plan, per the wave's file-ownership boundary.
- No blockers. `/gate/money-roundtrip` (the tracer) and `/health` remain wired and unaffected -- confirmed via route-table inspection and by `tests/test_money_roundtrip.py` continuing to collect its db-marked tests.

## Self-Check: PASSED

All claimed files exist on disk (`src/morai/api/errors.py`, `src/morai/api/app.py`,
`tests/gate/routes_negative_control.py`, `tests/gate/test_api_boundary.py`); all five
commit hashes (`caf74fe`, `3d540d6`, `bbbd1f7`, `8379155`, `dcf488e`) are present in
`git log`.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-08-30*

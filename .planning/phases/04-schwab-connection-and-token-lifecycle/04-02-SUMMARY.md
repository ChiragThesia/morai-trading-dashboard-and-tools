---
phase: 04-schwab-connection-and-token-lifecycle
plan: 02
subsystem: auth
tags: [schwab-py, oauth, fastapi, sqlalchemy, asyncio, concurrency, pytest]

requires:
  - phase: 04-schwab-connection-and-token-lifecycle
    provides: "04-01's schwab_connections table, the OAuth routes, upsert_connection's repair-in-place write path, and tests/vendor/conftest.py's FakeSchwabAuth/FakeSchwabClient"
provides:
  - "tests/vendor/test_oauth_flow.py -- genuinely concurrent OAuth callbacks proven with an asyncio.Barrier, the atomic oauth_state consume proven at the consume_token level on two independent engines, and replayed/unknown/expired states proven rejected identically"
  - "tests/vendor/test_reauth.py -- re-auth proven to leave a second user's row byte-identical, and an expired connection proven repaired to healthy with the row count still 1"
  - "tests/vendor/test_tracer_connect.py's CONN-03 log-capture test widened to cover the received URL and the rejected-state/failing-exchange paths, not just the success path"
affects: [04-03-health-and-reauth, 04-04-notification-due]

actuals:
  tokens: 3700
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A minimal, test-local SchwabAuth implementation (not the shared conftest fake) when a test needs per-call behaviour the shared fake's fields can't express -- _BarrierGatedSchwabAuth derives its account hash from raw_state so a payload swap under concurrency fails the assertion, which a fixed shared account_entries list could not prove"
    - "httpx.ASGITransport(app=app, raise_app_exceptions=False) for observing an opaque 500 response inside a test, instead of letting the exception propagate to pytest -- needed whenever a fake is made to raise mid-route"

key-files:
  created:
    - tests/vendor/test_oauth_flow.py
    - tests/vendor/test_reauth.py
    - .planning/phases/04-schwab-connection-and-token-lifecycle/deferred-items.md
  modified:
    - tests/vendor/test_tracer_connect.py

key-decisions:
  - "Task 2 and Task 3 as planned were superseded by 04-01's own overshoot (04-01 added CONN-03/CONN-05 proofs to close a gap between its requirements and its behaviour list, per its own SUMMARY's Deviations section). The orchestrating harness supplied a verified per-task disposition before this plan ran; each was checked against the actual code before acting on it, not trusted blind -- see Deviations below for where the disposition needed correcting."
  - "Task 2: widened test_tracer_connect.py's existing test in place (renamed to test_no_log_record_or_response_body_contains_the_code_url_or_state) rather than adding a second test in test_oauth_flow.py, per the disposition's explicit instruction. Kept the existing morai-namespace log scoping that deliberately excludes httpx's own ASGITransport request-logging artifact -- that reasoning was sound and untouched -- while adding the received-URL fragment to the leak check and raising the schwab/authlib loggers to DEBUG as explicit regression guards."
  - "Task 3: the disposition said 04-01 already satisfies 'the whole criterion' via test_reauth_repairs_the_row_instead_of_duplicating_it. On inspection that claim was half right: that test does prove the row-count-stays-1-with-changed-ciphertext-and-advanced-timestamp property, but it only ever touches one user and never ages a connection, so it does not prove the plan's other-user-untouched or expired-then-healthy behaviours (both named in the plan's own <behavior> list and success_criteria). Wrote tests/vendor/test_reauth.py covering exactly those two gaps, deliberately not re-proving what 04-01's test already proves."

requirements-completed: [CONN-01, CONN-02, CONN-03, CONN-05]

coverage:
  - id: D1
    description: "Two users' OAuth callbacks genuinely overlap (enforced by an asyncio.Barrier sized two, so a serialised implementation times out rather than passing quietly); each lands its own row, cross-checked by account hash and token content so a payload swap under concurrency would fail loudly."
    requirement: "CONN-01"
    verification:
      - kind: integration
        ref: "tests/vendor/test_oauth_flow.py#test_two_overlapping_callbacks_each_land_their_own_users_row"
        status: pass
    human_judgment: false
  - id: D2
    description: "One oauth_state nonce consumed concurrently on two independent database engines yields exactly one winner, mirroring setup_tokens' own two-engine proof at the consume_token level."
    requirement: "CONN-02"
    verification:
      - kind: integration
        ref: "tests/vendor/test_oauth_flow.py#test_concurrent_consume_of_one_oauth_state_produces_exactly_one_winner"
        status: pass
    human_judgment: false
  - id: D3
    description: "A replayed state, a never-issued state, and an expired state are all rejected with an identical 400 and create no row -- the failure mode is not an oracle."
    requirement: "CONN-02"
    verification:
      - kind: integration
        ref: "tests/vendor/test_oauth_flow.py#test_replayed_unknown_and_expired_states_are_rejected_identically_with_no_row"
        status: pass
    human_judgment: false
  - id: D4
    description: "Across a successful callback, a rejected-state callback, and a callback whose vendor exchange raises, no captured log record (morai, schwab, or authlib namespaces) and no response body contains the code, the received URL, or the state; the failing-exchange path still returns a correlatable request_id."
    requirement: "CONN-03"
    verification:
      - kind: integration
        ref: "tests/vendor/test_tracer_connect.py#test_no_log_record_or_response_body_contains_the_code_url_or_state"
        status: pass
    human_judgment: true
    rationale: "Proves the application's own logger and the vendor/OAuth-library loggers are clean under an in-process ASGITransport suite. It structurally cannot observe Hypercorn's real production access log -- that gap is Manual-Only in 04-VALIDATION.md and needs a human to confirm on the deployed service."
  - id: D5
    description: "Re-authorising an existing connection leaves a second user's row byte-identical across every column."
    requirement: "CONN-05"
    verification:
      - kind: integration
        ref: "tests/vendor/test_reauth.py#test_reauth_leaves_the_other_users_row_byte_identical"
        status: pass
    human_judgment: false
  - id: D6
    description: "A connection whose token_created_at is eight days old reads expired, and re-authorising it reads healthy again with the row count still exactly 1 -- no operator step anywhere in the flow."
    requirement: "CONN-05"
    verification:
      - kind: integration
        ref: "tests/vendor/test_reauth.py#test_expired_connection_reads_expired_then_healthy_after_reauth"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-08-31
status: complete
---

# Phase 4 Plan 2: OAuth Concurrency, Atomic Consume, and Re-auth Row Integrity Summary

**Three new/widened test proofs against 04-01's already-implemented OAuth path: genuinely overlapping callbacks proven with an `asyncio.Barrier`, one `oauth_state` nonce proven consumed exactly once on two independent database engines, and re-authorisation proven to leave the other user's row untouched and an expired connection repaired to healthy -- no source changes anywhere.**

## Performance

- **Duration:** 40 min
- **Started:** 2026-08-31T20:35:00Z (approx.)
- **Completed:** 2026-08-31T21:16:19Z
- **Tasks:** 3 (Task 1 executed in full; Task 2 widened an existing test rather than adding a new one; Task 3 covered only the two behaviours 04-01's own re-auth test didn't already prove)
- **Files modified:** 4 (2 created, 1 modified, 1 deferred-items log created)

## Accomplishments

- `tests/vendor/test_oauth_flow.py` -- a test-local `_BarrierGatedSchwabAuth` proves two users' callbacks genuinely overlap (a serialised implementation times out via `asyncio.wait_for` on the barrier instead of passing quietly), each landing its own row cross-checked by account hash and token content.
- The same file mirrors `test_setup_tokens.py`'s own two-independent-engines proof at the `consume_token` level, changing only the purpose to `OAUTH_STATE`, plus a three-way replayed/unknown/expired rejection test asserting identical 400s and no row created in any case.
- `tests/vendor/test_tracer_connect.py`'s CONN-03 proof widened in place to also cover the received URL, a rejected-state path, and a failing-exchange path (via `ASGITransport(..., raise_app_exceptions=False)`), with `schwab`/`authlib` loggers raised to DEBUG as explicit regression guards alongside the existing, still-correct `httpx`-exclusion reasoning.
- `tests/vendor/test_reauth.py` -- proves the two CONN-05 behaviours 04-01's own re-auth test doesn't exercise: a second user's row is byte-identical across every column after the first user's re-auth, and a connection aged past seven days reads `expired` then `healthy` again after a real re-auth, with the row count staying exactly 1 throughout (asserted with `SELECT count(*)`, not `scalar_one_or_none`).
- `.planning/phases/04-schwab-connection-and-token-lifecycle/deferred-items.md` -- logs a pre-existing, intermittent full-suite test flake discovered while running the plan's own gate, with evidence it is unrelated to this plan's changes.

## Task Commits

1. **Task 1: Genuinely concurrent callbacks, and one state consumed exactly once** - `cf6e7ce` (test)
2. **Task 2: No captured log record or response body carries the code, the URL, or the state** - `69109e8` (test)
3. **Task 3: Re-authorisation repairs the row -- the count stays at one** - `a551693` (test)

_All three tasks went green on arrival (no red observed) -- expected and stated up front in the plan's own `<environment>` block, since every behaviour asserted here was already implemented by 04-01. No scaffolding was built to manufacture a red._

## Files Created/Modified

- `tests/vendor/test_oauth_flow.py` - concurrent callbacks, atomic consume, replay/unknown/expired rejection
- `tests/vendor/test_reauth.py` - other-user-untouched and expired-then-healthy re-auth proofs
- `tests/vendor/test_tracer_connect.py` - CONN-03 log-capture proof widened to the received URL and two additional paths
- `.planning/phases/04-schwab-connection-and-token-lifecycle/deferred-items.md` - pre-existing full-suite flake, logged not fixed

## Decisions Made

See `key-decisions` in the frontmatter above. In short: the harness's own per-task disposition for Tasks 2 and 3 was verified against the actual code rather than trusted at face value. Task 2's disposition ("widen the existing test, do not write a second one") was accurate and followed exactly. Task 3's disposition ("already satisfied by 04-01, skip") was half right -- the row-count-and-timestamp property is proven, but two of the plan's own named behaviours (other-user-untouched, expired-then-healthy) were not, so `test_reauth.py` was written to cover exactly that gap rather than being skipped outright or fully re-implemented.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4-adjacent, but resolved without a checkpoint -- verified disposition correction] Task 3's "skip entirely" disposition would have left two of the plan's own named behaviours unproven**
- **Found during:** Reading 04-01's `test_reauth_repairs_the_row_instead_of_duplicating_it` before acting on the injected disposition for Task 3
- **Issue:** The disposition claimed that single test satisfies "Task 3's whole criterion." It proves the row count stays 1 and `token_created_at` advances across a second handshake for one user -- it never touches a second user, and never ages a connection past seven days. The plan's own `<behavior>` list and `success_criteria` both name "the other user's row is untouched" and "an expired connection reads expired, then healthy after re-auth" as required proofs, neither covered.
- **Fix:** Wrote `tests/vendor/test_reauth.py` with exactly the two missing tests, explicitly not re-implementing the row-count/ciphertext/timestamp property 04-01 already proves (see that file's own module docstring, which names the existing test by function name as the reason).
- **Files modified:** `tests/vendor/test_reauth.py` (new)
- **Verification:** Both new tests pass; full local gate green (`bash tools/gate.sh`).
- **Committed in:** `a551693`

**2. [Rule 3 - Blocking, type-check] `AccountNumberEntry`'s synthesized `__init__` rejects direct field-name kwargs despite `populate_by_name=True`**
- **Found during:** Task 1, first `basedpyright` run
- **Issue:** basedpyright's synthesized Pydantic `__init__` signature for `AccountNumberEntry` only accepts the alias kwargs (`accountNumber`/`hashValue`), not the field names, even though `populate_by_name=True` allows it at runtime. Six `reportCallIssue` errors across the two direct-construction call sites.
- **Fix:** Switched both call sites to `AccountNumberEntry.model_validate({"accountNumber": ..., "hashValue": ...})`, matching the exact convention `test_tracer_connect.py`'s own `install_fake_schwab_auth` fixture already uses.
- **Files modified:** `tests/vendor/test_oauth_flow.py`
- **Verification:** `basedpyright`/`mypy` both clean afterward.
- **Committed in:** `cf6e7ce`

**3. [Rule 1 - Bug, test-only] `httpx.CookieConflict` when copying a cookie between clients for the failing-exchange sub-test**
- **Found during:** Task 2, first `pytest` run of the widened test
- **Issue:** Copying `logged_in_client.cookies["morai_session"]` onto a fresh client raised `CookieConflict` (multiple jar entries for the same cookie name, one from the response's own `Set-Cookie` processing and one from the fixture's explicit `.set()` call).
- **Fix:** Removed the cookie copy entirely -- `/schwab/callback` is unauthenticated by design (`test_callback_with_no_session_cookie_still_succeeds` already proves this), so the fresh client needs no cookie at all.
- **Files modified:** `tests/vendor/test_tracer_connect.py`
- **Verification:** Test passes; comment added explaining why no cookie is needed.
- **Committed in:** `69109e8`

**4. [Rule 3 - Blocking, type-check] `httpx.Response.json()` types as `Any`**
- **Found during:** Task 2, `mypy` run after the pytest fix above
- **Issue:** `failing.json()` returns `Any` per httpx's stubs, tripping `reportAny`.
- **Fix:** Added a `TypeAdapter[dict[str, str]]` (`_ERROR_ENVELOPE`) narrowing `_opaque_500`'s known shape, and read via `.validate_json(failing.content)` instead of `.json()`, matching the project's own stated convention (`model_validate`/`TypeAdapter` over `cast`).
- **Files modified:** `tests/vendor/test_tracer_connect.py`
- **Verification:** `mypy`/`basedpyright` both clean.
- **Committed in:** `69109e8`

---

**Total deviations:** 4 (1 disposition-verification correction, 2 blocking type-check fixes, 1 test-only bug fix). **Impact on plan:** All four were necessary to make the plan's own stated success criteria provable and the suite type-clean; none touched `src/`, matching the plan's explicit scope boundary.

## Issues Encountered

**A pre-existing, intermittent full-suite test flake, unrelated to this plan's changes.** Running `bash tools/gate.sh` (which runs the full `uv run pytest`, not just this plan's files) occasionally failed or errored a scattered, run-to-run-varying set of tests across many files this plan never touched (`tests/identity/*`, `tests/crypto/test_nonce_uniqueness.py`, `tests/ledger/*`, `tests/test_isolation.py`, `tests/test_pg_dump_confidentiality.py`, and even a gate meta-test, `tests/gate/test_vendor_boundary.py`, in one run where a working-tree file had been temporarily renamed for a control experiment). Isolated evidence that this is pre-existing:

- `tests/vendor/` run on its own passed cleanly and repeatably across every attempt (both `pytest-randomly`'s default random order and `-p no:randomly`).
- With this plan's two new files excluded via `--ignore`, the very next full-suite run still showed the same class of scattered failures in files this plan never touched (`test_account_deletion.py`, `test_login_logout.py`, `test_setup_tokens.py`, `test_nonce_uniqueness.py`).
- A subsequent clean `bash tools/gate.sh` run (ruff, ruff format, basedpyright, mypy, pytest -- all green, 265 passed) is the evidence attached to this SUMMARY as the plan's own verification.

Root cause is not confirmed -- logged as a hypothesis (connection-pool/fixture-teardown timing pressure under `pytest-randomly`'s reordering across ~265 `db`-marked tests) in `deferred-items.md`, not fixed here, per this plan's own scope (`src/` changes are explicitly out of bounds; see 04-02-PLAN.md's `<verification>`) and the executor's scope-boundary rule (don't fix pre-existing issues unrelated to the current task's changes).

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

Ready for 04-03 (health and re-auth). The two new test files and the widened proof establish:
- Genuine concurrency is provable and proven for the OAuth callback path (a template plan 04-03/04-04 can follow for their own concurrency claims, if any).
- `NN-34`'s discipline holds across three distinct request paths, not just the happy path.
- Re-auth's row-integrity guarantees are proven per-user and for the expired case specifically, not just "a connection exists."

**Flag for whoever next runs the full suite:** see "Issues Encountered" above -- a locally green `bash tools/gate.sh` is necessary but not sufficient; a second run is worth the ~15 extra seconds given the observed intermittent flake.

## Known Stubs

None.

## Threat Flags

None -- this plan added no new surface. `T-04-09` through `T-04-14` (the six threats this plan's own `<threat_model>` names) were all already open against 04-01's implementation; this plan's tests are exactly their proofs (see `coverage` above), not new surface needing its own flag.

## Self-Check: PASSED

- `tests/vendor/test_oauth_flow.py` -- FOUND
- `tests/vendor/test_reauth.py` -- FOUND
- `.planning/phases/04-schwab-connection-and-token-lifecycle/deferred-items.md` -- FOUND
- Commit `cf6e7ce` -- FOUND in `git log --oneline`
- Commit `69109e8` -- FOUND in `git log --oneline`
- Commit `a551693` -- FOUND in `git log --oneline`
- Full local gate (`bash tools/gate.sh`): ruff, ruff format, basedpyright, mypy, pytest all green -- 265 passed (baseline 260 + 5 net new: 3 in test_oauth_flow.py, 0 net new in test_tracer_connect.py's widened test, 2 in test_reauth.py)

---
*Phase: 04-schwab-connection-and-token-lifecycle*
*Plan: 02*
*Completed: 2026-08-31*

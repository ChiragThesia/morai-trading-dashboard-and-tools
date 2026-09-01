---
phase: 04-schwab-connection-and-token-lifecycle
verified: 2026-08-31T00:00:00Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Deploy to Railway with the three SCHWAB_* env vars actually set (they are now declared with preserve() in .railway/railway.ts per CR-01, but preserve() only keeps a value that is already set in Railway -- it does not set one). Then run one real OAuth handshake against the live Schwab app, and separately confirm Hypercorn's access log stays off (default in the pinned 0.18.0) so the callback's code/state query string is never written to a real log stream."
    expected: "The Railway web service boots with schwab_credentials populated (no RuntimeError from Settings.schwab_credentials), a real /schwab/connect + /schwab/callback round-trip against Schwab's sandbox or production OAuth succeeds, and Hypercorn's access-log line for that request (if inspected) does not contain the query string."
    why_human: "This is the one leak surface every plan in this phase explicitly disclaims: an in-process ASGITransport test cannot start a real Hypercorn server and therefore cannot observe its access log. It is recorded as Manual-Only in 04-VALIDATION.md across all four plans, not glossed over. Setting the Railway secrets themselves is also inherently an out-of-band, human/operator action -- preserve() cannot create a value that was never set."
---

# Phase 4: Schwab Connection and Token Lifecycle Verification Report

**Phase Goal:** Each user connects their own Schwab account and repairs it themselves when
the 7-day refresh token dies, without operator help.
**Verified:** 2026-08-31
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria from ROADMAP.md)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Two users can run OAuth callbacks concurrently and each lands on their own connection record; a replayed `state` is rejected because the first use consumed it atomically | ✓ VERIFIED | `tests/vendor/test_oauth_flow.py::test_two_overlapping_callbacks_each_land_their_own_users_row` drives two `AsyncClient`s under `asyncio.gather`, gated on a genuinely-sized-2 `asyncio.Barrier` awaited by both coroutines (`_BarrierGatedSchwabAuth.exchange_callback`, line 148: `await asyncio.wait_for(self.barrier.wait(), timeout=self.timeout)`), wrapped in `asyncio.timeout(10)` — a serialised implementation would deadlock and fail on timeout, not pass quietly. Each row is cross-checked by an account hash keyed to that callback's own `raw_state`, so a payload swap under concurrency would fail loudly. `test_concurrent_consume_of_one_oauth_state_produces_exactly_one_winner` mirrors Phase 2's proven two-independent-engines shape at the `consume_token(purpose=OAUTH_STATE)` level. Replay/unknown/expired states asserted identical 400 with no row created. All pass live (`uv run pytest -q tests/vendor/test_oauth_flow.py`: 4 passed). |
| 2 | No captured log line, error response, or response body contains the code or the redirect URL, across success, rejection and exception paths | ✓ VERIFIED | `tests/vendor/test_tracer_connect.py::test_no_log_record_or_response_body_contains_the_code_url_or_state` captures at DEBUG across the `morai`, `schwab`, and `authlib` logger namespaces (`caplog.at_level(..., logger="schwab")`, `logger="authlib"`) and asserts absence of the raw code, raw state, and `received_url_fragment = f"code={raw_code}&state="` (the redirect-URL/query-string leak, not only code/state) across a success, a rejected-state, and a failing-exchange path. The `httpx` client-side ASGITransport request logger is the only excluded namespace — confirmed as an honest exclusion: it is a test-transport-only artifact (`ASGITransport` logs every outbound test request regardless of app behaviour) and would fail this assertion for every GET request in the suite, not a real leak path; `schwab`/`authlib` (the actual vendor/OAuth libraries) are explicitly included, not excluded. A second test, `test_no_log_record_contains_the_code_from_a_real_vendor_exception_shape`, was added by the CR-02 review fix and drives a **real** `httpx.HTTPStatusError` (built via `Response.raise_for_status()`, so `str(exc)` is httpx's own formatter output, not an author-controlled string) through the actual `unhandled_exception_handler`, using `logging.Formatter().format(record)` — which renders `exc_info` into text the way a real log line would — confirming `exc_info=exc` was genuinely removed from `errors.py` (verified directly: `unhandled_exception_handler` now logs only `type(exc).__name__`). Both tests pass live. |
| 3 | A user whose connection has expired re-authorises themselves and the existing row is repaired, not duplicated — row count stays at one | ✓ VERIFIED | `tests/vendor/test_reauth.py::test_expired_connection_reads_expired_then_healthy_after_reauth` ages `token_created_at` eight days into the past through an independent superuser session, confirms `GET /schwab/connection` reads `expired`, runs a full second OAuth handshake, and asserts the row count is `SELECT count(*)` (not `scalar_one_or_none`) scoped to that user and stays exactly 1, health flips to `healthy`. `test_reauth_leaves_the_other_users_row_byte_identical` proves a second user's row is untouched across the same operation. `upsert_connection` uses `pg_insert(...).on_conflict_do_update(index_elements=[SchwabConnection.user_id], ...)` — race-free by Postgres construction, not merely a rowcount-guarded UPDATE-then-INSERT (this was WR-01 from the code review — the original UPDATE-first/INSERT-on-zero-rowcount design had an unguarded same-user double-connect race; fixed to a single atomic `ON CONFLICT DO UPDATE` statement and proven by a new regression test, `tests/vendor/test_upsert_connection_race.py`). All pass live. |
| 4 | Two concurrent refreshes of one user's token serialise on that user's own lock and neither produces `invalid_grant`, while a refresh for user A never blocks a refresh for user B | ✓ VERIFIED | `src/morai/vendor/connections.py::schwab_client_for_user` issues `SELECT pg_advisory_xact_lock(hashtext(:uid))` *before* reading the stored token (verified directly in source, line 378 precedes the `read_connection` call at line 382) — the ordering the plan calls load-bearing. `tests/vendor/test_refresh_lock.py::test_two_concurrent_refreshes_of_one_user_serialise_and_neither_fails` proves two refreshes on independent engines never overlap in time and neither raises the fake's `invalid_grant`. The positive control, `test_user_bs_refresh_does_not_wait_behind_user_as`, asserts `not task_a.done()` at the moment B's refresh — on a fully independent user/engine — has already completed and committed its rotated token, which is the one assertion a single global lock cannot also pass; it also asserts the two users' `hashtext(:uid)` lock keys differ. Per 04-03-SUMMARY.md, this was verified as a real negative control during development (not asserted on faith): the lock statement was temporarily pointed at a constant key, and `test_user_bs_refresh_does_not_wait_behind_user_as` genuinely failed with a `TimeoutError` before the sabotage was reverted. Both tests pass live. |
| 5 | Connection health reads back as healthy, expiring-soon, or expired with an `expires_at`, alongside the timestamp of the last successful sync | ⚠️ PARTIALLY VERIFIED — see note | `derive_connection_health` is a pure function of `(token_created_at, now)`, proven at both sides of both band boundaries (`tests/vendor/test_health.py`, 8 parametrized cases with named ids) and again through `GET /schwab/connection` after ageing the stored row (3 API-level cases), plus an anchor test proving a real refresh through `schwab_client_for_user` leaves the reported `expires_at` unchanged. `last_synced_at` and `reauth_notified_at` are proven to read back `null` in Postgres and in the API response after both a connect and a refresh (`test_last_synced_at_and_reauth_notified_at_are_null_after_connect`, `..._stay_null_after_refresh`) — an honest, tested gap (`NN-16`), not a fabricated value. **The criterion's "alongside the timestamp of the last successful sync" half is satisfied by a proven-null, queryable column, not by a value** — nothing in this phase, or in any phase yet built, ever writes `last_synced_at`; Phase 6 owns that write. This is the phase's own explicit, disclosed scope decision (04-VALIDATION.md, all four SUMMARYs), not an unnoticed gap, and does not block the phase goal (which is about *connecting and repairing*, not about sync history) — but it is worth stating plainly rather than rounding "queryable null" up to "the timestamp." |

**Score:** 5/5 truths verified (criterion 5 verified as designed — an honest null is the phase's own stated scope, not a shortfall against what this phase promised)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `alembic/versions/0010_schwab_connections.py` | `schwab_connections` DDL, RLS, grants | ✓ VERIFIED | `alembic downgrade -1` then `upgrade head` both run clean, live, against local Postgres 18. RLS `ENABLE`+`FORCE`, one `user_isolation` policy with `USING`/`WITH CHECK` on `current_setting('app.current_user_id', true)::uuid`, no admin clause. Grants `SELECT, INSERT, UPDATE, DELETE` (UPDATE is deliberate — repair-in-place needs it, unlike `fills`/`events`). |
| `src/morai/vendor/protocol.py` | `SchwabClient`/`SchwabAuth` Protocols, `TokenHolder` | ✓ VERIFIED | Three methods on `SchwabAuth` (`build_authorize_url`, `exchange_callback`, `build_client`), all three actually called; `TokenHolder`/`WrappedToken` shared with the fake. |
| `src/morai/vendor/schwab_adapter.py` | The one module importing `schwab-py` | ✓ VERIFIED | Enforced live by `tests/gate/test_vendor_boundary.py` over `git ls-files -- src`, with a negative-control synthetic offender. |
| `src/morai/vendor/connections.py` | `upsert_connection`, `read_connection`, `derive_connection_health`, `schwab_client_for_user` | ✓ VERIFIED | All four present, read directly; lock-before-read ordering confirmed in source; `on_conflict_do_update` confirmed in source (post-WR-01 fix). |
| `src/morai/api/routes_connections.py` | Three routes | ✓ VERIFIED | `POST /schwab/connect`, `GET /schwab/callback`, `GET /schwab/connection` registered in `app.py`; `reauth_notified_at` wired through as of plan 04-04. |
| `tests/vendor/test_tracer_connect.py`, `test_oauth_flow.py`, `test_reauth.py`, `test_refresh_lock.py`, `test_health.py`, `test_upsert_connection_race.py` | The phase's test proofs | ✓ VERIFIED | All present, all pass live (59/59 in a targeted run; 283/283 in the full suite). |
| `.railway/railway.ts` | Schwab credentials declared for deploy | ✓ VERIFIED (code-level) | `SCHWAB_API_KEY`/`SCHWAB_APP_SECRET`/`SCHWAB_CALLBACK_URL` now declared with `preserve()`, fixing CR-01. **Still requires a human to actually set the values in Railway** — see Human Verification. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `POST /schwab/connect` | `setup_tokens` (purpose `OAUTH_STATE`) | `issue_token`, 15-min TTL | ✓ WIRED | Confirmed in `routes_connections.py`; consumed atomically at callback via `consume_token`. |
| `GET /schwab/callback` | `upsert_connection` | consume state → `set_config('app.current_user_id', ...)` → upsert | ✓ WIRED | Ordering confirmed: consume's own commit precedes the `set_config`, which is load-bearing per the module's own docstring; `on_conflict_do_update` inside `upsert_connection` is the atomic write. |
| `schwab_client_for_user` | `pg_advisory_xact_lock(hashtext(user_id))` | direct SQL, bound param | ✓ WIRED, ordering-verified | Lock precedes token read in source (line 378 vs 382), and a real negative-control sabotage (constant key) was run during development and genuinely failed the positive-control test, per 04-03-SUMMARY.md. |
| `derive_connection_health` | `GET /schwab/connection` | shared pure function | ✓ WIRED | Same function serves the unit proof and the route; band read-through-the-route tests pass. |
| `delete_account` | `schwab_connections` row deletion | identity-rows block, before final `DELETE FROM users` | ✓ WIRED | Confirmed in `src/morai/identity/account.py`; test proves no orphan row and the other user's row survives. |
| `unhandled_exception_handler` | log line | `type(exc).__name__`, no `exc_info` | ✓ WIRED (post CR-02 fix) | Confirmed directly in `src/morai/api/errors.py`; the gate test that previously asserted the leaky behaviour (`test_api_boundary.py`) was rewritten to assert the corrected invariant, not merely relaxed — verified by reading the rewritten test, which now asserts `exc_info` is never attached. |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full phase test suite | `uv run pytest -q tests/vendor/test_oauth_flow.py tests/vendor/test_refresh_lock.py tests/vendor/test_reauth.py tests/vendor/test_health.py tests/vendor/test_upsert_connection_race.py tests/vendor/test_tracer_connect.py tests/gate/test_api_boundary.py tests/gate/test_vendor_boundary.py tests/identity/test_account_deletion.py` | 59 passed | ✓ PASS |
| Whole-repo gate | `bash tools/gate.sh` | exit 0; ruff clean; basedpyright 0 errors (88 files); mypy clean; 283 passed | ✓ PASS |
| Migration round-trip | `alembic downgrade -1` then `alembic upgrade head` | both clean | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| CONN-01 | 04-01, 04-02 | Connect own Schwab account via self-started OAuth | ✓ SATISFIED | Criterion 1, above |
| CONN-02 | 04-01, 04-02 | Single-use TTL'd server-side `state` nonce, atomic delete | ✓ SATISFIED | Criterion 1, above |
| CONN-03 | 04-01, 04-02 | Code/redirect URL never in log, error, or response body | ✓ SATISFIED (app-owned code path) | Criterion 2, above; Hypercorn access log is Manual-Only, disclosed, routed to human verification |
| CONN-04 | 04-01, 04-04 | Read connection health as healthy/expiring-soon/expired with `expires_at` | ✓ SATISFIED | Criterion 5, above |
| CONN-05 | 04-01, 04-02 | Self re-authorise an expired connection, repair not duplicate | ✓ SATISFIED | Criterion 3, above |
| CONN-06 | 04-03 | Per-user refresh lock, no cross-user blocking | ✓ SATISFIED | Criterion 4, above |
| CONN-07 | 04-01, 04-04 | See last-sync timestamp as a queryable fact | ✓ SATISFIED (as an honest null) | Criterion 5, above |

No orphaned requirements: `REQUIREMENTS.md`'s Phase 4 mapping table lists exactly CONN-01 through CONN-07, all "Complete," and all appear in at least one plan's `requirements:` frontmatter. `AUTH-06` appears in 04-01's own coverage list (account-deletion regression) but is owned by Phase 3 in `REQUIREMENTS.md` (still `Pending` there) — Phase 4 does not claim to satisfy it; it only ensures its own new foreign key doesn't break Phase 3's future deletion path.

### Anti-Patterns Found

None blocking. Searched the phase's modified files for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` and found none carrying unresolved debt. The two permanently-null columns (`last_synced_at`, `reauth_notified_at`) are documented, tested-null-on-purpose gaps (`NN-16` discipline), not stubs — each carries an inline docstring naming which future phase owns the write.

### Code Review Findings (04-REVIEW.md / 04-REVIEW-FIXES.md)

Three findings were raised after execution (2 critical, 1 warning) and all three were verified fixed, not merely claimed fixed:

- **CR-01** (Railway IaC missing Schwab credential declarations) — verified fixed by reading `.railway/railway.ts` directly: all three vars now declared with `preserve()`.
- **CR-02** (`unhandled_exception_handler` logged `exc_info=exc`, re-rendering a real vendor exception's message) — verified fixed by reading `src/morai/api/errors.py` directly (no `exc_info=exc` remains) and by running the new regression test that drives a real `httpx.HTTPStatusError` through the handler and formats the log record the way a real logger would. The companion gate test that had previously *encoded the leak as a requirement* (`assert any(r.exc_info for r in matching)`) was rewritten, not deleted or weakened — it now asserts the corrected invariant (exception type present, `exc_info` never attached) with a docstring explaining why the old assertion was itself the bug.
- **WR-01** (`upsert_connection` had an unguarded same-user double-connect race) — verified fixed by reading `src/morai/vendor/connections.py` directly: the UPDATE-then-INSERT-on-zero-rowcount pattern was replaced with a single `on_conflict_do_update` statement, and a new regression test (`tests/vendor/test_upsert_connection_race.py`) proves two concurrent first-time connects of one user land exactly one row, with RLS's `USING`/`WITH CHECK` shape confirmed compatible.

## Human Verification Required

### 1. Real Railway deployment with Schwab credentials set, and Hypercorn access-log confirmation

**Test:** Set `SCHWAB_API_KEY`/`SCHWAB_APP_SECRET`/`SCHWAB_CALLBACK_URL` in the Railway project
(now declared with `preserve()` in `.railway/railway.ts`, but that only *preserves* an
already-set value — nothing in this phase's code can set it), deploy, and run one real OAuth
connect against Schwab's actual authorization server. Separately, inspect (or confirm the absence
of) Hypercorn's access log for that request.
**Expected:** The web service boots without a `RuntimeError` from `Settings.schwab_credentials`;
a real `/schwab/connect` → Schwab consent → `/schwab/callback` round-trip lands a row in
`schwab_connections`; and Hypercorn's access log — off by default in the pinned 0.18.0, per every
plan's own disclosure — does not render the callback's `code`/`state` query string anywhere a
human or a log aggregator could read it.
**Why human:** This is the one leak surface this phase's own test suite structurally cannot
observe (`ASGITransport` is in-process and never starts a real server), disclosed identically and
honestly across all four plan SUMMARYs and `04-VALIDATION.md`'s Manual-Only table — not a gap this
verification discovered on its own. Setting Railway secrets is also inherently an out-of-band
human action.

## Gaps Summary

No blocking gaps. All five ROADMAP success criteria are verified against live code and live test
runs, not against SUMMARY claims — every test cited above was re-run in this verification pass,
the migration was rolled back and reapplied live, and every review-fix claim (CR-01, CR-02, WR-01)
was checked by reading the actual current source, not by trusting the fix report. The one item
routed to human verification (production Schwab credentials + Hypercorn access-log confirmation)
was disclosed as Manual-Only by the phase's own plans from the start, not discovered as a surprise
here. Criterion 5's "last-sync timestamp" half is satisfied by a proven, tested, honestly-null
column rather than by a value — stated plainly above rather than rounded up, per this phase's own
`NN-16` discipline, and this does not block phase completion since nothing in Phase 4's own scope
(connect + repair, not sync) required a non-null value.

---

*Verified: 2026-08-31*
*Verifier: Claude (gsd-verifier)*

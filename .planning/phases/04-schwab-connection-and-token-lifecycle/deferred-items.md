# Deferred Items -- Phase 4

Out-of-scope discoveries, logged per the executor's scope-boundary rule rather than
fixed quietly. None of these are fixed by 04-02; none of 04-02's own two new test files
(`tests/vendor/test_oauth_flow.py`, `tests/vendor/test_reauth.py`) or its widening of
`tests/vendor/test_tracer_connect.py` caused them.

## 1. `uv run pytest` is intermittently flaky across the whole suite, pre-existing

**Found during:** 04-02, running `bash tools/gate.sh` after Task 3.

**Symptom:** A full `uv run pytest` run occasionally fails or errors a scattered set of
`db`-marked tests across many unrelated files -- observed failures/errors in
`tests/identity/test_account_deletion.py`, `tests/identity/test_login_logout.py`,
`tests/identity/test_setup_tokens.py`, `tests/crypto/test_nonce_uniqueness.py`,
`tests/ledger/test_tracer_encrypted_fill.py`, `tests/ledger/test_roll_check_constraint.py`,
`tests/ledger/test_plaintext_queries.py`, `tests/test_isolation.py`,
`tests/test_pg_dump_confidentiality.py`, and `tests/vendor/test_tracer_connect.py`. The
specific set of failing tests differs run to run -- consistent with `pytest-randomly`
picking a different collection order each time and some tests being sensitive to it, not
with a single deterministic bug in one file.

**Evidence this is pre-existing, not introduced by 04-02:** with both of 04-02's new test
files temporarily excluded (`--ignore=tests/vendor/test_oauth_flow.py
--ignore=tests/vendor/test_reauth.py`), the same class of scattered, unrelated failures
still occurred on the very next run (`test_account_creation_provisions_exactly_one_key_at_version_one`,
`test_one_users_logout_does_not_touch_another_users_session`,
`test_me_returns_the_callers_own_record_and_nothing_names_another`,
`test_no_raw_token_or_hash_in_any_log_record`, and three `test_nonce_uniqueness.py` tests
errored). None of those files are touched by 04-02. Separately, `tests/vendor/` run on its
own (`uv run pytest tests/vendor/`) passed cleanly and repeatably across every attempt in
this plan, including with the fuller suite's random-order plugin active
(`-p no:randomly` and default randomised order both green).

**Not investigated further:** root cause is unconfirmed. The failure shapes seen
(`sqlalchemy.exc.NoResultFound` on a freshly-provisioned user's own DEK, a login route
returning 401 for a request the test just authenticated) are consistent with connection-
pool or fixture-teardown timing pressure across ~265 `db`-marked tests sharing the same
local Postgres instance under `pytest-randomly`'s reordering, but this is a hypothesis, not
a measurement -- no profiling was done, per the time-box and this plan's own
`files_modified` scope (`src/` changes here are out of bounds; see 04-02-PLAN.md's
`<verification>`).

**Recommended next step:** whichever future phase or plan next touches test infrastructure
should either pin `pytest-randomly`'s seed in CI/local runs to make failures reproducible,
or investigate connection-pool sizing/fixture teardown ordering directly. Until then, a
locally green `bash tools/gate.sh` is necessary but not sufficient evidence of a passing
suite -- a second run is worth the ~15 extra seconds if the first one is suspiciously fast
or slow.

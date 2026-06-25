---
phase: 11-sidecar-scaffold-auth-migration
plan: "04"
subsystem: sidecar-python
tags: [tdd, token-store, advisory-lock, gw-01, gw-04, postgres, pgcrypto]
status: complete

requires:
  - 11-01  # RED scaffold test files committed in prior plan
  - 11-02  # schema migration adds token_json JSONB column

provides:
  - apps/sidecar/token_store.py
  - apps/sidecar/advisory_lock.py
  - apps/sidecar/tests/conftest.py

affects:
  - broker_tokens (dual-write: token_json + encrypted discrete columns)
  - GW-01 (token round-trip contract)
  - GW-04 (single-streamer advisory lock)

tech-stack:
  added:
    - psycopg2-binary>=2.9 (token store + advisory lock DB driver)
    - pytest>=8.0 (Python/pytest CI lane)
  patterns:
    - dual-write (token_json blob + decomposed pgcrypto encrypted columns)
    - pg_try_advisory_lock session-level on autocommit direct connection
    - bound %s params for all secrets (encryption_key never interpolated)

key-files:
  created:
    - apps/sidecar/token_store.py
    - apps/sidecar/advisory_lock.py
    - apps/sidecar/tests/conftest.py
    - apps/sidecar/.gitignore
  modified: []

decisions:
  - "timezone-aware datetime objects used (datetime.now(UTC)) instead of deprecated utcnow()"
  - "conftest uses session-scoped autouse fixture to create+seed broker_tokens once per pytest run"
  - ".venv placed inside apps/sidecar/ (not project root) to stay isolated from Bun workspace"

metrics:
  duration: "~4 minutes"
  completed: "2026-06-25T22:00:55Z"
  tasks_completed: 1
  files_created: 4
  files_modified: 0
---

# Phase 11 Plan 04: Token-Store Callbacks + Advisory Lock — TDD Green Summary

Token-store dual-write callbacks and Postgres advisory-lock guard implemented from scratch,
turning the 11-01 RED scaffolds green. Four tests pass; refresh_issued_at anchor preserved;
encryption key never interpolated or logged.

## Objective

Turn the 11-01 RED scaffolds (test_token_store.py, test_advisory_lock.py) green by
implementing `token_store.py`, `advisory_lock.py`, and `tests/conftest.py`.

## What Was Built

### `apps/sidecar/token_store.py`

`make_token_callbacks(db_url, app_id, encryption_key)` returns two callables:

- **token_read_func()**: `SELECT token_json FROM broker_tokens WHERE app_id = %s`;
  raises `ValueError("No token found for app_id=...")` when token_json is NULL or row
  absent, giving the FastAPI lifespan a clear degraded-state signal (RESEARCH Open Q2).

- **token_write_func(token)**: dual-writes the full schwab-py wrapped blob to `token_json`
  AND decomposes `inner['access_token']` / `inner['refresh_token']` via
  `pgp_sym_encrypt(%s, %s)` into the existing discrete bytea columns.
  `refresh_issued_at` is absent from the SET clause; `issued_at`, `expires_at`, and
  `updated_at` are updated on each rotation.  Logs only `app_id` + `issued_at` — no
  token values (V6 / T-11-04-01).

Security invariants confirmed:
- encryption_key passed as `%s` bound parameter in every `cur.execute()` call
- No f-string, `.format()`, or `%` string interpolation of any secret
- `grep -n 'refresh_issued_at' token_store.py` returns only comment lines

### `apps/sidecar/advisory_lock.py`

`SIDECAR_LOCK_KEY = 8876543210` (documented constant; stable bigint).

`acquire_sidecar_lock(direct_db_url)`:
- Opens a psycopg2 connection with `autocommit = True` (session-level lock requires it)
- Executes `SELECT pg_try_advisory_lock(%s)` with `SIDECAR_LOCK_KEY`
- On `False`: closes conn, calls `logging.error("...another sidecar instance is running...")`,
  raises `SystemExit(1)`
- On `True`: logs info, returns the open connection (caller holds it for process lifetime)

No explicit `pg_advisory_unlock` call — Postgres releases session-level locks on
connection close, including crashes (§ Don't Hand-Roll).

### `apps/sidecar/tests/conftest.py`

Session-scoped autouse fixture `_setup_db`:
- Connects to test Postgres (Docker port 5499 by default; overrideable via env vars)
- Runs `CREATE EXTENSION IF NOT EXISTS pgcrypto`, `DROP TABLE IF EXISTS broker_tokens`,
  then `CREATE TABLE broker_tokens (...)` mirroring the Drizzle schema exactly
- Seeds one row for `app_id='test-trader'` with synthetic encrypted tokens and
  `refresh_issued_at = NOW() - INTERVAL '1 day'` (fixed anchor for the P02 invariant test)
- `token_json` starts NULL (seeded by test_token_round_trip via token_write_func)

Per-test fixtures:
- `db_url` — direct connection string (port 5499 — not a pooler)
- `app_id` — `"test-trader"`
- `enc_key` — synthetic 32-char key; passed only as bound param, never logged

### `apps/sidecar/.gitignore`

Excludes `__pycache__/`, `.venv/`, `*.pyc`, `.pytest_cache/` from git.

## pytest Run — GREEN

```
============================= test session starts ==============================
platform darwin -- Python 3.14.6, pytest-9.1.1, pluggy-1.6.0
rootdir: /Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/apps/sidecar
configfile: pytest.ini
collected 4 items

tests/test_token_store.py::test_token_round_trip                  PASSED  [ 25%]
tests/test_token_store.py::test_refresh_issued_at_unchanged       PASSED  [ 50%]
tests/test_advisory_lock.py::test_second_instance_fails           PASSED  [ 75%]
tests/test_advisory_lock.py::test_first_instance_acquires         PASSED  [100%]

========================= 4 passed, 1 warning in 0.16s =========================
```

Warning: `PytestConfigWarning: Unknown config option: asyncio_mode` — pytest-asyncio is
not yet installed (it is not needed for these synchronous tests; 11-05 adds it to
requirements.txt). The warning does not affect test collection or results.

Command used to run:
```bash
cd apps/sidecar && .venv/bin/python3 -m pytest tests/test_token_store.py tests/test_advisory_lock.py -x -q -v
```

Environment note: `pytest` and `psycopg2-binary` were pip-installed into a local
`.venv/` (not global system Python on macOS 3.14 which blocks `pip install`). The `.venv/`
is gitignored. 11-05 will add `requirements.txt` with pinned deps for Railway Dockerfile.

## Python Environment Setup

```bash
# Created during this plan execution:
python3 -m venv apps/sidecar/.venv
apps/sidecar/.venv/bin/pip install pytest psycopg2-binary
# Docker container for test Postgres:
docker run -d --name morai_test_pg -e POSTGRES_PASSWORD=testpw \
  -e POSTGRES_USER=testuser -e POSTGRES_DB=testdb \
  -p 5499:5432 postgres:16-alpine
```

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| `pytest tests/test_token_store.py tests/test_advisory_lock.py -x -q` is GREEN | PASS — 4/4 tests pass |
| test_token_round_trip proves byte-for-byte blob equality + discrete access_token match | PASS |
| test_refresh_issued_at_unchanged proves anchor not bumped | PASS |
| test_second_instance_fails proves SystemExit(1) + log message | PASS |
| `grep -n 'pg_try_advisory_lock' advisory_lock.py` matches | PASS — line 81 |
| `grep -n 'refresh_issued_at' token_store.py` returns no SET-clause assignment | PASS — comments only |
| No token value or encryption key in logging calls | PASS — verified manually |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced deprecated `utcnow()` / `utcfromtimestamp()` with timezone-aware equivalents**
- **Found during:** Initial pytest run showing DeprecationWarning on Python 3.14
- **Issue:** `datetime.datetime.utcnow()` and `datetime.datetime.utcfromtimestamp()` are
  deprecated in Python 3.12+ and scheduled for removal. These produced warnings on Python 3.14.
- **Fix:** Replaced with `datetime.datetime.now(tz=datetime.timezone.utc)` and
  `datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc)`
- **Files modified:** `apps/sidecar/token_store.py`
- **Commit:** included in 8595145 (fixed before commit)

**2. [Rule 2 - Missing] Added `apps/sidecar/.gitignore` for Python artifacts**
- **Found during:** `git status` after initial implementation
- **Issue:** `__pycache__/` and `.venv/` appeared as untracked — no Python gitignore existed
- **Fix:** Created `apps/sidecar/.gitignore` with standard Python exclusion patterns
- **Files modified:** none (new file)
- **Commit:** 8595145

None beyond the above. Plan executed as written.

## Known Stubs

None. token_store.py and advisory_lock.py are fully wired to real Postgres. The conftest
seeds a complete row. No placeholder values flow to any consumer.

## Threat Flags

No new security surface introduced beyond what the threat model in 11-04-PLAN.md covers.
All T-11-04-* mitigations were applied as implemented:
- T-11-04-01: token values never logged; only app_id + issued_at
- T-11-04-02: all params as bound `%s` — no SQL injection surface
- T-11-04-03: pg_try_advisory_lock non-blocking + SystemExit(1); direct conn port 5432
- T-11-04-04: sidecar is sole writer; TS refresh-tokens retired in 11-06 (sequenced)

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `apps/sidecar/token_store.py` exists | FOUND |
| `apps/sidecar/advisory_lock.py` exists | FOUND |
| `apps/sidecar/tests/conftest.py` exists | FOUND |
| `apps/sidecar/.gitignore` exists | FOUND |
| Commit 8595145 exists in git log | FOUND |
| `11-04-SUMMARY.md` exists | FOUND |

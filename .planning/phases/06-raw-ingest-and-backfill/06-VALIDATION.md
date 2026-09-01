---
phase: 6
slug: raw-ingest-and-backfill
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-09-01
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x with `pytest-asyncio` |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| **Quick run command** | `uv run pytest -q tests/ingest/` |
| **Full suite command** | `uv run pytest -q && bash tools/gate.sh` |
| **Estimated runtime** | ~10s quick, ~48s full (gate adds ruff + basedpyright + mypy) |

Every command needs this environment. `MORAI_MASTER_KEY` has been required since Phase 3 —
omit it and eight crypto and ledger tests error at setup rather than fail:

```bash
export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai"
export MORAI_APP_DB_PASSWORD="localdevpassword"
export MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ="
export MORAI_ENV_FILE=""
```

Postgres 18 runs natively via Homebrew. Not Docker — that daemon is broken on this machine.

---

## Sampling Rate

- **After every task commit:** `uv run pytest -q tests/ingest/`
- **After every plan wave:** `uv run pytest -q && bash tools/gate.sh`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 48 seconds

**Never push to CI to find out whether a test passes.** A CI round-trip is ~3 minutes against
48 seconds locally. Phase 2 lost four hours to that loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | INGEST-02 | T-06-01 | Job session runs as `morai_app`, cannot bypass RLS | integration | `uv run pytest -q tests/ingest/test_sync_tracer.py` | ❌ new | ⬜ pending |
| 06-01-02 | 01 | 1 | INGEST-02 | T-06-02 | Vendor's sign preserved; no `abs()` reachable in the extraction path | integration + AST gate | `uv run pytest -q tests/ingest/test_raw_fidelity.py` | ❌ new | ⬜ pending |
| 06-01-03 | 01 | 1 | OPS-05 | T-06-03 | Batch inserts chunk at ≤2,000; a second writer is a gate failure | integration + AST gate | `uv run pytest -q tests/ingest/test_broker_transactions_chunking.py tests/gate/test_ingest_write_boundary.py` | ❌ new | ⬜ pending |
| 06-02-01 | 02 | 2 | INGEST-01 | — | One job per connected user; a tick cannot double-fire across redeploy | integration | `uv run pytest -q tests/ingest/test_fan_out.py` | ❌ new | ⬜ pending |
| 06-02-02 | 02 | 2 | INGEST-03 | T-06-04 | Re-ingest changes nothing; the conflict clause is safe because the key is complete (WR-A3) | integration | `uv run pytest -q tests/ingest/test_idempotency.py` | ❌ new | ⬜ pending |
| 06-02-03 | 02 | 2 | INGEST-05 | — | First connect reaches back over the full lookback, chunked, bounds logged | integration | `uv run pytest -q tests/ingest/test_backfill.py` | ❌ new | ⬜ pending |
| 06-03-01 | 03 | 3 | INGEST-06 | T-06-05 | A failure record survives the rollback of the transaction that failed | integration | `uv run pytest -q tests/ingest/test_sync_runs.py` | ❌ new | ⬜ pending |
| 06-03-02 | 03 | 3 | INGEST-04 | T-06-06 | Web process defers without a superuser DSN; repeated re-sync is safe | integration | `uv run pytest -q tests/ingest/test_manual_resync.py` | ❌ new | ⬜ pending |
| 06-03-03 | 03 | 3 | INGEST-06 | T-06-07 | One user reads their own sync history and nobody else's | integration | `uv run pytest -q tests/ingest/test_sync_history_route.py` | ❌ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** every task carries its own automated command. Longest gap without an
automated verify is zero.

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Measured, not assumed:

- `tests/ledger/conftest.py` and `tests/vendor/conftest.py` already provide DB fixtures, the
  RLS session context, and Phase 4's `Protocol` fake (`FakeSchwabAuth`) — the whole phase is
  testable against it, exactly as Phase 4 itself was.
- `assert_connection_cannot_bypass_rls` already exists and is what 06-01 Task 1 calls.
- `insert_fills` already chunks at `_CHUNK_SIZE = 2000` and carries the `_write_token` gate.
- `tests/gate/` already holds the meta-test pattern the new write-boundary gate follows.
- pytest, `pytest-asyncio`, ruff, basedpyright and mypy all installed and green at 325 passed.

No framework install. No new dependency. A `tests/ingest/` package is created by 06-01 Task 1
as part of its own tracer, not as separate scaffolding.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Schwab's real per-call transaction range limit | INGEST-05 | `salvage/measured-constants.md` flags 365/90 as UNJUSTIFIED; `schwab-py`'s own docstring claims 60 days. No live connection exists to settle it. Every vendor call logs its requested bounds and returned element count — that logging is the instrument. | Set the Railway secrets, run one real backfill, read the logged bounds against what came back |
| Schwab's real rate limit on `get_transactions` | INGEST-01 | Unmeasured. Fan-out defers one job per user, so the rate ceiling only bites with several connected users against the live vendor. | Observe under a real multi-user cycle |
| `activityId` uniqueness guarantee | INGEST-02 | v1's `salvage/invariants.md` establishes `(activityId, legIndex)` as the natural key, but the vendor's own guarantee is undocumented. The composite key is built to be safe either way (`NN-1`). | Confirm against a real transaction payload |
| `transferItems[].price` as the source for `price_usd`, real OCC symbol spacing, the `cost`-sign fallback | INGEST-02 | Payload-shape facts. No live connection; `[ASSUMED]` in `06-RESEARCH.md` and carried into the SUMMARYs. | Confirm against a real payload |

**These are payload and vendor-behaviour facts, not gaps in the code.** Every one is
reachable only through a live Schwab connection, which is gated on the same Railway secrets
Phases 2, 3 and 4 are already waiting on. The phase is designed so all nine tasks verify
against Phase 4's `Protocol` fake without them.

---

## New Operator Prerequisite

`MORAI_APP_DB_PASSWORD` is now required on the Railway **worker** service, which did not need
it before. Declared as `user_setup` in `06-01-PLAN.md`'s frontmatter rather than assumed.

The reason is a security finding, not a convenience: `worker/app.py` holds only a Procrastinate
psycopg pool on the **superuser** DSN. An ingest job writing user-scoped rows over that role
would make every RLS policy inert for exactly the rows this phase adds. 06-01 Task 1 routes the
job's session through `get_app_engine()` (`morai_app`, `NOSUPERUSER NOBYPASSRLS`) and asserts it.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — none missing
- [x] No watch-mode flags
- [x] Feedback latency < 48s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-01

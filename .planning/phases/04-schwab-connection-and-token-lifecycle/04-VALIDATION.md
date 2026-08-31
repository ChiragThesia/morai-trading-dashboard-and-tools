---
phase: 4
slug: schwab-connection-and-token-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-31
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x + pytest-asyncio, Hypothesis available |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| **Quick run command** | `uv run pytest -q -m db tests/<target>.py` |
| **Full suite command** | `bash tools/gate.sh` (ruff + ruff format + basedpyright + mypy + pytest) |
| **Estimated runtime** | ~29s full suite; ~30s full gate. Baseline entering this phase: 245 passed |

```bash
export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai"
export MORAI_APP_DB_PASSWORD="localdevpassword"
export MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ="
export MORAI_ENV_FILE=""
```

Postgres 18 runs natively via Homebrew, **not** Docker. A CI round-trip is ~3 minutes against
~30 seconds locally — push when the local gate is green, never to discover whether it is.

---

## Sampling Rate

- **After every task commit:** `uv run pytest -q`
- **After every plan wave:** `bash tools/gate.sh`
- **Before `/gsd-verify-work`:** full gate green
- **Max feedback latency:** 35 seconds

---

## Per-Task Verification Map

Populated by the planner. Every `type: tdd` task needs an `<automated>` command and
red-then-green output as part of its deliverable.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(planner fills)* | | | | | | | | | ⬜ pending |

---

## Criterion-Level Validation Contract

| # | Criterion | Required proof | Trap |
|---|-----------|----------------|------|
| 1 | Concurrent OAuth callbacks land on their own records; a replayed `state` is rejected | Two **genuinely concurrent** callbacks via two independent engines + `asyncio.gather`, exactly as `test_concurrent_consume_produces_exactly_one_winner` already does for setup tokens | A sequential simulation proves nothing about the atomic consume. `NN-35` requires one `DELETE ... RETURNING`, never SELECT-then-DELETE. |
| 2 | No log line, error body, or response contains the auth code or redirect URL | Capture **all** log output — app, `schwab-py`, `httpx`, `authlib` — and assert absence, mirroring `test_no_log_record_from_login_contains_password_token_or_hash` | Research grepped `schwab-py` and `authlib`: neither logs the code on the OAuth path. **The real risk is Hypercorn's access log, which includes the full query string.** It is off by default in 0.18.0, but an ASGITransport test structurally cannot prove production keeps it off — see Manual-Only below. |
| 3 | Re-auth repairs the existing record, does not duplicate | Assert the per-user connection row count is exactly 1 after re-auth | Asserting only "a valid connection exists" passes with two rows and an ambiguous live one. |
| 4 | Per-user refresh lock; A never blocks B | Two positive controls: concurrent refreshes of **one** user serialise with no `invalid_grant`; and a refresh for user A **does not block** user B | The second control is the real content. A single global lock passes the first test alone — which is exactly the v1 mistake `CONN-06` exists to prevent. |
| 5 | Health reads healthy/expiring-soon/expired with `expires_at` and last-sync | Derived at read time from `expires_at`; anchored to schwab-py's `TokenMetadata.creation_timestamp`, which it explicitly does **not** update on refresh | Anchoring to "last refresh" resets the clock on every automatic refresh and the 7-day expiry becomes invisible. |

---

## Landmines Research Already Proved

1. **`token_write_func` must be a plain `def`, never `async def`.** Verified by the
   orchestrator against `schwab/auth.py` in the real 1.5.1 wheel: `wrapped_token_write_func`
   is a plain `def` and calls the closure with **no `await`** (lines 103-113; zero `await` on
   the closure anywhere in the file). An `async def` closure returns a coroutine that is
   assigned, never awaited, and returned — Python only emits a "coroutine was never awaited"
   RuntimeWarning at GC. **OAuth would appear to succeed while the token silently never
   persists.** Capture synchronously into an in-memory holder, then persist explicitly from
   the caller's async code after the vendor call returns.

2. **`schwab-py` 1.5.1 has no `py.typed`; no stub package exists** (`D4-01`). Every symbol is
   `Any`. Research verified that a local partial `.pyi` stub for the ~6 used symbols clears
   every diagnostic against this project's pinned basedpyright 1.39.10 / mypy 2.3.1, leaving
   exactly one legitimate `reportAny` on `httpx.Response.json()` — funnelled through a single
   `_response_json()` helper, that is the one suppression `D4-04` budgets for. **Stubs and the
   `Protocol` are complementary, not alternatives:** stubs make the vendor legible to the
   checkers, the `Protocol` (locked in `D4-02`) keeps the app decoupled and testable against a
   fake. Do not drop the `Protocol` because stubs exist.

3. **`pg_advisory_xact_lock(hashtext(user_id::text))`** verified live against local Postgres
   18, including with a bound parameter rather than a literal.

---

## Wave 0 Requirements

- [ ] `tests/connection/__init__.py`, `conftest.py` — fixtures for the connection table
- [ ] A `Protocol` fake covering success, `invalid_grant`, expired refresh token, rate-limit
- [ ] No framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hypercorn access logging stays off in production | CONN-03 / NN-34 | Hypercorn's default access-log format includes the full query string, which on the OAuth callback carries the authorization code. It is off by default in 0.18.0, but the ASGITransport-based suite cannot observe the production server's config | On the Railway `web` service, confirm no `--access-log`/`accesslog` is configured, and that no deploy log line contains a `code=` query parameter |
| The 7-day refresh window | CONN-05 | No test run spans 7 days | Observe one real expiry against a live connection, or accept the injected-clock proof as the limit of what is known (`D4-15`) |
| Live Schwab OAuth round trip | CONN-01 | Needs a human at a browser and a registered callback URL | Deferred with the Railway items Phases 2 and 3 already owe |

---

## Scope Decisions Taken at Discuss Time

- **`last_synced_at` stays NULL through this phase.** Phase 6 owns real ingest; building a
  throwaway sync probe here would be scaffolding, and `NN-16` prefers an honest gap to a
  fabricated value. The column exists and is queryable; nothing writes it yet.
- **OAuth `state` TTL is 15 minutes**, named `_OAUTH_STATE_TTL` alongside the existing
  `_SETUP_TOKEN_TTL` / `_RESET_TOKEN_TTL`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 35s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

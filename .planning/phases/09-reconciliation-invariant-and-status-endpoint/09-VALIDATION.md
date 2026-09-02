---
phase: 9
slug: reconciliation-invariant-and-status-endpoint
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-01
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `09-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.1.1 + `pytest-asyncio` 1.4.0 (session-scoped loop) |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` — `pytest.mark.db` gates DB tests |
| **Quick run command** | `uv run pytest -m "not db" -q` |
| **Full suite command** | `export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai" MORAI_APP_DB_PASSWORD="localdevpassword" MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ=" MORAI_ENV_FILE="" && uv run pytest -q && bash tools/gate.sh` |
| **Estimated runtime** | ~13s pytest; gate adds ruff + basedpyright + mypy |

Baseline entering this phase: **587 passed, gate exit 0.**
**Never push to CI to find out whether a test passes** — ~3 minutes against ~13 seconds locally.

---

## Sampling Rate

- **After every task commit:** `uv run pytest -m "not db" -q`, or the single relevant file `-x`
- **After every plan wave:** `bash tools/gate.sh`
- **Before `/gsd-verify-work`:** full suite green, including the `test_sync_tracer.py` extension
  proving `sync_user` actually calls reconciliation
- **Max feedback latency:** ~13 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| RECON-01 | Realised P&L equals broker cash delta, net of transfers, over a closed window | unit (pure) | `uv run pytest tests/ledger/test_reconciliation.py -k matches -x` | ❌ W0 |
| RECON-01 | **A deliberately seeded one-cent discrepancy FAILS** | unit (pure) | `uv run pytest tests/ledger/test_reconciliation.py -k seeded_discrepancy -x` | ❌ W0 |
| RECON-02 | The check runs at the end of a REAL ingest cycle, not merely callable | integration (db, real worker task) | `uv run pytest tests/ingest/test_sync_tracer.py -k reconciliation -x` | ❌ W0 — extend |
| RECON-03 | A failure names the failing window and both sides, not a bare boolean | unit (pure) | `uv run pytest tests/ledger/test_reconciliation.py -k failure_names_window -x` | ❌ W0 |
| RECON-04 | The response envelope marks dependent numbers untrustworthy while failing | integration (db, API) | `uv run pytest tests/api/test_reconciliation_status.py -x` | ❌ W0 |
| API-01 | Status endpoint reads one persisted row, never recomputes | integration | `uv run pytest tests/api/test_reconciliation_status.py -k no_recompute -x` | ❌ W0 |
| D9-08 | An unknown input yields `indeterminate`, never `passed` | unit (pure) | `uv run pytest tests/ledger/test_reconciliation.py -k indeterminate -x` | ❌ W0 |
| Regression | The 13-calendar oracle stays byte-identical and green | db | `bash tools/gate.sh` | ✅ existing |

**The one-cent seeded-discrepancy test is this phase's own anti-vacuous-pass control.** Criterion 2
names it explicitly. It must fail before the implementation is correct — a reconciliation that
cannot fail on a deliberately corrupted input proves nothing. Given this run's record (seven
defects, every one a test that passed while proving nothing), treat a green reconciliation test
without an observed red as unproven.

**`D9-08`'s three-state verdict needs all three states tested.** A test covering only `passed` and
`failed` leaves `indeterminate` — the state that exists to stop an unanswerable check reporting a
pass — completely unexercised.

---

## Wave 0 Requirements

- [ ] `tests/ledger/test_reconciliation.py` — RECON-01, RECON-03, D9-08; pure-function tests
- [ ] `tests/ingest/test_sync_tracer.py` extension — RECON-02, proving the real Procrastinate
      `sync_user` task writes a `reconciliation_runs` row (the CR-01 guard)
- [ ] `tests/api/test_reconciliation_status.py` — RECON-03, RECON-04, API-01
- [ ] Framework install: none — pytest/pytest-asyncio already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Schwab transaction field names for net cash amount and commission/fees | RECON-01 | **Genuinely unverified.** `schwab-py` 1.5.1's installed source contains zero references to `netAmount`, `fees` or `commission`; this project's own fixtures never populate them; no public source settled it during research. Research rates this LOW confidence and explicitly owes it to the first live payload | On the first live `get_transactions` call, dump one stored `broker_transactions.raw_ciphertext` payload and compare against the named constants. Until then the constants are injectable and named, not inlined — the same discipline `sync_windows`' range settings already get |
| Whether a cash-settled SETTLEMENT produces its own `broker_transactions` row | RECON-01 | Unknown without live data. Subsumed either way by `D9-11`: an unpriced settlement makes its window `indeterminate`, so a wrong assumption here cannot produce a false `passed` | Inspect a real post-expiry transaction list for a settled position |

Both are honest unknowns whose failure mode is `indeterminate`, never a wrong number — the same
mitigation shape Phase 8 used for the unverified `get_quotes` schema.

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] The one-cent discrepancy test observed RED before green
- [ ] All three verdict states (`passed`/`failed`/`indeterminate`) exercised
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

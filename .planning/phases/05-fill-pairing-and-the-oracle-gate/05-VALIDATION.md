---
phase: 5
slug: fill-pairing-and-the-oracle-gate
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-31
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x with `pytest-asyncio` |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| **Quick run command** | `uv run pytest -q tests/ledger/` |
| **Full suite command** | `uv run pytest -q && bash tools/gate.sh` |
| **Estimated runtime** | ~8s quick, ~46s full (gate adds ruff + basedpyright + mypy) |

Every command below needs this environment. `MORAI_MASTER_KEY` is required since Phase 3 —
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

- **After every task commit:** `uv run pytest -q tests/ledger/`
- **After every plan wave:** `uv run pytest -q && bash tools/gate.sh`
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** 46 seconds

**Never push to CI to find out whether a test passes.** A CI round-trip is ~3 minutes against
46 seconds locally. Phase 2 lost four hours to that loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | LEDGER-01 | — | Events derive from stored fills; fills stay the source of truth | integration | `uv run pytest -q tests/ledger/test_pairing_tracer.py` | ❌ new | ⬜ pending |
| 05-01-02 | 01 | 1 | LEDGER-12 | T-05-02 | Recompute is pure; no broker call reachable from the derivation | unit + AST gate | `uv run pytest -q tests/ledger/test_pairing_pure.py` | ❌ new | ⬜ pending |
| 05-01-03 | 01 | 1 | LEDGER-09 | — | Re-deriving one `(user, order_id)` scope yields an identical event set | integration | `uv run pytest -q tests/ledger/test_pairing_idempotency.py` | ❌ new | ⬜ pending |
| 05-02-01 | 02 | 2 | LEDGER-03 | T-05-03 | Shared front leg resolves by order anchor; unresolved never guessed (`NN-11`) | integration | `uv run pytest -q tests/ledger/test_pairing_shared_leg.py` | ❌ new | ⬜ pending |
| 05-02-02 | 02 | 2 | LEDGER-02 | — | No derivation path reads position state; the 14th fixture stays open | integration + AST gate | `uv run pytest -q tests/ledger/test_pairing_no_position_state.py` | ❌ new | ⬜ pending |
| 05-02-03 | 02 | 2 | LEDGER-02 | — | `detect_roll` rejects the different-strike order — never a spurious ROLL | unit | `uv run pytest -q tests/ledger/test_pairing_roll_guard.py` | ❌ new | ⬜ pending |
| 05-03-01 | 03 | 3 | LEDGER-11 | — | All 13 calendars match expected figures; 52 fills; zero orphans | integration | `uv run pytest -q tests/ledger/test_oracle_gate.py` | ❌ new | ⬜ pending |
| 05-03-02 | 03 | 3 | OPS-06 | T-05-04 | Sign-flip, rounding and off-by-one faults are each caught | unit | `uv run pytest -q tests/ledger/test_pairing_seeded_faults.py` | ❌ new | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** every task carries its own automated command. No three consecutive
tasks run without an automated verify. Longest gap is zero.

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No Wave 0 needed, and this is measured
rather than assumed:

- `tests/ledger/oracle_seed.py` already transcribes all 13 calendars and seeds all 52 fills
  through `insert_fills` — the one write path. Only the 14th synthetic fixture's seed helper
  is missing, and 05-02 Task 2 adds it.
- `tests/ledger/conftest.py` already provides the DB fixtures and RLS session context.
- `tests/ledger/test_plaintext_queries.py` already proves the order-anchor disambiguation SQL
  against real Postgres with real oracle data.
- pytest, `pytest-asyncio`, ruff, basedpyright and mypy are all installed and green at 283
  passed.

No framework install. No new dependency. `D5-03` explicitly declines to pin a mutation tool.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

**All phase behaviors have automated verification.** This is the first phase in this rebuild
where that is true without qualification, and it is a property of the phase rather than of the
effort spent: fill pairing is pure derivation over stored rows. There is no vendor to call, no
deployment to observe, and no clock to wait on. Criterion 4 requires that no broker call is
made from the process at all, so the absence of an external dependency is itself the thing
under test.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — none missing
- [x] No watch-mode flags
- [x] Feedback latency < 46s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-08-31

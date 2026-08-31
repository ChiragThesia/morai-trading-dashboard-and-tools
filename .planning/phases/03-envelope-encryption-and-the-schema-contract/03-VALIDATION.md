---
phase: 3
slug: envelope-encryption-and-the-schema-contract
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-31
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.x + pytest-asyncio, Hypothesis available |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) |
| **Quick run command** | `uv run pytest -q -m db tests/<target>.py` |
| **Full suite command** | `bash tools/gate.sh` (ruff + ruff format + basedpyright + mypy + pytest) |
| **Estimated runtime** | ~13s full suite; ~21s full gate |

Environment for every DB-marked run — Postgres 18 runs natively via Homebrew, **not** Docker:

```bash
export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai"
export MORAI_APP_DB_PASSWORD="localdevpassword"
export MORAI_ENV_FILE=""
```

---

## Sampling Rate

- **After every task commit:** `uv run pytest -q` (~13s)
- **After every plan wave:** `bash tools/gate.sh`
- **Before `/gsd-verify-work`:** full gate must be green
- **Max feedback latency:** 25 seconds

A CI round-trip is ~3 minutes against ~13 seconds locally. Push when the local gate is
green, never to discover whether it is (`.claude/rules/workflow.md`, Speed).

---

## Per-Task Verification Map

Populated by the planner as tasks are written. Every task carrying `type: tdd` needs an
`<automated>` verify command, and the red-then-green output is part of its deliverable.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(planner fills)* | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Criterion-Level Validation Contract

The six success criteria and the shape of proof each demands. These are the assertions the
phase is judged on; a test that cannot fail against a broken implementation does not count.

| # | Criterion | Required proof | Trap |
|---|-----------|----------------|------|
| 1a | Dump yields no readable price/qty/P&L/free-text | Restore a **real `pg_dump`** into a scratch DB with the master key unavailable and compare raw `bytes`; or grep the dump for the plaintext's **hex encoding** | **`pg_dump` hex-encodes `bytea`.** Grepping the dump for the literal plaintext returns zero matches even with NO encryption at all — verified live this session. A test written that way is a false pass on the phase's headline claim. |
| 1b | No two ciphertext rows share `(key, nonce)` | One SQL query **UNIONing every ciphertext column** across all encrypted tables, grouped by `(user_id, key_version, nonce)`, asserting no group has count > 1 | A per-column check misses a collision **between** two columns of the same row (a ROLL's `open_debit` and `close_credit` share one user's key) — equally a GCM break. |
| 2 | Plaintext set documented + both queries run in SQL | Both the shared-front-leg disambiguation query and the reconciliation window query executed against real Postgres, returning correct results, using only plaintext columns | Research proved both against real oracle data (`8a63aa81`/`6303e6af`). If either regresses, `D3-02` is wrong and the schema must change before it lands. |
| 3 | KEK rotation touches no trade ciphertext | Assert trade ciphertext is **byte-identical** before and after rotation, and that a row written under `key_version` N still decrypts after rotating to N+1 | Asserting only "it still decrypts" would pass even if every row had been rewritten. |
| 4 | Netted-only ROLL rejected by a DB `CHECK` | Attempt the insert through raw SQL on a connection that bypasses the application, expect `IntegrityError` | Application-level validation is explicitly insufficient — a later caller bypasses it. Note: with encrypted `bytea` amounts, the `CHECK` can only test NULL-ness. State plainly what that does and does not catch. |
| 5 | Account deletion crypto-shreds | Destroy the wrapped DEK, then assert the user's rows **decrypt to nothing** — not merely that the rows are gone | Deleting rows alone proves nothing about the key. Order matters: destroy key, then delete. |
| 6 | Exactly one write path into fills | A `tests/gate/` fixture proving a second writer **fails type-check**, asserting the specific diagnostic marker | A bare exit-code check is decoration. `tests/gate/test_type_gate.py` already asserts specific rule markers — follow it. The exact marker for this pattern is `[ASSUMED]` in research and must be confirmed against a real checker run. |

---

## Wave 0 Requirements

- [ ] `tests/ledger/__init__.py`, `tests/ledger/conftest.py` — fixtures for the new trading tables
- [ ] `tests/crypto/` — envelope-encryption unit tests (no DB needed for the primitive)
- [ ] No framework install needed — pytest, pytest-asyncio and Hypothesis are already present

---

## Carried Obligation — not optional, and not in CONTEXT.md

`src/morai/db/models.py` states in its own docstrings (lines 5-6 and 113-119) that **Phase 3
must drop `GateMoneyProbe` and `GateUserScopedProbe` with an explicit migration** once real
trading tables exist to prove against.

**Consequence the obligation does not spell out:** `GateUserScopedProbe` is the table
`tests/test_isolation.py`'s eleven guards exercise. Dropping it without repointing that suite
at the real trading tables would silently delete Phase 2's isolation proof — `AUTH-07`, the
phase's hardest requirement. The drop migration and the isolation-suite migration are one
unit of work and must land together, with the suite green against real tables before the
probe tables go.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| KEK held outside the database | CRYPT-01 | The env var lives on Railway; a local test can only prove the app reads it from the environment, not that production is configured | Confirm `MORAI_MASTER_KEY` is set on the Railway service, alongside Phase 2's outstanding `MORAI_APP_DB_PASSWORD` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 25s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

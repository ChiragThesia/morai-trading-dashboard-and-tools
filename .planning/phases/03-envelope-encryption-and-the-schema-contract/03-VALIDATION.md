---
phase: 3
slug: envelope-encryption-and-the-schema-contract
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: true
wave_0_complete: true
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
# New this phase. Base64 of a 32-byte ASCII string that says what it is. Local only.
export MORAI_MASTER_KEY="bG9jYWxkZXZtYXN0ZXJrZXktMzJieXRlcy10ZXN0MDA="
```

`pg_dump`, `pg_restore`, `psql` and `createdb` are installed but **not on the default PATH** —
they live in `/opt/homebrew/opt/postgresql@18/bin`, confirmed on this machine. Plan 03-03
resolves them explicitly rather than assuming PATH.

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

Every task carries an `<automated>` verify command, and the red-then-green output is part of
its deliverable. Every command below is prefixed by `$ENV`, which stands for:

```
MORAI_ENV_FILE= DATABASE_URL=postgresql://morai:morai@localhost:5432/morai MORAI_APP_DB_PASSWORD=localdevpassword MORAI_MASTER_KEY=bG9jYWxkZXZtYXN0ZXJrZXktMzJieXRlcy10ZXN0MDA=
```

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 03-01 | 1 | CRYPT-01, CRYPT-02, CRYPT-03 | T-03-01, T-03-02, T-03-06, T-03-07 | A `Decimal` round-trips through per-column AES-GCM under a wrapped per-user key; RLS enforced on both new tables; the KEK is never rendered | tracer + db | `$ENV uv run pytest -q tests/ledger/test_tracer_encrypted_fill.py tests/test_settings.py -x` | ❌ created by the task | ⬜ pending |
| 03-01-T2 | 03-01 | 1 | CRYPT-02 | T-03-03, T-03-04 | Tamper, wrong key, wrong nonce and wrong row all raise `InvalidTag`; a nonce is fresh per call | unit | `$ENV uv run pytest -q tests/crypto/test_envelope.py -x` | ❌ created by the task | ⬜ pending |
| 03-01-T3 | 03-01 | 1 | CRYPT-02 | T-03-05 | A second writer into the fill table is rejected by both checkers, with the marker pinned from a real run | gate | `uv run pytest -q tests/gate/test_type_gate.py -x` | ✅ extends existing | ⬜ pending |
| 03-02-T1 | 03-02 | 2 | CRYPT-02, CRYPT-03 | T-03-12 | RLS enable + force, admin-free policy and verb-narrowed grants on `positions`, `legs`, `events` | db | `$ENV uv run pytest -q tests/ledger/test_schema_contract.py -x` | ❌ created by the task | ⬜ pending |
| 03-02-T2 | 03-02 | 2 | LEDGER-04 | T-03-09, T-03-10 | A netted-only ROLL is rejected by Postgres on a connection that bypasses the application, and the error names the constraint | db | `$ENV uv run pytest -q tests/ledger/test_roll_check_constraint.py -x` | ❌ created by the task | ⬜ pending |
| 03-02-T3 | 03-02 | 2 | LEDGER-04, CRYPT-02 | T-03-11, T-03-13 | A ROLL's two amounts are encrypted separately under two distinct nonces; no plaintext netted column exists | db | `$ENV uv run pytest -q tests/ledger -x` | ❌ created by the task | ⬜ pending |
| 03-03-T1 | 03-03 | 3 | CRYPT-05 | T-03-14, T-03-15, T-03-18 | A real dump restored into a scratch database yields no plaintext bytes to a reader with no key; the naive literal grep is demonstrated passing on an unencrypted value | db | `$ENV uv run pytest -q tests/test_pg_dump_confidentiality.py -x` | ❌ created by the task | ⬜ pending |
| 03-03-T2 | 03-03 | 3 | CRYPT-05 | T-03-16, T-03-17 | No `(user_id, key_version, nonce)` triple repeats across any ciphertext column; a planted cross-column collision is caught; a new column with no branch fails the drift guard | db | `$ENV uv run pytest -q tests/crypto/test_nonce_uniqueness.py -x` | ❌ created by the task | ⬜ pending |
| 03-04-T1 | 03-04 | 3 | CRYPT-01 | T-03-21 | A new account's data key is provisioned in the same transaction, without an admin clause on the key table | db | `$ENV uv run pytest -q tests/identity/test_account_deletion.py -x` | ❌ created by the task | ⬜ pending |
| 03-04-T2 | 03-04 | 3 | CRYPT-04 | T-03-22, T-03-23, T-03-24 | Trade ciphertext is byte-identical before and after a master-key rotation; wrapped keys all changed; a wrong old key raises before any write | db | `$ENV uv run pytest -q tests/test_key_rotation.py -x` | ❌ created by the task | ⬜ pending |
| 03-04-T3 | 03-04 | 3 | AUTH-06 | T-03-19, T-03-20, T-03-25 | Key destroyed first, rows second; with the key gone and rows present, reads raise a named missing-key error; `DELETE /me` names no other user | db | `$ENV uv run pytest -q tests/test_crypto_shred.py tests/identity/test_account_deletion.py -x` | ❌ created by the task | ⬜ pending |
| 03-05-T1 | 03-05 | 3 | CRYPT-03 | T-03-30 | All 52 oracle fills are seeded through `insert_fills()` with no test-only fast path | db | `$ENV uv run pytest -q tests/ledger/test_plaintext_queries.py -k seed -x` | ❌ created by the task | ⬜ pending |
| 03-05-T2 | 03-05 | 3 | CRYPT-03 | T-03-26, T-03-27, T-03-28, T-03-29 | Both queries run against plaintext columns only, proved against the schema's own column list; the window total is summed in Python after decrypt | db | `$ENV uv run pytest -q tests/ledger/test_plaintext_queries.py -x` | ❌ created by the task | ⬜ pending |
| 03-06-T1 | 03-06 | 4 | CRYPT-02 | T-03-34, T-03-35 | The deployed gate route serves `positions`, returns plaintext columns only, and still answers not-found rather than forbidden | db + http | `$ENV uv run pytest -q tests/identity -x` | ✅ repoints existing | ⬜ pending |
| 03-06-T2 | 03-06 | 4 | CRYPT-02 | T-03-31 | All eleven isolation guards run green against real trading tables, with the privilege precondition and the superuser positive control intact | db + http | `$ENV uv run pytest -q tests/test_isolation.py -v` | ✅ repoints existing | ⬜ pending |
| 03-06-T3 | 03-06 | 4 | CRYPT-02 | T-03-32, T-03-33 | All five new tables refuse cross-tenant reads and planted writes, and no policy on any of them names the admin setting | db | `$ENV uv run pytest -q tests/test_isolation.py tests/identity/test_app_role.py -x` | ✅ extends existing | ⬜ pending |
| 03-07-T1 | 03-07 | 5 | CRYPT-02 | T-03-37, T-03-39 | A `Decimal` survives Python, encryption, Postgres `bytea`, decryption and JSON unchanged, read on an independent connection | db | `$ENV uv run pytest -q tests/test_money_roundtrip.py tests/test_decimal_canary.py -x` | ✅ repoints existing | ⬜ pending |
| 03-07-T2 | 03-07 | 5 | CRYPT-03 | T-03-38 | Every money column names its unit whether `NUMERIC` or `bytea`; two synthetic negative controls fire; the vacuity guard counts both types | unit | `uv run pytest -q tests/test_money_column_naming.py -x` | ✅ extends existing | ⬜ pending |
| 03-07-T3 | 03-07 | 5 | CRYPT-02, CRYPT-03 | T-03-36, T-03-40 | Both probe tables dropped by a reversible migration, after the isolation proof moved; the full suite green with the models and the money-probe route gone | db | `$ENV uv run pytest -q` | ✅ full suite | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** no three consecutive tasks lack an automated verify — every task has
one, and every one runs locally in seconds against native Postgres.

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

No separate Wave 0 plan. Every test file is written by the task that needs it, test-first,
which is this project's own established TDD shape and is what makes the red-then-green output
a deliverable rather than a ceremony. The scaffolding each item names lands here:

- [x] `tests/ledger/__init__.py`, `tests/ledger/conftest.py` — plan 03-01 Task 1, extended by
      03-02 Task 2 with the position/leg seed and the new tables' truncation
- [x] `tests/crypto/__init__.py`, `tests/crypto/test_envelope.py` — plan 03-01 Task 2, no DB
      marker, pure `bytes` in and out
- [x] No framework install needed — pytest, pytest-asyncio and Hypothesis are already present.
      `cryptography==50.0.1` is a runtime dependency added by plan 03-01 Task 1, not a test one

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

- [x] All tasks have `<automated>` verify — 18 tasks across 7 plans, every one with a command
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references — each scaffolding item is created by the task that
      needs it, listed above
- [x] No watch-mode flags
- [x] Feedback latency < 25s — the slowest scoped command is the full suite at roughly 13s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-08-31. Execution has not run; every status above is
⬜ pending until it does.

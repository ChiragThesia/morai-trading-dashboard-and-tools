---
phase: 7
slug: position-and-campaign-read-models
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-01
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `07-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.1.1 + `pytest-asyncio` 1.4.0 (session-scoped event loop) |
| **Config file** | `pyproject.toml` (`[tool.pytest.ini_options]`) — `pytest.mark.db` gates DB tests |
| **Quick run command** | `uv run pytest -m "not db"` |
| **Full suite command** | `export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai" MORAI_APP_DB_PASSWORD="localdevpassword" MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ=" MORAI_ENV_FILE="" && uv run pytest -q && bash tools/gate.sh` |
| **Estimated runtime** | ~13 seconds for pytest; gate adds ruff + basedpyright + mypy |

Postgres 18 runs natively via Homebrew, not Docker. **Never push to CI to find out whether a test
passes** — a CI round-trip is ~3 minutes against ~12 seconds locally, and Phase 2 lost four hours
to that loop (`.claude/rules/workflow.md`).

---

## Sampling Rate

- **After every task commit:** the targeted test file for that task (or `uv run pytest -m "not db"`
  if no Postgres is reachable)
- **After every plan wave:** `bash tools/gate.sh` — ruff, ruff format, basedpyright, mypy, and the
  full pytest run including `db`-marked tests
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** ~13 seconds

---

## Per-Task Verification Map

| Requirement | Behavior | Test Type | Automated Command | File Exists |
|-------------|----------|-----------|-------------------|-------------|
| LEDGER-05 | Closed state derives from net quantity per leg; mutating any remaining stored position field changes nothing | unit + db | `uv run pytest tests/ledger/test_closed_state.py -x` | ❌ W0 |
| LEDGER-05 | AST structural gate (mirrors D5-02) proves closed-state derivation never reads a stored position timestamp | unit | `uv run pytest tests/ledger/test_pairing_pure.py -x` | ✅ extend |
| LEDGER-06 | A leg past expiry with no fill produces exactly one SETTLEMENT event, no broker call | unit + db | `uv run pytest tests/ledger/test_settlements.py -x` | ❌ W0 |
| LEDGER-06 | The 13-calendar oracle still passes byte-identically — 4 events/calendar, no spurious ROLL | db | `uv run pytest tests/ledger/test_oracle_gate.py -x` | ✅ must stay green unmodified |
| LEDGER-07 | One position holds a PM-settled SPXW front and an AM-settled SPX back, each on its own `event_time`; **exactly two SETTLEMENT rows land, not one** (Pitfall 2 regression) | db | `uv run pytest tests/ledger/test_settlements.py::test_mixed_settlement_style_position -x` | ❌ W0 |
| LEDGER-10 | Campaign view returns the correct chain; `DROP VIEW` + re-run migration reproduces it row-for-row | db | `uv run pytest tests/ledger/test_campaigns.py -x` | ❌ W0 |
| LEDGER-10 | A second user querying the campaign view sees nothing of the first user's chain (Pitfall 1 regression — `security_invoker`) | db | `uv run pytest tests/ledger/test_campaigns.py::test_campaign_view_respects_rls -x` | ❌ W0 |
| D7-12 | Position/leg creation groups an order's OPENING fills correctly, and `sync_user_task` end-to-end populates `positions`/`legs`/`events` (Pitfall 3 regression) | integration | `uv run pytest tests/worker/ -x` | ❌ W0 (check for existing Phase 6 file to extend) |
| D7-14 | No module outside the derivation writes position/leg/event state | unit (AST gate) | `uv run pytest tests/gate/test_ledger_write_boundary.py -x` | ❌ W0 — mirrors `test_ingest_write_boundary.py` |

---

## Wave 0 Requirements

- [ ] `tests/ledger/test_closed_state.py` — LEDGER-05
- [ ] `tests/ledger/test_settlements.py` — LEDGER-06, LEDGER-07, Pitfall 2 regression
- [ ] `tests/ledger/test_campaigns.py` — LEDGER-10, Pitfall 1 (RLS) regression
- [ ] `tests/gate/test_ledger_write_boundary.py` — D7-14
- [ ] Repair `tests/ledger/oracle_seed.py`'s two `insert(Position)` sites (Pitfall 5)
- [ ] Repair `tests/ledger/test_pairing_shared_leg.py`'s `ORDER BY opened_at DESC` (Pitfall 5)
- [ ] Retire and replace `tests/ledger/test_pairing_no_position_state.py`'s behavioral half (Pitfall 5)
- [ ] Worker-level integration test proving `sync_user_task` populates `positions`/`legs`/`events` (Pitfall 3)
- [ ] `uv add tzdata` — Pitfall 4; verify-before-install per the Package Legitimacy Audit's SUS flag

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `ZoneInfo("America/New_York")` constructs on the real Railway container | LEDGER-06/07 | macOS always ships system tz data, so the failure mode is production-only. A local pass proves nothing about the deployed image (Pitfall 4) | After deploy, exercise a settlement-generating path on Railway and confirm no `ZoneInfoNotFoundError`. Adding `tzdata` as an explicit dependency is the fix; this is the confirmation. |

Everything else in this phase has automated verification.

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

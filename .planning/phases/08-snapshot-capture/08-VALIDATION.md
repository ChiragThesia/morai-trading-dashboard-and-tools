---
phase: 8
slug: snapshot-capture
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-01
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `08-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.1.1 + `pytest-asyncio` (`asyncio_mode = "auto"`, session-scoped loop) |
| **Config file** | `pyproject.toml` `[tool.pytest.ini_options]` — `pytest.mark.db` gates DB tests |
| **Quick run command** | `uv run pytest -m "not db"` |
| **Full suite command** | `export DATABASE_URL="postgresql://morai:morai@localhost:5432/morai" MORAI_APP_DB_PASSWORD="localdevpassword" MORAI_MASTER_KEY="bW9yYWktbG9jYWwtZGV2LWtleS1ub3QtYS1zZWNyZXQ=" MORAI_ENV_FILE="" && uv run pytest -q && bash tools/gate.sh` |
| **Estimated runtime** | ~13s pytest; gate adds ruff + basedpyright + mypy |

Baseline entering this phase: **459 passed, gate exit 0.**
Postgres 18 runs natively via Homebrew, not Docker. **Never push to CI to find out whether a test
passes** — ~3 minutes against ~13 seconds locally (`.claude/rules/workflow.md`).

---

## Sampling Rate

- **After every task commit:** the single relevant test file, `-x` fail-fast
- **After every plan wave:** `bash tools/gate.sh` — ruff, ruff format, basedpyright, mypy, full pytest
- **Before `/gsd-verify-work`:** full suite green
- **Max feedback latency:** ~13 seconds

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists |
|--------|----------|-----------|-------------------|-------------|
| SNAP-01 | Every open position gets a mark row per RTH slot; a non-RTH tick writes nothing | unit + db | `uv run pytest tests/ingest/test_snapshot_capture.py -x` | ❌ W0 |
| SNAP-02 | No market data → `mark_usd IS NULL` + `gap_reason` set, never a fabricated value | unit | `uv run pytest tests/ingest/test_snapshot_parse_quote_payload.py -x` | ❌ W0 |
| SNAP-03 | Real observation heals a gap; a gap never overwrites a real observation | db | `uv run pytest tests/ingest/test_snapshot_gap_upsert.py -x` | ❌ W0 |
| SNAP-04 | `repair_snapshot_marks` rebuilds marks from stored raw observations, no vendor call, via task AND CLI | db | `uv run pytest tests/ingest/test_snapshot_repair.py -x` | ❌ W0 |
| SNAP-05 | Expired connection → gap row `gap_reason=connection_expired`, no vendor call attempted | db | `uv run pytest tests/ingest/test_snapshot_capture.py::test_expired_connection_writes_gap -x` | ❌ W0 |
| D8-03 | OCC → Schwab wire symbol codec round-trips for both SPX and SPXW padding (Pitfall 1) | unit | `uv run pytest tests/ingest/test_snapshot_wire_symbol_codec.py -x` | ❌ W0 |
| D8-16 | One failing leg does not abort the sweep | db | `uv run pytest tests/ingest/test_snapshot_capture.py -x` | ❌ W0 |
| Regression | Phase 7's oracle and full suite stay green | db | `bash tools/gate.sh` | ✅ existing |

**The SNAP-03 upsert test must cover the full four-cell truth table**, directly against Postgres:
real-over-nothing, real-over-gap, gap-over-nothing, and gap-blocked-by-real. A test covering only
the first three passes while the one clause that matters is broken — and that clause (`L020`/`L071`)
is what blocked v1's backfill of 1,190 corrupted rows.

---

## Wave 0 Requirements

- [ ] `tests/ingest/test_snapshot_wire_symbol_codec.py` — the OCC → Schwab wire codec (Pitfall 1)
- [ ] `tests/ingest/test_snapshot_parse_quote_payload.py` — SNAP-02: missing symbol, missing `quote`
      object, missing `mark`, fully-populated element
- [ ] `tests/ingest/test_snapshot_gap_upsert.py` — SNAP-03: the four-cell truth table against Postgres
- [ ] `tests/ingest/test_snapshot_capture.py` — SNAP-01/SNAP-05: the shell, connection-health branch,
      per-user isolation, per-leg error isolation
- [ ] `tests/ingest/test_snapshot_repair.py` — SNAP-04: task and CLI over one function; a repair run
      with no vendor client still succeeds
- [ ] Framework install: none — pytest/pytest-asyncio already configured

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `get_quotes` response schema for OCC option symbols | SNAP-01, SNAP-02 | This project has never called `get_quotes` live. The research rates the exact OPTION response schema LOW confidence; Schwab's authoritative docs need an authenticated developer-portal session. The design mitigates rather than assumes: raw payloads are stored and the parser degrades to an honest gap instead of raising | After deploy, run one capture slot against a live connection and compare a stored raw payload against the parser's output. A wrong field name yields gaps, not wrong numbers — the failure is visible and non-corrupting |
| Procrastinate misses a slot entirely when the worker is down >10 minutes | SNAP-01 | `procrastinate/periodic.py` `MAX_DELAY = 600`: a longer outage produces **no row at all**, not even a gap. This is a scheduler-level hole below the phase's own gap semantics | Confirm `snapshot_runs` makes the missing slot visible, and that the repair path can write an honest gap for a slot that never fired. Never fabricate a mark for it (`L041`) |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

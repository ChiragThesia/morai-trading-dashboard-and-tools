---
phase: 1
slug: walking-skeleton
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-30
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Content materialised from `01-RESEARCH.md` § Validation Architecture, reconciled against the ten
> plans' `<verify>` blocks.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.1.1 + pytest-asyncio 1.4.0 |
| **Config file** | none yet — plan 01-01 creates `[tool.pytest.ini_options]` in `pyproject.toml` |
| **Quick run command** | `uv run pytest -m "not db" -q` |
| **Full suite command** | `bash tools/gate.sh` (ruff, ruff format, basedpyright, mypy, pytest) |
| **Estimated runtime** | ~30s quick, ~90s full locally; ~3min for the four CI jobs |

### There is no local database

Docker's daemon is broken on the authoring machine (`docker info` returns a 500 from the API socket),
Railway's Postgres is private-network-only (`PGHOST` is `.railway.internal`), and `psql` is not
installed. A Railway TCP proxy was deliberately not created.

Consequences for sampling, and they shape every row below:

- Tests needing Postgres carry `@pytest.mark.db` and run **only in CI**, on the GitHub Actions
  `services: postgres` container from plan 01-02.
- `uv run pytest -m "not db"` is the local default and covers every pure-Python behaviour.
- DB fixtures **fail loudly on an unreachable database rather than skipping**. A silently-skipped
  round-trip test is the exact failure this phase exists to prevent.
- `docker-compose.yml` ships because D-17 names it, pinned to Postgres major 18, marked unverified.
  No task starts it and no success criterion depends on it.

---

## Sampling Rate

- **After every task commit:** `uv run pytest -m "not db" -q`
- **After every plan wave:** `bash tools/gate.sh` locally, plus a push and a read of the four CI jobs
- **Before `/gsd-verify-work`:** full suite green in CI, enforced from plan 01-10 onward by the
  branch ruleset
- **Max feedback latency:** ~30s local, ~3min for CI's DB-backed confirmation

The CI round trip is the honest latency figure for anything DB-backed. That is the cost of having no
local database and it is accepted, not worked around.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | OPS-01 | T-01-03, T-01-04 | Banned constructs rejected; lockfile pinned | config | `uv sync --frozen && uv lock --check && uv run ruff check src tests` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | OPS-02 | T-01-02 | Secrets typed `SecretStr`; boot fails on missing var | unit | `uv run pytest tests/test_settings.py -x` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | OPS-04 | T-01-01 | No credential-bearing DSN in a committed file | static | `grep -qE '^sqlalchemy.url *= *$' alembic.ini` + import check | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 2 | OPS-01, OPS-03 | T-01-06, T-01-09 | Four required checks report; CI DB pinned to major 18 | smoke | `gh run view --json jobs` — four named jobs green | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 2 | OPS-01 | T-01-07 | The workflow provably goes red | negative control | `gh run view --branch ci-negative-control --log-failed` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 3 | OPS-03 | T-01-12 | Money cannot transit a float unaltered | unit | `uv run pytest tests/test_decimal_canary.py -x` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 3 | OPS-03, LEDGER-08, API-07 | T-01-10, T-01-11, T-01-13, T-01-15 | Strict parse; float/int/extra-key rejected; `/health` makes no DB call | integration (db) | `uv run pytest tests/test_money_roundtrip.py -x` — **CI** | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 4 | LEDGER-08 | T-01-16 | Multiplier required, literal in exactly one file | unit | `uv run pytest tests/test_money_units.py -x` | ❌ W0 | ⬜ pending |
| 1-04-02 | 04 | 4 | LEDGER-08 | T-01-17 | Every `Numeric` column names its unit | unit | `uv run pytest tests/test_money_column_naming.py -x` | ❌ W0 | ⬜ pending |
| 1-05-01 | 05 | 4 | OPS-01, LEDGER-08 | T-01-18 | Each checker fails with its expected rule code | unit (subprocess) | `uv run pytest tests/gate/test_type_gate.py -x` | ❌ W0 | ⬜ pending |
| 1-05-02 | 05 | 4 | OPS-01 | T-01-19 | A rule-coded suppression carries a written reason | unit | `uv run pytest tests/gate/test_suppressions.py -x` | ❌ W0 | ⬜ pending |
| 1-05-03 | 05 | 4 | OPS-01 | T-01-20, T-01-21 | No committed secret; no iCloud collision artifact | unit | `uv run pytest tests/test_repo_hygiene.py -x` | ❌ W0 | ⬜ pending |
| 1-06-01 | 06 | 4 | API-07 | T-01-22, T-01-25 | Opaque error body; full detail server-side only | unit | `uv run pytest tests/gate/test_api_boundary.py -x -k "opaque or request_id"` | ❌ W0 | ⬜ pending |
| 1-06-02 | 06 | 4 | API-07 | T-01-23, T-01-24 | Mismatch raises rather than serialising | negative control | `uv run pytest tests/gate/test_api_boundary.py -x` | ❌ W0 | ⬜ pending |
| 1-07-01 | 07 | 4 | OPS-04 | T-01-26 | One migration system of record | integration (db) | `uv run alembic heads` + CI `test-pytest` green | ❌ W0 | ⬜ pending |
| 1-07-02 | 07 | 4 | OPS-04 | T-01-27, T-01-28, T-01-29 | Own capped psycopg pool; DSN from `SecretStr`; bounded run | integration (db) | `uv run pytest tests/test_worker_heartbeat.py -x` — **CI** | ❌ W0 | ⬜ pending |
| 1-08-01 | 08 | 5 | OPS-03, OPS-04 | T-01-30, T-01-31, T-01-33, T-01-34 | No credential in committed IaC; only web runs migrations | smoke (deployed) | `curl -sS -X POST .../gate/money-roundtrip` — digits identical | ❌ W0 | ⬜ pending |
| 1-08-02 | 08 | 5 | OPS-04 | T-01-32, T-01-35 | Dual-stack bind serves both address families | smoke (deployed) | `curl -4` public + `railway run --service worker -- curl` private | ❌ W0 | ⬜ pending |
| 1-08-03 | 08 | 5 | OPS-04 | — | Measurement recorded, not inherited | static | `grep -c '^### V092' docs/learnings/vendors-and-infra.md` | ❌ W0 | ⬜ pending |
| 1-09-01 | 09 | 6 | OPS-02 | T-01-36 | Red-then-green evidence real, gaps named not fabricated | static | `grep -qi 'bit-inexact'` + `git diff --quiet HEAD -- .planning/ROADMAP.md` | ❌ W0 | ⬜ pending |
| 1-09-02 | 09 | 6 | OPS-02 | T-01-37, T-01-39 | Instruction files true; local constraint stated honestly | static | `! grep -riq 'there is no application' CLAUDE.md .claude/rules/*.md` | ❌ W0 | ⬜ pending |
| 1-10-01 | 10 | 7 | OPS-01 | T-01-41, T-01-42 | Required contexts match job names character for character | static | `gh ruleset view` + context list comparison | ❌ W0 | ⬜ pending |
| 1-10-02 | 10 | 7 | OPS-01, OPS-02 | T-01-40 | Gate blocks a bad PR **and** accepts a good one | live (both directions) | `gh pr list --json state,mergedAt` + `git show origin/main:...EVIDENCE.md` | ❌ W0 | ⬜ pending |
| 1-10-03 | 10 | 7 | OPS-02 | T-01-43 | Strategy flipped only after the gate is proven | static | `git show origin/main:.planning/config.json` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Every task carries an automated command. No three consecutive tasks lack one.

---

## Wave 0 Requirements

Everything is `❌ W0` — this is a greenfield repository with no application code, no test suite and
no CI. Plans 01-01 and 01-02 are the Wave 0 that closes it, in that order.

- [ ] `pyproject.toml` — `[tool.pytest.ini_options]` with the `db` marker registered, plus
      `[tool.basedpyright]`, `[tool.mypy]`, `[tool.pydantic-mypy]`, `[tool.ruff.lint]` (plan 01-01)
- [ ] `tools/gate.sh` — the single script CI and local hooks both call (plan 01-01)
- [ ] `tests/test_settings.py` — the first test, DB-free (plan 01-01)
- [ ] `src/morai/db/base.py` — `Base` alone, so `alembic/env.py` imports before any model exists
      (plan 01-01)
- [ ] `.github/workflows/ci.yml` — four named jobs plus the `services: postgres` container that is
      this project's only usable test database (plan 01-02)
- [ ] `tests/conftest.py` — the async DB fixtures, failing loudly rather than skipping (plan 01-03)
- [ ] `tests/gate/` — the D-07 negative controls (plan 01-05)
- [ ] Framework install: `uv add --dev pytest pytest-asyncio basedpyright mypy ruff` (plan 01-01).
      `hypothesis` is deliberately **not** installed — no property test ships this phase.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Test-before-implementation ordering (D-08, OPS-02) | OPS-02 | Not automatable. D-08 chose a commit pair over a replay script because replaying the red commit in CI breaks under squash-merge | Read `01-RED-GREEN-EVIDENCE.md`: each test-first task carries a `test:` SHA with pasted failing output and a `feat:` SHA with pasted passing output, or a CI run URL where the green run could only happen in CI, or a named gap |

Every other phase behaviour has an automated command. Nothing in the phase needs a human to click
anything — see the sign-off below.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s local, < 3min for DB-backed CI confirmation
- [x] `nyquist_compliant: true` set in frontmatter
- [x] No task requires human interaction — every deploy, ruleset and merge step runs through
      `railway` or `gh` on already-authenticated CLIs

**Approval:** pending

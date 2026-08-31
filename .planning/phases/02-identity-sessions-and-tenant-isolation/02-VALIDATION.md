---
phase: 02-identity-sessions-and-tenant-isolation
nyquist_compliant: true
source: 02-RESEARCH.md § Validation Architecture
---

# Phase 2 Validation Contract

Materialised from `02-RESEARCH.md`'s Validation Architecture section, which is the authority.
This file exists because `config.json` sets `workflow.nyquist_validation: true` and the gate
expects the artifact; the substance was already written and is reproduced, not re-derived.

## Test Framework

| Property | Value |
|---|---|
| Framework | pytest 9.1.1 + pytest-asyncio 1.4.0, unchanged from Phase 1 |
| Config | existing `pyproject.toml` `[tool.pytest.ini_options]` — no change |
| Quick run | `uv run pytest tests/ -x -q --ignore=tests/gate -m "not db"` |
| Full gate | `bash tools/gate.sh` |

## Requirements → Test Map

Every requirement has an automated command. No three consecutive rows lack one.

| Req | Behaviour | Type | Automated command |
|---|---|---|---|
| AUTH-01 | A setup link is consumable exactly once; a concurrent double-use succeeds once | integration (db) | `uv run pytest tests/test_setup_tokens.py -x -m db` |
| AUTH-02 | A consumed setup link's second use is rejected | integration (db) | same file |
| AUTH-03 | Login issues a session row and cookie; wrong password rejected | integration (db) + unit | `uv run pytest tests/test_login.py -x -m db`, `uv run pytest tests/identity/test_passwords.py -x` |
| AUTH-04 | Logout deletes the row; a replayed cookie is rejected because the row is gone (D2-05) | integration (db) | `uv run pytest tests/test_logout.py -x -m db` |
| AUTH-05 | Admin-issued reset link works exactly once, same mechanism as AUTH-01 | integration (db) | `uv run pytest tests/test_setup_tokens.py -x -m db` (parametrized by `purpose`) |
| AUTH-07 | User A cannot read user B's row, **including when A is admin** | integration (db) | `uv run pytest tests/test_isolation.py -x -m db` |
| AUTH-08 | An audited read writes exactly one audit row in the same transaction; the natural bypass fails both type checkers; a forged capability raises at runtime | unit + gate meta-test | `uv run pytest tests/identity/test_audit.py -x`, `uv run pytest tests/gate/test_type_gate.py -x` |

## Sampling Rate

- **Per task commit:** `uv run pytest tests/ -x -q --ignore=tests/gate -m "not db"`
- **Per wave merge:** `bash tools/gate.sh` — the full suite including `tests/gate/` and `-m db`
  against CI's Postgres container.
- **Phase gate:** full CI suite green.

## The one thing this contract will not certify on its own

`tests/test_isolation.py` passing is **necessary and not sufficient**, and the reason is specific
enough to write down.

Superusers bypass RLS, and `FORCE ROW LEVEL SECURITY` does not change that. CI's Postgres service
runs as `POSTGRES_USER=morai`, which the official image documents as created "with superuser power".
So a suite that connects as CI's default user has every policy silently inert — and still passes,
because the application's own query filter returns the right rows anyway. It would measure the
filter and report it as the policy.

The suite therefore carries its own guards, and **these are part of the contract, not incidental
tests**:

| Guard | Without it |
|---|---|
| Assert the test connection has `rolsuper` false and `rolbypassrls` false, before any isolation assertion | The suite silently degrades to testing the app filter |
| A positive control running byte-identical SQL through a superuser connection, asserting every row returns | `assert rows == []` also passes on an empty table, a misspelled relation, or a seed that did nothing |
| A third user owning no rows | Cannot distinguish "the policy excluded them" from "the context excludes everyone" |
| A fail-closed test for unset RLS context | An unset context that returns everything looks identical to a working policy |
| A `WITH CHECK` write test | Reads are policed, writes are not |
| `test_admin_is_not_exempt...` as its own named test, with `test_admin_can_read_another_users_account_row` as counterpart | A green admin test could mean a broken `is_admin` context rather than a real policy difference |

If any guard is weakened, the suite stops certifying isolation and starts certifying nothing. That
is the same failure shape as Phase 1's worktree false-green, where a suite passed only because a
gitignored `.env` was absent — and it is why this phase's isolation suite is its equivalent of the
13-calendar oracle.

## Deferred, with reasons

- **The deployed-service isolation run (D2-10).** Criterion 3 wants the suite proven against the real
  Railway configuration. `tools/isolation_smoke.py` ships committed and runnable but **unrun** — the
  Railway variable cutover it depends on is blocked by a permission classifier in this session and is
  written up as an operator runbook in `docs/operations/phase-2-operator-steps.md`. Mitigating fact:
  the spike found no pooler, so CI's direct-connection container is the same topology in kind, not a
  lesser stand-in.
- **Argon2id parameter tuning on Railway hardware.** Measured at 276 ms on an M1 Pro
  (128 MiB / t=3 / p=1), inside OWASP's 250-400 ms band — a floor, not the deployed answer. The real
  constraint is CPU wall-clock on a shared vCPU. Script ships; the measurement is a post-deploy task.

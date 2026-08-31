---
gsd_state_version: 1.0
current_phase: 04
current_phase_name: Schwab Connection and Token Lifecycle
status: executing
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-08-31T18:29:26.878Z"
last_activity: 2026-08-31
last_activity_desc: Phase 04 execution started
state_head: fd4c88220c9bc58c75ef6f1d777c38a9991c55b0
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 27
  completed_plans: 20
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-29)

**Core value:** The ledger is correct across rolls and settlements — the sum of realised P&L over any
window equals the broker's cash delta over that window, checked every ingest cycle.
**Current focus:** Phase 04 — Schwab Connection and Token Lifecycle

## Current Position

Phase: 04 (Schwab Connection and Token Lifecycle) — EXECUTING
Plan: 1 of 4
Status: Executing Phase 04
Last activity: 2026-08-31 — Phase 04 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P02 | 25min | 2 tasks | 2 files |
| Phase 01 P03 | 9min | 2 tasks | 13 files |
| Phase 01 P05 | 8min | 3 tasks | 8 files |
| Phase 01-walking-skeleton P06 | 25min | 2 tasks | 4 files |
| Phase 01 P07 | 20min | 2 tasks | 4 files |
| Phase 02 P01 | 40min | 3 tasks | 17 files |
| Phase 02 P04 | 22min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Derivation (Phase 5) runs parallel to the Schwab connection (Phase 4). The oracle is
  fixture data, so the riskiest correctness work is not blocked on the flakiest vendor integration.

- [Roadmap]: Encryption and the trade-data schema are one phase (Phase 3). The plaintext column set
  is a schema decision, and it is settled before any trade row is written.

- [Roadmap]: Snapshot capture is Phase 8, immediately after its dependencies (positions plus a
  market read). It cannot be backfilled, so it does not sort to the end.

- [Roadmap]: No separate tooling phase. OPS-01 and OPS-02 are established in Phase 1 and every later
  phase is held to them.

- [Phase 1]: CI push trigger unfiltered by branch, since Task 2 needs a red run observed on a throwaway branch pushed directly
- [Phase 1]: test-pytest Postgres pinned to major 18 (postgres:18-alpine), matching the live Railway Postgres image, superseding 01-RESEARCH.md's illustrative postgres:17 example
- [Phase 1, 01-03]: Float canary asserts bit-inexactness (`Decimal(float(x)) != x`), not a visible digit flip -- NUMERIC(14,4)'s 14-sig-fig ceiling is narrower than a double's ~15.95, so no value both fits the column and visibly loses a digit
- [Phase 1, 01-03]: `StrictDecimalField` (`BeforeValidator`) fixes the R-02 gap between D-03's Decimal-as-JSON-string wire format and D-12's strict request models
- [Phase 1, 01-03]: pytest session shares one asyncio event loop (`asyncio_default_fixture_loop_scope`/`asyncio_default_test_loop_scope = "session"`) so the app's `lru_cache`d `AsyncEngine` isn't handed to a second loop mid-suite
- [Phase 1]: 01-05: tests/gate/fixtures exclusion applies to explicit checker paths too, not only glob discovery -- meta-test copies fixtures to tmp_path before invoking each checker
- [Phase 1]: 01-05: dropped the false mypy-vs-explicit-Any assertion (disallow_any_explicit deliberately off); substituted basedpyright's reportIgnoreCommentWithoutRule on the bare-ignore fixture
- [Phase 1]: 01-05: committed-secret guard uses a shape heuristic (16+ chars, letters and digits) instead of a file exclusion list, so existing test fixtures with fake passwords never trip it
- [Phase 1]: Request-id propagation uses contextvars.ContextVar[str], not request.state (State.__getattr__ returns Any, which reportAny flags)
- [Phase 1]: Negative-control response models locally set revalidate_instances='always' so model_construct() actually re-validates -- otherwise FastAPI returns a silent 200 for a broken response
- [Phase 1]: PsycopgConnector (psycopg v3) is the worker's connector -- Procrastinate ships no asyncpg connector; pool capped explicitly (min_size=1, max_size=2) as its own NN-28 budget line
- [Phase 1]: Procrastinate's schema.sql wrapped verbatim into Alembic revision 0002, split into per-statement op.execute() calls -- asyncpg's protocol rejects multi-statement strings
- [Phase 2]: [Phase 2, 02-01]: SET LOCAL cannot bind a query parameter -- use set_config(name, value, true) for RLS context, measured against real Postgres/asyncpg
- [Phase 2]: [Phase 2, 02-01]: morai_app (NOSUPERUSER NOBYPASSRLS) is a required deliverable; get_db_session runs every route through it, get_engine() stays the DDL/superuser-only engine
- [Phase 2]: 02-04: audit.py's own module docstring carries the three-paragraph honest ceiling (what type-checks, what falls back to a runtime guard, what neither covers) so a later reader of the code, not just the plan, finds the caveat
- [Phase 2]: 02-04: open_audited_read() writes via raw text() SQL, not insert(AuditLog).values(...) -- the ORM construct silently appends an implicit RETURNING for the server-generated id, and audit_log's INSERT-only RLS policy has no SELECT policy to permit that read back (found in CI, no reachable local database)

### Pending Todos

None yet.

### Blockers/Concerns

Five open decisions are assigned to owning phases rather than left floating — see ROADMAP.md
"Open Decisions and Their Owners":

- Phase 1: Hypercorn vs uvicorn dual-stack binding on real Railway hardware (`V039`, partially stale)
- Phase 2: Railway pooling topology is SETTLED — `02-RESEARCH.md` confirmed against live
  Railway docs and `railway variables` that no pooler sits in front of this Postgres, so the
  `set_config(..., true)` RLS context and its query share a transaction. What remains open is
  narrower: the isolation suite has never run against the live deployment, because none of
  `docs/operations/phase-2-operator-steps.md`'s four steps have been performed —
  `MORAI_APP_DB_PASSWORD` is not yet set on Railway, so the deployed services cannot connect
  as `morai_app` at all. Tracked as human verification in `02-VERIFICATION.md`.

- Phase 4: `schwab-py` `py.typed` coverage — **SETTLED 2026-08-31, measured not recalled.**
  The published 1.5.1 wheel was downloaded and listed: no `py.typed` marker. Neither
  `types-schwab-py` nor `schwab-py-stubs` exists on PyPI (both HTTP 404). Under PEP 561 the
  package is untyped to mypy and basedpyright, so every symbol from it is `Any` and
  `reportAny` flags every call. The project therefore owns a `Protocol` over exactly the
  four methods it uses, with one adapter module as the sole importer of `schwab` and
  `model_validate()` at every call site. Recorded as `D4-01`..`D4-05` in `04-CONTEXT.md`.

- Phase 6: Railway execution model, cron container vs long-running worker — Phase 8 inherits it
- Phase 9: Reconciliation window boundary — RECON-01 is untestable until it is fixed

REQUIREMENTS.md recorded 62 v1 requirements; the actual count is 68. Corrected in that file.

## Deferred Verification

Phase 2's code is complete and its other four success criteria are verified. Criterion 3b —
"the isolation suite passes against the real Railway pooling configuration" — cannot be closed
from a development machine and is deferred by explicit user decision (2026-08-31), not skipped.
`02-VERIFICATION.md` keeps `status: human_needed`; it was NOT rewritten to `passed`.

| Phase | State | Resume |
|-------|-------|--------|
| 2 | verification_deferred_human | /gsd-verify-work 2 |
| 3 | verification_deferred_human | /gsd-verify-work 3 |

Owed on live Railway:

1. `docs/operations/phase-2-operator-steps.md` steps 1-4 (set `MORAI_APP_DB_PASSWORD`, deploy,
   bootstrap the admin), then `tools/isolation_smoke.py` against the live deployment. Until
   step 1 runs, the deployed services cannot connect as `morai_app` at all.

2. `tools/measure_argon2.py` on the real Railway container — `D2-03`'s owed measurement. The
   Argon2id band must be tuned on production hardware, not copied from a laptop.

Neither blocks Phase 3, which is local schema and encryption work with no deployment dependency.

Phase 3 verified 6/6 success criteria against live code and a live database, and carries two
NEW infrastructure-only items, deferred on the same basis as Phase 2's (user decision
2026-08-31). `03-VERIFICATION.md` keeps `status: human_needed`; it was NOT rewritten to
`passed`.

3. Confirm `MORAI_MASTER_KEY` is set on Railway's `web` and `worker` services. This is
   `CRYPT-01`'s own Manual-Only Verification in `03-VALIDATION.md`: a local test can prove the
   app reads the KEK from its environment, never that production has one configured. Without
   it the deployed services cannot unwrap any user's data key.

4. `tools/rotate_kek.py` has never been run against a real deployment (stated plainly in
   `03-04-SUMMARY.md`). Rotation is verified locally as all-or-nothing with byte-identical
   trade ciphertext, but an operator decision is owed on whether shipping an unexercised
   rotation path is acceptable.

Neither blocks Phase 4 (Schwab connection) or Phase 5 (fill pairing against the oracle), both
of which are local work. Item 3 belongs with Phase 2's item 1 — the same Railway deploy that
sets `MORAI_APP_DB_PASSWORD` should set `MORAI_MASTER_KEY`.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-08-31T05:25:23.839Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None

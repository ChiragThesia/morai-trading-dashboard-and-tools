---
gsd_state_version: 1.0
current_phase: 02
current_phase_name: Identity, Sessions, and Tenant Isolation
status: executing
stopped_at: Completed 02-04-PLAN.md
last_updated: "2026-08-31T10:52:14.228Z"
last_activity: 2026-08-31
last_activity_desc: Phase 02 execution started
state_head: ed05015b89939986372a26628ccd47e57c8a9d83
progress:
  total_phases: 11
  completed_phases: 0
  total_plans: 16
  completed_plans: 10
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-29)

**Core value:** The ledger is correct across rolls and settlements — the sum of realised P&L over any
window equals the broker's cash delta over that window, checked every ingest cycle.
**Current focus:** Phase 02 — Identity, Sessions, and Tenant Isolation

## Current Position

Phase: 02 (Identity, Sessions, and Tenant Isolation) — EXECUTING
Plan: 1 of 6
Status: Executing Phase 02
Last activity: 2026-08-31 — Phase 02 execution started

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
- Phase 4: `schwab-py` `py.typed` coverage (UNVERIFIED) — sets the vendor `Protocol` shape
- Phase 6: Railway execution model, cron container vs long-running worker — Phase 8 inherits it
- Phase 9: Reconciliation window boundary — RECON-01 is untestable until it is fixed

REQUIREMENTS.md recorded 62 v1 requirements; the actual count is 68. Corrected in that file.

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| *(none)* | | | | |

## Session Continuity

Last session: 2026-08-31T05:25:23.839Z
Stopped at: Completed 02-04-PLAN.md
Resume file: None

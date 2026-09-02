---
gsd_state_version: 1.0
current_phase: 09
current_phase_name: Reconciliation Invariant and Status Endpoint
status: executing
stopped_at: Phase 05 complete, ready to plan Phase 1
last_updated: "2026-09-02T04:00:27.876Z"
last_activity: 2026-09-01
last_activity_desc: Phase 09 execution started
state_head: c8c851d9bd0d015a048d112ee02f0087cee18831
progress:
  total_phases: 11
  completed_phases: 1
  total_plans: 45
  completed_plans: 39
  percent: 9
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-29)

**Core value:** The ledger is correct across rolls and settlements — the sum of realised P&L over any
window equals the broker's cash delta over that window, checked every ingest cycle.
**Current focus:** Phase 09 — Reconciliation Invariant and Status Endpoint

## Current Position

Phase: 09 (Reconciliation Invariant and Status Endpoint) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 09
Last activity: 2026-09-01 — Phase 09 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 05 | 3 | - | - |

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
- Phase 9: Reconciliation window boundary — **SETTLED 2026-09-01 in `09-CONTEXT.md` (`D9-01`..`D9-04`).**
  A window is a **settlement-date trading day in ET**, because cash moves on the broker's settlement
  calendar; a rolling 24-hour window would split a single trading day and manufacture a false
  mismatch every day, and calendar days do the same across every weekend. A window closes when a
  later trading day's broker transaction lands — the broker's own later activity is the evidence it
  considers the prior day final, where a clock timeout would close a window the vendor may still be
  writing into. Late data reopens a closed window and the reopening is itself recorded as a finding,
  never silently absorbed. RECON-01 is now testable.

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
| 4 | verification_deferred_human | /gsd-verify-work 4 |
| 6 | verification_deferred_human | /gsd-verify-work 6 |
| 7 | verification_deferred_human | /gsd-verify-work 7 |
| 8 | verification_deferred_human | /gsd-verify-work 8 |

Phase 8's code is complete and all five of its success criteria are verified against live code and
a live database (587 passed, gate exit 0). Deferred by explicit user decision (2026-09-01) to keep
the autonomous run moving; `08-VERIFICATION.md` keeps `status: human_needed` and was NOT rewritten
to `passed`.

Phase 8 carries TWO open items, both pre-declared Manual-Only in `08-VALIDATION.md` before
execution — neither is a surprise finding:

1. **The live Schwab `get_quotes` OPTION response schema.** This project has never called
   `get_quotes` live, and `08-RESEARCH.md` rates the exact response shape LOW confidence. The design
   absorbs the risk rather than assuming it away: raw payloads are stored independently (`D8-01`,
   `D8-04`) and `parse_quote_payload` never raises — so a wrong field path yields honest gaps, never
   a wrong number. Closing it needs one real capture slot against a live connection, comparing the
   stored `snapshot_observations` payload against the parser's output.

2. **Procrastinate's `MAX_DELAY` on a real worker outage.** `PeriodicDeferrer.MAX_DELAY = 600` (read
   from the installed 3.9.0 source): a worker down more than ten minutes across a slot boundary
   produces no job at all for that slot — not even a failed one. The *mechanism* is proven locally
   (`missing_capture_slots` surfaces the hole and `backfill_uncaptured_slot_gaps` writes an honest
   `slot_not_captured` gap), but the real trigger needs a deployed worker actually stopped.

Both close with the same Railway deploy items 1-4 below.

**Known test-infrastructure flake, not a production defect:**
`test_expired_connection_writes_gap` can fail intermittently when run as a narrow subset. Root
caused during verification to Phase 1's heartbeat periodic task (`cron="* * * * *"`) sharing the
same Procrastinate `app` and monkeypatched auth seam. Confirmed three independent ways as test
isolation, not Phase 8 behaviour, and it does not manifest under the gating command
(`bash tools/gate.sh`). Worth fixing when the worker test harness is next touched.

Phase 7's code is complete and all four of its success criteria are verified against live code
and a live database (459 passed, gate exit 0). Deferred by explicit user decision (2026-09-01)
to keep the autonomous run moving; `07-VERIFICATION.md` keeps `status: human_needed` and was NOT
rewritten to `passed`.

Its one open item is narrower than the other four and is new in kind: `ZoneInfo("America/New_York")`
must be confirmed to construct on the real Railway container. macOS always ships system tz data, so
a local pass proves nothing about the deployed image — the failure, if it exists, is production-only.
`tzdata==2026.3` is now pinned explicitly in `pyproject.toml`/`uv.lock` as the fix. `07-VALIDATION.md`
lists this as Manual-Only. It closes with the same deploy as items 1-4 below: deploy this phase, run
`sync_user` for a user whose legs are past expiry, confirm no `ZoneInfoNotFoundError` and that
SETTLEMENT rows are written.

Phase 6's code is complete and all five of its success criteria are verified against live
code and a live database (383 passed, gate exit 0, clean on 114 files). Its one open item is
the same Railway blocker Phases 2, 3 and 4 carry, and it unblocks from the same action.

Phase 6 adds one NEW prerequisite to that action, and it is a security fix rather than a
convenience: `MORAI_APP_DB_PASSWORD` is now required on the Railway **worker** service, which
never needed it before. `worker/app.py` previously held only a Procrastinate pool on the
superuser DSN; an ingest job writing user-scoped rows over that role would have made every RLS
policy inert for exactly the rows this phase adds -- silently, with the whole suite green. The
`sync_user` job now opens its session as `morai_app` and calls
`assert_connection_cannot_bypass_rls` before touching a protected table, so the worker cannot
start without that password. See `06-USER-SETUP.md`.

`06-VERIFICATION.md` keeps `status: human_needed`; it was NOT rewritten to `passed`.

Phase 4's code is complete and all five of its success criteria are verified against live
code, a live database, and live test runs (283 passed, gate exit 0). The one open item is
the same Railway blocker Phases 2 and 3 carry, and it unblocks from the same action: set
the secrets on the `web` service, then `railway config apply`. Phase 4 adds three to the
list — `SCHWAB_API_KEY`, `SCHWAB_APP_SECRET`, `SCHWAB_CALLBACK_URL` — now declared with
`preserve()` in `.railway/railway.ts`, which keeps a value that is already set but cannot
create one. Deferred by explicit user decision (2026-08-31). `04-VERIFICATION.md` keeps
`status: human_needed`; it was NOT rewritten to `passed`. Items in `04-UAT.md`.

Phase 5 does not depend on any of this — the ROADMAP marks it "Parallel with Phase 4"
because fill pairing is derivation logic that needs no broker connection.

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
Stopped at: Phase 05 complete, ready to plan Phase 1
Resume file: None

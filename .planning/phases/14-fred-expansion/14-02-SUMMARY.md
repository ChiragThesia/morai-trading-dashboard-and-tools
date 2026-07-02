---
phase: 14-fred-expansion
plan: 02
subsystem: database
tags: [drizzle, postgres, migration, fred, macro]

# Dependency graph
requires: []
provides:
  - "macroObservations pgTable in packages/adapters/src/postgres/schema.ts — composite time-leading PK (date, series_id), RLS enabled"
  - "Migration 0013_macro_observations.sql generated, hand-reviewed, applied live + idempotency-confirmed"
  - "meta/0013_snapshot.json + _journal.json ledger entry (tag 0013_macro_observations)"
affects: [14-03, 14-04, 14-05, macro, fred-expansion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "macro_observations: composite-PK observation table (no uuid id) — PK IS the idempotency key, unlike cot_observations (uuid + unique constraint)"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0013_macro_observations.sql
    - packages/adapters/src/postgres/migrations/meta/0013_snapshot.json
  modified:
    - packages/adapters/src/postgres/schema.ts
    - packages/adapters/src/postgres/migrations/meta/_journal.json

key-decisions:
  - "source column included (Claude's Discretion): text NOT NULL, 'fred'|'cboe' provenance — matches codebase source-tagging convention"
  - "Composite PK (date, series_id) time-leading per DATA-01 — the D-05 upsert idempotency target; no uuid id column"
  - "Migration renamed 0013_perpetual_lorna_dane → 0013_macro_observations; _journal.json tag updated (0003/0004 precedent)"

patterns-established:
  - "macro_observations follows term_structure_observations composite-PK shape, not cot_observations uuid+unique shape"

requirements-completed: [MAC-01]

coverage:
  - id: D1
    description: "macro_observations table live in the schema with composite (date, series_id) PK and RLS enabled; migration 0013 applied idempotently"
    requirement: MAC-01
    verification:
      - kind: manual_procedural
        ref: "bun run migrate (run 1: 0013 applied cleanly; run 2: no-op — operator-executed after permission gate)"
        status: pass
      - kind: other
        ref: "rg 'PRIMARY KEY(\"date\",\"series_id\")' + 'ENABLE ROW LEVEL SECURITY' in 0013_macro_observations.sql"
        status: pass
      - kind: other
        ref: "bun run typecheck (schema compiles clean)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration is a clean CREATE TABLE — rate_observations untouched, no destructive statements (D-02 / T-14-05)"
    requirement: MAC-01
    verification:
      - kind: other
        ref: "rg -n 'DROP TABLE|rate_observations' packages/adapters/src/postgres/migrations/0013_macro_observations.sql → no match"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-02
status: complete
---

# Phase 14 Plan 02: macro_observations Schema + Migration 0013 Summary

**New macro_observations table (date, series_id, value, source) with composite time-leading PK + RLS — migration 0013 generated from Drizzle schema, hand-reviewed, and applied live to Supabase with idempotency confirmed**

## Performance

- **Duration:** ~12 min (excluding permission-gate wait)
- **Started:** 2026-07-02T01:50:00Z
- **Completed:** 2026-07-02T02:02:22Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- `macroObservations` pgTable added to `schema.ts` beside `rateObservations`: `date` (date NOT NULL), `seriesId` (text NOT NULL), `value` (numeric NOT NULL — RAW as reported, D-14), `source` (text NOT NULL, `fred`|`cboe`), composite PK `primaryKey({ columns: [table.date, table.seriesId] })`, `.enableRLS()`
- Migration `0013_macro_observations.sql` generated via `bunx drizzle-kit generate` (not hand-written — Drizzle ledger stays consistent); hand-reviewed: clean `CREATE TABLE "macro_observations"` with `PRIMARY KEY("date","series_id")` + `ENABLE ROW LEVEL SECURITY`, zero destructive statements
- Live-applied to production Supabase (`bun run migrate` run twice — second run a no-op), so 14-03's repo/testcontainer work builds against a proven table

## Task Commits

Each task was committed atomically:

1. **Task 1: macro_observations table + migration 0013 + [BLOCKING] live schema push** - `9ff51f7` (feat)

## Files Created/Modified

- `packages/adapters/src/postgres/schema.ts` - added `macroObservations` pgTable (table 16); nothing else touched
- `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` - generated CREATE TABLE + RLS
- `packages/adapters/src/postgres/migrations/meta/0013_snapshot.json` - drizzle-kit snapshot
- `packages/adapters/src/postgres/migrations/meta/_journal.json` - ledger entry idx 13, tag `0013_macro_observations`

## Decisions Made

- **Included the optional `source` column** (Claude's Discretion in 14-CONTEXT): `text("source").notNull()` — cheap, matches the codebase source-tagging convention (`snapshot_source`/`observation_source` enums elsewhere); plain text (not enum) keeps the migration additive-only
- **Renamed drizzle-kit's random-word file** `0013_perpetual_lorna_dane.sql` → `0013_macro_observations.sql` and updated the `_journal.json` tag (established precedent: 0003_broker_tokens, 0004_calendar_events)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added dummy SIDECAR_URL to local .env for migrate env validation**
- **Found during:** Task 1 (pre-migrate env check)
- **Issue:** `bun run migrate` Zod-validates the FULL `workerConfigSchema` including `SIDECAR_URL`, which was absent from local `.env` (RESEARCH Pitfall 7, anticipated by the plan)
- **Fix:** Appended `SIDECAR_URL=http://localhost:8000` to the gitignored local `.env`
- **Files modified:** `.env` (gitignored — not committed)
- **Verification:** `bun run migrate` boots and runs
- **Committed in:** N/A (gitignored local file)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** None — the plan's action text explicitly anticipated this env prep. No scope creep.

## Issues Encountered

- **Permission gate on live migration:** the harness auto-mode classifier denied `bun run migrate` (live-prod DDL). Escalated to the user rather than working around it; user approved and the orchestrator executed both runs. Run 1: "migrate: all migrations applied" (0013 applied cleanly, only pre-existing NOTICE messages). Run 2: no-op — idempotency confirmed. Documented as normal flow, not a failure.

## User Setup Required

None - no external service configuration required. (FRED_API_KEY prod prerequisite is tracked at phase level for later plans, not this schema plan.)

## Next Phase Readiness

- `macro_observations` live with the MAC-01 idempotency key — 14-03 (repo + testcontainer contract suite) can proceed against a proven table
- `rate_observations` / `readRate` / BSM path verified untouched (D-02)

## Self-Check: PASSED

- `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` — FOUND
- `packages/adapters/src/postgres/migrations/meta/0013_snapshot.json` — FOUND
- Commit `9ff51f7` — FOUND in git log
- All 5 acceptance criteria — PASS

---
*Phase: 14-fred-expansion*
*Completed: 2026-07-02*

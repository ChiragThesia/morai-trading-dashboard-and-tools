---
phase: 06-derived-analytics
plan: 02
subsystem: analytics
tags: [drizzle, postgres, migration, testcontainers, idempotency, rls]

# Dependency graph
requires:
  - phase: 06-derived-analytics
    plan: 01
    provides: three analytics tables in schema.ts (skew/risk-reversal/term-structure) with per-grain composite PKs
provides:
  - 0007_analytics_observations.sql — CREATE TABLE for the three analytics tables (per-grain PK = UNIQUE idempotency key, RLS enabled)
  - complete drizzle snapshot chain 0000→0007 (reconstructed missing 0006 snapshot)
  - migration proven valid + idempotent against a postgres:16 testcontainer
affects: [06-04 term-structure slice, 06-05 skew/RR slice — both replay 0007 via testcontainers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generated migration renamed to descriptive tag + journal tag updated to match (Phase 4/5 precedent)"
    - "Drizzle snapshot chain must be whole: a committed SQL migration WITHOUT its meta snapshot makes the next generate re-emit already-applied DDL"
    - "Live prod DDL push deferred to operator; SQL pre-validated against a local testcontainer (chain replay + idempotent no-op) as the strongest non-prod proof"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0007_analytics_observations.sql
    - packages/adapters/src/postgres/migrations/meta/0006_snapshot.json
    - packages/adapters/src/postgres/migrations/meta/0007_snapshot.json
  modified:
    - packages/adapters/src/postgres/migrations/meta/_journal.json
    - .planning/phases/06-derived-analytics/deferred-items.md

key-decisions:
  - "Reconstructed the missing meta/0006_snapshot.json (Phase 5 shipped the 0006 SQL + journal entry but not its snapshot) — without it drizzle re-emitted the 0006 columns into 0007, which would dup-ADD COLUMN on replay. Built 0006 snapshot from the full schema minus the 3 analytics tables, prevId chained to 0005."
  - "Live production Supabase migrate (Task 2 blocking checkpoint) DEFERRED per operator (same as phases 03/04/05). NOT executed. Validated locally against postgres:16 testcontainer instead."

requirements-completed: [ANLY-01, ANLY-02, ANLY-03]

# Metrics
duration: 5min
completed: 2026-06-22
status: complete
---

# Phase 6 Plan 2: Analytics-Observations Migration Summary

**Generated `0007_analytics_observations.sql` (three analytics tables, per-grain composite PKs, RLS) from schema.ts; repaired a broken drizzle snapshot chain so the migration contains only the new tables; proven valid + idempotent against a postgres:16 testcontainer. Live production push deferred to the operator.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-22T16:11:38Z
- **Completed:** 2026-06-22T16:16:29Z
- **Tasks:** 2 (1 executed, 1 deferred)
- **Files:** 3 created, 2 modified

## Accomplishments

- **`0007_analytics_observations.sql` generated** via `drizzle-kit generate` (NOT hand-written), renamed from drizzle's random slug, journal tag updated to match. Contains exactly three `CREATE TABLE` statements:
  - `skew_observations` — PK (snapshot_time, underlying, expiration, strike); nullable `delta`, `moneyness`.
  - `risk_reversal_observations` — PK (snapshot_time, underlying, expiration); nullable `risk_reversal`, `rr_rank`.
  - `term_structure_observations` — PK (snapshot_time, calendar_id); `value`, `front_iv`, `back_iv` NOT NULL.
  - Each composite PK doubles as the per-grain UNIQUE idempotency key; each table `ENABLE ROW LEVEL SECURITY`.
- **Repaired the drizzle snapshot chain** (see Deviations) — `meta/0006_snapshot.json` was missing, so the first generate re-emitted the Phase-5 0006 columns into 0007. Reconstructed 0006 so 0007 carries only the analytics tables.
- **Validated locally against a real Postgres:** `drizzle-kit check` ⇒ "Everything's fine"; a follow-up `generate` is a clean no-op (schema fully captured); the full chain (0000→0007) applies on a `postgres:16` testcontainer and a second `runMigrations` run is a clean no-op (DATA-02 idempotency). `migrate.idempotent.test.ts` + `rls.test.ts` both green.

## Task Commits

1. **Task 1: generate 0007 analytics-observations migration** — `45c220a` (feat)
2. **Task 2: live production Supabase migrate** — **DEFERRED, not executed** (see below)

**Plan metadata:** final docs commit — SUMMARY/STATE/ROADMAP/REQUIREMENTS.

## Files Created/Modified

- `packages/adapters/src/postgres/migrations/0007_analytics_observations.sql` — three analytics tables (created)
- `packages/adapters/src/postgres/migrations/meta/0006_snapshot.json` — reconstructed missing snapshot (created, Rule 1 fix)
- `packages/adapters/src/postgres/migrations/meta/0007_snapshot.json` — drizzle-generated post-0007 snapshot (created)
- `packages/adapters/src/postgres/migrations/meta/_journal.json` — idx-7 entry, tag `0007_analytics_observations` (modified)
- `.planning/phases/06-derived-analytics/deferred-items.md` — recorded the deferred live push (modified)

## Decisions Made

- **Live production push DEFERRED.** Task 2 is a blocking `checkpoint:human-verify` applying DDL to the live Supabase DB. Per operator instruction (mirroring phases 03/04/05) it was NOT run. Recorded in `deferred-items.md` item 3: operator runs `bun run migrate` (session pooler / direct URL, max:1) before deploy, then a second no-op run, then confirms the three tables exist.
- **Reconstructed the 0006 snapshot rather than hand-editing 0007 SQL.** The plan forbids hand-editing the SQL body. The correct fix targeted the root cause (broken snapshot chain), letting drizzle regenerate a clean 0007.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing `meta/0006_snapshot.json` made the first generate re-emit already-applied columns**
- **Found during:** Task 1 (first `drizzle-kit generate`)
- **Issue:** Phase 5 (commits 2173b7d / 23e0eef) committed `0006_fills_processed_at.sql` and its `_journal.json` entry, but never committed `meta/0006_snapshot.json`. Drizzle's snapshot chain therefore ended at 0005, and `0007_snapshot.prevId` pointed straight at `0005.id` (skipping 0006). As a result the first generated 0007 re-emitted the three Phase-5 columns: `ALTER TABLE calendar_events ADD COLUMN roll_open_debit/roll_close_credit` and `ALTER TABLE fills ADD COLUMN processed_at`. Those columns already exist live and in the testcontainer replay (0006 adds them), so 0007 would dup-`ADD COLUMN` — a non-idempotent migration that breaks both the live apply and downstream testcontainer chain replay (06-04/06-05).
- **Fix:** Removed the wrong 0007 artifacts; reconstructed `meta/0006_snapshot.json` = the full post-0006 schema (the 3 analytics tables removed), fresh id, `prevId` chained to `0005.id`; regenerated 0007 against the now-complete chain — it emitted only the three analytics tables; renamed to `0007_analytics_observations.sql` and set the journal tag to match.
- **Files modified:** created `meta/0006_snapshot.json`; created `0007_analytics_observations.sql` + `meta/0007_snapshot.json`; updated `meta/_journal.json`.
- **Verification:** `drizzle-kit check` ⇒ "Everything's fine"; re-`generate` ⇒ "No schema changes, nothing to migrate"; `migrate.idempotent.test.ts` + `rls.test.ts` green against `postgres:16` (full chain applied, second run a clean no-op).
- **Committed in:** 45c220a

**Total deviations:** 1 auto-fixed (1 bug — pre-existing broken snapshot chain from Phase 5, fixed at the root cause).
**Impact on plan:** Necessary to produce a correct, idempotent 0007. The migration SQL is exactly the three planned tables — no hand-edits to table DDL, matching schema.ts.

## Issues Encountered

- **Constraint-name truncation NOTICE (informational, not an error):** Postgres truncates the
  `risk_reversal_observations_snapshot_time_underlying_expiration_pk` PK constraint name (65 chars)
  to 63 chars (`...expiration_`). It is deterministic and idempotent (the idempotency test proves a
  second run is a clean no-op), and the truncated name stays unique. Logged for operator awareness
  in `deferred-items.md`. The other two PK names fit within 63 chars.

## Verification Status

- **Plan automated verify:** PASS — 0007 SQL exists; 3 `CREATE TABLE`; journal tag `0007_analytics_observations` present; all three table names present.
- **drizzle-kit check:** "Everything's fine 🐶🔥" (journal + snapshot chain consistent).
- **Re-generate:** no-op ("No schema changes, nothing to migrate") — schema.ts fully captured by the migration chain.
- **Testcontainer (postgres:16):** full chain 0000→0007 applies; second `runMigrations` is a clean no-op; `migrate.idempotent.test.ts` 1/1 green, `rls.test.ts` 1/1 green.
- **Live production apply:** DEFERRED (not run) — operator action recorded in `deferred-items.md`.

## Known Stubs

None. The migration is complete and self-contained.

## Next Phase Readiness

- 06-04 / 06-05 can replay the migration chain (including 0007) via testcontainers to build their schema — no live DB needed.
- **Operator action before deploy:** run `bun run migrate` against live Supabase, prove idempotent no-op on a second run, confirm the three tables exist (see `deferred-items.md` item 3).

## Self-Check: PASSED

- `0007_analytics_observations.sql`, `meta/0006_snapshot.json`, `meta/0007_snapshot.json` all exist on disk.
- Commit `45c220a` exists in git history with all four migration files.
- Three analytics table names + 3 `CREATE TABLE` confirmed present in the SQL; journal tag matches the renamed file.

---
*Phase: 06-derived-analytics*
*Completed: 2026-06-22*

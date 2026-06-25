---
phase: 11-sidecar-scaffold-auth-migration
plan: "02"
subsystem: postgres-migrations
tags: [drizzle, migration, broker_tokens, token_json, operator-deferred]
status: checkpoint-pending

dependency_graph:
  requires: [11-01]
  provides: [0011_broker_tokens_token_json.sql]
  affects: [broker_tokens, 11-04]

tech_stack:
  added: []
  patterns:
    - drizzle-kit generate + rename convention (Phase 4 P01 precedent)
    - operator-deferred live DDL (Phase 6 P02 / Phase 8 precedent)

key_files:
  created:
    - packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql
    - packages/adapters/src/postgres/migrations/meta/0011_snapshot.json
  modified:
    - packages/adapters/src/postgres/migrations/meta/_journal.json

decisions:
  - Migration renamed from drizzle-kit default (0011_fantastic_inertia) to 0011_broker_tokens_token_json per Phase 4 P01 convention; journal tag updated to match
  - Task 2 (bun run migrate against live Supabase) operator-deferred per orchestrator directive: prod is db-down/stale (STATE.md Blocker) and autonomous:false; consistent with Phase 6 P02 / Phase 8 operator-defer precedent

metrics:
  duration_minutes: 2
  completed_date: "2026-06-25"
  tasks_completed: 1
  tasks_deferred: 1
  files_created: 2
  files_modified: 1
---

# Phase 11 Plan 02: Broker Tokens Migration Summary

**One-liner:** Generated additive Drizzle migration 0011 adding `token_json jsonb` to `broker_tokens`; live DB apply is operator-deferred (prod db-down).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Generate 0011 migration from schema diff | c0f75eb | 0011_broker_tokens_token_json.sql, 0011_snapshot.json, _journal.json |

## Tasks Deferred (Checkpoint Pending)

| Task | Name | Status | Reason |
|------|------|--------|--------|
| 2 | Apply migration to live DB via `bun run migrate` | operator-deferred | autonomous:false; prod db-down/stale (STATE.md Blocker); orchestrator directive prohibits automated apply |

## Verification (Task 1)

```
test -f packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql \
  && grep -iq 'add column' packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql \
  && grep -q 'token_json' packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql \
  && echo PASS
```
Result: **PASS**

Migration SQL (complete — one additive statement, no other tables touched):
```sql
ALTER TABLE "broker_tokens" ADD COLUMN "token_json" jsonb;
```

Journal (meta/_journal.json) — entry appended at idx 11:
```json
{
  "idx": 11,
  "version": "7",
  "when": 1782423773522,
  "tag": "0011_broker_tokens_token_json",
  "breakpoints": true
}
```

## Deviations from Plan

### Rename Applied (Convention)

**1. [Rule 3 - Convention] Migration file renamed from drizzle-kit default**
- **Found during:** Task 1
- **Issue:** `bunx drizzle-kit generate` emits a random-word filename (`0011_fantastic_inertia.sql`) by default
- **Fix:** Renamed to `0011_broker_tokens_token_json.sql`; updated `_journal.json` tag from `0011_fantastic_inertia` to `0011_broker_tokens_token_json` (Phase 4 P01 precedent — same as `0003_broker_tokens`, `0004_calendar_events`, etc.)
- **Files modified:** `packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql`, `meta/_journal.json`
- **Commit:** c0f75eb

### Task 2 Operator-Deferred (Per Orchestrator Directive)

This is not a deviation from the plan — the plan itself marks Task 2 as `autonomous: false` and explicitly instructs the executor to surface a checkpoint if prod DATABASE_URL is not available or if prod is in a db-down state (STATE.md Blocker). The orchestrator directive confirms: do NOT run `bun run migrate` against any live/prod DATABASE_URL. Task 2 is operator-deferred, consistent with the precedent for migrations 0007–0010 (Phase 6 P02, Phase 8 P04).

## Auth Gates / Blockers

None during Task 1 (no live DB touched).

Task 2 is blocked by:
- Prod db-down/stale (STATE.md Blocker: "Railway prod deploy is db-down + STALE")
- orchestrator directive (autonomous:false — operator must apply manually)

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced by Task 1 (migration file only, not applied to prod). Task 2 (when operator applies) touches the trust boundary: migrate process → live Supabase Postgres — covered by T-11-02-01/02/03 in the plan threat model.

## Self-Check: PASSED

- [x] `packages/adapters/src/postgres/migrations/0011_broker_tokens_token_json.sql` exists
- [x] Commit c0f75eb confirmed: `git log --oneline | grep c0f75eb` → `chore(11-02): generate 0011 broker_tokens token_json migration`
- [x] Journal tag `0011_broker_tokens_token_json` confirmed in `_journal.json`
- [x] Migrations 0000-0010 unmodified (git diff shows only new files + _journal.json update)
- [x] SUMMARY.md records Task 2 as operator-deferred

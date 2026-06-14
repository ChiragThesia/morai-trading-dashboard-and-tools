---
phase: "03-calendar-journal-mvp"
plan: "02"
subsystem: "db-schema"
tags: ["drizzle", "migration", "postgres", "schema", "option_type"]
dependency_graph:
  requires: ["03-01"]
  provides: ["calendars.option_type SQL migration", "live calendars.option_type column"]
  affects: ["live Supabase calendars table", "03-03", "03-05"]
tech_stack:
  added: []
  patterns: ["drizzle-kit generate", "ALTER TABLE ADD COLUMN NOT NULL", "railway run --service worker bun run migrate"]
key_files:
  created:
    - "packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql"
    - "packages/adapters/src/postgres/migrations/meta/0002_snapshot.json"
  modified:
    - "packages/adapters/src/postgres/migrations/meta/_journal.json"
decisions:
  - "Migration name kept as drizzle-kit generated (0002_watery_molecule_man) — no rename needed per plan"
  - "ADD COLUMN ... NOT NULL without DEFAULT — prod calendars table is empty; no backfill required"
  - "Live apply via railway run --service worker bun run migrate (session pooler URL, no local DATABASE_URL needed)"
metrics:
  duration_seconds: 300
  completed_date: "2026-06-14"
  tasks_completed: 2
  tasks_total: 2
  tasks_blocked_at_checkpoint: 0
---

# Phase 03 Plan 02: Add option_type Migration Summary

**One-liner:** Generated drizzle-kit migration `0002_watery_molecule_man.sql` with `ALTER TABLE "calendars" ADD COLUMN "option_type" "contract_type" NOT NULL` and applied it to the live Supabase Postgres via `railway run --service worker bun run migrate`.

## Status

**COMPLETE** — Both tasks done. Migration generated and applied to live DB.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Generate drizzle-kit migration for option_type | 385a609 | 0002_watery_molecule_man.sql, meta/_journal.json, meta/0002_snapshot.json |
| 2 | Apply option_type migration to live Supabase Postgres | (human-action, no code commit) | live DB DDL applied via Railway |

## What Was Built

The `optionType` column was already added to `packages/adapters/src/postgres/schema.ts` in Plan 03-01 (Rule 3 deviation). This plan generated the SQL migration that drizzle-kit emits when it detects the schema diff against the previous snapshot, then applied it to the live database.

**Migration produced:**
```sql
ALTER TABLE "calendars" ADD COLUMN "option_type" "contract_type" NOT NULL;
```

The migration file is `packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql`. Drizzle-kit updated `meta/_journal.json` atomically (new entry: `idx=2`, tag `0002_watery_molecule_man`).

**Live DB apply:** `railway run --service worker bun run migrate` applied the migration to live Supabase Postgres. Output: `migrate: all migrations applied`. Benign NOTICEs (`drizzle schema/__drizzle_migrations already existed`) — these are harmless first-run artefacts from the migrator's own setup, not errors.

**Result:** The live `calendars` table now has the `option_type` (`contract_type`, NOT NULL) column. All downstream plans (03-03, 03-05) that read or write `calendars.option_type` against real Postgres will find the column present.

## Human-Action Checkpoint: Task 2 — Apply Migration to Live DB

**Resolved.** The human ran:

```
railway run --service worker bun run migrate
```

Output excerpt (terminal):
```
migrate: all migrations applied
```

Benign NOTICEs noted: `drizzle schema already existed`, `__drizzle_migrations already existed` — expected on first Railway run; DDL was applied without error. The `ALTER TABLE "calendars" ADD COLUMN "option_type"` statement completed successfully.

**Verification method:** Terminal exit 0 + `migrate: all migrations applied` message. Human confirmed via resume signal "applied".

## Deviations from Plan

### Context Deviation

The plan's Task 1 included "add optionType to schema.ts" as an action. That column was already present (added in Plan 03-01 as a Rule 3 deviation to unblock compile). This plan correctly skipped the schema edit and proceeded directly to `bunx drizzle-kit generate`, which detected the diff and produced the migration.

No schema files were modified in this plan — only migration artifacts were created.

## Verification Evidence

```
$ rg -n "optionType.*contractTypeEnum" packages/adapters/src/postgres/schema.ts
42:  optionType: contractTypeEnum("option_type").notNull(),

$ rg -n "option_type" packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql
1:ALTER TABLE "calendars" ADD COLUMN "option_type" "contract_type" NOT NULL;

$ bun run typecheck
$ tsc --build --force
(exits 0, no output)

$ railway run --service worker bun run migrate
migrate: all migrations applied
```

## Known Stubs

None — this plan produces only migration artifacts and a live DDL apply. No application code.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. T-03-02 (DDL on live table) was mitigated by the human checkpoint confirming `calendars` was empty before apply. T-03-03 (wrong database target) mitigated by Railway service binding to the worker's env (session pooler URL, confirmed by successful apply).

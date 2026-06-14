---
phase: "03-calendar-journal-mvp"
plan: "02"
subsystem: "db-schema"
tags: ["drizzle", "migration", "postgres", "schema", "option_type"]
dependency_graph:
  requires: ["03-01"]
  provides: ["calendars.option_type SQL migration"]
  affects: ["live Supabase calendars table", "03-03", "03-05"]
tech_stack:
  added: []
  patterns: ["drizzle-kit generate", "ALTER TABLE ADD COLUMN NOT NULL"]
key_files:
  created:
    - "packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql"
    - "packages/adapters/src/postgres/migrations/meta/0002_snapshot.json"
  modified:
    - "packages/adapters/src/postgres/migrations/meta/_journal.json"
decisions:
  - "Migration name kept as drizzle-kit generated (0002_watery_molecule_man) — no rename needed per plan"
  - "ADD COLUMN ... NOT NULL without DEFAULT — prod calendars table is empty; no backfill required"
metrics:
  duration_seconds: 172
  completed_date: "2026-06-14"
  tasks_completed: 1
  tasks_total: 2
  tasks_blocked_at_checkpoint: 1
---

# Phase 03 Plan 02: Add option_type Migration Summary

**One-liner:** Generated drizzle-kit migration `0002_watery_molecule_man.sql` with `ALTER TABLE "calendars" ADD COLUMN "option_type" "contract_type" NOT NULL` — stopped at blocking human-action checkpoint for live DB apply.

## Status

**STOPPED AT CHECKPOINT** — Task 2 (live DB apply) requires human action.

Task 1 complete and committed. Task 2 (apply migration to live Supabase) is a `checkpoint:human-action` gate that this executor must not perform.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Generate drizzle-kit migration for option_type | 385a609 | 0002_watery_molecule_man.sql, meta/_journal.json, meta/0002_snapshot.json |

## Tasks Pending (at checkpoint)

| Task | Name | Type | Gate |
|------|------|------|------|
| 2 | Apply option_type migration to live Supabase Postgres | checkpoint:human-action | blocking |

## What Was Built

The `optionType` column was already added to `packages/adapters/src/postgres/schema.ts` in Plan 03-01 (Rule 3 deviation). This plan generated the SQL migration that drizzle-kit emits when it detects the schema diff against the previous snapshot.

**Migration produced:**
```sql
ALTER TABLE "calendars" ADD COLUMN "option_type" "contract_type" NOT NULL;
```

The migration file is `packages/adapters/src/postgres/migrations/0002_watery_molecule_man.sql`. Drizzle-kit updated `meta/_journal.json` atomically (new entry: `idx=2`, tag `0002_watery_molecule_man`).

**Typecheck:** `bun run typecheck` exits 0 — types derive from schema source, not live DB.

## Checkpoint: Task 2 — Apply Migration to Live DB

**This step was NOT performed.** The executor must stop here.

The human must:

1. Confirm `DATABASE_URL` in the worker env points at the live Supabase direct (session pooler) connection.
2. Run: `bun run migrate`
3. Verify the column is present: use Supabase MCP `list_tables` for `calendars`, or `psql "$DATABASE_URL" -c "\d calendars"`. Confirm row: `option_type | contract_type | not null`.
4. Confirm idempotency: run `bun run migrate` a second time — it must exit 0 with `migrate: all migrations applied` and produce no DDL.

**Resume signal:** Type "applied" once the column is confirmed present on the live DB.

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
```

## Known Stubs

None — this plan produces only migration artifacts, no application code.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced. The DDL migration (T-03-02) is addressed by the Task 2 human checkpoint.

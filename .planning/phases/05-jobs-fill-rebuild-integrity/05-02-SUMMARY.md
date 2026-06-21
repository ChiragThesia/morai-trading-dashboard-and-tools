---
phase: 05-jobs-fill-rebuild-integrity
plan: "02"
subsystem: database
tags: [drizzle, postgres, supabase, migration, calendar-events, orphan-fills]

requires:
  - phase: 05-01
    provides: schema.ts declarations for calendar_events, orphan_fills, calendar_event_type enum, calendars.entry_thesis column

provides:
  - "0004_calendar_events.sql — DDL migration committed and applied to live Supabase DB"
  - "calendar_events table with fill_ids_hash UNIQUE constraint (SHA-256 idempotency key)"
  - "orphan_fills table for unmatched fill tracking"
  - "calendar_event_type enum (OPEN, CLOSE, ROLL)"
  - "calendars.entry_thesis nullable text column"

affects:
  - 05-03
  - 05-04
  - 05-05
  - 05-06
  - 05-07
  - 05-08

tech-stack:
  added: []
  patterns:
    - "Migration rename convention: drizzle-kit generated name overridden to descriptive slug (0004_calendar_events); journal tag + snapshot updated to match (same as Phase 4 P01 0003_broker_tokens)"
    - "Session-pooler migration: bun run migrate runs safely against Supabase session pooler (port 5432, max:1 client) — no direct connection required for DDL"

key-files:
  created:
    - packages/adapters/src/postgres/migrations/0004_calendar_events.sql
    - packages/adapters/src/postgres/migrations/meta/0004_snapshot.json
  modified:
    - packages/adapters/src/postgres/migrations/meta/_journal.json

key-decisions:
  - "Migration applied via session pooler (port 5432, max:1) — Supabase session pooler is migration-safe for DDL; transaction pooler (port 6543) would not be"
  - "Drizzle NOTICEs 42P06/42P07 on drizzle internal bookkeeping tables confirm 0000-0003 were already applied; only 0004 was new"

patterns-established:
  - "Migration rename: always rename drizzle-kit generated adjective names to descriptive slugs; update journal tag and snapshot file to match"

requirements-completed: [JRNL-01]

duration: ~25min (Task 1 automated ~5min; Task 2 blocking human-verify resolved by orchestrator)
completed: 2026-06-21
---

# Phase 05 Plan 02: Calendar Events Schema Migration Summary

**Drizzle migration 0004_calendar_events applied to live Supabase DB — calendar_events, orphan_fills, calendar_event_type enum, and calendars.entry_thesis now exist in production**

## Performance

- **Duration:** ~25 min (Task 1 automated; Task 2 was a blocking human-verify resolved by orchestrator)
- **Started:** 2026-06-21
- **Completed:** 2026-06-21
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 3

## Accomplishments

- Generated `0004_calendar_events.sql` via `bunx drizzle-kit generate` — additive-only DDL (zero DROP/RENAME statements); renamed from drizzle-kit default `0004_supreme_snowbird` following Phase 4 precedent
- Applied migration to live Supabase database via `bun run migrate` (session pooler, port 5432); all five live-DB acceptance checks passed
- Confirmed idempotency: second `bun run migrate` run was a clean no-op (exit 0)

## Task Commits

1. **Task 1: Generate the Drizzle migration and review the emitted DDL** — `44ffd20` (chore)
2. **Task 2: [BLOCKING] Apply the migration to the live database** — resolved by orchestrator (no code commit — DDL applied via `bun run migrate` against live DB)

**Plan metadata:** (see final-commit hash below)

## Files Created/Modified

- `packages/adapters/src/postgres/migrations/0004_calendar_events.sql` — DDL: CREATE TYPE calendar_event_type ENUM(OPEN,CLOSE,ROLL); CREATE TABLE calendar_events (uuid PK, calendar_id, event_type, evented_at, fill_ids_hash varchar(64) UNIQUE, leg_occ_symbol, rolled_from_occ_symbol, qty, avg_price, net_amount, realized_pnl, leg_breakdown, entry_thesis, created_at) with RLS enabled; CREATE TABLE orphan_fills (fill_id uuid PK, occ_symbol, side, qty, price, filled_at, reason, created_at) with RLS enabled; ALTER TABLE calendars ADD COLUMN entry_thesis text
- `packages/adapters/src/postgres/migrations/meta/0004_snapshot.json` — Drizzle schema snapshot for migration diff base
- `packages/adapters/src/postgres/migrations/meta/_journal.json` — Journal entry appended for 0004_calendar_events

## Migration DDL (complete)

```sql
CREATE TYPE "public"."calendar_event_type" AS ENUM('OPEN', 'CLOSE', 'ROLL');
CREATE TABLE "calendar_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "calendar_id" uuid NOT NULL,
    "event_type" "calendar_event_type" NOT NULL,
    "evented_at" timestamp with time zone NOT NULL,
    "fill_ids_hash" varchar(64) NOT NULL,
    "leg_occ_symbol" varchar(32) NOT NULL,
    "rolled_from_occ_symbol" varchar(32),
    "qty" integer NOT NULL,
    "avg_price" numeric NOT NULL,
    "net_amount" numeric NOT NULL,
    "realized_pnl" numeric,
    "leg_breakdown" text,
    "entry_thesis" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "calendar_events_fill_ids_hash_unique" UNIQUE("fill_ids_hash")
);
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "orphan_fills" (
    "fill_id" uuid PRIMARY KEY NOT NULL,
    "occ_symbol" varchar(32) NOT NULL,
    "side" varchar(4) NOT NULL,
    "qty" integer NOT NULL,
    "price" numeric NOT NULL,
    "filled_at" timestamp with time zone NOT NULL,
    "reason" text NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "orphan_fills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "calendars" ADD COLUMN "entry_thesis" text;
```

## Live-DB Verification Evidence (all passed)

| Check | Evidence |
|-------|----------|
| `bun run migrate` exit 0 | "migrate: all migrations applied"; NOTICEs 42P06/42P07 confirm drizzle bookkeeping tables pre-existed (0000-0003 already applied); only 0004 was new |
| `to_regclass('public.calendar_events')` | returns `calendar_events` (non-null) |
| `to_regclass('public.orphan_fills')` | returns `orphan_fills` (non-null) |
| `calendars.entry_thesis` column | present in information_schema |
| `calendar_event_type` enum | exists in pg_type, labels OPEN/CLOSE/ROLL |
| `fill_ids_hash` UNIQUE index | present |
| Idempotency: second `bun run migrate` | clean no-op, exit 0 |

**DB endpoint:** Supabase session pooler (port 5432, max:1 client) — migration-safe for DDL.

## Decisions Made

- **Session pooler for migrations:** `bun run migrate` ran against Supabase session pooler (port 5432, max:1). Session pooler preserves connection identity across transaction boundaries, making it safe for Drizzle's DDL migration pattern. Transaction pooler (port 6543) would break multi-statement migrations.
- **Migration rename convention:** drizzle-kit generated `0004_supreme_snowbird`; renamed to `0004_calendar_events` and journal tag updated — same Phase 4 precedent as `0003_famous_azazel` → `0003_broker_tokens`.
- **Deferred deferred item resolved:** STATE.md previously flagged `broker_tokens migration (0003_broker_tokens.sql + pgcrypto) not yet applied to live Supabase DB` as blocking. Drizzle NOTICEs 42P06/42P07 confirmed 0000-0003 were already applied before this plan ran — the deferred item was resolved prior to this plan (likely during Phase 4 live work).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. The drizzle NOTICEs `42P06 type "drizzle"."journal" already exists` and `42P07 relation "drizzle"."migrations" already exists` during `bun run migrate` are expected — they confirm drizzle's internal bookkeeping schema was created in prior migration runs. They are not errors.

## Known Stubs

None — this plan is purely DDL/migration; no application code with stubs was produced.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes beyond what was in the plan's threat model. The migration adds tables at the DB tier only. RLS is enabled on both new tables (consistent with existing table patterns in this schema).

| Threat | Status |
|--------|--------|
| T-05-03 (DDL tampering) | Mitigated — migration reviewed for additive-only; no DROP/RENAME; idempotent re-run verified |
| T-05-04 (DoS via ALTER) | Accepted — nullable column add is metadata-only in Postgres 16 (no table rewrite) |
| T-05-05 (DATABASE_URL disclosure) | Mitigated — credential read from env only; not logged; not committed |

## Next Phase Readiness

- Live DB now has all tables required for Phase 05 plans 04-08 (syncFills, fill-pairing write path, calendar event journal, orphan fill triage)
- `fill_ids_hash` UNIQUE constraint in place — syncFills idempotency key is enforced at DB level
- Remaining Phase 05 plans (04-08) are unblocked

---
*Phase: 05-jobs-fill-rebuild-integrity*
*Completed: 2026-06-21*

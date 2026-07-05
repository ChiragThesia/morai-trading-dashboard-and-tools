-- SNAP-01 / D-12: provenance marker for calendar_snapshots rows — 'scheduled' (worker
-- cron cadence, the implicit default) vs 'event-move' (server-side large-move detector).
-- Purely additive: nullable, no DB-level default, no backfill. Existing rows stay NULL
-- and are read as "scheduled" at the application layer (packages/adapters mapper).
ALTER TABLE "calendar_snapshots" ADD COLUMN "trigger" text;

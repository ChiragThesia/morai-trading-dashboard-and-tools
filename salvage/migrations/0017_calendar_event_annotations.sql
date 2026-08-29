-- RULE-01 (D-09/D24): calendar_event_annotations is orthogonal to calendar_events and
-- survives rebuildJournal's delete-then-reinsert cycle. fill_ids_hash is a SOFT reference
-- to calendar_events.fill_ids_hash — a plain varchar(64) PRIMARY KEY, deliberately NOT a
-- foreign key. A real FK would either CASCADE-wipe this table's rows when rebuildJournal
-- deletes calendar_events, or RESTRICT-block the rebuild's DELETE outright (RESEARCH
-- Pitfall 3). Ships EMPTY — no backfill (D-16).
CREATE TABLE "calendar_event_annotations" (
	"fill_ids_hash" varchar(64) PRIMARY KEY NOT NULL,
	"rule_tags" text[] DEFAULT '{}' NOT NULL,
	"other_note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event_annotations" ENABLE ROW LEVEL SECURITY;
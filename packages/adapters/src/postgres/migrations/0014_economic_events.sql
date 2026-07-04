CREATE TABLE "economic_events" (
	"event_date" date NOT NULL,
	"event_name" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "economic_events_event_date_event_name_pk" PRIMARY KEY("event_date","event_name")
);
--> statement-breakpoint
ALTER TABLE "economic_events" ENABLE ROW LEVEL SECURITY;
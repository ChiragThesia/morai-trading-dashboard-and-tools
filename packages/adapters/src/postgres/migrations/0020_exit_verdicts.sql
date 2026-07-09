CREATE TABLE "exit_verdicts" (
	"observed_at" timestamp with time zone NOT NULL,
	"calendar_id" uuid NOT NULL,
	"verdict" jsonb NOT NULL,
	CONSTRAINT "exit_verdicts_observed_at_calendar_id_pk" PRIMARY KEY("observed_at","calendar_id")
);
--> statement-breakpoint
ALTER TABLE "exit_verdicts" ENABLE ROW LEVEL SECURITY;
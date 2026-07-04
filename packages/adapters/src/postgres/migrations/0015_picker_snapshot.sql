CREATE TABLE "picker_snapshot" (
	"observed_at" timestamp with time zone PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "picker_snapshot" ENABLE ROW LEVEL SECURITY;
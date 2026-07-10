CREATE TABLE "rule_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"overrides" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rule_overrides" ENABLE ROW LEVEL SECURITY;
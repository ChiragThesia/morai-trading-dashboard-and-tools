CREATE TABLE "gex_snapshots" (
	"cycle_time" timestamp with time zone PRIMARY KEY NOT NULL,
	"spot" numeric NOT NULL,
	"flip" numeric,
	"call_wall" integer,
	"put_wall" integer,
	"net_gamma_at_spot" numeric NOT NULL,
	"profile" jsonb NOT NULL,
	"strikes" jsonb NOT NULL,
	"by_expiry" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gex_snapshots" ENABLE ROW LEVEL SECURITY;
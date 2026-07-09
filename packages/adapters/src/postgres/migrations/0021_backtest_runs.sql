CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"params" jsonb NOT NULL,
	"report" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_runs" ENABLE ROW LEVEL SECURITY;
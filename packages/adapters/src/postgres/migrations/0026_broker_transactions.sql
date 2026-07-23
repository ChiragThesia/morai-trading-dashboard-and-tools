CREATE TABLE "broker_transactions" (
	"activity_id" bigint PRIMARY KEY NOT NULL,
	"order_id" bigint,
	"activity_type" text,
	"exec_time" timestamp with time zone,
	"trade_date" date NOT NULL,
	"settlement_date" date,
	"net_amount" numeric NOT NULL,
	"fees" numeric,
	"legs" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_transactions" ENABLE ROW LEVEL SECURITY;
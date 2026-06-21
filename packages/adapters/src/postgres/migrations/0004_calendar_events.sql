CREATE TYPE "public"."calendar_event_type" AS ENUM('OPEN', 'CLOSE', 'ROLL');--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "orphan_fills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendars" ADD COLUMN "entry_thesis" text;
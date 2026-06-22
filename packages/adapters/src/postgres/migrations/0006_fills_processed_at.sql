ALTER TABLE "fills" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "roll_open_debit" numeric;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "roll_close_credit" numeric;
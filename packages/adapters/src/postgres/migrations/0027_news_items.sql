CREATE TABLE "news_items" (
	"id" text PRIMARY KEY NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"source" text NOT NULL,
	"url" text,
	"symbols" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "news_items" ENABLE ROW LEVEL SECURITY;
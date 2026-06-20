CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "broker_tokens" (
	"app_id" text PRIMARY KEY NOT NULL,
	"access_token" bytea NOT NULL,
	"refresh_token" bytea NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"refresh_issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broker_tokens" ENABLE ROW LEVEL SECURITY;

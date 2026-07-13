CREATE TABLE "reauth_nonces" (
	"state" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reauth_nonces" ENABLE ROW LEVEL SECURITY;
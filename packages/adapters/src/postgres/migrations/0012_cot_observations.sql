CREATE TABLE "cot_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contract_code" text NOT NULL,
	"as_of" date NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"open_interest" integer NOT NULL,
	"dealer_long" integer NOT NULL,
	"dealer_short" integer NOT NULL,
	"asset_mgr_long" integer NOT NULL,
	"asset_mgr_short" integer NOT NULL,
	"lev_money_long" integer NOT NULL,
	"lev_money_short" integer NOT NULL,
	"other_rept_long" integer NOT NULL,
	"other_rept_short" integer NOT NULL,
	"nonrept_long" integer NOT NULL,
	"nonrept_short" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cot_observations_contract_code_as_of_unique" UNIQUE("contract_code","as_of")
);
--> statement-breakpoint
ALTER TABLE "cot_observations" ENABLE ROW LEVEL SECURITY;
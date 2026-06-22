CREATE TABLE "risk_reversal_observations" (
	"snapshot_time" timestamp with time zone NOT NULL,
	"underlying" varchar(16) NOT NULL,
	"expiration" date NOT NULL,
	"risk_reversal" numeric,
	"rr_rank" numeric,
	CONSTRAINT "risk_reversal_observations_snapshot_time_underlying_expiration_pk" PRIMARY KEY("snapshot_time","underlying","expiration")
);
--> statement-breakpoint
ALTER TABLE "risk_reversal_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "skew_observations" (
	"snapshot_time" timestamp with time zone NOT NULL,
	"underlying" varchar(16) NOT NULL,
	"expiration" date NOT NULL,
	"strike" integer NOT NULL,
	"iv" numeric NOT NULL,
	"delta" numeric,
	"moneyness" numeric,
	CONSTRAINT "skew_observations_snapshot_time_underlying_expiration_strike_pk" PRIMARY KEY("snapshot_time","underlying","expiration","strike")
);
--> statement-breakpoint
ALTER TABLE "skew_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "term_structure_observations" (
	"snapshot_time" timestamp with time zone NOT NULL,
	"calendar_id" uuid NOT NULL,
	"value" numeric NOT NULL,
	"front_iv" numeric NOT NULL,
	"back_iv" numeric NOT NULL,
	CONSTRAINT "term_structure_observations_snapshot_time_calendar_id_pk" PRIMARY KEY("snapshot_time","calendar_id")
);
--> statement-breakpoint
ALTER TABLE "term_structure_observations" ENABLE ROW LEVEL SECURITY;
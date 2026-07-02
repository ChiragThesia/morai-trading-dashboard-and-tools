CREATE TABLE "macro_observations" (
	"date" date NOT NULL,
	"series_id" text NOT NULL,
	"value" numeric NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "macro_observations_date_series_id_pk" PRIMARY KEY("date","series_id")
);
--> statement-breakpoint
ALTER TABLE "macro_observations" ENABLE ROW LEVEL SECURITY;
CREATE TYPE "public"."calendar_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('C', 'P');--> statement-breakpoint
CREATE TYPE "public"."exercise_style" AS ENUM('american', 'european');--> statement-breakpoint
CREATE TYPE "public"."observation_source" AS ENUM('schwab_chain', 'cboe', 'computed_only');--> statement-breakpoint
CREATE TYPE "public"."snapshot_source" AS ENUM('schwab_chain', 'cboe', 'computed_only');--> statement-breakpoint
CREATE TABLE "calendar_snapshots" (
	"time" timestamp with time zone NOT NULL,
	"calendar_id" uuid NOT NULL,
	"spot" numeric NOT NULL,
	"net_mark" numeric NOT NULL,
	"front_mark" numeric NOT NULL,
	"back_mark" numeric NOT NULL,
	"front_iv" numeric NOT NULL,
	"back_iv" numeric NOT NULL,
	"front_iv_raw" numeric NOT NULL,
	"back_iv_raw" numeric NOT NULL,
	"net_delta" numeric NOT NULL,
	"net_gamma" numeric NOT NULL,
	"net_theta" numeric NOT NULL,
	"net_vega" numeric NOT NULL,
	"term_slope" numeric NOT NULL,
	"dte_front" integer NOT NULL,
	"dte_back" integer NOT NULL,
	"pnl_open" numeric NOT NULL,
	"source" "snapshot_source" NOT NULL,
	CONSTRAINT "calendar_snapshots_time_calendar_id_pk" PRIMARY KEY("time","calendar_id")
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"underlying" varchar(16) NOT NULL,
	"strike" integer NOT NULL,
	"front_expiry" date NOT NULL,
	"back_expiry" date NOT NULL,
	"qty" integer NOT NULL,
	"status" "calendar_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"open_net_debit" numeric,
	"close_net_credit" numeric,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"occ_symbol" varchar(32) PRIMARY KEY NOT NULL,
	"schwab_symbol" varchar(32),
	"underlying" varchar(16) NOT NULL,
	"root" varchar(8) NOT NULL,
	"contract_type" "contract_type" NOT NULL,
	"exercise_style" "exercise_style" NOT NULL,
	"strike" integer NOT NULL,
	"expiration" date NOT NULL,
	"multiplier" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" varchar(64) NOT NULL,
	"occ_symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"qty" integer NOT NULL,
	"price" numeric NOT NULL,
	"filled_at" timestamp with time zone NOT NULL,
	"commission" numeric,
	"fees" numeric,
	"raw" text
);
--> statement-breakpoint
CREATE TABLE "leg_observations" (
	"time" timestamp with time zone NOT NULL,
	"contract" varchar(32) NOT NULL,
	"bid" numeric NOT NULL,
	"ask" numeric NOT NULL,
	"mark" numeric NOT NULL,
	"last" numeric,
	"underlying_price" numeric NOT NULL,
	"iv" numeric,
	"delta" numeric,
	"gamma" numeric,
	"theta" numeric,
	"vega" numeric,
	"bsm_iv" numeric,
	"bsm_delta" numeric,
	"bsm_gamma" numeric,
	"bsm_theta" numeric,
	"bsm_vega" numeric,
	"open_interest" integer NOT NULL,
	"volume" integer NOT NULL,
	"source" "observation_source" NOT NULL,
	CONSTRAINT "leg_observations_time_contract_pk" PRIMARY KEY("time","contract")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broker_id" varchar(64) NOT NULL,
	"occ_symbol" varchar(32) NOT NULL,
	"side" varchar(4) NOT NULL,
	"qty" integer NOT NULL,
	"order_type" varchar(16) NOT NULL,
	"limit_price" numeric,
	"status" varchar(16) NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"raw" text
);
--> statement-breakpoint
CREATE TABLE "rate_observations" (
	"date" date PRIMARY KEY NOT NULL,
	"rate" numeric NOT NULL
);
--> statement-breakpoint
CREATE INDEX "leg_obs_pending_bsm_idx" ON "leg_observations" USING btree ("time","contract") WHERE bsm_iv IS NULL AND mark IS NOT NULL;
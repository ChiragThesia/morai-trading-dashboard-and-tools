-- 0031: the calendar engine's own ranking history.
--
-- WHY IT EXISTS. `rankCalendars` computes on read and never persists, so the engine has no
-- history -- and its SCORE_WEIGHTS (fwdEdge 70 / deltaBalance 30) are required to be
-- "re-derived against a backtest, never adjusted by feel". The only corpus that exists today,
-- `picker_snapshot`, belongs to the engine being retired.
--
-- ONE ROW PER RANKED EXPIRY PAIR, not per candidate and not per top-N. Measured 2026-07-28:
-- 2,981 candidates collapse to 96 pairs per cycle, 48 cycles a day = ~4,600 rows a day, against
-- leg_observations' measured 824,198 a day. 0.56%. Storing only the top 25 would truncate the
-- cross-section at the 74th percentile, and every score term IS a percentile -- the calendars
-- that ranked badly are what falsify the weights.
--
-- NORMALISED, NOT A JSONB BLOB like picker_snapshot. The full `ScoredCalendar` measured ~1.3 KB
-- of JSON per row (both leg quotes, both leg greeks, every reported-not-scored field) against
-- ~150 B for these 20 columns: 2.2 GB a year against 250 MB, for numbers a chain read at `as_of`
-- already carries. A weight backtest also regresses forward P&L on the term percentiles across
-- weeks of cycles, which is a column scan here and an unnest-every-blob there.
--
-- THE KEY, and the question this repo has got wrong three times (0224db1, 0029, 0030):
-- CAN THIS CONFLICT KEY REPEAT WITHIN ONE BATCH? No. One write is one `rankCalendars` call, and
-- that call has already collapsed to one row per (root, front, back) -- so the pair alone is
-- unique in-batch, before strike is even considered. `as_of` and `contract_type` are single
-- literals for the whole batch, which is exactly why `contract_type` still has to be IN the key:
-- migration 0030 left it out of the skew key on the reasoning that it never varies, and 49.6% of
-- every smile was silently discarded for that table's whole life. A constant column cannot
-- discriminate, so the key must already carry the discriminator the second wing needs. `strike`
-- is in the key for the same reason: it is constant per pair only because of the collapse, and a
-- key that depends on a downstream choice is the 0029/0030 defect waiting to happen.
-- The writer uses ON CONFLICT DO NOTHING, which additionally cannot raise the "command cannot
-- affect row a second time" error that DO UPDATE raises on an in-batch duplicate (0224db1's
-- ~80-minute outage). Re-running a cycle for the same `as_of` writes nothing.
--
-- NO SECONDARY INDEX. The PK's leading `as_of` already serves the only planned read -- a range
-- scan over cycles, `as_of BETWEEN from AND to`.
CREATE TABLE "calendar_ranking" (
	"as_of" timestamp with time zone NOT NULL,
	"root" varchar(8) NOT NULL,
	"contract_type" "contract_type" NOT NULL,
	"front_expiration" date NOT NULL,
	"back_expiration" date NOT NULL,
	"strike" numeric NOT NULL,
	"rank" integer NOT NULL,
	"score" numeric NOT NULL,
	"fwd_edge_raw" numeric,
	"fwd_edge_percentile" numeric,
	"delta_balance_raw" numeric,
	"delta_balance_percentile" numeric,
	"fwd_iv" numeric NOT NULL,
	"front_ref_iv" numeric NOT NULL,
	"back_ref_iv" numeric NOT NULL,
	"debit" numeric NOT NULL,
	"net_theta" numeric NOT NULL,
	"net_vega" numeric NOT NULL,
	"spot" numeric,
	"no_iv_legs" integer NOT NULL,
	CONSTRAINT "calendar_ranking_pkey" PRIMARY KEY("as_of","root","contract_type","front_expiration","back_expiration","strike")
);
--> statement-breakpoint
ALTER TABLE "calendar_ranking" ENABLE ROW LEVEL SECURITY;

-- 0030: add `contract_type` to the skew key, and label the history from delta's sign.
--
-- WHY. 0029 added `root` to this key eight commits ago and stopped one column short. The key was
--
--   skew_observations  (snapshot_time, underlying, root, expiration, strike)
--
-- and readSmile emits one quote per SOLVED LEG -- which is the CALL and the PUT at every strike.
-- Two different contracts, identical on all five of those columns. They collide inside a SINGLE
-- batch, where storeSkewObservations' `onConflictDoNothing` discards one. No error, no metric.
--
-- Measured on the live cohort behind snapshot_time 2026-07-28T14:00:00Z: 3,521 quotes carrying
-- 1,773 distinct values of the old key, and 3,521 distinct once contract_type joins it -- the
-- column resolves the collision completely, with nothing left over. The table holds exactly 1,773
-- rows for that stamp. 1,748 rows, 49.6%, were thrown away in one call.
--
-- Which wing survived is whichever the join emitted first: a query plan, not a rule. Lifetime that
-- left 9,479 calls against 903 puts. The owner trades PUT calendars, so the wing that actually
-- matters is the 8.7% one.
--
-- A dedupe in the writer would NOT have fixed this. The colliding rows are not duplicates, they
-- are the two wings of one smile; deduping drops the same 1,748 rows, only deliberately instead of
-- arbitrarily. Narrowing readSmile to OTM-only would not fix it either -- that same quotes array
-- feeds interpolateRiskReversal, which needs BOTH wings to bracket ±25Δ, so it would silently
-- change every risk_reversal written from here on. That is a model change, not a dedupe.
--
-- THIS MIGRATION KEEPS ITS HISTORY. 0029 had to delete, because a stored row carried no way to
-- recover its root. These rows ARE attributable: `delta` is stored and non-null on all 10,382 of
-- them, and a put's delta is negative where a call's is positive. Verified against the source the
-- rows were built from (leg_observations x contracts, solved legs only): of 7,247,744 call legs
-- ZERO have a negative delta, and of 7,032,868 put legs ZERO have a positive one. The sign is not
-- a convention here, it is measured.
--
-- BUT THE HISTORY IS NOT WHOLE, and nothing below makes it whole. Every stamp before this
-- migration is still missing roughly half its smile -- the discarded wing is gone and cannot be
-- recovered from anything the table kept. What the backfill buys is that the rows which DID
-- survive stop being anonymous, and that no further row is lost. Read the pre-0030 window as a
-- half-smile with correct labels, never as a smile.
--
-- The one value the sign rule cannot label is delta = 0, which both wings reach far out of the
-- money (61,023 solved legs, 27% of them calls). Those rows are left NULL on purpose, and so are
-- NULL and NaN deltas -- Postgres orders 'NaN'::numeric ABOVE every number, so `delta > 0` would
-- have labelled a NaN as a call. SET NOT NULL below then ABORTS the migration rather than let an
-- unattributable row be asserted into a wing. skew_observations holds none of the three today
-- (0 null, 0 NaN, 0 zero; smallest |delta| stored is 4.57e-4), so the guard is inert -- it exists
-- because a fabricated put is exactly the failure this whole line of work exists to remove. If it
-- ever does fire, the fix is to delete the offending rows, not to widen the CASE.

-- Nullable first: NOT NULL with no default cannot be added to a table that already has rows, and
-- a DEFAULT would let a future caller silently omit the field and reintroduce this bug.
ALTER TABLE "skew_observations" ADD COLUMN "contract_type" "contract_type";
--> statement-breakpoint

-- The WHERE selects only attributable rows; anything it skips stays NULL and trips SET NOT NULL.
UPDATE "skew_observations"
SET "contract_type" = CASE WHEN "delta" > 0 THEN 'C'::contract_type ELSE 'P'::contract_type END
WHERE "delta" IS NOT NULL AND "delta" <> 0 AND "delta"::text <> 'NaN';
--> statement-breakpoint

ALTER TABLE "skew_observations" ALTER COLUMN "contract_type" SET NOT NULL;
--> statement-breakpoint

-- The existing PK carries a Drizzle-generated name, and 0029 learned those are unreliable -- one
-- was truncated at Postgres's 63-character identifier limit. Dropping BY LOOKUP rather than by
-- literal name keeps this correct whatever it happens to be called, in production and in a
-- freshly-migrated test container alike.
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name FROM pg_constraint
  WHERE conrelid = 'skew_observations'::regclass AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', 'skew_observations', pk_name);
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "skew_observations" ADD CONSTRAINT "skew_observations_pkey"
  PRIMARY KEY ("snapshot_time", "underlying", "root", "expiration", "strike", "contract_type");
--> statement-breakpoint

-- Post-condition. A half-applied key change is worse than none: it would leave the reader
-- believing the two wings are separated when they are not. The column COUNT is checked as well as
-- contract_type's presence -- a drop-and-re-add that gained contract_type but lost `root` would
-- satisfy the presence test alone, and that is precisely the shape this guards against.
DO $$
DECLARE
  pk_cols integer;
  ct_in_pk integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE a.attname = 'contract_type')
  INTO pk_cols, ct_in_pk
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'skew_observations'::regclass AND c.contype = 'p';

  IF ct_in_pk <> 1 OR pk_cols <> 6 THEN
    RAISE EXCEPTION
      '0030: skew_observations primary key is wrong (columns=%, contract_type=%)',
      pk_cols, ct_in_pk;
  END IF;
END $$;

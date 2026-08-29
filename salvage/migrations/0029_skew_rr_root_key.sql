-- 0029: add `root` to the skew and risk-reversal keys, and restart both series.
--
-- WHY. Both tables were keyed WITHOUT root:
--
--   skew_observations           (snapshot_time, underlying, expiration, strike)
--   risk_reversal_observations  (snapshot_time, underlying, expiration)
--
-- and `contracts.underlying` is ALWAYS the literal 'SPX'. But SPX (AM-settled third-Friday
-- monthlies) and SPXW (PM-settled weeklies) quote the SAME strike on the SAME date with
-- DIFFERENT books. So the two collided on the key, and the writers' `onConflictDoNothing`
-- silently discarded one of them -- arbitrarily, whichever the batch happened to order second.
--
-- Measured on one live cycle before this migration: 709 colliding keys against 1,632 rows
-- actually stored. Roughly 30% of every skew snapshot was thrown away, and had been for the
-- life of the table. This is the only per-strike IV history the project has, and it is exactly
-- the dataset the v2 percentile gates are waiting to accumulate -- so it was accumulating wrong.
--
-- Same failure mode as the contracts outage the day before (0028 / the upsert dedupe): a
-- conflict clause papering over a key that cannot distinguish two genuinely different rows.
--
-- THIS MIGRATION DELETES DATA, deliberately, with the owner's explicit decision.
--
-- The existing rows cannot be repaired. A stored row carries no root, and its IV can only be
-- traced back to a book by fingerprinting it against leg_observations -- which resolves just
-- 9,502 of 629,720 rows (1.5%), because leg_observations retains ~30 days and the snapshot
-- stamps do not align. The other 98.5% are permanently unattributable, AND each snapshot is
-- missing ~30% of its rows regardless.
--
-- Three options were weighed. Labelling the legacy rows 'SPXW' was rejected outright: it would
-- assert a book for 620,000 rows we cannot attribute, converting "missing" into "confidently
-- wrong" -- the precise failure mode this whole line of work exists to remove. Keeping them
-- under an 'UNKNOWN' sentinel is honest but forces every reader to handle a third root value
-- forever, in exchange for a series that still has a 30% hole through the legacy window.
--
-- So: restart. The cost is 23 days of 70%-complete history whose only consumer is a percentile
-- gate that needs 250+ days and is therefore months away from caring. The benefit is that
-- everything accumulated from here is complete and correctly attributed.

DELETE FROM "skew_observations";
--> statement-breakpoint
DELETE FROM "risk_reversal_observations";
--> statement-breakpoint

-- Root is NOT NULL with no default: every writer must now supply it explicitly. A default would
-- let a future caller silently omit the field and reintroduce exactly this bug.
-- The existing PK constraints carry Drizzle-generated names, one of which Postgres already
-- truncated at the 63-character identifier limit
-- ("risk_reversal_observations_snapshot_time_underlying_expiration_"). Dropping them BY LOOKUP
-- rather than by literal name keeps this migration correct whatever they happen to be called,
-- in production and in a freshly-migrated test container alike.
DO $$
DECLARE
  pk_name text;
BEGIN
  SELECT conname INTO pk_name FROM pg_constraint
  WHERE conrelid = 'skew_observations'::regclass AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', 'skew_observations', pk_name);
  END IF;

  SELECT conname INTO pk_name FROM pg_constraint
  WHERE conrelid = 'risk_reversal_observations'::regclass AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', 'risk_reversal_observations', pk_name);
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "skew_observations" ADD COLUMN "root" varchar(8) NOT NULL;
--> statement-breakpoint
ALTER TABLE "skew_observations" ADD CONSTRAINT "skew_observations_pkey"
  PRIMARY KEY ("snapshot_time", "underlying", "root", "expiration", "strike");
--> statement-breakpoint

ALTER TABLE "risk_reversal_observations" ADD COLUMN "root" varchar(8) NOT NULL;
--> statement-breakpoint
ALTER TABLE "risk_reversal_observations" ADD CONSTRAINT "risk_reversal_observations_pkey"
  PRIMARY KEY ("snapshot_time", "underlying", "root", "expiration");
--> statement-breakpoint

-- Post-condition. A half-applied key change is worse than none: it would leave the reader
-- believing the two books are separated when they are not.
DO $$
DECLARE
  skew_cols integer;
  rr_cols integer;
BEGIN
  SELECT count(*) INTO skew_cols
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'skew_observations'::regclass AND c.contype = 'p' AND a.attname = 'root';

  SELECT count(*) INTO rr_cols
  FROM pg_constraint c
  JOIN LATERAL unnest(c.conkey) k(attnum) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'risk_reversal_observations'::regclass AND c.contype = 'p' AND a.attname = 'root';

  IF skew_cols <> 1 OR rr_cols <> 1 THEN
    RAISE EXCEPTION
      '0029: root missing from a primary key (skew=%, risk_reversal=%)', skew_cols, rr_cols;
  END IF;
END $$;

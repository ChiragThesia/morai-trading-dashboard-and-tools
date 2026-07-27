-- 0028: repair contracts.root and contracts.expiration from the OCC symbol.
--
-- WHY. Ingest wrote `root` from the REQUESTED chain label, not the contract's own symbol. The
-- sidecar makes one Schwab "$SPX" call that returns BOTH SPX and SPXW contracts, so every
-- contract from that call inherited the requested label. It also formatted `expiration` with
-- LOCAL date getters off a UTC-midnight Date, which reads the previous day west of Greenwich.
-- Fixed at the writer in fetchChain.ts; this repairs the rows already stored.
--
-- Measured before writing this: 1,294 of 26,115 contracts are wrong (1,194 root, all 1,294
-- date). Every root mismatch also carries the date mismatch, which is what proves one writer
-- rather than two bugs.
--
-- NOT COSMETIC. Both columns feed computeT, which selects AM 09:30 ET against PM 16:00 ET
-- settlement off `root`, so those legs were solved with T short by a full day — plus 6.5 hours
-- for the 100 contracts that become AM-settled once repaired. Their bsm_iv and every greek are
-- biased HIGH.
--
-- SAFE TO RUN. `contracts` has exactly one constraint, PRIMARY KEY (occ_symbol), and no unique
-- index over (root, expiration, strike, contract_type) — verified against production. The
-- repaired values also produce 0 duplicate (root, expiration, strike, contract_type) groups, so
-- this UPDATE cannot collide with an existing correct row.
--
-- IDEMPOTENT. The WHERE clause only matches rows that still disagree with their own symbol, so
-- re-running is a no-op. That matters: until the writer fix is deployed, newly listed contracts
-- are still born corrupt, and this migration is the repair to re-run afterwards.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: re-solve the affected leg_observations.
--
-- 1,576,510 observation rows hang off these 1,294 contracts. The BSM drain is bounded at 800
-- rows per pass, so blanking them would be roughly 41 days of drain and would starve every new
-- cohort behind it — breaking live GEX, the chain table and the calendar engine.
--
-- It is also the wrong trade. Every consumer filters `bsm_iv IS NOT NULL`, so blanking a row
-- makes it VANISH rather than merely biased, and the drain is newest-first, so backfilled NULLs
-- go to the back of the queue and may linger indefinitely. A slightly-wrong number that is
-- present beats a missing one.
--
-- And the live path needs no re-solve: once the writer fix is deployed, the next 30-minute cycle
-- writes new observations against corrected contracts and solves them correctly. Live surfaces
-- read the newest cohort, so they self-heal within one cycle.
--
-- The residual is historical only, confined to observations from 2026-07-06 to 2026-07-27 on
-- these contracts, and its size is a function of tenor (IV scales as 1/sqrt(T), so a one-day T
-- error is ~0.5/DTE in relative terms):
--
--     true DTE    rows        approx IV bias
--        1        10,580      16.5 vol points   <- severe, but these contracts have expired
--        2        10,418       4.2
--        5        17,926       1.2
--        7        20,450       0.92
--       15        27,706       0.43
--      >20     1,095,978      <0.34
--
-- Anything replaying that window (the backtest harness) should exclude or discount these
-- contracts. Recorded in docs/calendar-engine/measurements.md rather than papered over.

UPDATE "contracts"
SET
  "root" = btrim(substring("occ_symbol", 1, 6)),
  "expiration" = to_date('20' || substring("occ_symbol", 7, 6), 'YYYYMMDD')
WHERE
  "root" <> btrim(substring("occ_symbol", 1, 6))
  OR "expiration" <> to_date('20' || substring("occ_symbol", 7, 6), 'YYYYMMDD');
--> statement-breakpoint

-- Post-condition. A partial repair is worse than none: it leaves the reader believing the
-- column is trustworthy. Fail the migration loudly instead of returning success.
DO $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
  FROM "contracts"
  WHERE "root" <> btrim(substring("occ_symbol", 1, 6))
     OR "expiration" <> to_date('20' || substring("occ_symbol", 7, 6), 'YYYYMMDD');

  IF remaining <> 0 THEN
    RAISE EXCEPTION
      '0028: % contracts still disagree with their OCC symbol after repair', remaining;
  END IF;
END $$;

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ChainQuoteForPicker, ForReadingChainForPicker, StorageError } from "@morai/core";
import { and, asc, desc, eq, gte, isNotNull, lte, max } from "drizzle-orm";
import { legObservations, contracts } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresPickerChainRepo — Postgres implementation of ForReadingChainForPicker.
 *
 * Mirrors the GEX readLegObsForGex cohort semantics (postgres/gex-snapshot.repo.ts):
 * (1) resolve the latest observation time with BSM-filled IV (bsm_iv IS NOT NULL);
 * (2) union all rows in [maxTime − 10 min, maxTime] — one dual-source fetch cycle lands
 *     as TWO nearby timestamps (Schwab + CBOE), and a strict max(time) equality read
 *     collapses to a single source whenever the cycle straddles a boundary (the exact
 *     2026-07-08 GEX regression); DISTINCT ON (contract) newest-first dedupes the
 *     near-ATM overlap so a contract never appears twice in the universe;
 * (3) JOIN contracts for strike/expiration (Pitfall 2), puts only (contract_type = 'P').
 *
 * bid/ask/open_interest ride along for the `liquidity` gate (rules.ts).
 *
 * source maps leg_observations.source (schwab_chain|cboe|computed_only) to the picker's
 * schwab|cboe union — 'computed_only' has no vendor source and maps to 'cboe' (the
 * historical default), mirroring snapshotCalendars.ts's identical mapping.
 */
export type PostgresPickerChainRepo = {
  readonly readChainForPicker: ForReadingChainForPicker;
};

/** Cohort lookback — matches gex-snapshot.repo.ts (well under the 30-min cycle spacing). */
const LOOKBACK_MS = 10 * 60 * 1000;

export function makePostgresPickerChainRepo(db: Db): PostgresPickerChainRepo {
  const readChainForPicker: ForReadingChainForPicker = async (): Promise<
    Result<ReadonlyArray<ChainQuoteForPicker>, StorageError>
  > => {
    try {
      // Step 1: resolve the latest observation time that has BSM-filled IV values.
      const latestRows = await db
        .select({ maxTime: max(legObservations.time) })
        .from(legObservations)
        .where(isNotNull(legObservations.bsmIv));

      const latestTime = latestRows[0]?.maxTime;
      if (latestTime === undefined || latestTime === null) return ok([]);

      const windowStart = new Date(latestTime.getTime() - LOOKBACK_MS);

      // Step 2+3: lookback union, one row per contract (newest wins), puts only.
      const rows = await db
        .selectDistinctOn([legObservations.contract], {
          contract: legObservations.contract,
          time: legObservations.time,
          underlyingPrice: legObservations.underlyingPrice,
          bsmIv: legObservations.bsmIv,
          bid: legObservations.bid,
          ask: legObservations.ask,
          openInterest: legObservations.openInterest,
          source: legObservations.source,
          contractType: contracts.contractType,
          strike: contracts.strike,
          expiration: contracts.expiration,
        })
        .from(legObservations)
        .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
        .where(
          and(
            gte(legObservations.time, windowStart),
            lte(legObservations.time, latestTime),
            eq(contracts.contractType, "P"),
          ),
        )
        // DISTINCT ON requires the distinct column to lead the ORDER BY; time DESC within
        // each contract makes the newest row win.
        .orderBy(asc(legObservations.contract), desc(legObservations.time));

      const legs: ChainQuoteForPicker[] = rows.map((row) => ({
        time: row.time,
        strike: row.strike, // ×1000 int convention
        expiration: row.expiration,
        contractType: row.contractType,
        underlyingPrice: parseFloat(row.underlyingPrice),
        bsmIv: row.bsmIv, // numeric string or null
        bid: parseFloat(row.bid),
        ask: parseFloat(row.ask),
        openInterest: row.openInterest,
        source: row.source === "schwab_chain" ? "schwab" : "cboe",
      }));

      return ok(legs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readChainForPicker };
}

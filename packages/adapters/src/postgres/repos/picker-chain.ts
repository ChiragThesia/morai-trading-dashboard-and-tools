import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ChainQuoteForPicker, ForReadingChainForPicker, StorageError } from "@morai/core";
import { and, asc, eq, isNotNull, max } from "drizzle-orm";
import { legObservations, contracts } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresPickerChainRepo — Postgres implementation of ForReadingChainForPicker.
 *
 * Mirrors the GEX readLegObsForGex cohort-resolution query (postgres/gex-snapshot.repo.ts):
 * (1) resolve the latest cycle time that has BSM-filled IV values (bsm_iv IS NOT NULL);
 * (2) JOIN leg_observations ↔ contracts at that cycle time, puts only (contract_type = 'P'),
 *     to pick up strike/expiration/contractType (Pitfall 2 — those live on `contracts`, not
 *     `leg_observations`).
 *
 * source maps leg_observations.source (schwab_chain|cboe|computed_only) to the picker's
 * schwab|cboe union — 'computed_only' has no vendor source and maps to 'cboe' (the historical
 * default), mirroring snapshotCalendars.ts's identical mapping.
 */
export type PostgresPickerChainRepo = {
  readonly readChainForPicker: ForReadingChainForPicker;
};

export function makePostgresPickerChainRepo(db: Db): PostgresPickerChainRepo {
  const readChainForPicker: ForReadingChainForPicker = async (): Promise<
    Result<ReadonlyArray<ChainQuoteForPicker>, StorageError>
  > => {
    try {
      // Step 1: resolve the latest cycle time that has BSM-filled IV values.
      const latestRows = await db
        .select({ maxTime: max(legObservations.time) })
        .from(legObservations)
        .where(isNotNull(legObservations.bsmIv));

      const latestTime = latestRows[0]?.maxTime;
      if (latestTime === undefined || latestTime === null) return ok([]);

      // Step 2: JOIN leg_observations ↔ contracts at that cycle time, puts only.
      const rows = await db
        .select({
          time: legObservations.time,
          underlyingPrice: legObservations.underlyingPrice,
          bsmIv: legObservations.bsmIv,
          source: legObservations.source,
          contractType: contracts.contractType,
          strike: contracts.strike,
          expiration: contracts.expiration,
        })
        .from(legObservations)
        .innerJoin(contracts, eq(legObservations.contract, contracts.occSymbol))
        .where(
          and(
            eq(legObservations.time, latestTime),
            eq(contracts.contractType, "P"),
          ),
        )
        .orderBy(asc(contracts.strike));

      const legs: ChainQuoteForPicker[] = rows.map((row) => ({
        time: row.time,
        strike: row.strike, // ×1000 int convention
        expiration: row.expiration,
        contractType: row.contractType,
        underlyingPrice: parseFloat(row.underlyingPrice),
        bsmIv: row.bsmIv, // numeric string or null
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

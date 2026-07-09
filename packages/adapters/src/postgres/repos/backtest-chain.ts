import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ChainLegQuoteAsOf, ForReadingChainAsOf, StorageError } from "@morai/core";
import { and, asc, desc, eq, gte, isNotNull, lte, max } from "drizzle-orm";
import { legObservations, contracts } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresBacktestChainRepo — Postgres implementation of ForReadingChainAsOf
 * (Phase 27, Plan 03).
 *
 * Generalizes picker-chain.ts's readChainForPicker with exactly ONE added predicate —
 * lte(legObservations.time, asOfT) — on the MAX(time WHERE bsm_iv IS NOT NULL) step, so
 * the "latest cohort" resolves to the newest cohort AT OR BEFORE asOfT, never after
 * (BT-01 no-lookahead). The identical 10-min lookback union + per-contract-newest-wins
 * dedup (DISTINCT ON) as the live picker/GEX readers applies unchanged, puts only.
 *
 * Returns the FULL column set (ChainLegQuoteAsOf) — bid/ask/OI/bsmIv for
 * candidate-universe generation AND mark/bsmDelta/bsmGamma/bsmTheta/bsmVega for exit-context
 * assembly — so one read serves both replay paths (27-RESEARCH.md "As-of-T chain query
 * pattern").
 */
export type PostgresBacktestChainRepo = {
  readonly readChainAsOf: ForReadingChainAsOf;
};

/** Cohort lookback — matches picker-chain.ts / gex-snapshot.repo.ts. */
const LOOKBACK_MS = 10 * 60 * 1000;

export function makePostgresBacktestChainRepo(db: Db): PostgresBacktestChainRepo {
  const readChainAsOf: ForReadingChainAsOf = async (
    asOfT: Date,
  ): Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>> => {
    try {
      // Step 1: latest observation time with BSM-filled IV, at or before asOfT — the one
      // added predicate that generalizes readChainForPicker into an as-of-T read.
      const latestRows = await db
        .select({ maxTime: max(legObservations.time) })
        .from(legObservations)
        .where(and(isNotNull(legObservations.bsmIv), lte(legObservations.time, asOfT)));

      const latestTime = latestRows[0]?.maxTime;
      if (latestTime === undefined || latestTime === null) return ok([]);

      const windowStart = new Date(latestTime.getTime() - LOOKBACK_MS);

      // Step 2+3: lookback union, one row per contract (newest wins), puts only — identical
      // to readChainForPicker, but SELECT the full column set.
      const rows = await db
        .selectDistinctOn([legObservations.contract], {
          contract: legObservations.contract,
          time: legObservations.time,
          underlyingPrice: legObservations.underlyingPrice,
          bid: legObservations.bid,
          ask: legObservations.ask,
          mark: legObservations.mark,
          bsmIv: legObservations.bsmIv,
          bsmDelta: legObservations.bsmDelta,
          bsmGamma: legObservations.bsmGamma,
          bsmTheta: legObservations.bsmTheta,
          bsmVega: legObservations.bsmVega,
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

      const legs: ChainLegQuoteAsOf[] = rows.map((row) => ({
        occSymbol: row.contract,
        strike: row.strike, // ×1000 int convention
        expiration: row.expiration,
        contractType: row.contractType,
        bid: parseFloat(row.bid),
        ask: parseFloat(row.ask),
        mark: parseFloat(row.mark),
        bsmIv: row.bsmIv !== null ? parseFloat(row.bsmIv) : null,
        bsmDelta: row.bsmDelta !== null ? parseFloat(row.bsmDelta) : null,
        bsmGamma: row.bsmGamma !== null ? parseFloat(row.bsmGamma) : null,
        bsmTheta: row.bsmTheta !== null ? parseFloat(row.bsmTheta) : null,
        bsmVega: row.bsmVega !== null ? parseFloat(row.bsmVega) : null,
        openInterest: row.openInterest,
        underlyingPrice: parseFloat(row.underlyingPrice),
        source: row.source,
        time: row.time,
      }));

      return ok(legs);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readChainAsOf };
}

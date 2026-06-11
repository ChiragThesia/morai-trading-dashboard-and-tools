import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingObservations,
  ForUpsertingContracts,
  ForReadingPendingObs,
  ForWritingBsmResults,
  ObservationRow,
  ContractRow,
  PendingObs,
  StorageError,
} from "@morai/core";
import { and, isNull, isNotNull, eq, inArray } from "drizzle-orm";
import { legObservations, contracts } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresLegObservationsRepo — Postgres implementation of
 * ForPersistingObservations, ForUpsertingContracts, ForReadingPendingObs, ForWritingBsmResults.
 *
 * T-02-08: fetchChain filter bounds write volume before this layer.
 * T-02-09: Drizzle parameterized insert/onConflictDoNothing; no raw interpolation.
 * Append-only idempotency: composite PK (time, contract) — onConflictDoNothing.
 * First-seen contracts: onConflictDoNothing on occ_symbol PK.
 * BSM-03: pending scan via partial index (bsm_iv IS NULL AND mark IS NOT NULL).
 * T-02-17: bsm-write touches only bsm_* columns; vendor columns never modified.
 */
export type PostgresLegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  readonly readPendingObs: ForReadingPendingObs;
  readonly writeBsmResults: ForWritingBsmResults;
};

export function makePostgresLegObservationsRepo(
  db: Db,
): PostgresLegObservationsRepo {
  const persistObservations: ForPersistingObservations = async (
    rows: ReadonlyArray<ObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      // Map ObservationRow → leg_observations insert shape
      const values = rows.map((row) => ({
        time: row.time,
        contract: row.contract,
        bid: String(row.bid),
        ask: String(row.ask),
        mark: String(row.mark),
        underlyingPrice: String(row.underlyingPrice),
        iv: row.iv !== null ? String(row.iv) : null,
        delta: row.delta !== null ? String(row.delta) : null,
        gamma: row.gamma !== null ? String(row.gamma) : null,
        theta: row.theta !== null ? String(row.theta) : null,
        vega: row.vega !== null ? String(row.vega) : null,
        openInterest: row.openInterest,
        volume: row.volume,
        source: row.source,
      }));

      await db.insert(legObservations).values(values).onConflictDoNothing();
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const upsertContracts: ForUpsertingContracts = async (
    rows: ReadonlyArray<ContractRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      // Map ContractRow → contracts insert shape
      const values = rows.map((row) => ({
        occSymbol: row.occSymbol,
        underlying: row.underlying,
        root: row.root,
        contractType: row.contractType,
        exerciseStyle: row.exerciseStyle,
        strike: row.strike, // already ×1000 int
        expiration: row.expiration,
        multiplier: row.multiplier,
      }));

      await db.insert(contracts).values(values).onConflictDoNothing();
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForReadingPendingObs ─────────────────────────────────────────────────
  // BSM-03: scan the partial index — returns rows where bsm_iv IS NULL AND mark IS NOT NULL.
  // T-02-15: this scan is the mechanism that makes re-runs a no-op (NaN-stamped rows excluded).
  const readPendingObs: ForReadingPendingObs = async (): Promise<
    Result<ReadonlyArray<PendingObs>, StorageError>
  > => {
    try {
      // Step 1: scan the partial index for pending rows
      const obsRows = await db
        .select({
          time: legObservations.time,
          contract: legObservations.contract,
          mark: legObservations.mark,
          underlyingPrice: legObservations.underlyingPrice,
        })
        .from(legObservations)
        .where(and(isNull(legObservations.bsmIv), isNotNull(legObservations.mark)));

      if (obsRows.length === 0) return ok([]);

      // Step 2: fetch contract metadata for the pending symbols (single query via inArray)
      const contractSymbols = [...new Set(obsRows.map((obs) => obs.contract))];
      const contractMeta = await db
        .select({
          occSymbol: contracts.occSymbol,
          root: contracts.root,
          contractType: contracts.contractType,
          expiration: contracts.expiration,
          strike: contracts.strike,
        })
        .from(contracts)
        .where(inArray(contracts.occSymbol, contractSymbols));

      // Build lookup map: occSymbol → contract metadata
      type ContractMetaRow = (typeof contractMeta)[number];
      const metaBySymbol = new Map<string, ContractMetaRow>(
        contractMeta.map((m) => [m.occSymbol, m]),
      );

      const pending: PendingObs[] = [];
      for (const obs of obsRows) {
        const meta = metaBySymbol.get(obs.contract);
        if (meta === undefined) continue; // no metadata → skip (shouldn't happen in practice)

        // Parse the expiration date string (YYYY-MM-DD from Drizzle date column)
        const parts = meta.expiration.split("-");
        if (parts.length !== 3) continue;
        const [yearStr, monthStr, dayStr] = parts;
        if (yearStr === undefined || monthStr === undefined || dayStr === undefined) continue;
        const expiry = new Date(
          Number(yearStr),
          Number(monthStr) - 1,
          Number(dayStr),
        );

        // Root: Drizzle stores as varchar(8); map to union
        const root: "SPX" | "SPXW" = meta.root === "SPXW" ? "SPXW" : "SPX";

        // ContractType: Drizzle enum stores "C" or "P"
        const type: "C" | "P" = meta.contractType === "P" ? "P" : "C";

        // Strike: stored as ×1000 int → convert back to points (e.g. 7275000 → 7275)
        const strike = meta.strike / 1000;

        pending.push({
          time: obs.time,
          contract: obs.contract,
          mark: parseFloat(obs.mark),
          underlyingPrice: parseFloat(obs.underlyingPrice),
          strike,
          expiry,
          root,
          type,
        });
      }

      return ok(pending);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── ForWritingBsmResults ─────────────────────────────────────────────────
  // BSM-03: update bsm_* columns for a batch of rows.
  // T-02-16: pass string 'NaN' for unsolvable rows — never JS NaN.
  // T-02-17: ONLY bsm_* columns updated; vendor columns (bid/ask/mark/iv/delta) untouched.
  const writeBsmResults: ForWritingBsmResults = async (
    writes,
  ): Promise<Result<void, StorageError>> => {
    if (writes.length === 0) return ok(undefined);
    try {
      for (const write of writes) {
        await db
          .update(legObservations)
          .set({
            bsmIv: write.bsmIv,
            bsmDelta: write.bsmDelta,
            bsmGamma: write.bsmGamma,
            bsmTheta: write.bsmTheta,
            bsmVega: write.bsmVega,
          })
          .where(
            and(
              eq(legObservations.time, write.time),
              eq(legObservations.contract, write.contract),
            ),
          );
      }
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { persistObservations, upsertContracts, readPendingObs, writeBsmResults };
}

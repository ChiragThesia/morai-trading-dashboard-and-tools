import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingObservations,
  ForUpsertingContracts,
  ObservationRow,
  ContractRow,
  StorageError,
} from "@morai/core";
import { legObservations, contracts } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresLegObservationsRepo — Postgres implementation of
 * ForPersistingObservations and ForUpsertingContracts.
 *
 * T-02-08: fetchChain filter bounds write volume before this layer.
 * T-02-09: Drizzle parameterized insert/onConflictDoNothing; no raw interpolation.
 * Append-only idempotency: composite PK (time, contract) — onConflictDoNothing.
 * First-seen contracts: onConflictDoNothing on occ_symbol PK.
 */
export type PostgresLegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
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
        source: row.source as "cboe",
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
        contractType: row.contractType as "C" | "P",
        exerciseStyle: row.exerciseStyle as "european",
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

  return { persistObservations, upsertContracts };
}

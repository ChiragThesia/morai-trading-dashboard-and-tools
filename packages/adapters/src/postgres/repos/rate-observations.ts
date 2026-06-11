import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPersistingRate, ForReadingRate, StorageError } from "@morai/core";
import { lte, desc } from "drizzle-orm";
import { rateObservations } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresRateObservationsRepo — Postgres implementation of
 * ForPersistingRate and ForReadingRate.
 *
 * T-02-14: Drizzle parameterized upsert on date PK; no raw interpolation.
 * Idempotent by date PK — onConflictDoUpdate updates rate on conflict (last-write wins).
 * ForReadingRate: select where date ≤ onOrBefore, orderBy desc(date), limit 1.
 */
export type PostgresRateObservationsRepo = {
  readonly persistRate: ForPersistingRate;
  readonly readRate: ForReadingRate;
};

export function makePostgresRateObservationsRepo(
  db: Db,
): PostgresRateObservationsRepo {
  const persistRate: ForPersistingRate = async (
    obs,
  ): Promise<Result<void, StorageError>> => {
    try {
      // Drizzle numeric column expects a string; T-02-14: parameterized, no interpolation
      await db
        .insert(rateObservations)
        .values({ date: obs.date, rate: String(obs.rate) })
        .onConflictDoUpdate({
          target: rateObservations.date,
          set: { rate: String(obs.rate) },
        });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readRate: ForReadingRate = async (
    onOrBefore: string,
  ): Promise<Result<string | null, StorageError>> => {
    try {
      // Select the most-recent row with date ≤ onOrBefore (PATTERNS.md §rate-observations.ts)
      const rows = await db
        .select({ rate: rateObservations.rate })
        .from(rateObservations)
        .where(lte(rateObservations.date, onOrBefore))
        .orderBy(desc(rateObservations.date))
        .limit(1);

      const first = rows[0];
      if (first === undefined) {
        return ok(null);
      }
      return ok(first.rate);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { persistRate, readRate };
}

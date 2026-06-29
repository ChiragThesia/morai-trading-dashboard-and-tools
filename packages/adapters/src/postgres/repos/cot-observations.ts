import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingCotObservation,
  ForReadingCotObservations,
  CotObservationRow,
  StorageError,
} from "@morai/core";
import { desc } from "drizzle-orm";
import { cotObservations } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresCotObservationsRepo — Postgres implementation of
 * ForPersistingCotObservation and ForReadingCotObservations.
 *
 * T-13-05: Drizzle parameterized insert — contractCode and asOf are NOT
 * interpolated as raw SQL; fully parameterized via Drizzle's query builder.
 * T-13-06: onConflictDoNothing on (contractCode, asOf) — COT-01 idempotency
 * (D-09): a duplicate report week is a true no-op (DO NOTHING, not DO UPDATE).
 *
 * asOf (YYYY-MM-DD string) → date column; publishedAt (Date) → timestamptz.
 * Neither is derived from the other by date-math (D-07/D-08).
 * NET values not stored — derived at the use-case / API layer (D-04).
 */
export type PostgresCotObservationsRepo = {
  readonly insertCotObservation: ForPersistingCotObservation;
  readonly listCotObservations: ForReadingCotObservations;
};

export function makePostgresCotObservationsRepo(
  db: Db,
): PostgresCotObservationsRepo {
  const insertCotObservation: ForPersistingCotObservation = async (
    row: CotObservationRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      // T-13-05: parameterized insert — all values bound by Drizzle, no string interpolation
      // T-13-06: DO NOTHING on the unique constraint (contract_code, as_of)
      await db
        .insert(cotObservations)
        .values({
          contractCode: row.contractCode,
          asOf: row.asOf,
          publishedAt: row.publishedAt,
          openInterest: row.openInterest,
          dealerLong: row.dealerLong,
          dealerShort: row.dealerShort,
          assetMgrLong: row.assetMgrLong,
          assetMgrShort: row.assetMgrShort,
          levMoneyLong: row.levMoneyLong,
          levMoneyShort: row.levMoneyShort,
          otherReptLong: row.otherReptLong,
          otherReptShort: row.otherReptShort,
          nonreptLong: row.nonreptLong,
          nonreptShort: row.nonreptShort,
        })
        .onConflictDoNothing({
          target: [cotObservations.contractCode, cotObservations.asOf],
        });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const listCotObservations: ForReadingCotObservations = async (
    limit?: number,
  ): Promise<Result<ReadonlyArray<CotObservationRow>, StorageError>> => {
    try {
      const base = db
        .select()
        .from(cotObservations)
        .orderBy(desc(cotObservations.asOf));

      const rawRows =
        limit !== undefined ? await base.limit(limit) : await base;

      return ok(
        rawRows.map((r) => ({
          contractCode: r.contractCode,
          asOf: r.asOf,
          publishedAt: r.publishedAt,
          openInterest: r.openInterest,
          dealerLong: r.dealerLong,
          dealerShort: r.dealerShort,
          assetMgrLong: r.assetMgrLong,
          assetMgrShort: r.assetMgrShort,
          levMoneyLong: r.levMoneyLong,
          levMoneyShort: r.levMoneyShort,
          otherReptLong: r.otherReptLong,
          otherReptShort: r.otherReptShort,
          nonreptLong: r.nonreptLong,
          nonreptShort: r.nonreptShort,
        })),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { insertCotObservation, listCotObservations };
}

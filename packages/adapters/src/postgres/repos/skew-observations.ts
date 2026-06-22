/**
 * makePostgresSkewObservationsRepo — Postgres implementation of the skew (per-strike smile) ports.
 *
 * storeSkewObservations: bulk INSERT onConflictDoNothing on the composite PK
 *   (snapshot_time, underlying, expiration, strike) — re-running for the same grain is a no-op
 *   (ANLY-01 R1 idempotency).
 * readSkewSmileDetail: SELECT ordered by snapshot_time ASC, optional underlying/expiration filter;
 *   empty array when none (never null/error).
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * Numeric columns cross the boundary via String()/parseFloat() (calendar-events.ts precedent);
 * nullable delta/moneyness survive the round-trip as null.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForWritingSkewObservations,
  ForReadingSkewSmileDetail,
  SkewObservationRow,
  StorageError,
} from "@morai/core";
import { and, eq, asc } from "drizzle-orm";
import { skewObservations } from "../schema.ts";
import type { Db } from "../db.ts";

/** Stay below Postgres's 65,534 bind-parameter limit (7 cols × 2000 = 14,000 params). */
const INSERT_CHUNK_ROWS = 2000;

export type PostgresSkewObservationsRepo = {
  readonly storeSkewObservations: ForWritingSkewObservations;
  readonly readSkewSmileDetail: ForReadingSkewSmileDetail;
};

export function makePostgresSkewObservationsRepo(db: Db): PostgresSkewObservationsRepo {
  const storeSkewObservations: ForWritingSkewObservations = async (
    rows: ReadonlyArray<SkewObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      const values = rows.map((row) => ({
        snapshotTime: row.snapshotTime,
        underlying: row.underlying,
        expiration: row.expiration,
        strike: row.strike,
        iv: String(row.iv),
        delta: row.delta !== null ? String(row.delta) : null,
        moneyness: row.moneyness !== null ? String(row.moneyness) : null,
      }));
      for (let i = 0; i < values.length; i += INSERT_CHUNK_ROWS) {
        const slice = values.slice(i, i + INSERT_CHUNK_ROWS);
        await db.insert(skewObservations).values(slice).onConflictDoNothing();
      }
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readSkewSmileDetail: ForReadingSkewSmileDetail = async (query: {
    readonly underlying?: string;
    readonly expiration?: string;
  }): Promise<Result<ReadonlyArray<SkewObservationRow>, StorageError>> => {
    try {
      const conditions = [];
      if (query.underlying !== undefined) {
        conditions.push(eq(skewObservations.underlying, query.underlying));
      }
      if (query.expiration !== undefined) {
        conditions.push(eq(skewObservations.expiration, query.expiration));
      }
      const base = db.select().from(skewObservations);
      const filtered = conditions.length === 0 ? base : base.where(and(...conditions));
      const rows = await filtered.orderBy(asc(skewObservations.snapshotTime));

      const mapped: SkewObservationRow[] = rows.map((row) => ({
        snapshotTime: row.snapshotTime,
        underlying: row.underlying,
        expiration: row.expiration,
        strike: row.strike,
        iv: parseFloat(row.iv),
        delta: row.delta !== null ? parseFloat(row.delta) : null,
        moneyness: row.moneyness !== null ? parseFloat(row.moneyness) : null,
      }));
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { storeSkewObservations, readSkewSmileDetail };
}

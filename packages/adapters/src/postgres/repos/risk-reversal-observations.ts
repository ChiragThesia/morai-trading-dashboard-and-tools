/**
 * makePostgresRiskReversalObservationsRepo — Postgres implementation of the risk-reversal ports.
 *
 * storeRiskReversalObservations: bulk INSERT onConflictDoNothing on the composite PK
 *   (snapshot_time, underlying, expiration) — re-run for the same grain is a no-op (R2 idempotency).
 *   Nullable risk_reversal/rr_rank are written as SQL NULL (never coerced to 0 — R2 prohibition).
 * readRiskReversalSeries (= ForReadingSkewSeries): the headline RR series for GET /api/analytics/skew,
 *   ordered by snapshot_time ASC, optional underlying/expiration filter; empty array when none.
 * readRiskReversalHistory: trailing window (≤252) of prior NON-NULL risk_reversal values for a
 *   (underlying, expiration) at/before a time, oldest→newest, for percentile rank (T-06-15 cap).
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForWritingRiskReversalObservations,
  ForReadingSkewSeries,
  ForReadingRiskReversalHistory,
  RiskReversalObservationRow,
  StorageError,
} from "@morai/core";
import { and, eq, lte, isNotNull, asc, desc } from "drizzle-orm";
import { riskReversalObservations } from "../schema.ts";
import type { Db } from "../db.ts";

/** Trailing-window cap for rank history (≤252 prior values — T-06-15). */
const HISTORY_LIMIT = 252;

export type PostgresRiskReversalObservationsRepo = {
  readonly storeRiskReversalObservations: ForWritingRiskReversalObservations;
  readonly readRiskReversalSeries: ForReadingSkewSeries;
  readonly readRiskReversalHistory: ForReadingRiskReversalHistory;
};

export function makePostgresRiskReversalObservationsRepo(
  db: Db,
): PostgresRiskReversalObservationsRepo {
  const storeRiskReversalObservations: ForWritingRiskReversalObservations = async (
    rows: ReadonlyArray<RiskReversalObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      await db
        .insert(riskReversalObservations)
        .values(
          rows.map((row) => ({
            snapshotTime: row.snapshotTime,
            underlying: row.underlying,
            expiration: row.expiration,
            // NULL stays NULL — never fabricated, never coerced to 0 (R2).
            riskReversal: row.riskReversal !== null ? String(row.riskReversal) : null,
            rrRank: row.rrRank !== null ? String(row.rrRank) : null,
          })),
        )
        .onConflictDoNothing();
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readRiskReversalSeries: ForReadingSkewSeries = async (query: {
    readonly underlying?: string;
    readonly expiration?: string;
  }): Promise<Result<ReadonlyArray<RiskReversalObservationRow>, StorageError>> => {
    try {
      const conditions = [];
      if (query.underlying !== undefined) {
        conditions.push(eq(riskReversalObservations.underlying, query.underlying));
      }
      if (query.expiration !== undefined) {
        conditions.push(eq(riskReversalObservations.expiration, query.expiration));
      }
      const base = db.select().from(riskReversalObservations);
      const filtered = conditions.length === 0 ? base : base.where(and(...conditions));
      const rows = await filtered.orderBy(asc(riskReversalObservations.snapshotTime));

      const mapped: RiskReversalObservationRow[] = rows.map((row) => ({
        snapshotTime: row.snapshotTime,
        underlying: row.underlying,
        expiration: row.expiration,
        riskReversal: row.riskReversal !== null ? parseFloat(row.riskReversal) : null,
        rrRank: row.rrRank !== null ? parseFloat(row.rrRank) : null,
      }));
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readRiskReversalHistory: ForReadingRiskReversalHistory = async (query: {
    readonly underlying: string;
    readonly expiration: string;
    readonly beforeOrAt: Date;
  }): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    try {
      // Most-recent HISTORY_LIMIT prior NON-NULL values, then re-order oldest→newest.
      const rows = await db
        .select({ riskReversal: riskReversalObservations.riskReversal })
        .from(riskReversalObservations)
        .where(
          and(
            eq(riskReversalObservations.underlying, query.underlying),
            eq(riskReversalObservations.expiration, query.expiration),
            lte(riskReversalObservations.snapshotTime, query.beforeOrAt),
            isNotNull(riskReversalObservations.riskReversal),
          ),
        )
        .orderBy(desc(riskReversalObservations.snapshotTime))
        .limit(HISTORY_LIMIT);

      const values: number[] = [];
      for (const row of rows) {
        if (row.riskReversal !== null) values.push(parseFloat(row.riskReversal));
      }
      values.reverse(); // oldest→newest
      return ok(values);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    storeRiskReversalObservations,
    readRiskReversalSeries,
    readRiskReversalHistory,
  };
}

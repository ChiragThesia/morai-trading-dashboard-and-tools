/**
 * makeMemoryRiskReversalObservationsRepo — in-memory twin of the Postgres risk-reversal adapter.
 *
 * Implements ForWritingRiskReversalObservations + ForReadingSkewSeries (the headline RR series read)
 * + ForReadingRiskReversalHistory using a plain Map. Idempotency mirrors Postgres onConflictDoNothing
 * on the composite PK (snapshot_time, underlying, expiration):
 *   key = `${snapshotTime.toISOString()}|${underlying}|${expiration}`.
 *
 * riskReversal/rrRank are held as number|null and never re-encoded → NULL round-trips as null
 * (never coerced to 0 — R2 prohibition). readRiskReversalHistory returns the trailing window of
 * prior NON-NULL riskReversal values for the (underlying, expiration) at/before a time.
 *
 * Architecture law (architecture-boundaries.md §8): every driven port change updates this twin.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForWritingRiskReversalObservations,
  ForReadingSkewSeries,
  ForReadingRiskReversalHistory,
  RiskReversalObservationRow,
  StorageError,
} from "@morai/core";

/** Trailing-window cap for rank history (≤252 prior values — T-06-15). */
const HISTORY_LIMIT = 252;

export type MemoryRiskReversalObservationsRepo = {
  readonly storeRiskReversalObservations: ForWritingRiskReversalObservations;
  readonly readRiskReversalSeries: ForReadingSkewSeries;
  readonly readRiskReversalHistory: ForReadingRiskReversalHistory;
  /** countObservations — test helper: count rows (optionally for one underlying) */
  readonly countObservations: (underlying?: string) => Promise<number>;
};

export function makeMemoryRiskReversalObservationsRepo(): MemoryRiskReversalObservationsRepo {
  const store = new Map<string, RiskReversalObservationRow>();

  const keyOf = (row: RiskReversalObservationRow): string =>
    `${row.snapshotTime.toISOString()}|${row.underlying}|${row.expiration}`;

  const storeRiskReversalObservations: ForWritingRiskReversalObservations = async (
    rows: ReadonlyArray<RiskReversalObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      const key = keyOf(row);
      if (!store.has(key)) store.set(key, row); // onConflictDoNothing equivalent
    }
    return ok(undefined);
  };

  const readRiskReversalSeries: ForReadingSkewSeries = async (query: {
    readonly underlying?: string;
    readonly expiration?: string;
  }): Promise<Result<ReadonlyArray<RiskReversalObservationRow>, StorageError>> => {
    const rows = [...store.values()]
      .filter((r) => query.underlying === undefined || r.underlying === query.underlying)
      .filter((r) => query.expiration === undefined || r.expiration === query.expiration)
      .sort((a, b) => a.snapshotTime.getTime() - b.snapshotTime.getTime());
    return ok(rows);
  };

  const readRiskReversalHistory: ForReadingRiskReversalHistory = async (query: {
    readonly underlying: string;
    readonly expiration: string;
    readonly beforeOrAt: Date;
  }): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    const values = [...store.values()]
      .filter(
        (r) =>
          r.underlying === query.underlying &&
          r.expiration === query.expiration &&
          r.snapshotTime.getTime() <= query.beforeOrAt.getTime() &&
          r.riskReversal !== null,
      )
      .sort((a, b) => a.snapshotTime.getTime() - b.snapshotTime.getTime())
      // Keep the most recent HISTORY_LIMIT, then return oldest→newest.
      .slice(-HISTORY_LIMIT)
      .map((r) => r.riskReversal)
      .filter((v): v is number => v !== null);
    return ok(values);
  };

  const countObservations = async (underlying?: string): Promise<number> =>
    [...store.values()].filter((r) => underlying === undefined || r.underlying === underlying)
      .length;

  return {
    storeRiskReversalObservations,
    readRiskReversalSeries,
    readRiskReversalHistory,
    countObservations,
  };
}

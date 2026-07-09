import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingDailySpotClosesAsOf,
  ForReadingPickerSnapshotsInRange,
  StoredPickerSnapshotRow,
  StorageError,
} from "@morai/core";
import { pickerSnapshotResponse } from "@morai/contracts";
import { and, asc, gte, lte, sql } from "drizzle-orm";
import { pickerSnapshots } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresBacktestHistoryRepo — Postgres implementation of
 * ForReadingDailySpotClosesAsOf and ForReadingPickerSnapshotsInRange (Phase 27, Plan 03).
 *
 * readDailySpotClosesAsOf: bounds picker-history.ts's "last N distinct days present" read
 * with `time <= asOfT` — a close dated after asOfT is never included (RV20's as-of-T input,
 * PITFALLS.md Pitfall 2's `vrp` leakage vector).
 *
 * readPickerSnapshotsInRange: every picker_snapshot row with observed_at in [from, to], ASC —
 * the cohort ledger the leakage-oracle/hypothetical-entry walk-forward loops iterate. Each
 * row's snapshot blob is re-validated through pickerSnapshotResponse.parse at the read
 * boundary (mirrors picker-snapshot.ts's T-19-10 convention) — a corrupt blob surfaces
 * StorageError, never a loosely-typed object.
 */
export type PostgresBacktestHistoryRepo = {
  readonly readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf;
  readonly readPickerSnapshotsInRange: ForReadingPickerSnapshotsInRange;
};

export function makePostgresBacktestHistoryRepo(db: Db): PostgresBacktestHistoryRepo {
  const readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf = async (
    nDays: number,
    asOfT: Date,
  ): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    try {
      const rows = await db.execute(sql`
        SELECT underlying_price
        FROM (
          SELECT DISTINCT ON (time::date) time::date AS day, underlying_price
          FROM leg_observations
          WHERE time <= ${asOfT.toISOString()}::timestamptz
          ORDER BY time::date DESC, time DESC
          LIMIT ${nDays}
        ) latest_per_day
        ORDER BY day ASC
      `);

      const closes: number[] = [];
      for (const row of rows) {
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const raw = rec["underlying_price"];
        const value = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(value)) closes.push(value);
      }
      return ok(closes);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readPickerSnapshotsInRange: ForReadingPickerSnapshotsInRange = async (
    from: Date,
    to: Date,
  ): Promise<Result<ReadonlyArray<StoredPickerSnapshotRow>, StorageError>> => {
    try {
      const rows = await db
        .select()
        .from(pickerSnapshots)
        .where(and(gte(pickerSnapshots.observedAt, from), lte(pickerSnapshots.observedAt, to)))
        .orderBy(asc(pickerSnapshots.observedAt));

      const mapped: StoredPickerSnapshotRow[] = rows.map((row) => ({
        observedAt: row.observedAt,
        snapshot: pickerSnapshotResponse.parse(row.snapshot),
      }));
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readDailySpotClosesAsOf, readPickerSnapshotsInRange };
}

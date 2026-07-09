import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingDailySpotClosesAsOf,
  ForReadingPickerSnapshotsInRange,
  StoredPickerSnapshotRow,
  StorageError,
} from "@morai/core";
import { pickerSnapshotResponse } from "@morai/contracts";

/**
 * makeMemoryBacktestHistoryRepo — in-memory twin of the Postgres backtest-history adapter
 * (Phase 27, Plan 03).
 *
 * readDailySpotClosesAsOf mirrors picker-history.ts's "last observation per UTC calendar
 * day" over a plain seeded array, bounded by lte(time, asOfT) — the RV20 as-of-T fix.
 * readPickerSnapshotsInRange filters seeded rows to [from, to], ASC, re-validating each
 * blob through pickerSnapshotResponse (matches the Postgres write-boundary parity).
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryBacktestHistoryRepo = {
  readonly readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf;
  readonly readPickerSnapshotsInRange: ForReadingPickerSnapshotsInRange;
  /** seedDailyClose — append one raw observation (mirrors a leg_observations row). */
  readonly seedDailyClose: (time: Date, underlyingPrice: number) => void;
  /** seedSnapshot — append one picker_snapshot row. */
  readonly seedSnapshot: (row: StoredPickerSnapshotRow) => void;
};

export function makeMemoryBacktestHistoryRepo(): MemoryBacktestHistoryRepo {
  const observations: { time: Date; underlyingPrice: number }[] = [];
  const snapshots: StoredPickerSnapshotRow[] = [];

  const readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf = async (
    nDays: number,
    asOfT: Date,
  ): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    const eligible = observations.filter((o) => o.time.getTime() <= asOfT.getTime());

    // Last observation per UTC calendar day (mirrors DISTINCT ON (time::date) ORDER BY time DESC).
    const lastPerDay = new Map<string, { time: Date; underlyingPrice: number }>();
    for (const obs of eligible) {
      const day = obs.time.toISOString().slice(0, 10);
      const existing = lastPerDay.get(day);
      if (existing === undefined || obs.time.getTime() > existing.time.getTime()) {
        lastPerDay.set(day, obs);
      }
    }

    const closes = [...lastPerDay.entries()]
      .sort(([dayA], [dayB]) => (dayA < dayB ? 1 : -1)) // newest day first
      .slice(0, nDays)
      .reverse() // back to ASC — oldest of the kept N first
      .map(([, obs]) => obs.underlyingPrice);

    return ok(closes);
  };

  const readPickerSnapshotsInRange: ForReadingPickerSnapshotsInRange = async (
    from: Date,
    to: Date,
  ): Promise<Result<ReadonlyArray<StoredPickerSnapshotRow>, StorageError>> => {
    try {
      const inRange = snapshots
        .filter(
          (row) =>
            row.observedAt.getTime() >= from.getTime() && row.observedAt.getTime() <= to.getTime(),
        )
        .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())
        .map((row) => ({
          observedAt: row.observedAt,
          snapshot: pickerSnapshotResponse.parse(row.snapshot),
        }));
      return ok(inRange);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const seedDailyClose = (time: Date, underlyingPrice: number): void => {
    observations.push({ time, underlyingPrice });
  };

  const seedSnapshot = (row: StoredPickerSnapshotRow): void => {
    snapshots.push(row);
  };

  return {
    readDailySpotClosesAsOf,
    readPickerSnapshotsInRange,
    seedDailyClose,
    seedSnapshot,
  };
}

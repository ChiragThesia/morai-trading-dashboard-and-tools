import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingDailySpotCloses,
  ForReadingPickerSlopeHistory,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryPickerHistoryRepo — in-memory twin of the Postgres picker-history adapter.
 *
 * Read-only ports: returns the seeded series, honoring the same limit semantics as the
 * Postgres impl (closes: LAST `days` entries of the seeded ascending series; slopes:
 * flattened from the newest `limit` seeded snapshots' slope arrays).
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryPickerHistoryRepo = {
  readonly readDailySpotCloses: ForReadingDailySpotCloses;
  readonly readPickerSlopeHistory: ForReadingPickerSlopeHistory;
};

export function makeMemoryPickerHistoryRepo(seed: {
  /** Ascending daily closes (oldest → newest). */
  readonly dailyCloses?: ReadonlyArray<number>;
  /** Newest-first snapshot slope arrays (mirrors picker_snapshot DESC read). */
  readonly snapshotSlopes?: ReadonlyArray<ReadonlyArray<number>>;
} = {}): MemoryPickerHistoryRepo {
  const dailyCloses = seed.dailyCloses ?? [];
  const snapshotSlopes = seed.snapshotSlopes ?? [];

  const readDailySpotCloses: ForReadingDailySpotCloses = async (
    days: number,
  ): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    return ok(dailyCloses.slice(-days));
  };

  const readPickerSlopeHistory: ForReadingPickerSlopeHistory = async (
    limit: number,
  ): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    return ok(snapshotSlopes.slice(0, limit).flatMap((slopes) => [...slopes]));
  };

  return { readDailySpotCloses, readPickerSlopeHistory };
}

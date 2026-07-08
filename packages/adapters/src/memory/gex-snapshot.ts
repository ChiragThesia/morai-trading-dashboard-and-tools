/**
 * makeMemoryGexSnapshotRepo — in-memory twin of the Postgres GEX snapshot adapter.
 *
 * Implements ForReadingLegObsForGex + ForPersistingGexSnapshot + ForReadingGexSnapshot
 * using plain Maps. Idempotency mirrors Postgres onConflictDoNothing on the cycle_time PK:
 *   key = cycleTime.toISOString() (the idempotency key; one row per data cycle).
 *
 * GexSnapshotRow fields are held in their native domain types (no re-encoding).
 * profile/strikes/byExpiry are stored as-is (JSONB equivalent).
 *
 * Architecture law (architecture-boundaries.md §8): every driven port change updates
 * the in-memory twin in the SAME PR as the Postgres adapter.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingLegObsForGex,
  ForPersistingGexSnapshot,
  ForReadingGexSnapshot,
  GexSnapshotRow,
  LegObsForGex,
  StorageError,
} from "@morai/core";

export type MemoryGexSnapshotRepo = {
  readonly readLegObsForGex: ForReadingLegObsForGex;
  readonly persistGexSnapshot: ForPersistingGexSnapshot;
  readonly readGexSnapshot: ForReadingGexSnapshot;
  /** countSnapshots — test helper: count rows in gex_snapshots. */
  readonly countSnapshots: () => Promise<number>;
  /** seedLegs — test helper: seed LegObsForGex rows for readLegObsForGex. */
  readonly seedLegs: (legs: ReadonlyArray<LegObsForGex>) => void;
};

export function makeMemoryGexSnapshotRepo(): MemoryGexSnapshotRepo {
  /** keyed by cycleTime ISO string — idempotency anchor (SC-4). */
  const snapshots = new Map<string, GexSnapshotRow>();
  /** seeded legs for readLegObsForGex (test helper for the memory twin). */
  const seededLegs: LegObsForGex[] = [];

  const readLegObsForGex: ForReadingLegObsForGex = async (): Promise<
    Result<ReadonlyArray<LegObsForGex>, StorageError>
  > => {
    // Mirrors the Postgres dual-source cohort semantics (chain-window-narrow-regression):
    // union of all BSM-solved rows in [maxTime − LOOKBACK, maxTime], deduped per
    // contract (newest row wins). Lookback (not calendar slots) — a cycle that
    // straddles the 30-min boundary must stay together (live 2026-07-08 regression).
    const solved = seededLegs.filter((leg) => leg.bsmGamma !== null);
    if (solved.length === 0) return ok([]);

    const maxTime = Math.max(...solved.map((leg) => leg.time.getTime()));
    const lookbackMs = 10 * 60 * 1000;
    const windowStart = maxTime - lookbackMs;

    const newestByContract = new Map<string, LegObsForGex>();
    for (const leg of solved) {
      const t = leg.time.getTime();
      if (t < windowStart || t > maxTime) continue;
      const existing = newestByContract.get(leg.contract);
      if (existing === undefined || t > existing.time.getTime()) {
        newestByContract.set(leg.contract, leg);
      }
    }

    return ok([...newestByContract.values()]);
  };

  const persistGexSnapshot: ForPersistingGexSnapshot = async (
    row: GexSnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    const key = row.cycleTime.toISOString();
    // onConflictDoNothing equivalent: if already present, skip (idempotency SC-4).
    if (!snapshots.has(key)) {
      snapshots.set(key, row);
    }
    return ok(undefined);
  };

  const readGexSnapshot: ForReadingGexSnapshot = async (): Promise<
    Result<GexSnapshotRow | null, StorageError>
  > => {
    if (snapshots.size === 0) return ok(null);

    // Return the row with the LATEST cycleTime (ORDER BY cycle_time DESC LIMIT 1 equivalent).
    let latest: GexSnapshotRow | undefined;
    for (const row of snapshots.values()) {
      if (latest === undefined || row.cycleTime.getTime() > latest.cycleTime.getTime()) {
        latest = row;
      }
    }
    return ok(latest ?? null);
  };

  const countSnapshots = async (): Promise<number> => snapshots.size;

  const seedLegs = (legs: ReadonlyArray<LegObsForGex>): void => {
    seededLegs.splice(0, seededLegs.length, ...legs);
  };

  return {
    readLegObsForGex,
    persistGexSnapshot,
    readGexSnapshot,
    countSnapshots,
    seedLegs,
  };
}

/**
 * makeMemoryLegObservationsRepo — in-memory twin of the Postgres leg-observations adapter.
 *
 * Implements the subset of leg-observations ports needed by plan 06 use-cases:
 *   - ForPersistingObservations (write-path, used by tests that need seeded data)
 *   - ForReadingLatestLegObs (getLatestLegObs — backs get_live_greeks)
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * getLatestLegObs semantics: returns the observation with the MAX time
 * for the given OCC symbol; null when no observation exists.
 * (Mirrors Postgres ORDER BY time DESC LIMIT 1.)
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingObservations,
  ForReadingLatestLegObs,
  ForReadingSmileSource,
  ObservationRow,
  LegSnapshot,
  SmileQuote,
  StorageError,
} from "@morai/core";

/**
 * SeededSmileLeg — a BSM-solved leg observation at the grain the smile read joins on
 * (leg_observations × contracts). Used by the memory twin's readSmile (ANLY-01 R1 source).
 * bsmIv "NaN" or null → excluded from the smile, mirroring Postgres.
 */
export type SeededSmileLeg = {
  readonly snapshotTime: Date;
  readonly underlying: string;
  readonly expiration: string; // YYYY-MM-DD
  readonly strike: number; // ×1000 int
  readonly bsmIv: string | null;
  readonly bsmDelta: string | null;
};

export type MemoryLegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly getLatestLegObs: ForReadingLatestLegObs;
  readonly readSmile: ForReadingSmileSource;
  /** Test helper: seed a BSM-solved leg for the smile-source read. */
  readonly seedSmileLeg: (leg: SeededSmileLeg) => void;
};

export function makeMemoryLegObservationsRepo(): MemoryLegObservationsRepo {
  // Composite key: `${contract}:${time.toISOString()}` — idempotent (mirrors onConflictDoNothing)
  const store = new Map<string, ObservationRow>();
  // Smile-source seed store, keyed on the smile grain (snapshot_time, underlying, expiration, strike).
  const smileStore = new Map<string, SeededSmileLeg>();

  const persistObservations: ForPersistingObservations = async (
    rows: ReadonlyArray<ObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      const key = `${row.contract}:${row.time.toISOString()}`;
      if (!store.has(key)) store.set(key, row); // onConflictDoNothing equivalent
    }
    return ok(undefined);
  };

  // getLatestLegObs: scan all rows for the symbol, pick the one with max time.
  // Memory-safe O(n): observation counts are small in tests.
  const getLatestLegObs: ForReadingLatestLegObs = async (
    occSymbol,
  ): Promise<Result<LegSnapshot | null, StorageError>> => {
    let latest: ObservationRow | null = null;

    for (const row of store.values()) {
      if (row.contract !== occSymbol) continue;
      if (latest === null || row.time > latest.time) {
        latest = row;
      }
    }

    if (latest === null) return ok(null);

    const leg: LegSnapshot = {
      occSymbol: latest.contract,
      mark: latest.mark,
      underlyingPrice: latest.underlyingPrice,
      ivRaw: latest.iv,
      // Memory adapter: bsm fields are always null (not written by plan 06 memory tests)
      bsmIv: null,
      bsmDelta: null,
      bsmGamma: null,
      bsmTheta: null,
      bsmVega: null,
      source: latest.source,
    };

    return ok(leg);
  };

  const seedSmileLeg = (leg: SeededSmileLeg): void => {
    const key = `${leg.snapshotTime.toISOString()}|${leg.underlying}|${leg.expiration}|${leg.strike}`;
    smileStore.set(key, leg);
  };

  // ForReadingSmileSource: per-strike smile points for a snapshot time. Excludes NaN-stamped iv
  // (bsmIv === "NaN") and unsolved rows (bsmIv === null), mirroring the Postgres adapter.
  const readSmile: ForReadingSmileSource = async (
    snapshotTime,
  ): Promise<Result<ReadonlyArray<SmileQuote>, StorageError>> => {
    const smile: SmileQuote[] = [];
    for (const leg of smileStore.values()) {
      if (leg.snapshotTime.getTime() !== snapshotTime.getTime()) continue;
      if (leg.bsmIv === null || leg.bsmIv === "NaN") continue;
      smile.push({
        underlying: leg.underlying,
        expiration: leg.expiration,
        strike: leg.strike,
        iv: parseFloat(leg.bsmIv),
        delta: leg.bsmDelta !== null ? parseFloat(leg.bsmDelta) : null,
        moneyness: null,
      });
    }
    return ok(smile);
  };

  return { persistObservations, getLatestLegObs, readSmile, seedSmileLeg };
}

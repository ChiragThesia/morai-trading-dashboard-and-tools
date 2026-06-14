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
  ObservationRow,
  LegSnapshot,
  StorageError,
} from "@morai/core";

export type MemoryLegObservationsRepo = {
  readonly persistObservations: ForPersistingObservations;
  readonly getLatestLegObs: ForReadingLatestLegObs;
};

export function makeMemoryLegObservationsRepo(): MemoryLegObservationsRepo {
  // Composite key: `${contract}:${time.toISOString()}` — idempotent (mirrors onConflictDoNothing)
  const store = new Map<string, ObservationRow>();

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
    };

    return ok(leg);
  };

  return { persistObservations, getLatestLegObs };
}

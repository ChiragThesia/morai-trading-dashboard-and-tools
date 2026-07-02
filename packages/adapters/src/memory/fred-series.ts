import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingFredSeries, MacroObservationRow, FetchError } from "@morai/core";

/**
 * makeMemoryFredSeriesAdapter — in-memory twin of the parameterized FRED series
 * adapter (makeFredSeriesAdapter).
 *
 * Implements ForFetchingFredSeries using rows keyed by seriesId (unseeded → err).
 * Exposes `seed(row)` for test setup; re-seeding a seriesId replaces its row.
 *
 * D-09 parity with the real adapter: NO fabricated fallback — a seriesId with no
 * seeded row returns err(FetchError), never a fake value (unlike the legacy
 * makeMemoryRateAdapter, whose lenient 4.5% fallback mirrors D-02/D-13).
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8). Added per Phase 14 review WR-03.
 */
export type MemoryFredSeriesAdapter = {
  readonly fetchFredSeries: ForFetchingFredSeries;
  readonly seed: (row: MacroObservationRow) => void;
};

export function makeMemoryFredSeriesAdapter(): MemoryFredSeriesAdapter {
  // Keyed by seriesId — mirrors the real adapter's query-by-series behaviour.
  const store = new Map<string, MacroObservationRow>();

  const fetchFredSeries: ForFetchingFredSeries = async (
    seriesId: string,
  ): Promise<Result<MacroObservationRow, FetchError>> => {
    const row = store.get(seriesId);
    if (row === undefined) {
      return err({
        kind: "fetch-error",
        message: `MemoryFredSeriesAdapter: no row seeded for seriesId "${seriesId}" — call seed() first`,
      });
    }
    return ok(row);
  };

  const seed = (row: MacroObservationRow): void => {
    store.set(row.seriesId, row);
  };

  return { fetchFredSeries, seed };
}

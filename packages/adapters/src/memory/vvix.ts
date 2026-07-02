import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingVvixQuote, MacroObservationRow, FetchError } from "@morai/core";

/**
 * makeMemoryVvixAdapter — in-memory twin of the CBOE VVIX index-quote adapter
 * (makeCboeVvixAdapter).
 *
 * Implements ForFetchingVvixQuote using a single stored MacroObservationRow
 * (null = unseeded). Exposes `seed(row)` for test setup; re-seeding replaces it.
 *
 * No-fallback parity with the real adapter: unseeded `fetchVvixQuote` returns
 * err(FetchError), never a fabricated quote.
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8). Added per Phase 14 review WR-03.
 */
export type MemoryVvixAdapter = {
  readonly fetchVvixQuote: ForFetchingVvixQuote;
  readonly seed: (row: MacroObservationRow) => void;
};

export function makeMemoryVvixAdapter(): MemoryVvixAdapter {
  // Backing store: single VVIX observation (null = unseeded)
  let stored: MacroObservationRow | null = null;

  const fetchVvixQuote: ForFetchingVvixQuote = async (): Promise<
    Result<MacroObservationRow, FetchError>
  > => {
    if (stored === null) {
      return err({
        kind: "fetch-error",
        message: "MemoryVvixAdapter: no quote seeded — call seed() first",
      });
    }
    return ok(stored);
  };

  const seed = (row: MacroObservationRow): void => {
    stored = row;
  };

  return { fetchVvixQuote, seed };
}

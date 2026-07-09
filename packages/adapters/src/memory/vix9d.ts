import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingVix9dQuote, MacroObservationRow, FetchError } from "@morai/core";

/**
 * makeMemoryVix9dAdapter — in-memory twin of the CBOE VIX9D index-quote adapter
 * (makeCboeVix9dAdapter).
 *
 * Implements ForFetchingVix9dQuote using a single stored MacroObservationRow
 * (null = unseeded). Exposes `seed(row)` for test setup; re-seeding replaces it.
 *
 * No-fallback parity with the real adapter: unseeded `fetchVix9dQuote` returns
 * err(FetchError), never a fabricated quote.
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8). Added Phase 24 (MACRO-02/03).
 */
export type MemoryVix9dAdapter = {
  readonly fetchVix9dQuote: ForFetchingVix9dQuote;
  readonly seed: (row: MacroObservationRow) => void;
};

export function makeMemoryVix9dAdapter(): MemoryVix9dAdapter {
  // Backing store: single VIX9D observation (null = unseeded)
  let stored: MacroObservationRow | null = null;

  const fetchVix9dQuote: ForFetchingVix9dQuote = async (): Promise<
    Result<MacroObservationRow, FetchError>
  > => {
    if (stored === null) {
      return err({
        kind: "fetch-error",
        message: "MemoryVix9dAdapter: no quote seeded — call seed() first",
      });
    }
    return ok(stored);
  };

  const seed = (row: MacroObservationRow): void => {
    stored = row;
  };

  return { fetchVix9dQuote, seed };
}

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingRate, RateObservation, FetchError } from "@morai/core";

/**
 * makeMemoryRateAdapter — in-memory twin of the FRED rate adapter.
 *
 * Implements ForFetchingRate using a single stored RateObservation.
 * Exposes `seed(obs)` for test setup.
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 */
export type MemoryRateAdapter = {
  readonly fetchRate: ForFetchingRate;
  readonly seed: (obs: RateObservation) => void;
};

export function makeMemoryRateAdapter(): MemoryRateAdapter {
  // Backing store: single rate observation (null = unseeded)
  let stored: RateObservation | null = null;

  const fetchRate: ForFetchingRate = async (): Promise<
    Result<RateObservation, FetchError>
  > => {
    if (stored === null) {
      // Default fallback when unseeded — mirrors FRED adapter's 4.5% fallback
      return ok({ date: new Date().toISOString().slice(0, 10), rate: 0.045 });
    }
    return ok(stored);
  };

  const seed = (obs: RateObservation): void => {
    stored = obs;
  };

  return { fetchRate, seed };
}

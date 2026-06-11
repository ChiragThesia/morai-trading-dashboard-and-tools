import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForFetchingRate,
  ForPersistingRate,
  FetchError,
  StorageError,
} from "./ports.ts";

/**
 * makeFetchRateUseCase — orchestrate fetch-and-persist for the risk-free rate (MKT-02).
 *
 * Deps:
 *   fetchRate: ForFetchingRate — FRED HTTP adapter (always returns ok, fallback built in)
 *   persistRate: ForPersistingRate — Postgres rate_observations repo
 *
 * Returns ok(void) when both succeed, or err(StorageError) when persist fails.
 * A FetchError cannot escape here because ForFetchingRate always returns ok (the FRED
 * adapter absorbs network/key errors via the 4.5% fallback) — but the return type
 * includes FetchError to preserve the type contract in case of future adapter changes.
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries.md §2).
 */
export function makeFetchRateUseCase(deps: {
  readonly fetchRate: ForFetchingRate;
  readonly persistRate: ForPersistingRate;
}): () => Promise<Result<void, FetchError | StorageError>> {
  return async (): Promise<Result<void, FetchError | StorageError>> => {
    // Step 1: fetch (FRED adapter returns ok with fallback on any error)
    const fetchResult = await deps.fetchRate();
    if (!fetchResult.ok) {
      return err(fetchResult.error);
    }

    // Step 2: persist the returned RateObservation
    const persistResult = await deps.persistRate(fetchResult.value);
    if (!persistResult.ok) {
      return err(persistResult.error);
    }

    return ok(undefined);
  };
}

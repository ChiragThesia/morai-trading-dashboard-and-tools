import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { pricedChainResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/**
 * usePricedChain — polls GET /api/chain/priced every 30s, one wing at a time.
 *
 * SIBLING OF `useChain`, NOT A REPLACEMENT. `useChain` returns the raw two-vendor union — one
 * flat row per contract with `bsmIv` and nothing derived. This one returns that same read already
 * grouped into (root, expiration) cohorts with greeks, the ATM reference and vertical skew solved
 * by the calendar engine, so the browser stops holding a second copy of those formulas. The raw
 * read stays because the 25Δ risk reversal spans BOTH wings and this endpoint serves one.
 *
 * THE WING IS A QUERY PARAM, so it is part of the cache key. Keyed on the path alone, flipping to
 * calls would serve the put response out of cache: every number present, nothing to dash, the
 * whole table the wrong side of the book.
 *
 * And because it IS part of the key, the previous wing's rows are held across the change
 * (`keepPreviousData`). Without that, `data` is undefined for one round trip on every click of a
 * two-state toggle, and the Analyzer's `isLoading` branch replaces the table with "Loading chain…"
 * each time.
 */

// Non-retryable 401 error — mirrors the useChain/useGex pattern (no 3× backoff hang).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

export function usePricedChain(contractType: "C" | "P") {
  return useQuery({
    queryKey: ["chain-priced", contractType],
    queryFn: async () => {
      const res = await apiFetch(`/api/chain/priced?contractType=${contractType}`);

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/chain/priced failed: ${res.status}`);
      }

      return pricedChainResponse.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    placeholderData: keepPreviousData,
    retry: (failureCount: number, error: Error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { tradeHistoryResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useGex / usePositions pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useTradeHistory — fetches GET /api/trade-history every 60s (Trade Ledger).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the response body through `tradeHistoryResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching useCalendars' pattern).
 */
export function useTradeHistory() {
  return useQuery({
    queryKey: ["trade-history"],
    queryFn: async () => {
      const res = await apiFetch("/api/trade-history");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/trade-history failed: ${res.status}`);
      }

      return tradeHistoryResponse.parse(await res.json());
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

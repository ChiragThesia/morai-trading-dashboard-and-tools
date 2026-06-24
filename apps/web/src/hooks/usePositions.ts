import { useQuery } from "@tanstack/react-query";
import { positionsResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useStatus pattern (Pitfall 7: no 3× backoff hang).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * usePositions — polls GET /api/positions every 30s.
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the response body through `positionsResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching useStatus pattern).
 * - Provides positions data for the market strip (book P&L) and Overview screen.
 *
 * Note: brokerPosition does NOT include computed greeks (POSITIONS-01). The Positions
 * screen's full greek deep-dive is deferred to Plan 07 when the backend confirms the
 * computed-greek shape. The Overview and market strip use raw position data only.
 */
export function usePositions() {
  return useQuery({
    queryKey: ["positions"],
    queryFn: async () => {
      const res = await apiFetch("/api/positions");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/positions failed: ${res.status}`);
      }

      return positionsResponse.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

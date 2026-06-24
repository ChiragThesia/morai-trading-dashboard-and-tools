import { useQuery } from "@tanstack/react-query";
import { gexSnapshotResponse } from "@morai/contracts";
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
 * useGex — polls GET /api/analytics/gex every 30s.
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the response body through `gexSnapshotResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching useStatus pattern).
 * - Provides GEX data for the market strip: spot, netGammaAtSpot, flip, callWall, putWall.
 */
export function useGex() {
  return useQuery({
    queryKey: ["gex"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/gex");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/analytics/gex failed: ${res.status}`);
      }

      return gexSnapshotResponse.parse(await res.json());
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

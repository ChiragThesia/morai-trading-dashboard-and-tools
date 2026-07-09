import { useQuery } from "@tanstack/react-query";
import { regimeResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useMacro / useCot pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useRegimeBoard — fetches GET /api/analytics/regime (regime/breadth board, BOARD-01/02).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the body through `regimeResponse.parse()` — no `as` cast (T-24-11).
 * - 401 → throws UnauthorizedError (non-retryable, matching sibling hooks — T-24-12).
 * - Daily cadence, same class as useMacro's twice-daily refetch.
 */
export function useRegimeBoard() {
  return useQuery({
    queryKey: ["regime-board"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/regime");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/analytics/regime failed: ${res.status}`);
      }

      return regimeResponse.parse(await res.json());
    },
    refetchInterval: 1_800_000,
    staleTime: 900_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

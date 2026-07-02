import { useQuery } from "@tanstack/react-query";
import { cotResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useGex / useCalendars pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useCot — fetches GET /api/analytics/cot (CFTC TFF weekly series, newest-first).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the body through `cotResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching sibling hooks).
 * - COT updates once a week (Friday); no aggressive polling — refetch hourly.
 */
export function useCot() {
  return useQuery({
    queryKey: ["cot"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/cot");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/analytics/cot failed: ${res.status}`);
      }

      return cotResponse.parse(await res.json());
    },
    refetchInterval: 3_600_000,
    staleTime: 1_800_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

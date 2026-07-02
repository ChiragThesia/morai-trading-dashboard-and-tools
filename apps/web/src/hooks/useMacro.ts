import { useQuery } from "@tanstack/react-query";
import { macroResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useCot / useGex pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useMacro — fetches GET /api/analytics/macro (FRED rates/curve/vol series + VVIX, D-12).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the body through `macroResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching sibling hooks).
 * - Macro updates twice a day (D-06); refetch tighter than COT's hourly cadence.
 */
export function useMacro() {
  return useQuery({
    queryKey: ["macro"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/macro");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/analytics/macro failed: ${res.status}`);
      }

      return macroResponse.parse(await res.json());
    },
    refetchInterval: 1_800_000,
    staleTime: 900_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

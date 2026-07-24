import { useQuery } from "@tanstack/react-query";
import { newsResponse } from "@morai/contracts";
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
 * useNews — fetches GET /api/analytics/news (latest 50 headlines, newest-first) (D28).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the body through `newsResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching sibling hooks).
 * - The fetch-news cron lands new rows every 5 min; refetch every 60s keeps the
 *   card close behind without hammering the API.
 */
export function useNews() {
  return useQuery({
    queryKey: ["news"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/news");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/analytics/news failed: ${res.status}`);
      }

      return newsResponse.parse(await res.json());
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

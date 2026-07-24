import { useQuery } from "@tanstack/react-query";
import { tradeDetailResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useTradeHistory pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useTradeDetail — fetches GET /api/trade-history/:calendarId/detail ON EXPAND
 * (enabled only when a calendarId is set). Historical data — no polling.
 */
export function useTradeDetail(calendarId: string | null) {
  return useQuery({
    queryKey: ["trade-detail", calendarId],
    enabled: calendarId !== null,
    queryFn: async () => {
      const res = await apiFetch(`/api/trade-history/${calendarId ?? ""}/detail`);

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/trade-history/:id/detail failed: ${res.status}`);
      }

      return tradeDetailResponse.parse(await res.json());
    },
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

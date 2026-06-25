import { useQuery } from "@tanstack/react-query";
import { listCalendarsResponse } from "@morai/contracts";
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
 * useCalendars — fetches GET /api/calendars every 60s.
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses the response body through `listCalendarsResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching useGex / usePositions pattern).
 * - Provides the calendar list for the JournalContainer.
 */
export function useCalendars() {
  return useQuery({
    queryKey: ["calendars"],
    queryFn: async () => {
      const res = await apiFetch("/api/calendars");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/calendars failed: ${res.status}`);
      }

      return listCalendarsResponse.parse(await res.json());
    },
    refetchInterval: 60_000,
    staleTime: 45_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

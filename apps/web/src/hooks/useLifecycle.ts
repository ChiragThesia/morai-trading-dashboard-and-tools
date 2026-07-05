import { useQuery } from "@tanstack/react-query";
import { lifecycleResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useJournal/useStatus pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useLifecycle — polls GET /api/journal/:calendarId/lifecycle every 60s (JRNL-01).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses response body through `lifecycleResponse.parse()` — no `as` cast (parse-don't-cast).
 * - 401 → throws UnauthorizedError (non-retryable), same retry pattern as useJournal.
 * - 60s poll matches UI-SPEC "Journal snapshots" interval (snapshot job is 30-min cadence).
 * - `enabled: !!calendarId` — CRITICAL fix (T-22-10): useJournal/useRuleTags both lack this
 *   guard, firing a request with an empty calendarId when no trade is selected (Phase-20 bug).
 *   This hook must not repeat it.
 */
export function useLifecycle(calendarId: string) {
  return useQuery({
    queryKey: ["lifecycle", calendarId],
    queryFn: async () => {
      const res = await apiFetch(`/api/journal/${calendarId}/lifecycle`);

      // 401 → non-retryable (Pitfall 7: no 3× backoff hang on auth errors)
      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/journal/${calendarId}/lifecycle failed: ${res.status}`);
      }

      // Parse-don't-cast: lifecycleResponse.parse() validates the enriched snapshots shape.
      return lifecycleResponse.parse(await res.json());
    },
    enabled: !!calendarId,
    refetchInterval: 60_000,
    staleTime: 50_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

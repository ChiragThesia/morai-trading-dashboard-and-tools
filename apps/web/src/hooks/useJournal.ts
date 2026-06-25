import { useQuery } from "@tanstack/react-query";
import { journalResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useStatus/useGex pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useJournal — polls GET /api/journal/:calendarId every 60s.
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-09-01).
 * - Parses response body through `journalResponse.parse()` — no `as` cast (parse-don't-cast).
 * - 401 → throws UnauthorizedError (non-retryable), same retry pattern as useStatus.
 * - 60s poll matches UI-SPEC "Journal snapshots" interval (snapshot job is 30-min cadence).
 * - queryKey includes calendarId so each calendar gets its own cache entry.
 */
export function useJournal(calendarId: string) {
  return useQuery({
    queryKey: ["journal", calendarId],
    queryFn: async () => {
      const res = await apiFetch(`/api/journal/${calendarId}`);

      // 401 → non-retryable (Pitfall 7: no 3× backoff hang on auth errors)
      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (!res.ok) {
        throw new Error(`GET /api/journal/${calendarId} failed: ${res.status}`);
      }

      // Parse-don't-cast: journalResponse.parse() validates snapshots array shape.
      return journalResponse.parse(await res.json());
    },
    refetchInterval: 60_000,
    staleTime: 50_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

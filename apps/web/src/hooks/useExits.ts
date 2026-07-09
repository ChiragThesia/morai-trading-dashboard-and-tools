import { useQuery } from "@tanstack/react-query";
import { exitsResponse } from "@morai/contracts";
import type { ExitsResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the usePicker / useCot / useGex pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * useExits — fetches GET /api/exits (the latest exit-advice snapshot for open calendars).
 *
 * Mirrors usePicker.ts exactly (26-05-SUMMARY.md "Next Phase Readiness"):
 * - Uses `apiFetch` from rpc.ts (Bearer token header).
 * - Parses the body through `exitsResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching sibling hooks).
 * - 404 (`{error:"no-verdicts"}`, cold start — no verdict computed anywhere yet) → resolves to
 *   `null`, NOT a thrown error, on the status code alone (never reads the error string, same
 *   status-only check usePicker uses for its own distinct `"no-snapshot"` cold-start body).
 * - Any other non-2xx status → throws a generic Error (retries up to the sibling-hook cap).
 * - Same ~30-min chain-triggered cadence as the picker snapshot this advisor reads alongside.
 */
export function useExits() {
  return useQuery({
    queryKey: ["exits"],
    queryFn: async (): Promise<ExitsResponse | null> => {
      const res = await apiFetch("/api/exits");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        throw new Error(`GET /api/exits failed: ${res.status}`);
      }

      return exitsResponse.parse(await res.json());
    },
    refetchInterval: 1_800_000, // ~30-min chain-triggered snapshot cadence, matches usePicker
    staleTime: 900_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

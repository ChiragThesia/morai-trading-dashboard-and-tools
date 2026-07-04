import { useQuery } from "@tanstack/react-query";
import { pickerSnapshotResponse } from "@morai/contracts";
import type { PickerSnapshotResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

// Non-retryable 401 error — mirrors the useCot / useGex / useMacro pattern (Pitfall 7).
class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("UNAUTHORIZED");
    this.name = "UnauthorizedError";
  }
}

/**
 * usePicker — fetches GET /api/picker/candidates (the latest persisted picker snapshot).
 *
 * - Uses `apiFetch` from rpc.ts (Bearer token header — T-19-23).
 * - Parses the body through `pickerSnapshotResponse.parse()` — no `as` cast.
 * - 401 → throws UnauthorizedError (non-retryable, matching sibling hooks).
 * - 404 (`{error:"no-snapshot"}`, D-18 cold start — no `picker_snapshot` row computed yet) →
 *   resolves to `null`, NOT a thrown error. Analyzer.tsx renders a distinct "Picker warming up"
 *   message for this case; conflating it with the generic fetch-error state would be dishonest
 *   (a transient network failure and "nothing has been computed yet" are different situations).
 * - Any other non-2xx status → throws a generic Error (retries up to the useCot cap).
 * - The chain-triggered picker snapshot refreshes ~13x/day RTH (~30-min cadence, D-04/D-06) — a
 *   much tighter cadence than COT's weekly one, so staleTime/refetchInterval are tuned to match
 *   (vs. useCot's hourly values).
 */
export function usePicker() {
  return useQuery({
    queryKey: ["picker"],
    queryFn: async (): Promise<PickerSnapshotResponse | null> => {
      const res = await apiFetch("/api/picker/candidates");

      if (res.status === 401) {
        throw new UnauthorizedError();
      }

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        throw new Error(`GET /api/picker/candidates failed: ${res.status}`);
      }

      return pickerSnapshotResponse.parse(await res.json());
    },
    refetchInterval: 1_800_000, // ~30-min chain-triggered snapshot cadence (D-04/D-06)
    staleTime: 900_000,
    retry: (failureCount, error) => {
      if (error instanceof UnauthorizedError) return false;
      return failureCount < 3;
    },
  });
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { triggerJobResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/**
 * useRebuildJournal — mutation hook for POST /api/jobs/rebuild-journal/trigger.
 *
 * - Posts `{ calendarId }` to the bearer-guarded jobs group route.
 * - `calendarId` is REQUIRED for rebuild-journal (triggerJobBodyFor enforces this server-side).
 * - Parses the 202 response through `triggerJobResponse` (no `as` cast).
 * - Invalidates the journal query for the given calendar on success so the UI refreshes.
 * - REBUILD-01: the caller (RebuildButton) is responsible for the confirmation dialog.
 */
export function useRebuildJournal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (calendarId: string) => {
      const res = await apiFetch("/api/jobs/rebuild-journal/trigger", {
        method: "POST",
        body: JSON.stringify({ calendarId }),
      });

      if (res.status === 401) {
        throw new Error("UNAUTHORIZED");
      }

      if (!res.ok) {
        throw new Error(`POST /api/jobs/rebuild-journal/trigger failed: ${res.status}`);
      }

      // Parse-don't-cast: triggerJobResponse validates { jobId: string | null }
      return triggerJobResponse.parse(await res.json());
    },
    onSuccess: (_data, calendarId) => {
      // Invalidate the journal query so the UI polls for updated snapshots
      void queryClient.invalidateQueries({ queryKey: ["journal", calendarId] });
    },
  });
}

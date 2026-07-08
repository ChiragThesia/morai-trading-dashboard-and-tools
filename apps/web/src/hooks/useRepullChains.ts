import { useMutation, useQueryClient } from "@tanstack/react-query";
import { triggerJobResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/** How long the fetch→bsm→analytics→gex→picker chain typically takes end-to-end. */
export const REPULL_PIPELINE_MS = 4 * 60 * 1000;

/**
 * useRepullChains — mutation hook for POST /api/jobs/fetch-schwab-chain/trigger.
 *
 * One button, whole pipeline: fetch-schwab-chain chain-triggers compute-bsm-greeks →
 * snapshot-calendars → compute-analytics → compute-gex-snapshot → compute-picker, so a
 * single trigger refreshes chains AND re-scores the picker (24/7 — no RTH gate).
 *
 * - Parses the 202 response through `triggerJobResponse` (no `as` cast).
 * - On success, invalidates the picker query after REPULL_PIPELINE_MS so the rail
 *   refreshes once the chain has plausibly finished (and once immediately, harmless).
 */
export function useRepullChains() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/jobs/fetch-schwab-chain/trigger", {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (res.status === 401) {
        throw new Error("UNAUTHORIZED");
      }

      if (!res.ok) {
        throw new Error(`POST /api/jobs/fetch-schwab-chain/trigger failed: ${res.status}`);
      }

      return triggerJobResponse.parse(await res.json());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["picker"] });
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ["picker"] });
      }, REPULL_PIPELINE_MS);
    },
  });
}

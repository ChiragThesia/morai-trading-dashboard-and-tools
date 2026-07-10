import { useMutation } from "@tanstack/react-query";
import { analyzeAdHocCalendarRequest, analyzeAdHocCalendarResponse } from "@morai/contracts";
import type { AnalyzeAdHocCalendarRequest, AnalyzeAdHocCalendarResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/**
 * useAnalyzeCalendar — mutation hook for POST /api/picker/analyze (Phase 30, D-02).
 *
 * Scores one user-pasted PUT calendar through the real engine (30-04/30-05). Both
 * `{scored:true}` and `{scored:false}` (no stored snapshot / degraded context) are
 * normal, non-error results — the endpoint always returns HTTP 200 for a well-formed
 * request (binding #2). The caller decides the fallback for `scored:false`. Only a
 * genuine network/HTTP failure (e.g. 401, 500, offline) throws.
 */
export function useAnalyzeCalendar() {
  return useMutation({
    mutationFn: async (body: AnalyzeAdHocCalendarRequest): Promise<AnalyzeAdHocCalendarResponse> => {
      const res = await apiFetch("/api/picker/analyze", {
        method: "POST",
        body: JSON.stringify(analyzeAdHocCalendarRequest.parse(body)),
      });

      if (!res.ok) {
        throw new Error(`POST /api/picker/analyze failed: ${res.status}`);
      }

      return analyzeAdHocCalendarResponse.parse(await res.json());
    },
  });
}

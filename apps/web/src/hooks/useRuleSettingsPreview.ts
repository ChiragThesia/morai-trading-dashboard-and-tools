import { useMutation } from "@tanstack/react-query";
import {
  previewRuleOverridesRequest,
  previewRuleOverridesResponse,
} from "@morai/contracts";
import type {
  PreviewRuleOverridesRequest,
  PreviewRuleOverridesResponse,
  RegimeIndicator,
} from "@morai/contracts";
import {
  bandVixTermStructure,
  bandVvix,
  bandVix9dRatio,
  bandHyOas,
  resolveRegimeRuleConfig,
} from "@morai/core";
import type { RegimeBand, RegimeRuleConfig, RegimeRuleOverrides } from "@morai/core";
import { apiFetch } from "../lib/rpc.ts";

/**
 * useRuleSettingsPreview — mutation hook for POST /api/settings/rules/preview (Phase 32-06,
 * B1/B2/B3/B5/B7). Mirrors useAnalyzeCalendar's non-optimistic shape exactly: posts the staged
 * ruleOverrides-shaped body, parses `previewRuleOverridesResponse`, throws only on a genuine
 * HTTP/network failure.
 */
export function useRuleSettingsPreview() {
  return useMutation({
    mutationFn: async (body: PreviewRuleOverridesRequest): Promise<PreviewRuleOverridesResponse> => {
      const res = await apiFetch("/api/settings/rules/preview", {
        method: "POST",
        body: JSON.stringify(previewRuleOverridesRequest.parse(body)),
      });

      if (!res.ok) {
        throw new Error(`POST /api/settings/rules/preview failed: ${res.status}`);
      }

      return previewRuleOverridesResponse.parse(await res.json());
    },
  });
}

export interface RegimeBandPreview {
  readonly id: string;
  readonly before: RegimeBand;
  readonly after: RegimeBand;
}

// Each regime indicator id -> the matching core band function + its RegimeRuleConfig key.
// The banding DECISION is entirely delegated to the real @morai/core functions (T-32-12,
// parity by construction) -- this is only the id-to-function/threshold-pair lookup, not a
// second copy of the calm/warning/crisis logic.
const REGIME_BAND_FNS: Record<string, (value: number, thresholds: RegimeRuleConfig[keyof RegimeRuleConfig]) => RegimeBand> = {
  "vix-term-structure": bandVixTermStructure,
  vvix: bandVvix,
  "vix9d-vix": bandVix9dRatio,
  "hy-oas": bandHyOas,
};

const REGIME_CONFIG_KEY: Record<string, keyof RegimeRuleConfig> = {
  "vix-term-structure": "vixTermStructure",
  vvix: "vvix",
  "vix9d-vix": "vix9dRatio",
  "hy-oas": "hyOas",
};

/**
 * previewRegimeBands — pure client-side re-band (Phase 32-06, B3). Re-bands each on-screen
 * regime indicator's already-fetched value against the STAGED thresholds by calling the actual
 * core band<X> function via `resolveRegimeRuleConfig` (same merge-with-defaults seam the server
 * board use-case uses) -- no server round-trip, no duplicated band logic.
 *
 * An indicator whose id isn't one of the four known regime indicators is returned unchanged
 * (before === after) rather than thrown -- fail-soft, matching Plan 05's explainer lookup idiom.
 */
export function previewRegimeBands(
  stagedRegime: RegimeRuleOverrides | undefined,
  indicators: ReadonlyArray<RegimeIndicator>,
): ReadonlyArray<RegimeBandPreview> {
  const config = resolveRegimeRuleConfig(stagedRegime);
  return indicators.map((indicator) => {
    const bandFn = REGIME_BAND_FNS[indicator.id];
    const configKey = REGIME_CONFIG_KEY[indicator.id];
    if (bandFn === undefined || configKey === undefined) {
      return { id: indicator.id, before: indicator.band, after: indicator.band };
    }
    return { id: indicator.id, before: indicator.band, after: bandFn(indicator.value, config[configKey]) };
  });
}

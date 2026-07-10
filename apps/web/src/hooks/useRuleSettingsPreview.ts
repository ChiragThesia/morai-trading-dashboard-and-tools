import { useMutation } from "@tanstack/react-query";
import type {
  PreviewRuleOverridesRequest,
  PreviewRuleOverridesResponse,
  RegimeIndicator,
} from "@morai/contracts";
import type { RegimeBand, RegimeRuleOverrides } from "@morai/core";

// ponytail: RED-stage stub -- deliberately wrong, replaced by the real implementation in the
// GREEN commit that immediately follows.
export function useRuleSettingsPreview() {
  return useMutation({
    mutationFn: async (_body: PreviewRuleOverridesRequest): Promise<PreviewRuleOverridesResponse> => {
      return { asOf: null, picker: null, exits: null };
    },
  });
}

export interface RegimeBandPreview {
  readonly id: string;
  readonly before: RegimeBand;
  readonly after: RegimeBand;
}

export function previewRegimeBands(
  _stagedRegime: RegimeRuleOverrides | undefined,
  indicators: ReadonlyArray<RegimeIndicator>,
): ReadonlyArray<RegimeBandPreview> {
  return indicators.map((indicator) => ({ id: indicator.id, before: indicator.band, after: indicator.band }));
}

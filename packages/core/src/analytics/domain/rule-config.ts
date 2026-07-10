/**
 * rule-config.ts — pure merge seam for the analytics-owned regime warn/crisis thresholds
 * (Phase 29-06).
 *
 * Mirrors exits/domain/rule-config.ts's per-field `overrides?.field ?? CONSTANT` idiom:
 * resolveRegimeRuleConfig(overrides?) rebuilds the four {warn,crisis} pairs from regime.ts's
 * module constants, falling back per-field to the named constant. Omitting `overrides` (every
 * live call site until 29-12 wires the server) reproduces the constants byte-identically —
 * required for the board's omission regression (T-29-05).
 *
 * Hexagon law (architecture-boundaries §2): imports only this context's own `regime.ts`.
 */

import {
  VIX_TERM_STRUCTURE_WARN,
  VIX_TERM_STRUCTURE_CRISIS,
  VVIX_WARN,
  VVIX_CRISIS,
  VIX9D_RATIO_WARN,
  VIX9D_RATIO_CRISIS,
  HY_OAS_WARN,
  HY_OAS_CRISIS,
} from "./regime.ts";
import type { RegimeThresholds } from "./regime.ts";

export type RegimeRuleOverrides = {
  readonly vixTermStructureWarn?: number;
  readonly vixTermStructureCrisis?: number;
  readonly vvixWarn?: number;
  readonly vvixCrisis?: number;
  readonly vix9dRatioWarn?: number;
  readonly vix9dRatioCrisis?: number;
  readonly hyOasWarn?: number;
  readonly hyOasCrisis?: number;
};

export type RegimeRuleConfig = {
  readonly vixTermStructure: RegimeThresholds;
  readonly vvix: RegimeThresholds;
  readonly vix9dRatio: RegimeThresholds;
  readonly hyOas: RegimeThresholds;
};

/** Rebuilds the four regime threshold pairs from regime.ts's constants, applying per-field overrides. */
export function resolveRegimeRuleConfig(overrides?: RegimeRuleOverrides): RegimeRuleConfig {
  return {
    vixTermStructure: {
      warn: overrides?.vixTermStructureWarn ?? VIX_TERM_STRUCTURE_WARN,
      crisis: overrides?.vixTermStructureCrisis ?? VIX_TERM_STRUCTURE_CRISIS,
    },
    vvix: {
      warn: overrides?.vvixWarn ?? VVIX_WARN,
      crisis: overrides?.vvixCrisis ?? VVIX_CRISIS,
    },
    vix9dRatio: {
      warn: overrides?.vix9dRatioWarn ?? VIX9D_RATIO_WARN,
      crisis: overrides?.vix9dRatioCrisis ?? VIX9D_RATIO_CRISIS,
    },
    hyOas: {
      warn: overrides?.hyOasWarn ?? HY_OAS_WARN,
      crisis: overrides?.hyOasCrisis ?? HY_OAS_CRISIS,
    },
  };
}

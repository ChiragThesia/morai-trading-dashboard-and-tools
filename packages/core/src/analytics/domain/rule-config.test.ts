/**
 * rule-config.test.ts — resolveRegimeRuleConfig pure merge (Phase 29-06).
 *
 * Locked behavior (29-06-PLAN.md):
 *   1. Omission reproduces the four regime.ts threshold pairs byte-identically (deep-equal).
 *   2. A single-field override changes exactly that field; sibling pairs/fields stay default.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveRegimeRuleConfig } from "./rule-config.ts";
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

const DEFAULT_CONFIG = {
  vixTermStructure: { warn: VIX_TERM_STRUCTURE_WARN, crisis: VIX_TERM_STRUCTURE_CRISIS },
  vvix: { warn: VVIX_WARN, crisis: VVIX_CRISIS },
  vix9dRatio: { warn: VIX9D_RATIO_WARN, crisis: VIX9D_RATIO_CRISIS },
  hyOas: { warn: HY_OAS_WARN, crisis: HY_OAS_CRISIS },
};

describe("resolveRegimeRuleConfig — omission reproduces defaults", () => {
  it("no overrides -> deep-equal the regime.ts constants", () => {
    expect(resolveRegimeRuleConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("explicit undefined -> same as omission", () => {
    expect(resolveRegimeRuleConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });

  it("fast-check: every no-overrides call is deep-equal to the constants", () => {
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        expect(resolveRegimeRuleConfig()).toEqual(DEFAULT_CONFIG);
      }),
    );
  });
});

describe("resolveRegimeRuleConfig — single-field override", () => {
  it("vvixWarn overrides only vvix.warn, all else default", () => {
    const config = resolveRegimeRuleConfig({ vvixWarn: 90 });
    expect(config.vvix).toEqual({ warn: 90, crisis: VVIX_CRISIS });
    expect(config.vixTermStructure).toEqual(DEFAULT_CONFIG.vixTermStructure);
    expect(config.vix9dRatio).toEqual(DEFAULT_CONFIG.vix9dRatio);
    expect(config.hyOas).toEqual(DEFAULT_CONFIG.hyOas);
  });

  it("hyOasCrisis overrides only hyOas.crisis, all else default", () => {
    const config = resolveRegimeRuleConfig({ hyOasCrisis: 6.0 });
    expect(config.hyOas).toEqual({ warn: HY_OAS_WARN, crisis: 6.0 });
    expect(config.vixTermStructure).toEqual(DEFAULT_CONFIG.vixTermStructure);
    expect(config.vvix).toEqual(DEFAULT_CONFIG.vvix);
    expect(config.vix9dRatio).toEqual(DEFAULT_CONFIG.vix9dRatio);
  });
});

/**
 * rule-settings contract tests (Phase 29, Plan 29-02).
 *
 * ruleOverrides is the single validation seam the settings PUT route (29-13) and the
 * storage repo (29-08) both parse through — see rule-settings.ts's header for the full
 * design rationale (whitelist + weight-sum + hysteresis-pair invariants).
 */

import { describe, it, expect } from "vitest";
import { ruleOverrides, getRuleSettingsResponse, setRuleOverridesResponse } from "./rule-settings.ts";

// A full 9-weight set that sums to exactly 100 (mirrors rules.ts's live defaults).
const validWeights = {
  slope: 10,
  fwdEdge: 25,
  gexFit: 10,
  eventAdjustment: 5,
  beVsEm: 15,
  deltaNeutral: 15,
  thetaVega: 10,
  vrp: 5,
  debitFit: 5,
};

// ─── Whitelist: unknown keys rejected at every level ────────────────────────────

describe("ruleOverrides — whitelist (.strict())", () => {
  it("accepts an empty object", () => {
    expect(ruleOverrides.safeParse({}).success).toBe(true);
  });

  it("accepts a single scalar override", () => {
    expect(ruleOverrides.safeParse({ picker: { maxOpenCalendars: 8 } }).success).toBe(true);
  });

  it("rejects an unknown top-level key", () => {
    expect(ruleOverrides.safeParse({ foo: 1 }).success).toBe(false);
  });

  it("rejects an unknown key inside picker (excluded knob: slopeNormalizer)", () => {
    const result = ruleOverrides.safeParse({ picker: { slopeNormalizer: 0.5 } });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside exits.take", () => {
    const result = ruleOverrides.safeParse({ exits: { take: { plus20Arm: 0.2 } } });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside regime", () => {
    const result = ruleOverrides.safeParse({ regime: { fooWarn: 1 } });
    expect(result.success).toBe(false);
  });
});

// ─── Reset-per-group sentinel ────────────────────────────────────────────────────

describe("ruleOverrides — reset-per-group (null sentinel)", () => {
  it("accepts a group set to null", () => {
    expect(ruleOverrides.safeParse({ picker: null }).success).toBe(true);
  });

  it("accepts multiple groups, one null one populated", () => {
    const result = ruleOverrides.safeParse({
      picker: null,
      exits: { take: {} },
    });
    expect(result.success).toBe(true);
  });
});

// ─── Weight-sum invariant (all-9-or-none, sum to exactly 100) ───────────────────

describe("ruleOverrides — picker.weights sum-to-100 invariant", () => {
  it("accepts all 9 weights summing to exactly 100", () => {
    const result = ruleOverrides.safeParse({ picker: { weights: validWeights } });
    expect(result.success).toBe(true);
  });

  it("rejects all 9 weights summing to 99", () => {
    const result = ruleOverrides.safeParse({
      picker: { weights: { ...validWeights, slope: 9 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects all 9 weights summing to 101", () => {
    const result = ruleOverrides.safeParse({
      picker: { weights: { ...validWeights, slope: 11 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects fewer than 9 weight keys (all-9-or-none)", () => {
    const { debitFit: _debitFit, ...partial } = validWeights;
    const result = ruleOverrides.safeParse({ picker: { weights: partial } });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown key inside weights", () => {
    const result = ruleOverrides.safeParse({
      picker: { weights: { ...validWeights, backEventBonus: 1 } },
    });
    expect(result.success).toBe(false);
  });
});

// ─── Hysteresis pair invariant — TAKE rungs (disarm < arm) ──────────────────────

describe("ruleOverrides — exits.take hysteresis pairs", () => {
  it("accepts a complete, correctly-ordered plus15 pair", () => {
    const result = ruleOverrides.safeParse({
      exits: { take: { plus15Arm: 0.15, plus15Disarm: 0.13 } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a single-sided edit (arm without disarm)", () => {
    const result = ruleOverrides.safeParse({ exits: { take: { plus15Arm: 0.15 } } });
    expect(result.success).toBe(false);
  });

  it("rejects a single-sided edit (disarm without arm)", () => {
    const result = ruleOverrides.safeParse({ exits: { take: { plus15Disarm: 0.13 } } });
    expect(result.success).toBe(false);
  });

  it("rejects disarm >= arm", () => {
    const result = ruleOverrides.safeParse({
      exits: { take: { plus15Arm: 0.15, plus15Disarm: 0.15 } },
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty take group (no rungs touched)", () => {
    expect(ruleOverrides.safeParse({ exits: { take: {} } }).success).toBe(true);
  });

  it("validates the plus10 and plus5 rungs independently", () => {
    expect(
      ruleOverrides.safeParse({ exits: { take: { plus10Arm: 0.1, plus10Disarm: 0.11 } } })
        .success,
    ).toBe(false);
    expect(
      ruleOverrides.safeParse({ exits: { take: { plus5Arm: 0.05, plus5Disarm: 0.03 } } }).success,
    ).toBe(true);
  });
});

// ─── Hysteresis pair invariant — STOP rungs (disarm > arm, deeper is more negative) ──

describe("ruleOverrides — exits.stop hysteresis pairs", () => {
  it("accepts a complete, correctly-ordered minus50 pair (disarm closer to zero)", () => {
    const result = ruleOverrides.safeParse({
      exits: { stop: { minus50Arm: -0.5, minus50Disarm: -0.48 } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects disarm <= arm (disarm at or beyond arm's depth)", () => {
    const result = ruleOverrides.safeParse({
      exits: { stop: { minus50Arm: -0.5, minus50Disarm: -0.5 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a deeper disarm than arm", () => {
    const result = ruleOverrides.safeParse({
      exits: { stop: { minus50Arm: -0.5, minus50Disarm: -0.52 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a single-sided minus25 edit", () => {
    const result = ruleOverrides.safeParse({ exits: { stop: { minus25Arm: -0.25 } } });
    expect(result.success).toBe(false);
  });
});

// ─── Excluded knobs never parse ──────────────────────────────────────────────────

describe("ruleOverrides — excluded knobs have no schema field", () => {
  it("rejects SLOPE_NORMALIZER under picker", () => {
    expect(ruleOverrides.safeParse({ picker: { SLOPE_NORMALIZER: 0.6 } }).success).toBe(false);
  });

  it("rejects a gexFit credit override", () => {
    expect(ruleOverrides.safeParse({ picker: { gexDampenBaseCredit: 0.5 } }).success).toBe(false);
  });

  it("rejects a fill-haircut override", () => {
    expect(ruleOverrides.safeParse({ picker: { fillWidthFraction: 0.5 } }).success).toBe(false);
  });

  it("rejects a gate-hysteresis-internals override", () => {
    expect(
      ruleOverrides.safeParse({ picker: { gatePenaltyFloorMultiplier: 0.3 } }).success,
    ).toBe(false);
  });

  it("rejects a loss-cooldown override", () => {
    expect(ruleOverrides.safeParse({ picker: { lossCooldownPct: -0.25 } }).success).toBe(false);
  });

  it("rejects a roll-window override under exits", () => {
    expect(ruleOverrides.safeParse({ exits: { rollFrontDteMax: 14 } }).success).toBe(false);
  });
});

// ─── getRuleSettingsResponse / setRuleOverridesResponse — full resolved shape ───

const validRuleConfig = {
  picker: {
    deltaBandMin: -0.49,
    deltaBandMax: -0.3,
    frontDteMin: 21,
    frontDteMax: 36,
    backDteMinGap: 15,
    backDteMaxGap: 90,
    weights: validWeights,
    debitIdealMin: 3200,
    debitIdealMax: 5000,
    vixLadder: { normalMin: 15, elevatedMin: 20, crisisMin: 25 },
    maxOpenCalendars: 6,
    sizingContracts: { low: 2, normal: 2, elevated: 1, crisis: 0 },
  },
  exits: {
    take: {
      plus15Arm: 0.15,
      plus15Disarm: 0.13,
      plus10Arm: 0.1,
      plus10Disarm: 0.08,
      plus5Arm: 0.05,
      plus5Disarm: 0.03,
    },
    stop: {
      minus50Arm: -0.5,
      minus50Disarm: -0.48,
      minus25Arm: -0.25,
      minus25Disarm: -0.23,
    },
  },
  regime: {
    vixTermStructureWarn: 0.9,
    vixTermStructureCrisis: 0.95,
    vvixWarn: 100,
    vvixCrisis: 115,
    vix9dRatioWarn: 1.0,
    vix9dRatioCrisis: 1.1,
    hyOasWarn: 3.0,
    hyOasCrisis: 5.0,
  },
};

describe("getRuleSettingsResponse", () => {
  it("parses { defaults, overrides, effective } with a full resolved shape", () => {
    const result = getRuleSettingsResponse.safeParse({
      defaults: validRuleConfig,
      overrides: {},
      effective: validRuleConfig,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a defaults object missing a required field (not partial)", () => {
    const { maxOpenCalendars: _maxOpenCalendars, ...partialPicker } = validRuleConfig.picker;
    const result = getRuleSettingsResponse.safeParse({
      defaults: { ...validRuleConfig, picker: partialPicker },
      overrides: {},
      effective: validRuleConfig,
    });
    expect(result.success).toBe(false);
  });
});

describe("setRuleOverridesResponse", () => {
  it("parses { overrides, effective }", () => {
    const result = setRuleOverridesResponse.safeParse({
      overrides: { picker: { maxOpenCalendars: 8 } },
      effective: validRuleConfig,
    });
    expect(result.success).toBe(true);
  });
});

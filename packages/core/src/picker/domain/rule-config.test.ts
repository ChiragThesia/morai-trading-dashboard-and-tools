/**
 * rule-config.ts — RED: the picker engine's single pure merge function (29-07-PLAN.md).
 *
 * Invariants locked here:
 *   1. Omitting overrides returns a config whose every field equals its named picker-domain
 *      constant (BT-02 leakage-oracle correctness) — no fresh literals.
 *   2. Every single override field changes exactly that field, all siblings default.
 *   3. Merge is idempotent: feeding a resolved config's own values back as overrides
 *      reproduces the same config (fast-check).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { assertDefined } from "@morai/shared";
import {
  WEIGHT_SLOPE,
  WEIGHT_FWD_EDGE,
  WEIGHT_GEX_FIT,
  WEIGHT_EVENT,
  WEIGHT_BE_VS_EM,
  WEIGHT_DELTA_NEUTRAL,
  WEIGHT_THETA_VEGA,
  WEIGHT_VRP,
  WEIGHT_DEBIT_FIT,
  DEBIT_IDEAL_MIN,
  DEBIT_IDEAL_MAX,
} from "./rules.ts";
import {
  DELTA_BAND_MIN,
  DELTA_BAND_MAX,
  FRONT_DTE_MIN,
  FRONT_DTE_MAX,
  BACK_DTE_MIN_GAP,
  BACK_DTE_MAX_GAP,
} from "./candidate-selection.ts";
import { VIX_LADDER, resolveVixLadder } from "./entry-gate.ts";
import { DEFAULT_TIER_CONTRACTS } from "./sizing.ts";
import { MAX_OPEN_CALENDARS } from "./brakes.ts";
import { resolvePickerRuleConfig } from "./rule-config.ts";
import type { PickerRuleConfig, PickerRuleOverrides } from "./rule-config.ts";

const defaults = resolvePickerRuleConfig();

// ─── Fast-check arbitraries ─────────────────────────────────────────────────

const weightsArb: fc.Arbitrary<PickerRuleConfig["weights"]> = fc.record({
  slope: fc.double({ noNaN: true, min: 0, max: 100 }),
  fwdEdge: fc.double({ noNaN: true, min: 0, max: 100 }),
  gexFit: fc.double({ noNaN: true, min: 0, max: 100 }),
  eventAdjustment: fc.double({ noNaN: true, min: 0, max: 100 }),
  beVsEm: fc.double({ noNaN: true, min: 0, max: 100 }),
  deltaNeutral: fc.double({ noNaN: true, min: 0, max: 100 }),
  thetaVega: fc.double({ noNaN: true, min: 0, max: 100 }),
  vrp: fc.double({ noNaN: true, min: 0, max: 100 }),
  debitFit: fc.double({ noNaN: true, min: 0, max: 100 }),
});

const sizingContractsArb: fc.Arbitrary<PickerRuleConfig["sizingContracts"]> = fc.record({
  low: fc.integer({ min: 0, max: 10 }),
  normal: fc.integer({ min: 0, max: 10 }),
  elevated: fc.integer({ min: 0, max: 10 }),
  crisis: fc.integer({ min: 0, max: 10 }),
});

/** Ascending normalMin < elevatedMin < crisisMin — a valid, contiguous ladder input. */
const vixLadderOverrideArb = fc
  .tuple(
    fc.double({ noNaN: true, min: 1, max: 20 }),
    fc.double({ noNaN: true, min: 1, max: 20 }),
    fc.double({ noNaN: true, min: 1, max: 20 }),
  )
  .map(([base, gap1, gap2]) => ({
    normalMin: base,
    elevatedMin: base + gap1,
    crisisMin: base + gap1 + gap2,
  }));

/** Every field optional-present-or-absent (never explicitly undefined — exactOptionalPropertyTypes). */
const pickerRuleOverridesArb: fc.Arbitrary<PickerRuleOverrides> = fc.record(
  {
    deltaBandMin: fc.double({ noNaN: true, min: -1, max: 0 }),
    deltaBandMax: fc.double({ noNaN: true, min: -1, max: 0 }),
    frontDteMin: fc.integer({ min: 1, max: 60 }),
    frontDteMax: fc.integer({ min: 1, max: 60 }),
    backDteMinGap: fc.integer({ min: 1, max: 120 }),
    backDteMaxGap: fc.integer({ min: 1, max: 120 }),
    weights: weightsArb,
    debitIdealMin: fc.double({ noNaN: true, min: 0, max: 10000 }),
    debitIdealMax: fc.double({ noNaN: true, min: 0, max: 10000 }),
    vixLadder: vixLadderOverrideArb,
    maxOpenCalendars: fc.integer({ min: 0, max: 20 }),
    sizingContracts: sizingContractsArb,
  },
  { requiredKeys: [] },
);

/** Inverse of resolvePickerRuleConfig's shape transform — for the idempotency property. */
function configToOverrides(config: PickerRuleConfig): PickerRuleOverrides {
  const normalRow = config.vixLadder.find((row) => row.tier === "normal");
  const elevatedRow = config.vixLadder.find((row) => row.tier === "elevated");
  const crisisRow = config.vixLadder.find((row) => row.tier === "crisis");
  assertDefined(normalRow, "configToOverrides: normal tier row");
  assertDefined(elevatedRow, "configToOverrides: elevated tier row");
  assertDefined(crisisRow, "configToOverrides: crisis tier row");
  return {
    deltaBandMin: config.deltaBand.min,
    deltaBandMax: config.deltaBand.max,
    frontDteMin: config.frontDte.min,
    frontDteMax: config.frontDte.max,
    backDteMinGap: config.backDteGap.min,
    backDteMaxGap: config.backDteGap.max,
    weights: config.weights,
    debitIdealMin: config.debitBand.idealMin,
    debitIdealMax: config.debitBand.idealMax,
    vixLadder: { normalMin: normalRow.min, elevatedMin: elevatedRow.min, crisisMin: crisisRow.min },
    maxOpenCalendars: config.maxOpenCalendars,
    sizingContracts: config.sizingContracts,
  };
}

// ─── Omission ────────────────────────────────────────────────────────────────

describe("resolvePickerRuleConfig — omission", () => {
  it("omitting overrides returns a config whose every field equals its picker-domain constant", () => {
    const config = resolvePickerRuleConfig();
    expect(config).toEqual({
      weights: {
        slope: WEIGHT_SLOPE,
        fwdEdge: WEIGHT_FWD_EDGE,
        gexFit: WEIGHT_GEX_FIT,
        eventAdjustment: WEIGHT_EVENT,
        beVsEm: WEIGHT_BE_VS_EM,
        deltaNeutral: WEIGHT_DELTA_NEUTRAL,
        thetaVega: WEIGHT_THETA_VEGA,
        vrp: WEIGHT_VRP,
        debitFit: WEIGHT_DEBIT_FIT,
      },
      deltaBand: { min: DELTA_BAND_MIN, max: DELTA_BAND_MAX },
      frontDte: { min: FRONT_DTE_MIN, max: FRONT_DTE_MAX },
      backDteGap: { min: BACK_DTE_MIN_GAP, max: BACK_DTE_MAX_GAP },
      debitBand: { idealMin: DEBIT_IDEAL_MIN, idealMax: DEBIT_IDEAL_MAX },
      vixLadder: VIX_LADDER,
      sizingContracts: DEFAULT_TIER_CONTRACTS,
      maxOpenCalendars: MAX_OPEN_CALENDARS,
    });
  });

  it("an explicit empty overrides object resolves identically to omission", () => {
    expect(resolvePickerRuleConfig({})).toEqual(defaults);
  });
});

// ─── Single-field isolation ──────────────────────────────────────────────────

describe("resolvePickerRuleConfig — single-field isolation", () => {
  it("deltaBandMin only changes deltaBand.min", () => {
    const config = resolvePickerRuleConfig({ deltaBandMin: -0.55 });
    expect(config).toEqual({ ...defaults, deltaBand: { ...defaults.deltaBand, min: -0.55 } });
  });

  it("deltaBandMax only changes deltaBand.max", () => {
    const config = resolvePickerRuleConfig({ deltaBandMax: -0.2 });
    expect(config).toEqual({ ...defaults, deltaBand: { ...defaults.deltaBand, max: -0.2 } });
  });

  it("frontDteMin only changes frontDte.min", () => {
    const config = resolvePickerRuleConfig({ frontDteMin: 10 });
    expect(config).toEqual({ ...defaults, frontDte: { ...defaults.frontDte, min: 10 } });
  });

  it("frontDteMax only changes frontDte.max", () => {
    const config = resolvePickerRuleConfig({ frontDteMax: 50 });
    expect(config).toEqual({ ...defaults, frontDte: { ...defaults.frontDte, max: 50 } });
  });

  it("backDteMinGap only changes backDteGap.min", () => {
    const config = resolvePickerRuleConfig({ backDteMinGap: 5 });
    expect(config).toEqual({ ...defaults, backDteGap: { ...defaults.backDteGap, min: 5 } });
  });

  it("backDteMaxGap only changes backDteGap.max", () => {
    const config = resolvePickerRuleConfig({ backDteMaxGap: 100 });
    expect(config).toEqual({ ...defaults, backDteGap: { ...defaults.backDteGap, max: 100 } });
  });

  it("debitIdealMin only changes debitBand.idealMin", () => {
    const config = resolvePickerRuleConfig({ debitIdealMin: 2500 });
    expect(config).toEqual({ ...defaults, debitBand: { ...defaults.debitBand, idealMin: 2500 } });
  });

  it("debitIdealMax only changes debitBand.idealMax", () => {
    const config = resolvePickerRuleConfig({ debitIdealMax: 6000 });
    expect(config).toEqual({ ...defaults, debitBand: { ...defaults.debitBand, idealMax: 6000 } });
  });

  it("resolvePickerRuleConfig({ maxOpenCalendars: 8 }) overrides only that field", () => {
    const config = resolvePickerRuleConfig({ maxOpenCalendars: 8 });
    expect(config).toEqual({ ...defaults, maxOpenCalendars: 8 });
  });

  it("sizingContracts merges over DEFAULT_TIER_CONTRACTS, other fields untouched", () => {
    const config = resolvePickerRuleConfig({ sizingContracts: { crisis: 1 } });
    expect(config).toEqual({ ...defaults, sizingContracts: { ...defaults.sizingContracts, crisis: 1 } });
  });

  it("resolvePickerRuleConfig({ weights: {...9...} }) replaces the weights map", () => {
    const weights: PickerRuleConfig["weights"] = {
      slope: 1,
      fwdEdge: 2,
      gexFit: 3,
      eventAdjustment: 4,
      beVsEm: 5,
      deltaNeutral: 6,
      thetaVega: 7,
      vrp: 8,
      debitFit: 9,
    };
    const config = resolvePickerRuleConfig({ weights });
    expect(config).toEqual({ ...defaults, weights });
  });

  it("resolvePickerRuleConfig({ vixLadder: { normalMin: 14 } }) yields a rebuilt contiguous ladder", () => {
    const config = resolvePickerRuleConfig({ vixLadder: { normalMin: 14 } });
    expect(config).toEqual({ ...defaults, vixLadder: resolveVixLadder({ normalMin: 14 }) });
  });
});

// ─── Idempotency (fast-check) ─────────────────────────────────────────────────

describe("resolvePickerRuleConfig — idempotency", () => {
  it("feeding a resolved config's own values back as overrides yields the same config", () => {
    fc.assert(
      fc.property(pickerRuleOverridesArb, (overrides) => {
        const config = resolvePickerRuleConfig(overrides);
        const again = resolvePickerRuleConfig(configToOverrides(config));
        expect(again).toEqual(config);
      }),
    );
  });
});

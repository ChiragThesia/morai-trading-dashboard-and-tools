/**
 * exit-rules.ts — RED: the typed exit-rule registry (EXIT_PRECEDENCE + threshold/hysteresis
 * constants).
 *
 * Invariants locked here:
 *   1. EXIT_PRECEDENCE is exhaustive over every EXIT_RULE_METADATA id, no duplicates, no
 *      unknown id.
 *   2. Threshold + hysteresis constants equal the 26-CONTEXT.md-locked literals EXACTLY.
 *   3. Refuted picker criteria (IV-rank, IV-differential band, debit-%-of-back) never appear
 *      as an exit rule id/label/rationale (Phase-19 guard, mirrored here per 26-02-PLAN.md).
 */

import { describe, it, expect } from "vitest";
import {
  EXIT_RULE_METADATA,
  EXIT_PRECEDENCE,
  TAKE_RUNGS,
  STOP_RUNGS,
  TERM_INVERSION_MIN,
  TERM_INVERSION_DISARM,
  GAMMA_OFF_STRIKE,
  GAMMA_OFF_STRIKE_DISARM,
  GAMMA_FRONT_DTE_MAX,
  EVT_BLACKOUT_DAYS,
  ROLL_FRONT_DTE_MAX,
  ROLL_SPOT_BAND,
  ROLL_PROFIT_MAX,
  ROLL_REPLACEMENT_DTE_MIN,
  ROLL_REPLACEMENT_DTE_MAX,
} from "./exit-rules.ts";

describe("EXIT_PRECEDENCE — registry invariants", () => {
  it("is exhaustive over every EXIT_RULE_METADATA id, no duplicates, no unknown id", () => {
    const registryIds = EXIT_RULE_METADATA.map((r) => r.id).sort();
    const precedenceIds = [...EXIT_PRECEDENCE].sort();
    expect(precedenceIds).toEqual(registryIds);
    expect(new Set(EXIT_PRECEDENCE).size).toBe(EXIT_PRECEDENCE.length);
  });

  it("encodes the exact order STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD", () => {
    expect(EXIT_PRECEDENCE).toEqual(["stop", "evt", "gamma", "term", "take", "roll", "hold"]);
  });

  it("every rule row carries a non-empty rationale and source (provenance required)", () => {
    for (const rule of EXIT_RULE_METADATA) {
      expect(rule.rationale.length).toBeGreaterThan(0);
      expect(rule.source.length).toBeGreaterThan(0);
    }
  });

  it("REFUTED picker criteria are never encoded as exit rules (Phase-19 guard, mirrored)", () => {
    const text = EXIT_RULE_METADATA.flatMap((r) => [r.id, r.label, r.rationale])
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/iv[\s-]?rank/);
    expect(text).not.toMatch(/iv[\s-]?percentile/);
    expect(text).not.toMatch(/25[\s]?[-–][\s]?40\s?%/); // "fair debit 25-40% of back premium"
    expect(text).not.toMatch(/[-−]1\s?%?\s?to\s?[-−]3\s?%/); // "−1% to −3% ideal band"
    const ids = EXIT_RULE_METADATA.map((r) => r.id);
    expect(ids).not.toContain("ivRank");
    expect(ids).not.toContain("debitPctOfBack");
    expect(ids).not.toContain("ivDifferentialBand");
  });
});

describe("Threshold + hysteresis constants — locked literals (26-CONTEXT.md)", () => {
  it("TAKE_RUNGS: +5/+10/+15, disarm 2pp below each, ordered highest→lowest", () => {
    expect(TAKE_RUNGS).toEqual([
      { label: "+15%", arm: 0.15, disarm: 0.13 },
      { label: "+10%", arm: 0.1, disarm: 0.08 },
      { label: "+5%", arm: 0.05, disarm: 0.03 },
    ]);
  });

  it("STOP_RUNGS: -25/-50, disarm 2pp above each, ordered deepest→shallowest", () => {
    expect(STOP_RUNGS).toEqual([
      { label: "-50%", arm: -0.5, disarm: -0.48 },
      { label: "-25%", arm: -0.25, disarm: -0.23 },
    ]);
  });

  it("TERM inversion arm/disarm", () => {
    expect(TERM_INVERSION_MIN).toBe(0.005);
    expect(TERM_INVERSION_DISARM).toBe(0.003);
  });

  it("GAMMA off-strike arm/disarm + front-DTE ceiling", () => {
    expect(GAMMA_OFF_STRIKE).toBe(0.02);
    expect(GAMMA_OFF_STRIKE_DISARM).toBe(0.015);
    expect(GAMMA_FRONT_DTE_MAX).toBe(7);
  });

  it("EVT blackout window matches the picker's EVENT_BLACKOUT_DAYS value", () => {
    expect(EVT_BLACKOUT_DAYS).toBe(3);
  });

  it("ROLL gate + replacement window thresholds", () => {
    expect(ROLL_FRONT_DTE_MAX).toBe(14);
    expect(ROLL_SPOT_BAND).toBe(0.01);
    expect(ROLL_PROFIT_MAX).toBe(0.15);
    expect(ROLL_REPLACEMENT_DTE_MIN).toBe(14);
    expect(ROLL_REPLACEMENT_DTE_MAX).toBe(21);
  });
});

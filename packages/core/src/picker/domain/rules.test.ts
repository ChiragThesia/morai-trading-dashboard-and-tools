/**
 * rules.ts — RED: the typed rule registry (gates + weighted scores + experimental).
 *
 * Invariants locked here:
 *   1. Active score-rule weights sum to EXACTLY 100.
 *   2. Refuted criteria (Phase-19 research, `.planning/research/calendar-selection-criteria.md`)
 *      can never appear as rule ids/labels — the guard test names them verbatim.
 *   3. Registry composition: 2 active gates, 5 active scores, 4 experimental.
 *   4. gexFitFraction prefers the near-term (≤45d) level set, falls back to all-expiry,
 *      and awards dampen-regime / in-range / wall-pin credits.
 *   5. isLiquidQuote enforces spread ≤10% of mid AND OI ≥ 100.
 *   6. Experimental evaluators are null-honest (no fabricated values).
 */

import { describe, it, expect } from "vitest";
import {
  RULE_SET_METADATA,
  gexFitFraction,
  isLiquidQuote,
  vrpValue,
  slopePercentileValue,
  backEventBonusValue,
  thetaVegaValue,
  deltaNeutralFraction,
  WEIGHT_FWD_EDGE,
  WEIGHT_SLOPE,
  WEIGHT_DELTA_NEUTRAL,
  GEX_WALL_PIN_PTS,
} from "./rules.ts";
import type { GexContextForPicker } from "../application/ports.ts";

function gexCtx(overrides: Partial<GexContextForPicker> = {}): GexContextForPicker {
  return {
    flip: 7480,
    callWall: 8000,
    putWall: 7000,
    netGammaAtSpot: -10,
    absGammaStrike: 7500,
    nearTermFlip: 7486,
    nearTermCallWall: 7500,
    nearTermPutWall: 7450,
    computedAt: new Date("2026-07-08T17:00:00.000Z"),
    ...overrides,
  };
}

describe("RULE_SET_METADATA — registry invariants", () => {
  it("active score weights sum to exactly 100", () => {
    const total = RULE_SET_METADATA
      .filter((rule) => rule.kind === "score" && rule.status === "active")
      .reduce((sum, rule) => sum + rule.weight, 0);
    expect(total).toBe(100);
  });

  it("composition: 2 active gates, 6 active scores, 4 experimental", () => {
    const gates = RULE_SET_METADATA.filter((r) => r.kind === "gate" && r.status === "active");
    const scores = RULE_SET_METADATA.filter((r) => r.kind === "score" && r.status === "active");
    const experimental = RULE_SET_METADATA.filter((r) => r.status === "experimental");
    expect(gates.map((r) => r.id).sort()).toEqual(["liquidity", "net-theta-positive"]);
    expect(scores.map((r) => r.id).sort()).toEqual(
      ["beVsEm", "deltaNeutral", "eventAdjustment", "fwdEdge", "gexFit", "slope"],
    );
    expect(experimental.map((r) => r.id).sort()).toEqual(
      ["backEventBonus", "slopePercentile", "thetaVega", "vrp"],
    );
  });

  it("experimental rules carry weight 0 (display-only until PICK-04 calibration)", () => {
    for (const rule of RULE_SET_METADATA.filter((r) => r.status === "experimental")) {
      expect(rule.weight).toBe(0);
    }
  });

  it("REFUTED criteria are never encoded as rules (Phase-19 guard)", () => {
    const text = RULE_SET_METADATA
      .flatMap((r) => [r.id, r.label, r.rationale])
      .join(" ")
      .toLowerCase();
    // Verbatim refuted list from .planning/research/calendar-selection-criteria.md:26-32
    expect(text).not.toMatch(/iv[\s-]?rank/);
    expect(text).not.toMatch(/iv[\s-]?percentile/);
    expect(text).not.toMatch(/25[\s]?[-–][\s]?40\s?%/); // "fair debit 25-40% of back premium"
    expect(text).not.toMatch(/[-−]1\s?%?\s?to\s?[-−]3\s?%/); // "−1% to −3% ideal band"
    const ids = RULE_SET_METADATA.map((r) => r.id);
    expect(ids).not.toContain("ivRank");
    expect(ids).not.toContain("debitPctOfBack");
    expect(ids).not.toContain("ivDifferentialBand");
  });

  it("every rule row carries a non-empty rationale and source (provenance required)", () => {
    for (const rule of RULE_SET_METADATA) {
      expect(rule.rationale.length).toBeGreaterThan(0);
      expect(rule.source.length).toBeGreaterThan(0);
    }
  });
});

describe("gexFitFraction — near-term placement (spot-bracketed walls + flip regime)", () => {
  it("returns 0 when the GEX context is null (degraded context, never silent credit)", () => {
    expect(gexFitFraction(7450, 7490, null)).toBe(0);
  });

  it("full credit: spot above near-term flip, strike in [PW45, CW45], pinned at a wall", () => {
    // spot 7490 > ntFlip 7486 (+0.5); K=7450 ∈ [7450,7500] (+0.3); |K−ntPW|=0 ≤ pin pts (+0.2)
    expect(gexFitFraction(7450, 7490, gexCtx())).toBeCloseTo(1.0, 10);
  });

  it("below the near-term flip loses the dampen credit", () => {
    // spot 7470 < ntFlip 7486 → no 0.5 base; K 7450 in range (+0.3) and pinned (+0.2)
    expect(gexFitFraction(7450, 7470, gexCtx())).toBeCloseTo(0.5, 10);
  });

  it("in-range but unpinned strike earns base + range only", () => {
    // K 7475: in [7450,7500], 25 pts from both walls (> pin pts), spot above flip
    expect(GEX_WALL_PIN_PTS).toBeLessThan(25);
    expect(gexFitFraction(7475, 7490, gexCtx())).toBeCloseTo(0.8, 10);
  });

  it("falls back to ALL-EXPIRY flip/walls when the near-term set is entirely null", () => {
    const ctx = gexCtx({ nearTermFlip: null, nearTermCallWall: null, nearTermPutWall: null });
    // all-expiry: flip 7480, walls [7000, 8000]. spot 7490 > 7480 (+0.5); K 7450 in range (+0.3);
    // 450 pts from PW, 550 from CW → no pin.
    expect(gexFitFraction(7450, 7490, ctx)).toBeCloseTo(0.8, 10);
  });

  it("out-of-range strike earns only the regime credit", () => {
    // K 7600 > ntCW 7500 → not in range, not pinned at 100 pts; spot above flip
    expect(gexFitFraction(7600, 7490, gexCtx())).toBeCloseTo(0.5, 10);
  });
});

describe("isLiquidQuote — spread ≤ 10% of mid AND OI ≥ 100", () => {
  it("passes a tight, well-populated quote", () => {
    expect(isLiquidQuote({ bid: 9.8, ask: 10.2, openInterest: 150 })).toBe(true);
  });

  it("fails a wide market (spread > 10% of mid)", () => {
    expect(isLiquidQuote({ bid: 8, ask: 12, openInterest: 5000 })).toBe(false); // 40% of mid
  });

  it("fails thin open interest", () => {
    expect(isLiquidQuote({ bid: 9.9, ask: 10.1, openInterest: 99 })).toBe(false);
  });

  it("fails a non-positive mid (no market)", () => {
    expect(isLiquidQuote({ bid: 0, ask: 0, openInterest: 1000 })).toBe(false);
  });
});

describe("experimental evaluators — null-honest", () => {
  it("vrpValue = frontIV − RV20; null when RV is null", () => {
    expect(vrpValue(0.14, 0.11)).toBeCloseTo(0.03, 12);
    expect(vrpValue(0.14, null)).toBeNull();
  });

  it("slopePercentileValue ranks against history; null on empty history", () => {
    expect(slopePercentileValue(0.2, [0.1, 0.15, 0.25])).toBeCloseTo((100 * 2) / 3, 10);
    expect(slopePercentileValue(0.2, [])).toBeNull();
  });

  it("backEventBonusValue is 1 when the back leg spans an event the front does not, else 0", () => {
    expect(backEventBonusValue(["FOMC"])).toBe(1);
    expect(backEventBonusValue([])).toBe(0);
  });
});

describe("thetaVegaValue (experimental — θ/vega carry ratio)", () => {
  it("returns theta/vega for a normal candidate", () => {
    expect(thetaVegaValue(10, 50)).toBeCloseTo(0.2, 10);
  });

  it("is null-honest when vega is zero (never Infinity/NaN)", () => {
    expect(thetaVegaValue(10, 0)).toBeNull();
  });

  it("ships in RULE_SET_METADATA as an experimental weight-0 row", () => {
    const row = RULE_SET_METADATA.find((r) => r.id === "thetaVega");
    expect(row).toBeDefined();
    expect(row?.kind).toBe("experimental");
    expect(row?.weight).toBe(0);
    expect(row?.status).toBe("experimental");
  });
});

describe("deltaNeutralFraction (Δ-neutrality score — user-locked 2026-07-08)", () => {
  it("is 1 at perfectly flat delta and decays linearly to 0 at |Δ| ≥ 10", () => {
    expect(deltaNeutralFraction(0)).toBe(1);
    expect(deltaNeutralFraction(-1.8)).toBeCloseTo(0.82, 10);
    expect(deltaNeutralFraction(4.2)).toBeCloseTo(0.58, 10);
    expect(deltaNeutralFraction(-15)).toBe(0);
  });

  it("weights rebalanced: fwdEdge 30, slope 25, deltaNeutral 10 — sum still 100", () => {
    expect(WEIGHT_FWD_EDGE).toBe(30);
    expect(WEIGHT_SLOPE).toBe(25);
    expect(WEIGHT_DELTA_NEUTRAL).toBe(10);
  });
});

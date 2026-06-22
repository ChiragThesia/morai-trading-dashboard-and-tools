/**
 * percentile-rank domain — example tests (Phase 6, Plan 06-03).
 *
 * `percentileRank(value, history)` returns an INCLUSIVE (weak) percentile in [0, 100]:
 *   rank = 100 · (count of history values ≤ value) / history.length
 * The caller (06-05) passes the trailing window (≤ 252 prior values, all-available-if-shorter)
 * and excludes null risk_reversal values. Empty history → 100 (a lone observation is the 100th
 * percentile of the inclusive set {value} once it is added). Forward-only.
 *
 * NOTE (deviation from 06-01 RED scaffold): the scaffold used a [0,1] scale and null-on-empty.
 * The 06-03 plan <behavior> locks the [0,100] scale and the empty→100 sentinel; these example
 * tests were updated to the locked contract (order of authority: plan > scaffold).
 */

import { describe, it, expect } from "vitest";
import { percentileRank } from "./percentile-rank.ts";

describe("percentileRank", () => {
  it("returns the inclusive percentile of a value within its trailing history", () => {
    // value equal to the max of a 5-element history → inclusive percentile = 100
    const history = [0.01, 0.02, 0.03, 0.04, 0.05];
    expect(percentileRank(0.05, history)).toBeCloseTo(100, 5);
  });

  it("returns the inclusive percentile for a mid-range value", () => {
    // 3 of 5 values ≤ 0.03 → 60
    const history = [0.01, 0.02, 0.03, 0.04, 0.05];
    expect(percentileRank(0.03, history)).toBeCloseTo(60, 5);
  });

  it("returns 75 for value at the 3rd of 4 (plan worked example)", () => {
    const history = [0.01, 0.02, 0.03, 0.04];
    expect(percentileRank(0.03, history)).toBeCloseTo(75, 5);
  });

  it("returns 100 when the value exceeds every history value", () => {
    const history = [0.01, 0.02, 0.03, 0.04];
    expect(percentileRank(0.99, history)).toBeCloseTo(100, 5);
  });

  it("returns 0 when the value is below every history value", () => {
    const history = [0.01, 0.02, 0.03, 0.04];
    expect(percentileRank(-0.01, history)).toBeCloseTo(0, 5);
  });

  it("returns 100 for empty history (first observation ever, forward-only sentinel)", () => {
    expect(percentileRank(0.03, [])).toBeCloseTo(100, 5);
  });

  it("counts repeated values inclusively", () => {
    // history has three 0.03s; value 0.03 → all of them count (≤) → 3/3 = 100
    expect(percentileRank(0.03, [0.03, 0.03, 0.03])).toBeCloseTo(100, 5);
    // value 0.02 below all three → 0
    expect(percentileRank(0.02, [0.03, 0.03, 0.03])).toBeCloseTo(0, 5);
  });
});

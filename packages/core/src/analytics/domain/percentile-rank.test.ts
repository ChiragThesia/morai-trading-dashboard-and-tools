/**
 * percentile-rank domain — RED scaffold (Phase 6, Plan 06-01 Task 3).
 *
 * `percentileRank` is NOT YET IMPLEMENTED — 06-03 turns this green.
 * These tests RUN and FAIL for the RIGHT reason (the function under test does not exist),
 * seeding the inclusive trailing-window percentile contract 06-03 must satisfy.
 */

import { describe, it, expect } from "vitest";
// RED: this import resolves to a function that does not exist yet (06-03 implements it).
import { percentileRank } from "./percentile-rank.ts";

describe("percentileRank", () => {
  it("returns the inclusive percentile of a value within its trailing history", () => {
    // value equal to the max of a 5-element history → inclusive percentile = 1.0
    const history = [0.01, 0.02, 0.03, 0.04, 0.05];
    expect(percentileRank(0.05, history)).toBeCloseTo(1.0, 5);
  });

  it("returns the inclusive percentile for a mid-range value", () => {
    // 3 of 5 values ≤ 0.03 → 0.6 inclusive
    const history = [0.01, 0.02, 0.03, 0.04, 0.05];
    expect(percentileRank(0.03, history)).toBeCloseTo(0.6, 5);
  });

  it("returns null when there is no trailing history", () => {
    expect(percentileRank(0.03, [])).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { classifyRegime } from "./gex-regime.ts";

/**
 * gex-regime.test.ts — TDD RED: classifyRegime behavior contract.
 *
 * - AMPLIFY when netGammaAtSpot < 0  (dealer is short gamma → amplifies moves)
 * - DAMPEN when netGammaAtSpot >= 0  (dealer is long gamma → dampens moves)
 *
 * Reference value from gex-snapshot.json: tot = −57,047,301,908 → AMPLIFY
 * (the "tot" field maps to netGammaAtSpot in the API response).
 */

describe("classifyRegime", () => {
  it("returns AMPLIFY for negative net gamma (reference: −$47B from snapshot)", () => {
    // Reference from mockups/gex-snapshot.json: tot ≈ −57B
    expect(classifyRegime(-57_047_301_908)).toBe("AMPLIFY");
  });

  it("returns AMPLIFY for any negative netGammaAtSpot", () => {
    expect(classifyRegime(-1)).toBe("AMPLIFY");
    expect(classifyRegime(-0.001)).toBe("AMPLIFY");
    expect(classifyRegime(-1_000_000_000)).toBe("AMPLIFY");
  });

  it("returns DAMPEN for zero netGammaAtSpot", () => {
    expect(classifyRegime(0)).toBe("DAMPEN");
  });

  it("returns DAMPEN for any positive netGammaAtSpot", () => {
    expect(classifyRegime(1)).toBe("DAMPEN");
    expect(classifyRegime(0.001)).toBe("DAMPEN");
    expect(classifyRegime(1_000_000_000)).toBe("DAMPEN");
  });
});

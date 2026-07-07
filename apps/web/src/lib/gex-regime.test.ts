import { describe, it, expect } from "vitest";
import { classifyRegime, zeroDteGex } from "./gex-regime.ts";

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

describe("zeroDteGex", () => {
  const byExpiry = [
    { date: "2026-07-07", gex: -9.84 },
    { date: "2026-07-08", gex: 2.1 },
  ];

  it("returns the byExpiry net gex whose date matches the snapshot's ET calendar date", () => {
    // 19:46Z on Jul 7 = 15:46 ET Jul 7
    expect(zeroDteGex(byExpiry, "2026-07-07T19:46:00.000Z")).toBe(-9.84);
  });

  it("uses the ET date, not the UTC date (00:30Z next-day = same ET trading day)", () => {
    // 00:30Z Jul 8 = 20:30 ET Jul 7 → 0DTE is still Jul 7
    expect(zeroDteGex(byExpiry, "2026-07-08T00:30:00.000Z")).toBe(-9.84);
  });

  it("returns null when no byExpiry entry matches (expiry already rolled off)", () => {
    expect(zeroDteGex(byExpiry, "2026-07-09T14:00:00.000Z")).toBeNull();
    expect(zeroDteGex([], "2026-07-07T14:00:00.000Z")).toBeNull();
  });

  it("returns null on an unparseable computedAt", () => {
    expect(zeroDteGex(byExpiry, "not-a-date")).toBeNull();
  });
});

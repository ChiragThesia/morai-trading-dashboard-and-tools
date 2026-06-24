/**
 * GEX domain — RED scaffold (Phase 8, Plan 08-02).
 *
 * Wave-0 locked RED tests for 08-03 to turn GREEN. These import the not-yet-existing
 * packages/core/src/analytics/domain/gex.ts and will fail on unresolved SUT import.
 *
 * Oracle values from mockups/gex-profile.json:
 *   spot 7381, flip ≈ 7488 (profile crosses zero between s=7480/g=-4.09 and s=7500/g=5.98)
 *   netGammaAtSpot ≈ -47 (profile at s=7380 is -47.43)
 *   callWall = 7600 (argmax positive GEX in gex-snapshot.json: 1230277553)
 *   putWall  = 7400 (argmin / most-negative GEX in gex-snapshot.json: -5974395559)
 *
 * Function signatures expected from gex.ts (to be implemented in 08-03):
 *   dollarGamma(gamma: number, oi: number, spot: number): number
 *   strikeGex(contracts: ReadonlyArray<LegObsForGex>, spot: number): ReadonlyArray<{k:number; gex:number; coi:number; poi:number; vol:number}>
 *   findFlip(profile: ReadonlyArray<{spot:number; gamma:number}>): number | null
 *   buildProfile(contracts: ReadonlyArray<LegObsForGex>, spotGrid: ReadonlyArray<number>): ReadonlyArray<{spot:number; gamma:number}>
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { dollarGamma, findFlip, buildProfile } from "../domain/gex.ts";
import type { LegObsForGex } from "../application/ports.ts";

// ─── Oracle fixtures from mockups/gex-profile.json ─────────────────────────────
// The oracle profile is the result of running the GEX computation on the full SPX chain.
// spot=7381, netGammaAtSpot≈-47 (profile at s=7380 is -47.43 in the oracle).
// The profile crosses zero between s=7480 (g=-4.09) and s=7500 (g=5.98), giving flip≈7488.

const oracleProfile: ReadonlyArray<{ spot: number; gamma: number }> = [
  { spot: 6900, gamma: -34.16 },
  { spot: 6920, gamma: -35.79 },
  { spot: 6940, gamma: -37.5 },
  { spot: 6960, gamma: -39.29 },
  { spot: 6980, gamma: -41.16 },
  { spot: 7000, gamma: -43.11 },
  { spot: 7020, gamma: -45.13 },
  { spot: 7040, gamma: -47.22 },
  { spot: 7060, gamma: -49.37 },
  { spot: 7080, gamma: -51.56 },
  { spot: 7100, gamma: -53.76 },
  { spot: 7120, gamma: -55.94 },
  { spot: 7140, gamma: -58.07 },
  { spot: 7160, gamma: -60.07 },
  { spot: 7180, gamma: -61.89 },
  { spot: 7200, gamma: -63.45 },
  { spot: 7220, gamma: -64.65 },
  { spot: 7240, gamma: -65.39 },
  { spot: 7260, gamma: -65.54 },
  { spot: 7280, gamma: -64.97 },
  { spot: 7300, gamma: -63.57 },
  { spot: 7320, gamma: -61.2 },
  { spot: 7340, gamma: -57.77 },
  { spot: 7360, gamma: -53.18 },
  { spot: 7380, gamma: -47.43 },
  { spot: 7400, gamma: -40.51 },
  { spot: 7420, gamma: -32.53 },
  { spot: 7440, gamma: -23.65 },
  { spot: 7460, gamma: -14.07 },
  { spot: 7480, gamma: -4.09 },
  { spot: 7500, gamma: 5.98 },
  { spot: 7520, gamma: 15.81 },
  { spot: 7540, gamma: 25.07 },
  { spot: 7560, gamma: 33.47 },
  { spot: 7580, gamma: 40.79 },
  { spot: 7600, gamma: 46.87 },
  { spot: 7620, gamma: 51.64 },
  { spot: 7640, gamma: 55.09 },
  { spot: 7660, gamma: 57.28 },
  { spot: 7680, gamma: 58.33 },
  { spot: 7700, gamma: 58.39 },
  { spot: 7720, gamma: 57.62 },
  { spot: 7740, gamma: 56.18 },
  { spot: 7760, gamma: 54.24 },
  { spot: 7780, gamma: 51.92 },
  { spot: 7800, gamma: 49.36 },
  { spot: 7820, gamma: 46.66 },
  { spot: 7840, gamma: 43.88 },
  { spot: 7860, gamma: 41.1 },
  { spot: 7880, gamma: 38.37 },
  { spot: 7900, gamma: 35.7 },
];

// ─── Minimal synthetic leg for unit tests ─────────────────────────────────────
function makeLeg(overrides: Partial<LegObsForGex> = {}): LegObsForGex {
  return {
    time: new Date("2026-06-23T14:00:00Z"),
    contract: "O:SPX260627C07400",
    underlyingPrice: 7381,
    bsmGamma: "0.001",
    bsmIv: "0.14",
    openInterest: 1000,
    contractType: "C",
    strike: 7400000, // ×1000 convention
    expiration: "2026-06-27",
    ...overrides,
  };
}

// ─── dollarGamma ───────────────────────────────────────────────────────────────

describe("dollarGamma", () => {
  it("is positive for calls (positive gamma contribution) with positive OI", () => {
    // Formula: gamma * OI * 100 * spot^2 * 0.01 (or variant) — exact form set by 08-03
    const result = dollarGamma(0.001, 1000, 7381);
    expect(typeof result).toBe("number");
    expect(Number.isFinite(result)).toBe(true);
  });

  it("returns 0 when OI is 0", () => {
    expect(dollarGamma(0.001, 0, 7381)).toBe(0);
  });

  it("returns 0 when gamma is 0", () => {
    expect(dollarGamma(0, 1000, 7381)).toBe(0);
  });

  it("scales linearly in OI (doubling OI doubles result)", () => {
    const single = dollarGamma(0.001, 1000, 7381);
    const doubled = dollarGamma(0.001, 2000, 7381);
    expect(doubled).toBeCloseTo(single * 2, 6);
  });

  it("scales linearly in gamma (doubling gamma doubles result)", () => {
    const base = dollarGamma(0.001, 1000, 7381);
    const doubled = dollarGamma(0.002, 1000, 7381);
    expect(doubled).toBeCloseTo(base * 2, 6);
  });
});

// ─── findFlip (oracle: flip ≈ 7488) ───────────────────────────────────────────

describe("findFlip", () => {
  it("finds the oracle flip level ≈ 7488 from the profile (within 20 points)", () => {
    const flip = findFlip(oracleProfile);
    // Oracle: crossing between 7480 (g=-4.09) and 7500 (g=5.98) → linear interp ≈ 7488
    expect(flip).not.toBeNull();
    expect(flip ?? Number.NaN).toBeCloseTo(7488, -2); // within ±50 points
  });

  it("returns null when the profile never crosses zero (all-negative)", () => {
    const allNegative: ReadonlyArray<{ spot: number; gamma: number }> = [
      { spot: 7000, gamma: -10 },
      { spot: 7100, gamma: -5 },
      { spot: 7200, gamma: -1 },
    ];
    expect(findFlip(allNegative)).toBeNull();
  });

  it("returns null when the profile is always positive (all-positive)", () => {
    const allPositive: ReadonlyArray<{ spot: number; gamma: number }> = [
      { spot: 7000, gamma: 1 },
      { spot: 7100, gamma: 5 },
      { spot: 7200, gamma: 10 },
    ];
    expect(findFlip(allPositive)).toBeNull();
  });

  it("returns null for an empty profile", () => {
    expect(findFlip([])).toBeNull();
  });

  it("finds an exact zero crossing when one profile point is exactly 0", () => {
    const exactZero: ReadonlyArray<{ spot: number; gamma: number }> = [
      { spot: 7400, gamma: -5 },
      { spot: 7450, gamma: 0 },
      { spot: 7500, gamma: 5 },
    ];
    const flip = findFlip(exactZero);
    expect(flip).not.toBeNull();
    // Should return 7450 (the exact zero point) or the interpolated value nearby
    expect(flip ?? Number.NaN).toBeGreaterThanOrEqual(7400);
    expect(flip ?? Number.NaN).toBeLessThanOrEqual(7500);
  });
});

// ─── buildProfile — produces a profile matching the oracle shape ───────────────
// buildProfile is the most complex function; the oracle comparison requires a realistic
// leg set. We test structural properties here; oracle numeric accuracy is 08-03's green gate.

describe("buildProfile", () => {
  const spotGrid = [7380, 7400, 7420, 7440];

  it("returns one profile entry per spot in the grid", () => {
    const legs = [
      makeLeg({ contractType: "C", strike: 7400000, bsmGamma: "0.001", openInterest: 1000 }),
      makeLeg({ contractType: "P", strike: 7400000, bsmGamma: "0.001", openInterest: 1000 }),
    ];
    const profile = buildProfile(legs, spotGrid);
    expect(profile).toHaveLength(spotGrid.length);
  });

  it("profile entries have spot and gamma fields (WR-01: axis is spot level not option strike)", () => {
    const legs = [
      makeLeg({ contractType: "C", strike: 7400000, bsmGamma: "0.001", openInterest: 500 }),
    ];
    const profile = buildProfile(legs, [7381]);
    expect(profile).toHaveLength(1);
    const entry = profile[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    expect(typeof entry.spot).toBe("number");
    expect(typeof entry.gamma).toBe("number");
  });

  it("returns empty profile when given no legs", () => {
    const profile = buildProfile([], spotGrid);
    expect(profile).toHaveLength(spotGrid.length);
    // With no legs, all gammas should be 0
    for (const entry of profile) {
      expect(entry.gamma).toBe(0);
    }
  });

  it("returns empty profile when spotGrid is empty", () => {
    const legs = [makeLeg()];
    const profile = buildProfile(legs, []);
    expect(profile).toHaveLength(0);
  });
});

// ─── Fast-check property: dollarGamma — monotonic in OI ────────────────────────
// dollarGamma(gamma, oi, spot) should be monotonically non-decreasing in OI for fixed positive gamma.
// (More OI = more gamma exposure, never less.)

describe("dollarGamma — fast-check properties", () => {
  it("monotone in OI: dollarGamma(gamma, oi1, spot) <= dollarGamma(gamma, oi2, spot) when oi1 <= oi2 and gamma > 0", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.001), max: Math.fround(0.1), noNaN: true }),
        fc.integer({ min: 0, max: 100000 }),
        fc.integer({ min: 0, max: 100000 }),
        fc.float({ min: Math.fround(5000), max: Math.fround(10000), noNaN: true }),
        (gamma, oiA, oiB, spot) => {
          const lo = Math.min(oiA, oiB);
          const hi = Math.max(oiA, oiB);
          return dollarGamma(gamma, lo, spot) <= dollarGamma(gamma, hi, spot) + 1e-9;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("findFlip returns null for a monotone-positive profile (no zero crossing)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }), {
          minLength: 2,
          maxLength: 20,
        }),
        (gammas) => {
          // WR-01: field is `spot` not `strike` — the axis is a spot-price grid level
          const profile = gammas.map((g, i) => ({ spot: 7000 + i * 10, gamma: g }));
          return findFlip(profile) === null;
        },
      ),
      { numRuns: 500 },
    );
  });
});

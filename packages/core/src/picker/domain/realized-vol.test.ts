/**
 * realized-vol — RED: annualized realized volatility from daily closes.
 *
 * RV = stdev(log returns, sample n−1) × √252, for the experimental `vrp` rule
 * (frontIV − RV20). Null when fewer than 3 closes (need ≥2 returns for a sample stdev).
 * Non-positive closes are rejected (log undefined) → null rather than NaN.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { realizedVol } from "./realized-vol.ts";

describe("realizedVol", () => {
  it("returns 0 for a constant price series (no variance)", () => {
    expect(realizedVol([100, 100, 100, 100, 100])).toBe(0);
  });

  it("returns null when fewer than 3 closes (not enough returns for a sample stdev)", () => {
    expect(realizedVol([])).toBeNull();
    expect(realizedVol([100])).toBeNull();
    expect(realizedVol([100, 101])).toBeNull();
  });

  it("returns null when any close is non-positive (log return undefined)", () => {
    expect(realizedVol([100, 0, 101, 102])).toBeNull();
    expect(realizedVol([100, -5, 101, 102])).toBeNull();
  });

  it("matches a hand-computed value for a known series", () => {
    // closes 100 → 101 → 99.99: log returns r1=ln(1.01), r2=ln(99.99/101)
    const r1 = Math.log(101 / 100);
    const r2 = Math.log(99.99 / 101);
    const mean = (r1 + r2) / 2;
    const sampleVar = ((r1 - mean) ** 2 + (r2 - mean) ** 2) / 1; // n−1 = 1
    const expected = Math.sqrt(sampleVar) * Math.sqrt(252);
    expect(realizedVol([100, 101, 99.99])).toBeCloseTo(expected, 12);
  });

  it("fast-check: scale invariance — multiplying all closes by k > 0 leaves RV unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 10_000, noNaN: true }), { minLength: 3, maxLength: 40 }),
        fc.double({ min: 0.001, max: 1000, noNaN: true }),
        (closes, k) => {
          const base = realizedVol(closes);
          const scaled = realizedVol(closes.map((c) => c * k));
          if (base === null || scaled === null) return base === scaled;
          return Math.abs(base - scaled) < 1e-9 * Math.max(1, base);
        },
      ),
    );
  });

  it("fast-check: RV is always ≥ 0 and finite when defined", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 100_000, noNaN: true }), { minLength: 3, maxLength: 40 }),
        (closes) => {
          const rv = realizedVol(closes);
          return rv === null || (Number.isFinite(rv) && rv >= 0);
        },
      ),
    );
  });
});

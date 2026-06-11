/**
 * BSM price + greeks test suite
 *
 * RED phase: Calibration fixtures from RESEARCH.md + fast-check sanity properties.
 * All assertions fail until bsm.ts is implemented.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmPrice, bsmGreeks, bsmVega } from "./bsm.ts";
import type { BsmGreeks } from "./bsm.ts";

const TOL = 1e-4;

// ─────────────────────────────────────────────────────────────
// Fixture 1 — Hull Classic (q=0 baseline)
// S=42 K=40 T=0.5 r=0.10 sigma=0.20 q=0.0
// ─────────────────────────────────────────────────────────────
describe("Fixture 1 — Hull q=0", () => {
  const S = 42, K = 40, T = 0.5, r = 0.10, sigma = 0.20, q = 0.0;

  it("call price ≈ 4.7594", () => {
    expect(Math.abs(bsmPrice(S, K, T, sigma, r, q, "C") - 4.7594)).toBeLessThanOrEqual(TOL);
  });

  it("put price ≈ 0.8086", () => {
    expect(Math.abs(bsmPrice(S, K, T, sigma, r, q, "P") - 0.8086)).toBeLessThanOrEqual(TOL);
  });

  it("call delta ≈ 0.779131", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.delta - 0.779131)).toBeLessThanOrEqual(TOL);
  });

  it("put delta ≈ -0.220869", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "P");
    expect(Math.abs(g.delta - (-0.220869))).toBeLessThanOrEqual(TOL);
  });

  it("gamma ≈ 0.049963", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.gamma - 0.049963)).toBeLessThanOrEqual(TOL);
  });

  it("call theta/day ≈ -0.012482", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.theta - (-0.012482))).toBeLessThanOrEqual(TOL);
  });

  it("vega per vol point ≈ 0.088134", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.vega - 0.088134)).toBeLessThanOrEqual(TOL);
  });
});

// ─────────────────────────────────────────────────────────────
// Fixture 2 — SPX-like ATM with continuous dividend q=1.3%
// S=100 K=100 T=1.0 r=0.05 sigma=0.20 q=0.013
// ─────────────────────────────────────────────────────────────
describe("Fixture 2 — SPX ATM q=1.3%", () => {
  const S = 100, K = 100, T = 1.0, r = 0.05, sigma = 0.20, q = 0.013;

  it("call price ≈ 9.6439", () => {
    expect(Math.abs(bsmPrice(S, K, T, sigma, r, q, "C") - 9.6439)).toBeLessThanOrEqual(TOL);
  });

  it("put price ≈ 6.0584", () => {
    expect(Math.abs(bsmPrice(S, K, T, sigma, r, q, "P") - 6.0584)).toBeLessThanOrEqual(TOL);
  });

  it("call delta ≈ 0.604271", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.delta - 0.604271)).toBeLessThanOrEqual(TOL);
  });

  it("put delta ≈ -0.382813", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "P");
    expect(Math.abs(g.delta - (-0.382813))).toBeLessThanOrEqual(TOL);
  });

  it("gamma ≈ 0.018906", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.gamma - 0.018906)).toBeLessThanOrEqual(TOL);
  });

  it("call theta/day ≈ -0.015153", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.theta - (-0.015153))).toBeLessThanOrEqual(TOL);
  });

  it("put theta/day ≈ -0.005645", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "P");
    expect(Math.abs(g.theta - (-0.005645))).toBeLessThanOrEqual(TOL);
  });

  it("vega per vol point ≈ 0.378117", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.vega - 0.378117)).toBeLessThanOrEqual(TOL);
  });
});

// ─────────────────────────────────────────────────────────────
// Fixture 3 — OTM put, SPX-like
// S=100 K=95 T=0.25 r=0.045 sigma=0.18 q=0.013
// ─────────────────────────────────────────────────────────────
describe("Fixture 3 — OTM put SPX-like", () => {
  const S = 100, K = 95, T = 0.25, r = 0.045, sigma = 0.18, q = 0.013;

  it("call price ≈ 7.0710", () => {
    expect(Math.abs(bsmPrice(S, K, T, sigma, r, q, "C") - 7.0710)).toBeLessThanOrEqual(TOL);
  });

  it("put price ≈ 1.3327", () => {
    expect(Math.abs(bsmPrice(S, K, T, sigma, r, q, "P") - 1.3327)).toBeLessThanOrEqual(TOL);
  });

  it("call delta ≈ 0.756762", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.delta - 0.756762)).toBeLessThanOrEqual(TOL);
  });

  it("put delta ≈ -0.239993", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "P");
    expect(Math.abs(g.delta - (-0.239993))).toBeLessThanOrEqual(TOL);
  });

  it("gamma ≈ 0.034490", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.gamma - 0.034490)).toBeLessThanOrEqual(TOL);
  });

  it("call theta/day ≈ -0.021056", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.theta - (-0.021056))).toBeLessThanOrEqual(TOL);
  });

  it("vega per vol point ≈ 0.155204", () => {
    const g: BsmGreeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(g.vega - 0.155204)).toBeLessThanOrEqual(TOL);
  });
});

// ─────────────────────────────────────────────────────────────
// Edge case: T<=0 → intrinsic value
// ─────────────────────────────────────────────────────────────
describe("Edge: T<=0 returns intrinsic", () => {
  it("call intrinsic when ITM", () => {
    expect(bsmPrice(100, 90, 0, 0.20, 0.05, 0.013, "C")).toBe(10);
  });

  it("call intrinsic when OTM", () => {
    expect(bsmPrice(80, 90, 0, 0.20, 0.05, 0.013, "C")).toBe(0);
  });

  it("put intrinsic when ITM", () => {
    expect(bsmPrice(80, 90, 0, 0.20, 0.05, 0.013, "P")).toBe(10);
  });

  it("put intrinsic when OTM", () => {
    expect(bsmPrice(100, 90, 0, 0.20, 0.05, 0.013, "P")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// bsmVega exported separately (used as IV-inversion denominator)
// ─────────────────────────────────────────────────────────────
describe("bsmVega (unscaled, for IV inversion)", () => {
  it("returns a positive number for standard inputs", () => {
    const v = bsmVega(100, 100, 1.0, 0.20, 0.05, 0.013);
    expect(v).toBeGreaterThan(0);
  });

  it("equals greeks.vega * 100 (greeks.vega is /100 scaled)", () => {
    const S = 100, K = 100, T = 1.0, sigma = 0.20, r = 0.05, q = 0.013;
    const unscaled = bsmVega(S, K, T, sigma, r, q);
    const greeks = bsmGreeks(S, K, T, sigma, r, q, "C");
    expect(Math.abs(unscaled - greeks.vega * 100)).toBeLessThan(1e-10);
  });
});

// ─────────────────────────────────────────────────────────────
// fast-check sanity properties (numRuns ≥ 1000)
// Domain: S∈[500,8000], K∈[400,9000], T∈[0.01,2], sigma∈[0.05,3]
// ─────────────────────────────────────────────────────────────
describe("fast-check sanity properties", () => {
  const r = 0.045, q = 0.013;

  it("call delta ∈ [0, 1]", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 500, max: 8000, noNaN: true }),
        fc.float({ min: 400, max: 9000, noNaN: true }),
        fc.float({ min: 0.01, max: 2, noNaN: true }),
        fc.float({ min: 0.05, max: 3, noNaN: true }),
        (S, K, T, sigma) => {
          const g = bsmGreeks(S, K, T, sigma, r, q, "C");
          return g.delta >= 0 && g.delta <= 1;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("put delta ∈ [-1, 0]", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 500, max: 8000, noNaN: true }),
        fc.float({ min: 400, max: 9000, noNaN: true }),
        fc.float({ min: 0.01, max: 2, noNaN: true }),
        fc.float({ min: 0.05, max: 3, noNaN: true }),
        (S, K, T, sigma) => {
          const g = bsmGreeks(S, K, T, sigma, r, q, "P");
          return g.delta >= -1 && g.delta <= 0;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("gamma ≥ 0", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 500, max: 8000, noNaN: true }),
        fc.float({ min: 400, max: 9000, noNaN: true }),
        fc.float({ min: 0.01, max: 2, noNaN: true }),
        fc.float({ min: 0.05, max: 3, noNaN: true }),
        (S, K, T, sigma) => {
          const g = bsmGreeks(S, K, T, sigma, r, q, "C");
          return g.gamma >= 0;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("vega ≥ 0", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 500, max: 8000, noNaN: true }),
        fc.float({ min: 400, max: 9000, noNaN: true }),
        fc.float({ min: 0.01, max: 2, noNaN: true }),
        fc.float({ min: 0.05, max: 3, noNaN: true }),
        (S, K, T, sigma) => {
          const g = bsmGreeks(S, K, T, sigma, r, q, "C");
          return g.vega >= 0;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("theta ≤ 0 for both call and put (decay) in the SPX domain", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 500, max: 8000, noNaN: true }),
        fc.float({ min: 400, max: 9000, noNaN: true }),
        fc.float({ min: 0.01, max: 2, noNaN: true }),
        fc.float({ min: 0.05, max: 3, noNaN: true }),
        fc.constantFrom("C" as const, "P" as const),
        (S, K, T, sigma, type) => {
          const g = bsmGreeks(S, K, T, sigma, r, q, type);
          // Allow a tiny epsilon for numerical edge cases at boundaries
          return g.theta <= 1e-10;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

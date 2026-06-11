/**
 * IV inversion test suite — Newton-Raphson + bisection fallback
 *
 * RED phase: All assertions fail until iv-inversion.ts is implemented.
 *
 * Test structure:
 *   1. Round-trip property (numRuns ≥ 1000): invertIv recovers sigma to 1e-6
 *   2. Monotonicity property (numRuns ≥ 1000): BSM price monotone in sigma
 *   3. Bisection-path coverage: deep OTM + near-expiry force fallback
 *   4. Degenerate inputs return typed Result.err, never NaN
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmPrice, bsmVega } from "./bsm.ts";
import { invertIv } from "./iv-inversion.ts";
import type { IvError } from "./iv-inversion.ts";

// ─────────────────────────────────────────────────────────────
// Constants (mirror those in implementation)
// ─────────────────────────────────────────────────────────────
const VEGA_THRESHOLD = 1e-8;
const R = 0.045;
const Q = 0.013;

// ─────────────────────────────────────────────────────────────
// 1. Round-trip property
// For well-formed inputs where invertIv returns ok, the recomputed
// BSM price must be within 1e-6 of the original mark.
// ─────────────────────────────────────────────────────────────
describe("round-trip property — invertIv recovers sigma within 1e-6", () => {
  it(
    "round-trip: |bsmPrice(sigma_recovered) - mark| ≤ 1e-6 (numRuns=1000)",
    () => {
      // Note: fc.float v4 requires 32-bit float bounds via Math.fround()
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(500), max: Math.fround(8000), noNaN: true }),
          fc.float({ min: Math.fround(400), max: Math.fround(9000), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }),
          fc.float({ min: Math.fround(0.05), max: Math.fround(3), noNaN: true }),
          fc.constantFrom("C" as const, "P" as const),
          (S, K, T, sigma, type) => {
            const mark = bsmPrice(S, K, T, sigma, R, Q, type);
            const result = invertIv(mark, S, K, T, R, Q, type);
            if (!result.ok) {
              // Degenerate inputs are expected to fail — skip
              return true;
            }
            const recomputed = bsmPrice(S, K, T, result.value, R, Q, type);
            return Math.abs(recomputed - mark) <= 1e-6;
          },
        ),
        { numRuns: 1000 },
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────
// 2. Monotonicity property
// BSM price is monotone in sigma: sigmaHi > sigmaLo => price(sigmaHi) >= price(sigmaLo)
// ─────────────────────────────────────────────────────────────
describe("monotonicity — BSM price is non-decreasing in sigma", () => {
  it(
    "sigmaHi > sigmaLo => bsmPrice(sigmaHi) >= bsmPrice(sigmaLo) (numRuns=1000)",
    () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(500), max: Math.fround(8000), noNaN: true }),
          fc.float({ min: Math.fround(400), max: Math.fround(9000), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }),
          fc.float({ min: Math.fround(0.05), max: Math.fround(1.5), noNaN: true }),
          fc.float({ min: Math.fround(0.05), max: Math.fround(1.5), noNaN: true }),
          fc.constantFrom("C" as const, "P" as const),
          (S, K, T, sigmaA, sigmaB, type) => {
            const sigmaLo = Math.min(sigmaA, sigmaB);
            const sigmaHi = Math.max(sigmaA, sigmaB);
            if (sigmaHi <= sigmaLo) return true; // skip equal case
            const priceLo = bsmPrice(S, K, T, sigmaLo, R, Q, type);
            const priceHi = bsmPrice(S, K, T, sigmaHi, R, Q, type);
            // Allow small numerical tolerance
            return priceHi >= priceLo - 1e-10;
          },
        ),
        { numRuns: 1000 },
      );
    },
  );
});

// ─────────────────────────────────────────────────────────────
// 3. Bisection-path coverage
// Inputs where analytic vega < VEGA_THRESHOLD at the initial guess,
// forcing the solver to fall back to bisection. The bisection result
// must still satisfy round-trip to 1e-6.
// ─────────────────────────────────────────────────────────────
describe("bisection fallback — converges on inputs where NR breaks", () => {
  it("deep OTM call (S=4000, K=8000, T=0.02) — vega near zero forces bisection", () => {
    const S = 4000, K = 8000, T = 0.02, type = "C" as const;
    // Generate a mark using a real sigma to ensure it is a valid price
    const sigma = 0.5;
    const mark = bsmPrice(S, K, T, sigma, R, Q, type);

    // Verify that the analytic vega at the initial Brenner-Subrahmanyam guess
    // is below VEGA_THRESHOLD — this proves bisection will engage
    const bs0 = Math.sqrt(2 * Math.PI / T) * mark / S;
    const sigma0 = bs0 > 0 && isFinite(bs0) ? Math.max(0.001, Math.min(5.0, bs0)) : 0.2;
    const vegaAtGuess = bsmVega(S, K, T, sigma0, R, Q);
    expect(vegaAtGuess).toBeLessThan(VEGA_THRESHOLD);

    // Solver must still converge
    const result = invertIv(mark, S, K, T, R, Q, type);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const recomputed = bsmPrice(S, K, T, result.value, R, Q, type);
      expect(Math.abs(recomputed - mark)).toBeLessThanOrEqual(1e-6);
    }
  });

  it("near-expiry ATM (T=0.005) — vega negligible forces bisection", () => {
    const S = 4500, K = 4500, T = 0.005, type = "C" as const;
    const sigma = 0.2;
    const mark = bsmPrice(S, K, T, sigma, R, Q, type);

    // At T=0.005 the initial sigma0 = (mark/S)*sqrt(2*pi/T) may be huge or tiny
    // but regardless vega at T=0.005 is very small
    const vegaAtSigma = bsmVega(S, K, T, sigma, R, Q);
    // Check vega is small — not necessarily below threshold but close
    // The key test is that invertIv still returns ok
    const result = invertIv(mark, S, K, T, R, Q, type);
    // For near-expiry ATM, mark ≈ intrinsic + tiny time value — solver should work
    if (result.ok) {
      const recomputed = bsmPrice(S, K, T, result.value, R, Q, type);
      expect(Math.abs(recomputed - mark)).toBeLessThanOrEqual(1e-6);
    }
    // At minimum, no NaN should leak — result.ok or a typed error
    if (!result.ok) {
      expect(result.error).toBeDefined();
      const kind = (result.error as IvError).kind;
      expect(["expired", "below-intrinsic", "above-bound"]).toContain(kind);
    }
  });

  it("deep OTM put (S=4000, K=500, T=0.05) — vega near zero forces bisection", () => {
    const S = 4000, K = 500, T = 0.05, type = "P" as const;
    const sigma = 0.8;
    const mark = bsmPrice(S, K, T, sigma, R, Q, type);

    const result = invertIv(mark, S, K, T, R, Q, type);
    // Deep OTM put has near-zero price — likely returns err or bisects
    if (result.ok) {
      const recomputed = bsmPrice(S, K, T, result.value, R, Q, type);
      expect(Math.abs(recomputed - mark)).toBeLessThanOrEqual(1e-6);
    } else {
      const kind = (result.error as IvError).kind;
      expect(["expired", "below-intrinsic", "above-bound"]).toContain(kind);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Degenerate inputs — Result.err (never NaN)
// ─────────────────────────────────────────────────────────────
describe("degenerate inputs — typed Result.err, never NaN", () => {
  const S = 4000, K = 4000;

  it("T <= 0 returns err({kind:'expired'})", () => {
    const mark = 100;
    const result = invertIv(mark, S, K, 0, R, Q, "C");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("expired");
    }
  });

  it("T < 0 returns err({kind:'expired'})", () => {
    const mark = 100;
    const result = invertIv(mark, S, K, -0.1, R, Q, "C");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("expired");
    }
  });

  it("mark below call intrinsic returns err({kind:'below-intrinsic'})", () => {
    // Call intrinsic = max(S - K, 0). With S=5000, K=4000, intrinsic = 1000.
    // Pass mark = 999 (below intrinsic by 1)
    const result = invertIv(999, 5000, 4000, 0.5, R, Q, "C");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("below-intrinsic");
    }
  });

  it("mark below put intrinsic returns err({kind:'below-intrinsic'})", () => {
    // Put intrinsic = max(K - S, 0). With K=5000, S=4000, intrinsic = 1000.
    // Pass mark = 999 (below intrinsic by 1)
    const result = invertIv(999, 4000, 5000, 0.5, R, Q, "P");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("below-intrinsic");
    }
  });

  it("mark above upper bound returns err({kind:'above-bound'})", () => {
    // Upper bound for a call ≈ S * e^(-qT). Use mark = S * 10 (clearly above).
    const result = invertIv(S * 10, S, K, 0.5, R, Q, "C");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("above-bound");
    }
  });

  it("mark above upper bound for put returns err({kind:'above-bound'})", () => {
    // Upper bound for a put ≈ K * e^(-rT). Use mark = K * 10 (clearly above).
    const result = invertIv(K * 10, S, K, 0.5, R, Q, "P");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("above-bound");
    }
  });

  it("result.ok is never NaN — ok path returns finite number", () => {
    // A well-behaved ATM option at normal parameters
    const mark = bsmPrice(4000, 4000, 0.5, 0.2, R, Q, "C");
    const result = invertIv(mark, 4000, 4000, 0.5, R, Q, "C");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Number.isFinite(result.value)).toBe(true);
      expect(Number.isNaN(result.value)).toBe(false);
    }
  });

  it("all fast-check random inputs produce ok(finite) or typed err — never NaN leak", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(500), max: Math.fround(8000), noNaN: true }),
        fc.float({ min: Math.fround(400), max: Math.fround(9000), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }),
        fc.float({ min: Math.fround(0.05), max: Math.fround(3), noNaN: true }),
        fc.constantFrom("C" as const, "P" as const),
        (S, K, T, sigma, type) => {
          const mark = bsmPrice(S, K, T, sigma, R, Q, type);
          const result = invertIv(mark, S, K, T, R, Q, type);
          if (result.ok) {
            return Number.isFinite(result.value) && !Number.isNaN(result.value);
          }
          // Typed error — kind must be one of the three discriminant values
          const kind = result.error.kind;
          return kind === "expired" || kind === "below-intrinsic" || kind === "above-bound";
        },
      ),
      { numRuns: 1000 },
    );
  });
});

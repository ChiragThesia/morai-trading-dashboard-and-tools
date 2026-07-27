/**
 * implied-carry.test.ts — parity-implied dividend yield solver (Phase 34, Plan 34-03).
 *
 * Money-path rule: build the oracle before trusting the math. The oracle forward-prices
 * a synthetic call/put pair via bsmPrice with a KNOWN q, feeds the resulting marks into
 * impliedDivYield, and asserts the solver recovers that same q — put-call parity is an
 * EXACT identity for BSM prices sharing r/q/T/K, so recovery should hold to near
 * floating-point precision, not just "close".
 *
 * 34-RESEARCH.md Pattern 2 / Pitfall 3: q = −ln[((C−P) + K·e^{−rT}) / S] / T, guarded
 * against a non-positive or non-finite parity right-hand side (never NaN). (RESEARCH's
 * literally-quoted formula has a sign error — see implied-carry.ts's header comment;
 * this oracle is what pins the corrected, verified form.)
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmPrice } from "@morai/quant";
import { impliedDivYield } from "./implied-carry.ts";

describe("impliedDivYield — parity round-trip oracle", () => {
  it("recovers a known q from synthetic call/put marks forward-priced via bsmPrice", () => {
    const S = 7381;
    const K = 7400;
    const T = 98 / 365.25;
    const sigma = 0.14;
    const r = 0.043;
    const q = 0.013;

    const callMark = bsmPrice(S, K, T, sigma, r, q, "C");
    const putMark = bsmPrice(S, K, T, sigma, r, q, "P");

    const recovered = impliedDivYield(callMark, putMark, S, K, T, r);
    expect(recovered).not.toBeNull();
    if (recovered === null) return;
    expect(recovered).toBeCloseTo(q, 9);
  });
});

describe("impliedDivYield — fast-check round-trip property", () => {
  it("recovers q within tolerance across bounded (q, r, T, spot, strike, sigma)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 0.05, noNaN: true }), // q — kept > 0 (RHS = 0 at q=0)
        fc.double({ min: 0, max: 0.1, noNaN: true }), // r
        // T ≥ 0.02y (~7.3 days). The solver now REFUSES a shorter horizon outright: parity's noise
        // gain is 1/T, so below a week the answer is an amplifier reading rather than a
        // measurement. This property is "recovers q wherever the solve is defined", so its domain
        // moved with the function's. The refusal itself is pinned by its own example tests.
        fc.double({ min: 0.02, max: 2, noNaN: true }), // T (years)
        fc.double({ min: 50, max: 10_000, noNaN: true }), // spot
        fc.double({ min: 0.5, max: 1.5, noNaN: true }), // strike as a ratio of spot
        fc.double({ min: 0.05, max: 1, noNaN: true }), // sigma
        (q, r, T, spot, strikeRatio, sigma) => {
          const strike = spot * strikeRatio;
          const callMark = bsmPrice(spot, strike, T, sigma, r, q, "C");
          const putMark = bsmPrice(spot, strike, T, sigma, r, q, "P");

          const recovered = impliedDivYield(callMark, putMark, spot, strike, T, r);
          expect(recovered).not.toBeNull();
          if (recovered === null) return;
          expect(recovered).toBeCloseTo(q, 6);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("impliedDivYield — degenerate input guards (never NaN)", () => {
  it("returns null when T <= 0", () => {
    expect(impliedDivYield(10, 8, 7381, 7400, 0, 0.043)).toBeNull();
    expect(impliedDivYield(10, 8, 7381, 7400, -1, 0.043)).toBeNull();
  });

  it("returns null when spot <= 0", () => {
    expect(impliedDivYield(10, 8, 0, 7400, 0.25, 0.043)).toBeNull();
    expect(impliedDivYield(10, 8, -100, 7400, 0.25, 0.043)).toBeNull();
  });

  it("returns null (not NaN) when a wide/stale C-P spread pushes the parity RHS negative", () => {
    // Pitfall 3: a stale/wide AH quote can push C-P far past the parity bound —
    // rhs = (C-P) + K*e^{-rT} goes negative when the put is stale/wide-quoted far above
    // the call (deep put overpricing), making ln() undefined.
    const result = impliedDivYield(0, 10_000, 100, 100, 0.5, 0.05);
    expect(result).toBeNull();
    expect(Number.isNaN(result)).toBe(false);
  });

  it("returns null (not NaN) when an input mark is itself non-finite (corrupted data)", () => {
    expect(impliedDivYield(NaN, 8, 7381, 7400, 0.25, 0.043)).toBeNull();
    expect(impliedDivYield(10, Infinity, 7381, 7400, 0.25, 0.043)).toBeNull();
  });
});

/**
 * REGRESSION (prod, 2026-07-27). Parity divides the residual by T, so as T→0 the solve stops
 * being a measurement and becomes an amplifier for quote noise. Live `impliedCarry` from the GEX
 * snapshot showed exactly that shape:
 *
 *   2026-07-27 (0DTE)  q = 0.2984   ← 29.8% dividend yield
 *   2026-07-28 (1DTE)  q = 0.0823
 *   2026-07-29 (2DTE)  q = 0.0450
 *   2026-07-30 (3DTE)  q = 0.0291
 *   2026-07-31 (4DTE)  q = 0.0070   ← back in range
 *   ...steady ~0.009–0.012 thereafter
 *   2026-08-23         q = −0.1201  ← NEGATIVE, non-physical for an index
 *   2026-09-02         q = −0.0857
 *
 * SPX yields roughly 1.2–2.0%. At 1 DTE, T ≈ 0.0027, so a five-cent error in either mark moves q
 * by whole percentage points — the number carries no signal. And a negative continuous dividend
 * yield on an index is not a quantity that exists; it is the solver reading noise.
 *
 * Both now degrade to null, which `computeImpliedCarry` already handles by emitting no entry for
 * that expiry, so `resolveCarry` falls back to its flat default. This matters more since the
 * Analyzer's Browse surface lists EVERY expiry — a 1DTE front leg is one click away, and its
 * greeks were being priced at an 8% dividend yield.
 */
describe("impliedDivYield — refuses a solve that cannot carry signal", () => {
  /** Marks that imply q ≈ 0.013 exactly, at any T, via forward pricing. */
  function parityMarks(T: number, q: number, r = 0.0382, spot = 7411.98, strike = 7400) {
    // C − P = S·e^{-qT} − K·e^{-rT}; put the whole difference in the call.
    const diff = spot * Math.exp(-q * T) - strike * Math.exp(-r * T);
    return { callMark: diff + 5, putMark: 5, spot, strike, r };
  }

  it("solves normally at a horizon where parity is well conditioned", () => {
    const T = 25 / 365.25;
    const m = parityMarks(T, 0.013);
    const q = impliedDivYield(m.callMark, m.putMark, m.spot, m.strike, T, m.r);
    expect(q).not.toBeNull();
    expect(q ?? Number.NaN).toBeCloseTo(0.013, 9);
  });

  it("returns null below the minimum horizon, even when the marks are perfectly consistent", () => {
    // The guard is on CONDITIONING, not on whether this particular solve happened to be clean.
    for (const dte of [0.5, 1, 2, 3, 6]) {
      const T = dte / 365.25;
      const m = parityMarks(T, 0.013);
      expect(impliedDivYield(m.callMark, m.putMark, m.spot, m.strike, T, m.r)).toBeNull();
    }
  });

  it("starts solving again at the minimum horizon", () => {
    const T = 7 / 365.25;
    const m = parityMarks(T, 0.013);
    expect(impliedDivYield(m.callMark, m.putMark, m.spot, m.strike, T, m.r)).not.toBeNull();
  });

  it("returns null for a NEGATIVE yield — an index cannot pay negative dividends", () => {
    const T = 27 / 365.25;
    const m = parityMarks(T, -0.12); // the live 2026-08-23 reading
    const q = impliedDivYield(m.callMark, m.putMark, m.spot, m.strike, T, m.r);
    expect(q).toBeNull();
  });

  it("returns null for an implausibly LARGE yield", () => {
    const T = 30 / 365.25;
    const m = parityMarks(T, 0.35);
    expect(impliedDivYield(m.callMark, m.putMark, m.spot, m.strike, T, m.r)).toBeNull();
  });

  it("accepts a flat zero yield — no dividend is physical, a negative one is not", () => {
    const T = 30 / 365.25;
    const m = parityMarks(T, 0);
    const q = impliedDivYield(m.callMark, m.putMark, m.spot, m.strike, T, m.r);
    expect(q).not.toBeNull();
    expect(q ?? Number.NaN).toBeCloseTo(0, 9);
  });
});

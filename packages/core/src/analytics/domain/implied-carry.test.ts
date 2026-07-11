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
        fc.double({ min: 0.01, max: 2, noNaN: true }), // T (years)
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

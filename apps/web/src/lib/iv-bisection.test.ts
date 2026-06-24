/**
 * iv-bisection test suite
 *
 * RED phase: Example test + fast-check round-trip property.
 * impliedFlatIv finds an iv such that BSM(back, iv) − BSM(front, iv) ≈ debit at current spot.
 *
 * Bisection contract (UI-SPEC TOS Parser Contract Rule 8):
 *   - Bounded: lo=0.02, hi=2.0 (never unbounded loop)
 *   - No-debit default: returns 0.15 (15%)
 *   - Unbracketable: returns lo or hi (closest bound)
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { impliedFlatIv } from "./iv-bisection.ts";
import { bsmPrice } from "@morai/quant";

// Tolerance matching the playground reference: 1e-4 absolute on the spread price
const SPREAD_TOL = 1e-4;

// Default spread re-pricing tolerance (less strict for the round-trip property at extremes)
const ROUND_TRIP_TOL = 0.02;

// Standard SPX-like params
const S = 7550;
const r = 0.045;
const q = 0.013;

// ─────────────────────────────────────────────────────────────
// Example test — known fixture
// Calendar SPX 7550 PUT, front 20d / back 30d, debit 5.80
// ─────────────────────────────────────────────────────────────
describe("iv-bisection: example test", () => {
  it("recovers an iv that re-prices the calendar spread to ≈ input debit", () => {
    const K = 7550;
    const frontT = 20 / 365;
    const backT = 30 / 365;
    const type = "P" as const;
    const debit = 5.80;

    const iv = impliedFlatIv({ S, K, frontT, backT, type, r, q, debit });

    // iv must be a finite number in the bisection range
    expect(iv).toBeGreaterThan(0);
    expect(iv).toBeLessThanOrEqual(2.0);
    expect(Number.isFinite(iv)).toBe(true);

    // Re-price at the returned iv — must ≈ input debit
    const repriced =
      bsmPrice(S, K, backT, iv, r, q, type) -
      bsmPrice(S, K, frontT, iv, r, q, type);
    expect(Math.abs(repriced - debit)).toBeLessThanOrEqual(SPREAD_TOL);
  });

  it("returns 0.15 when debit is null (no-debit default)", () => {
    const iv = impliedFlatIv({
      S,
      K: 7550,
      frontT: 20 / 365,
      backT: 30 / 365,
      type: "P",
      r,
      q,
      debit: null,
    });
    expect(iv).toBe(0.15);
  });

  it("returns 0.15 when debit is undefined (no-debit default)", () => {
    const iv = impliedFlatIv({
      S,
      K: 7550,
      frontT: 20 / 365,
      backT: 30 / 365,
      type: "P",
      r,
      q,
    });
    expect(iv).toBe(0.15);
  });

  it("handles CALL calendar as well as PUT", () => {
    // Use a deep OTM call at K=8500 where ATM spread is small and debit is bracketable.
    // At S=7550, K=8500, frontT=30d, backT=60d, iv~0.20 → spread ≈ 10 pts.
    // Debit=10 is chosen to be within the bracket [lo,hi].
    const K = 8500;
    const frontT = 30 / 365;
    const backT = 60 / 365;
    const type = "C" as const;
    const debit = 10.0;

    const iv = impliedFlatIv({ S, K, frontT, backT, type, r, q, debit });
    expect(Number.isFinite(iv)).toBe(true);
    expect(iv).toBeGreaterThan(0);
    expect(iv).toBeLessThanOrEqual(2.0);

    const repriced =
      bsmPrice(S, K, backT, iv, r, q, type) -
      bsmPrice(S, K, frontT, iv, r, q, type);
    expect(Math.abs(repriced - debit)).toBeLessThanOrEqual(SPREAD_TOL);
  });
});

// ─────────────────────────────────────────────────────────────
// Fast-check round-trip property: numRuns:1000 with Math.fround() bounds
// Generate a realistic iv, price the spread, bisect back, assert re-price ≈ synthetic debit
// ─────────────────────────────────────────────────────────────
describe("iv-bisection: fast-check round-trip property", () => {
  it("bisect(iv→spread) round-trips: re-price at recovered iv ≈ synthetic debit (numRuns:1000)", () => {
    const r = 0.045;
    const q = 0.013;

    fc.assert(
      fc.property(
        // spot ∈ [5000, 8000]
        fc.float({ min: Math.fround(5000), max: Math.fround(8000), noNaN: true }),
        // strike ∈ [5000, 8500]
        fc.float({ min: Math.fround(5000), max: Math.fround(8500), noNaN: true }),
        // frontT ∈ [7/365, 45/365] (7–45 days to front expiry)
        fc.float({
          min: Math.fround(7 / 365),
          max: Math.fround(45 / 365),
          noNaN: true,
        }),
        // backT offset ∈ [7/365, 45/365] added to frontT
        fc.float({
          min: Math.fround(7 / 365),
          max: Math.fround(45 / 365),
          noNaN: true,
        }),
        // seed iv ∈ [0.05, 0.80] — realistic options IV range
        fc.float({ min: Math.fround(0.05), max: Math.fround(0.80), noNaN: true }),
        // type: 50/50 call/put
        fc.boolean(),
        (spot, strike, frontT, backTOffset, seedIv, isCall) => {
          const backT = frontT + backTOffset;
          const type = isCall ? ("C" as const) : ("P" as const);

          // Compute synthetic debit at the seed IV
          const syntheticDebit =
            bsmPrice(spot, strike, backT, seedIv, r, q, type) -
            bsmPrice(spot, strike, frontT, seedIv, r, q, type);

          // Only test when the synthetic debit is positive (calendar spread is debit)
          // and within a realistic range (not near-zero where bisection is numerically hard)
          if (syntheticDebit < 0.1) return true; // skip degenerate case

          // Bisect back from the synthetic debit
          const recoveredIv = impliedFlatIv({
            S: spot,
            K: strike,
            frontT,
            backT,
            type,
            r,
            q,
            debit: syntheticDebit,
          });

          // Re-price at recovered IV must ≈ synthetic debit
          const repriced =
            bsmPrice(spot, strike, backT, recoveredIv, r, q, type) -
            bsmPrice(spot, strike, frontT, recoveredIv, r, q, type);

          return Math.abs(repriced - syntheticDebit) <= ROUND_TRIP_TOL;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

/**
 * risk-reversal domain — example tests (Phase 6, Plan 06-03).
 *
 * `interpolateRiskReversal` = IV(25Δ put) − IV(25Δ call), linear-in-delta interpolation to the
 * ±0.25 delta points from the smile's (delta, iv) pairs. Returns null (never a fabricated number;
 * SPEC R2) when ±0.25 cannot be bracketed on either wing.
 */

import { describe, it, expect } from "vitest";
import { interpolateRiskReversal } from "./risk-reversal.ts";
import type { SmileQuote } from "../application/ports.ts";

// A symmetric smile that brackets both +0.25 (call) and −0.25 (put) deltas.
const bracketingSmile: ReadonlyArray<SmileQuote> = [
  { underlying: "SPX", expiration: "2026-07-17", strike: 5300000, iv: 0.22, delta: -0.35, moneyness: 0.96 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.2, delta: -0.2, moneyness: 0.98 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.17, delta: 0.2, moneyness: 1.02 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5700000, iv: 0.16, delta: 0.35, moneyness: 1.04 },
];

// A one-sided smile: no quote reaches ±0.25 on the put wing → cannot bracket.
const unbracketableSmile: ReadonlyArray<SmileQuote> = [
  { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.17, delta: 0.1, moneyness: 1.02 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5700000, iv: 0.16, delta: 0.05, moneyness: 1.04 },
];

// Worked numeric acceptance example (plan 06-03 <behavior>):
//   put A: delta −0.20, iv 0.180   put B: delta −0.30, iv 0.220
//   call C: delta +0.30, iv 0.150  call D: delta +0.20, iv 0.130
//   IV(25Δ put)  = 0.180 + 0.5·(0.220 − 0.180) = 0.200
//   IV(25Δ call) = 0.130 + 0.5·(0.150 − 0.130) = 0.140
//   risk_reversal = 0.200 − 0.140 = 0.060
const workedExampleSmile: ReadonlyArray<SmileQuote> = [
  { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5300000, iv: 0.22, delta: -0.3, moneyness: 0.96 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.15, delta: 0.3, moneyness: 1.02 },
  { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
];

describe("interpolateRiskReversal", () => {
  it("returns a number for a smile that brackets ±25Δ", () => {
    const rr = interpolateRiskReversal(bracketingSmile);
    expect(typeof rr).toBe("number");
  });

  it("matches the hand-computed value 0.06 within tol=1e-6 (worked example)", () => {
    const rr = interpolateRiskReversal(workedExampleSmile);
    expect(rr).not.toBeNull();
    expect(rr).toBeCloseTo(0.06, 6);
  });

  it("is order-independent: shuffling the smile array does not change the result", () => {
    const shuffled = [...workedExampleSmile].reverse();
    expect(interpolateRiskReversal(shuffled)).toBeCloseTo(0.06, 6);
  });

  it("returns null when ±25Δ cannot be bracketed (never fabricated — SPEC R2)", () => {
    const rr = interpolateRiskReversal(unbracketableSmile);
    expect(rr).toBeNull();
  });

  it("returns null for an all-puts smile (call wing unbracketable)", () => {
    const allPuts: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5300000, iv: 0.22, delta: -0.3, moneyness: 0.96 },
    ];
    expect(interpolateRiskReversal(allPuts)).toBeNull();
  });

  it("returns null for an all-calls smile (put wing unbracketable)", () => {
    const allCalls: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.15, delta: 0.3, moneyness: 1.02 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
    ];
    expect(interpolateRiskReversal(allCalls)).toBeNull();
  });

  it("returns null when a put wing is too shallow to reach −0.25", () => {
    const shallowPuts: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5500000, iv: 0.18, delta: -0.18, moneyness: 1.0 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.17, delta: -0.1, moneyness: 1.01 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.15, delta: 0.3, moneyness: 1.02 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
    ];
    expect(interpolateRiskReversal(shallowPuts)).toBeNull();
  });

  it("ignores points with a null delta (filtered before interpolation)", () => {
    const withNullDelta: ReadonlyArray<SmileQuote> = [
      ...workedExampleSmile,
      { underlying: "SPX", expiration: "2026-07-17", strike: 5500000, iv: 0.5, delta: null, moneyness: 1.0 },
    ];
    expect(interpolateRiskReversal(withNullDelta)).toBeCloseTo(0.06, 6);
  });

  it("ignores points with a NaN delta or NaN iv (filtered before interpolation)", () => {
    const withNaN: ReadonlyArray<SmileQuote> = [
      ...workedExampleSmile,
      { underlying: "SPX", expiration: "2026-07-17", strike: 5500000, iv: Number.NaN, delta: -0.25, moneyness: 1.0 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5510000, iv: 0.3, delta: Number.NaN, moneyness: 1.0 },
    ];
    expect(interpolateRiskReversal(withNaN)).toBeCloseTo(0.06, 6);
  });

  it("returns null for an empty smile", () => {
    expect(interpolateRiskReversal([])).toBeNull();
  });

  it("drops a non-physical |delta| >= 1 put point that would otherwise deepen the put bracket (WR-04)", () => {
    // The legitimate put wing reaches only −0.20 (shallow) — it cannot bracket −0.25 on its own.
    // A numerically unstable solve adds a stray delta −1.4 that, on UNFILTERED code, becomes the
    // deep lower bracket for −0.25 and lets the wing interpolate across a 1.2-wide non-physical gap,
    // fabricating a put IV. With the filter the stray is dropped and the wing is correctly null.
    const strayDeepensPut: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5100000, iv: 0.95, delta: -1.4, moneyness: 0.9 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.15, delta: 0.3, moneyness: 1.02 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
    ];
    expect(interpolateRiskReversal(strayDeepensPut)).toBeNull();
  });

  it("drops a non-physical |delta| >= 1 call point that would otherwise deepen the call bracket (WR-04)", () => {
    // Mirror image on the call wing: legit calls reach only +0.20; a stray +1.3 would let the
    // unfiltered code bracket +0.25 across a non-physical gap and fabricate a call IV.
    const strayDeepensCall: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5300000, iv: 0.22, delta: -0.3, moneyness: 0.96 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5900000, iv: 0.02, delta: 1.3, moneyness: 1.1 },
    ];
    expect(interpolateRiskReversal(strayDeepensCall)).toBeNull();
  });

  it("drops a delta == 1 boundary point as non-physical (a real delta is strictly within (-1, 1))", () => {
    // A delta of exactly +1 would, unfiltered, deepen the call bracket past +0.25 the same way.
    const boundaryDeepensCall: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5300000, iv: 0.22, delta: -0.3, moneyness: 0.96 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5900000, iv: 0.01, delta: 1, moneyness: 1.1 },
    ];
    expect(interpolateRiskReversal(boundaryDeepensCall)).toBeNull();
  });

  it("a harmless stray |delta| >= 1 point leaves a well-bracketed RR unchanged (WR-04 regression)", () => {
    // When both wings already bracket ±0.25 with physical points, a stray point must not perturb
    // the result — it is simply dropped. Guards against an over-aggressive filter as well.
    const strayCall: SmileQuote = {
      underlying: "SPX",
      expiration: "2026-07-17",
      strike: 5800000,
      iv: 0.05,
      delta: 1.2,
      moneyness: 1.08,
    };
    expect(interpolateRiskReversal([...workedExampleSmile, strayCall])).toBeCloseTo(0.06, 6);
  });

  it("becomes unbracketable on a wing whose only spanning point is non-physical → null (WR-04)", () => {
    // The put wing's only point reaching past −0.25 is the stray −1.2; once dropped, the remaining
    // −0.20 put cannot bracket −0.25 → the whole RR is null (never a wrong-wing fabrication).
    const onlyStrayReachesPut: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5200000, iv: 0.9, delta: -1.2, moneyness: 0.92 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.15, delta: 0.3, moneyness: 1.02 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
    ];
    expect(interpolateRiskReversal(onlyStrayReachesPut)).toBeNull();
  });

  it("interpolates exactly when a point sits on −0.25 / +0.25 (degenerate bracket)", () => {
    const exact: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.21, delta: -0.25, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.12, delta: 0.25, moneyness: 1.01 },
    ];
    expect(interpolateRiskReversal(exact)).toBeCloseTo(0.21 - 0.12, 6);
  });
});

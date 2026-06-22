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

  it("interpolates exactly when a point sits on −0.25 / +0.25 (degenerate bracket)", () => {
    const exact: ReadonlyArray<SmileQuote> = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5400000, iv: 0.21, delta: -0.25, moneyness: 0.98 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5550000, iv: 0.12, delta: 0.25, moneyness: 1.01 },
    ];
    expect(interpolateRiskReversal(exact)).toBeCloseTo(0.21 - 0.12, 6);
  });
});

/**
 * risk-reversal domain — RED scaffold (Phase 6, Plan 06-01 Task 3).
 *
 * `interpolateRiskReversal` is NOT YET IMPLEMENTED — 06-03 turns this green.
 * These tests RUN and FAIL for the RIGHT reason (the function under test does not exist),
 * seeding the worked examples 06-03 must satisfy:
 *   - a bracketing smile → a numeric risk-reversal (IV(25Δ put) − IV(25Δ call))
 *   - a smile that cannot bracket ±25Δ → null (never a fabricated number; SPEC R2)
 */

import { describe, it, expect } from "vitest";
// RED: this import resolves to a function that does not exist yet (06-03 implements it).
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

describe("interpolateRiskReversal", () => {
  it("returns a number for a smile that brackets ±25Δ", () => {
    const rr = interpolateRiskReversal(bracketingSmile);
    expect(typeof rr).toBe("number");
  });

  it("returns null when ±25Δ cannot be bracketed (never fabricated — SPEC R2)", () => {
    const rr = interpolateRiskReversal(unbracketableSmile);
    expect(rr).toBeNull();
  });
});

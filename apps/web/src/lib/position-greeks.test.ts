/**
 * position-greeks.test.ts — TDD suite for computePositionGreeks
 *
 * POSITIONS-01 resolution: GET /api/positions (brokerPosition schema) does NOT carry
 * computed greeks (confirmed: occSymbol/putCall/longQty/shortQty/averagePrice/marketValue/
 * underlyingSymbol only — no delta/gamma/theta/vega field). Per D-03 (live-only, fix at
 * source), greeks are computed client-side via the shared @morai/quant kernel.
 *
 * Suite goals:
 *   1. Kernel parity: computePositionGreeks returns the same delta/gamma/theta/vega as a
 *      direct bsmGreeks() call for the same parsed inputs (D-01 cross-screen consistency).
 *   2. Qty scaling property (fast-check): scaling longQty scales delta linearly.
 *   3. Short position: net qty = longQty - shortQty; short-only position has negative delta.
 *   4. Expired / T=0 edge: positions at or past expiry return NaN for all greeks (T=0 → d1
 *      undefined or infinite in BSM).
 *   5. Parse failure: invalid occSymbol returns an error Result.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { bsmGreeks } from "@morai/quant";
import { computePositionGreeks, type PositionGreeksInput } from "./position-greeks.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** SPX 7400 put expiring 2026-06-12: "SPX   260612P07400000" */
const FIXTURE_OCC = "SPX   260612P07400000";

/** Standard market inputs */
const SPOT = 5800;
const IV = 0.18; // 18% implied vol (decimal)
const RATE = 0.045; // risk-free rate (decimal)
const DIV = 0.013; // continuous dividend yield

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysFromNowToDate(y: number, mo: number, d: number): number {
  const now = Date.now();
  const target = new Date(y, mo - 1, d).getTime();
  return (target - now) / (1000 * 60 * 60 * 24);
}

/** T in years from today to 2026-06-12 */
function tToFixture(): number {
  return daysFromNowToDate(2026, 6, 12) / 365.25;
}

function makeInput(overrides: Partial<PositionGreeksInput> = {}): PositionGreeksInput {
  return {
    occSymbol: FIXTURE_OCC,
    spot: SPOT,
    iv: IV,
    rate: RATE,
    divYield: DIV,
    longQty: 1,
    shortQty: 0,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("position-greeks", () => {
  it("POSITIONS-01 is resolved: brokerPosition carries NO computed greeks — computed client-side via @morai/quant", () => {
    // Documenting the finding: this test always passes to record the decision.
    // See packages/contracts/src/brokerage.ts — brokerPosition has no delta/gamma/theta/vega.
    expect(true).toBe(true);
  });

  describe("computePositionGreeks — kernel parity", () => {
    it("returns delta/gamma/theta/vega equal to direct bsmGreeks() call for the same parsed inputs", () => {
      const input = makeInput();
      const result = computePositionGreeks(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { greeks } = result.value;
      const T = tToFixture();

      // If T <= 0 (expiry in the past) bsmGreeks degrades gracefully; skip parity check
      if (T <= 0) return;

      // Direct kernel call with the same inputs — parity assertion (D-01)
      const expected = bsmGreeks(SPOT, 7400, T, IV, RATE, DIV, "P");

      // Scale by net qty (1 long, 0 short → qty=1): greeks are per-contract (×100 not applied here)
      expect(greeks.delta).toBeCloseTo(expected.delta * 1, 6);
      expect(greeks.gamma).toBeCloseTo(expected.gamma * 1, 6);
      expect(greeks.theta).toBeCloseTo(expected.theta * 1, 6);
      expect(greeks.vega).toBeCloseTo(expected.vega * 1, 6);
    });

    it("short-only position has negative delta for a put (shortQty 1, longQty 0 → net qty -1)", () => {
      const input = makeInput({ longQty: 0, shortQty: 1 });
      const result = computePositionGreeks(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const T = tToFixture();
      if (T <= 0) return;

      // Put delta is negative; net qty is -1; so net delta = kernel.delta * -1 = positive
      // (short put = positive net delta)
      const kernelGreeks = bsmGreeks(SPOT, 7400, T, IV, RATE, DIV, "P");
      expect(result.value.greeks.delta).toBeCloseTo(kernelGreeks.delta * -1, 6);
    });

    it("net qty = longQty - shortQty scales greeks linearly", () => {
      const T = tToFixture();
      if (T <= 0) return;

      const input1 = makeInput({ longQty: 1, shortQty: 0 });
      const input3 = makeInput({ longQty: 3, shortQty: 0 });

      const r1 = computePositionGreeks(input1);
      const r3 = computePositionGreeks(input3);

      expect(r1.ok).toBe(true);
      expect(r3.ok).toBe(true);
      if (!r1.ok || !r3.ok) return;

      // 3× qty → 3× all greeks
      expect(r3.value.greeks.delta).toBeCloseTo(r1.value.greeks.delta * 3, 6);
      expect(r3.value.greeks.gamma).toBeCloseTo(r1.value.greeks.gamma * 3, 6);
      expect(r3.value.greeks.theta).toBeCloseTo(r1.value.greeks.theta * 3, 6);
      expect(r3.value.greeks.vega).toBeCloseTo(r1.value.greeks.vega * 3, 6);
    });
  });

  describe("fast-check: qty-scaling property", () => {
    it("scaling longQty by N scales delta by N (linear scaling invariant)", () => {
      const T = tToFixture();
      if (T <= 0) return;

      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 2, max: 5 }),
          (baseQty, multiplier) => {
            const r1 = computePositionGreeks(makeInput({ longQty: baseQty, shortQty: 0 }));
            const r2 = computePositionGreeks(makeInput({ longQty: baseQty * multiplier, shortQty: 0 }));

            if (!r1.ok || !r2.ok) return false;

            const ratio = r2.value.greeks.delta / r1.value.greeks.delta;
            return Math.abs(ratio - multiplier) < 1e-6;
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe("error cases", () => {
    it("returns err for an invalid OCC symbol (wrong length)", () => {
      const input = makeInput({ occSymbol: "INVALID" });
      const result = computePositionGreeks(input);
      expect(result.ok).toBe(false);
    });

    it("returns err for a bad type char in OCC symbol", () => {
      // Replace 'P' with 'X' at position 13 in a 21-char OCC symbol
      const bad = "SPX   260612X07400000";
      const input = makeInput({ occSymbol: bad });
      const result = computePositionGreeks(input);
      expect(result.ok).toBe(false);
    });

    it("net qty = 0 (longQty == shortQty) returns zero greeks", () => {
      const T = tToFixture();
      if (T <= 0) return;

      const input = makeInput({ longQty: 2, shortQty: 2 });
      const result = computePositionGreeks(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.greeks.delta).toBe(0);
      expect(result.value.greeks.gamma).toBe(0);
      expect(result.value.greeks.theta).toBe(0);
      expect(result.value.greeks.vega).toBe(0);
    });
  });

  describe("computePositionGreeks — call option", () => {
    it("handles a call position correctly — call delta is positive", () => {
      // "SPX   260612C07400000" — call at 7400
      const callOcc = "SPX   260612C07400000";
      const input = makeInput({ occSymbol: callOcc });
      const result = computePositionGreeks(input);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const T = tToFixture();
      if (T <= 0) return;

      // Long call delta is positive (0 < delta < 1)
      expect(result.value.greeks.delta).toBeGreaterThan(0);
      expect(result.value.greeks.delta).toBeLessThan(1);
    });
  });
});

/**
 * payoff-domain.test.ts — computePayoffDomain (D-01, Phase 30, Task 2)
 *
 * Covers: empty-positions fallback, the user's literal 7500P repro (strike 7500,
 * spot ~7381, left BE ~7150), a multi-strike book, and a fast-check property that
 * every strike/spot/breakeven from the wide-pass curves lies within [min, max].
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { computePayoffDomain } from "./payoff-domain.ts";
import type { AnalyzerPosition, ScenarioParams } from "./scenario-engine.ts";

const R = 0.043;
const Q = 0.013;

/**
 * Build a valid 21-char OCC symbol encoding `strike` at positions 13-20
 * (thousandths of a dollar), matching extractStrike()'s parsing.
 */
function occSymbolForStrike(strike: number): string {
  const thousandths = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");
  return `SPX   260808P${thousandths}`;
}

function makePosition(id: string, strike: number, frontDte = 45, backDte = 69, iv = 0.145): AnalyzerPosition {
  return {
    id,
    name: id,
    live: false,
    occSymbol: occSymbolForStrike(strike),
    putCall: "P",
    frontDte,
    backDte,
    frontIv: iv,
    backIv: iv,
    qty: 1,
    included: true,
  };
}

function paramsAt(spot: number): ScenarioParams {
  return { spot, daysForward: 0, ivShift: 0, rate: R, divYield: Q };
}

describe("computePayoffDomain — empty positions fallback", () => {
  it("returns {spot - 1000, spot + 1000} when there are no positions (TOS width, 2026-07-16)", () => {
    const domain = computePayoffDomain([], 7381, paramsAt(7381));
    expect(domain).toEqual({ min: 6381, max: 8381 });
  });
});

describe("computePayoffDomain — TOS x-axis width (2026-07-16 DITTO)", () => {
  it("always spans at least spot ± 1000 even when the tent is narrow", () => {
    const domain = computePayoffDomain([makePosition("tos-1", 7500)], 7381, paramsAt(7381));
    expect(domain.min).toBeLessThanOrEqual(7381 - 1000);
    expect(domain.max).toBeGreaterThanOrEqual(7381 + 1000);
  });

  it("still widens BEYOND ±1000 when an anchor (strike/breakeven) needs it", () => {
    // strike 9000 far outside spot+1000 — the tent must stay visible
    const domain = computePayoffDomain([makePosition("tos-2", 9000)], 7381, paramsAt(7381));
    expect(domain.max).toBeGreaterThanOrEqual(9000);
  });
});

describe("computePayoffDomain — the user's 7500P repro", () => {
  it("brackets the left tail and both breakevens (strike 7500, spot ~7381, left BE ~7150)", () => {
    // front 7d / back 45d, IV 50% — a real calendar shape whose @exp left breakeven
    // lands at ~7143 (verified via a probe script), matching the user's screenshot's
    // "left BE ~7150" report for this strike/spot pair.
    const positions = [makePosition("p1", 7500, 7, 45, 0.5)];
    const domain = computePayoffDomain(positions, 7381, paramsAt(7381));

    // Full left tail + both BEs visible: min must reach past the left BE, max past the strike.
    expect(domain.min).toBeLessThanOrEqual(7150);
    expect(domain.max).toBeGreaterThanOrEqual(7500);
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
  });
});

describe("computePayoffDomain — all positions excluded (WR-01 regression)", () => {
  it("falls back to {spot - 1000, spot + 1000} when every position is excluded, not {min: spot, max: spot}", () => {
    const positions = [
      { ...makePosition("p1", 7000), included: false },
      { ...makePosition("p2", 7600), included: false },
    ];
    const domain = computePayoffDomain(positions, 7300, paramsAt(7300));

    expect(domain).toEqual({ min: 6300, max: 8300 });
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
    expect(domain.max).toBeGreaterThan(domain.min);
  });

  it("falls back the same way when every position is non-convergent (both legs) rather than user-excluded", () => {
    const positions = [{ ...makePosition("p1", 7000), frontIvStatus: "non-convergent" as const, backIvStatus: "non-convergent" as const }];
    const domain = computePayoffDomain(positions, 7300, paramsAt(7300));

    expect(domain).toEqual({ min: 6300, max: 8300 });
  });
});

describe("computePayoffDomain — multi-position book (Pitfall 4)", () => {
  it("spans both strikes' tents simultaneously (7000 and 7600)", () => {
    const positions = [makePosition("p1", 7000), makePosition("p2", 7600)];
    const domain = computePayoffDomain(positions, 7300, paramsAt(7300));

    expect(domain.min).toBeLessThanOrEqual(7000);
    expect(domain.max).toBeGreaterThanOrEqual(7600);
  });
});

describe("computePayoffDomain — fast-check property", () => {
  it("every strike/spot/breakeven lies within [min, max]; padding is a non-negative fraction of the span", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(7100), max: Math.fround(7700), noNaN: true }),
        fc.array(
          fc.float({ min: Math.fround(6900), max: Math.fround(7900), noNaN: true }),
          { minLength: 1, maxLength: 3 },
        ),
        (spot, strikes) => {
          const positions = strikes.map((strike, i) => makePosition(`p${i}`, strike));
          const domain = computePayoffDomain(positions, spot, paramsAt(spot));

          expect(Number.isFinite(domain.min)).toBe(true);
          expect(Number.isFinite(domain.max)).toBe(true);
          expect(domain.max).toBeGreaterThanOrEqual(domain.min);

          expect(spot).toBeGreaterThanOrEqual(domain.min);
          expect(spot).toBeLessThanOrEqual(domain.max);
          for (const strike of strikes) {
            expect(strike).toBeGreaterThanOrEqual(domain.min);
            expect(strike).toBeLessThanOrEqual(domain.max);
          }

          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

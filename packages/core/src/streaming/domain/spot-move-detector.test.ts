/**
 * detectLargeMove — unit + fast-check property tests (SNAP-01, D-05, Pattern 2).
 *
 * RED phase: all tests fail until spot-move-detector.ts is implemented.
 *
 * Must-haves verified here:
 *   - Prunes samples older than windowMs, appends the new sample.
 *   - triggered=true iff |newPrice-oldestInWindow|/oldestInWindow >= thresholdPct.
 *   - Cold start (empty pruned window) never triggers.
 *   - fast-check: pruning invariant (every retained sample is within windowMs of newSample.ts).
 *   - fast-check: direction symmetry (an equal-magnitude move up or down triggers identically).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { detectLargeMove } from "./spot-move-detector.ts";
import type { SpotSample } from "./spot-move-detector.ts";

// ─── Example tests ────────────────────────────────────────────────────────────

describe("detectLargeMove — example tests", () => {
  it("triggers on a move of exactly the threshold (boundary, D-05)", () => {
    const oldest: SpotSample = { ts: 0, price: 1000 };
    const newSample: SpotSample = { ts: 60_000, price: 1010 }; // (1010-1000)/1000 = 0.01
    const { triggered } = detectLargeMove([oldest], newSample, 5 * 60_000, 0.01);
    expect(triggered).toBe(true);
  });

  it("does not trigger on a move below the threshold", () => {
    const oldest: SpotSample = { ts: 0, price: 1000 };
    const newSample: SpotSample = { ts: 60_000, price: 1009 }; // (1009-1000)/1000 = 0.009
    const { triggered } = detectLargeMove([oldest], newSample, 5 * 60_000, 0.01);
    expect(triggered).toBe(false);
  });

  it("cold start: empty window never triggers, nextWindow becomes [newSample]", () => {
    const newSample: SpotSample = { ts: 0, price: 5000 };
    const { triggered, nextWindow } = detectLargeMove([], newSample, 5 * 60_000, 0.01);
    expect(triggered).toBe(false);
    expect(nextWindow).toEqual([newSample]);
  });

  it("prunes samples older than windowMs before comparing", () => {
    const tooOld: SpotSample = { ts: 0, price: 1000 };
    const stillFresh: SpotSample = { ts: 200_000, price: 1005 };
    const newSample: SpotSample = { ts: 300_000, price: 1010 }; // 300s after tooOld — outside 5min window
    // windowMs = 5*60_000 = 300_000; newSample.ts - tooOld.ts = 300_000 (not <= 300_000 is false... equal is kept)
    // Use a window that strictly excludes tooOld: 250_000ms
    const { triggered, nextWindow } = detectLargeMove(
      [tooOld, stillFresh],
      newSample,
      250_000,
      0.01,
    );
    // tooOld pruned (300_000 - 0 = 300_000 > 250_000); oldest retained is stillFresh (price 1005)
    expect(nextWindow).toEqual([stillFresh, newSample]);
    // pctMove against stillFresh: (1010-1005)/1005 ≈ 0.00497 — below threshold
    expect(triggered).toBe(false);
  });

  it("appends the new sample to nextWindow even when not triggered", () => {
    const oldest: SpotSample = { ts: 0, price: 1000 };
    const newSample: SpotSample = { ts: 1000, price: 1001 };
    const { nextWindow } = detectLargeMove([oldest], newSample, 5 * 60_000, 0.01);
    expect(nextWindow).toEqual([oldest, newSample]);
  });
});

// ─── fast-check properties ────────────────────────────────────────────────────

describe("detectLargeMove — fast-check properties", () => {
  it("pruning invariant: every sample in nextWindow is within windowMs of newSample.ts", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ts: fc.integer({ min: 0, max: 1_000_000 }),
            price: fc.float({ min: Math.fround(1), max: Math.fround(10_000), noNaN: true }),
          }),
          { maxLength: 20 },
        ),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.float({ min: Math.fround(1), max: Math.fround(10_000), noNaN: true }),
        fc.integer({ min: 1, max: 600_000 }),
        (samples, newTs, newPrice, windowMs) => {
          const newSample: SpotSample = { ts: newTs, price: newPrice };
          const { nextWindow } = detectLargeMove(samples, newSample, windowMs, 0.01);
          for (const s of nextWindow) {
            expect(newTs - s.ts).toBeLessThanOrEqual(windowMs);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("direction symmetry: a move of equal magnitude up or down triggers identically", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(1), max: Math.fround(10_000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(0.4), noNaN: true }),
        (oldestPrice, magnitude) => {
          // Keep a safety margin away from the 0.01 threshold so float rounding
          // never flips one direction's outcome relative to the other's.
          fc.pre(Math.abs(magnitude - 0.01) > 1e-6);
          const oldest: SpotSample = { ts: 0, price: oldestPrice };
          const upPrice = oldestPrice * (1 + magnitude);
          const downPrice = oldestPrice * (1 - magnitude);
          fc.pre(downPrice > 0);
          const windowMs = 5 * 60_000;
          const thresholdPct = 0.01;
          const upResult = detectLargeMove(
            [oldest],
            { ts: 1000, price: upPrice },
            windowMs,
            thresholdPct,
          );
          const downResult = detectLargeMove(
            [oldest],
            { ts: 1000, price: downPrice },
            windowMs,
            thresholdPct,
          );
          expect(upResult.triggered).toBe(downResult.triggered);
        },
      ),
      { numRuns: 100 },
    );
  });
});

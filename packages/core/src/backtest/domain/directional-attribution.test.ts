/**
 * directional-attribution.test.ts — median-split sign test (BT-04).
 *
 * Locked constraint (27-CONTEXT.md): sign + n, NEVER a correlation coefficient. Covers the
 * edge cases 27-CONTEXT.md's Testing section names: constant arrays, n<4 (insufficient
 * floor), ties, and a known positive/negative split.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { directionalAttribution, type AttributionSample } from "./directional-attribution.ts";

describe("directionalAttribution", () => {
  it("returns insufficient for n below the floor (< 4)", () => {
    expect(directionalAttribution([]).verdict).toBe("insufficient");
    expect(directionalAttribution([{ metric: 1, outcome: 1 }]).verdict).toBe("insufficient");
    expect(
      directionalAttribution([
        { metric: 1, outcome: 1 },
        { metric: 2, outcome: 2 },
      ]).verdict,
    ).toBe("insufficient");
    expect(
      directionalAttribution([
        { metric: 1, outcome: 1 },
        { metric: 2, outcome: 2 },
        { metric: 3, outcome: 3 },
      ]).verdict,
    ).toBe("insufficient");
  });

  it("reports n equal to the sample count regardless of verdict", () => {
    expect(directionalAttribution([{ metric: 1, outcome: 1 }]).n).toBe(1);
    const samples: AttributionSample[] = [
      { metric: 1, outcome: 1 },
      { metric: 2, outcome: 10 },
      { metric: 3, outcome: 1 },
      { metric: 4, outcome: 10 },
    ];
    expect(directionalAttribution(samples).n).toBe(4);
  });

  it("returns insufficient for a constant metric array (no split possible)", () => {
    const samples: AttributionSample[] = [
      { metric: 5, outcome: 1 },
      { metric: 5, outcome: 2 },
      { metric: 5, outcome: 3 },
      { metric: 5, outcome: 4 },
      { metric: 5, outcome: 5 },
    ];
    expect(directionalAttribution(samples).verdict).toBe("insufficient");
  });

  it("returns yes for a known positive split (high-scoring beats low-scoring)", () => {
    const samples: AttributionSample[] = [
      { metric: 1, outcome: 1 },
      { metric: 2, outcome: 1 },
      { metric: 3, outcome: 10 },
      { metric: 4, outcome: 10 },
    ];
    expect(directionalAttribution(samples).verdict).toBe("yes");
  });

  it("returns no for a known negative split (high-scoring does NOT beat low-scoring)", () => {
    const samples: AttributionSample[] = [
      { metric: 1, outcome: 10 },
      { metric: 2, outcome: 10 },
      { metric: 3, outcome: 1 },
      { metric: 4, outcome: 1 },
    ];
    expect(directionalAttribution(samples).verdict).toBe("no");
  });

  it("handles ties at the median deterministically (metric <= median => low half)", () => {
    // median of [1,1,1,10] is (1+1)/2=1 → three metric<=1 samples in the low half, one in high.
    const samples: AttributionSample[] = [
      { metric: 1, outcome: 1 },
      { metric: 1, outcome: 1 },
      { metric: 1, outcome: 1 },
      { metric: 10, outcome: 10 },
    ];
    const first = directionalAttribution(samples);
    const second = directionalAttribution(samples);
    expect(first).toEqual(second); // deterministic, not order-of-call-dependent
    expect(first.verdict).toBe("yes");
  });

  it("fast-check: never returns a numeric coefficient — verdict is always one of the three sign strings", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            metric: fc.double({ min: -1000, max: 1000, noNaN: true }),
            outcome: fc.double({ min: -1000, max: 1000, noNaN: true }),
          }),
          { maxLength: 30 },
        ),
        (samples) => {
          const result = directionalAttribution(samples);
          return (
            ["yes", "no", "insufficient"].includes(result.verdict) && result.n === samples.length
          );
        },
      ),
    );
  });

  it("fast-check: a constant metric array always degenerates to insufficient", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 4, maxLength: 20 }),
        (metric, outcomes) => {
          const samples = outcomes.map((outcome) => ({ metric, outcome }));
          return directionalAttribution(samples).verdict === "insufficient";
        },
      ),
    );
  });

  it("fast-check: n below the floor is always insufficient regardless of values", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            metric: fc.double({ min: -1000, max: 1000, noNaN: true }),
            outcome: fc.double({ min: -1000, max: 1000, noNaN: true }),
          }),
          { maxLength: 3 },
        ),
        (samples) => directionalAttribution(samples).verdict === "insufficient",
      ),
    );
  });
});

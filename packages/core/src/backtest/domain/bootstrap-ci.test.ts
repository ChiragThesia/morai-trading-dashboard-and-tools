/**
 * bootstrap-ci.test.ts — seeded bootstrap confidence interval (BT-04).
 *
 * Covers the four invariants 27-CONTEXT.md/27-RESEARCH.md lock: seed-determinism (a
 * re-run over identical replay data reproduces an identical interval — no false "the
 * numbers changed" alarm from an append-only audit tool), constant-array degeneracy,
 * n=1 degeneracy, and low <= high always. Empty samples => { low: NaN, high: NaN, n: 0 }.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bootstrapCi } from "./bootstrap-ci.ts";

describe("bootstrapCi", () => {
  it("returns NaN low/high and n=0 for empty samples", () => {
    const result = bootstrapCi([], 42);
    expect(Number.isNaN(result.low)).toBe(true);
    expect(Number.isNaN(result.high)).toBe(true);
    expect(result.n).toBe(0);
  });

  it("degenerates to a point interval for a constant samples array", () => {
    const result = bootstrapCi([7, 7, 7, 7, 7], 42, 500);
    expect(result.low).toBe(7);
    expect(result.high).toBe(7);
    expect(result.n).toBe(5);
  });

  it("degenerates to a point interval at n=1", () => {
    const result = bootstrapCi([13], 42, 500);
    expect(result.low).toBe(13);
    expect(result.high).toBe(13);
    expect(result.n).toBe(1);
  });

  it("is reproducible: same seed + same samples => identical interval", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const first = bootstrapCi(samples, 99, 500);
    const second = bootstrapCi(samples, 99, 500);
    expect(second).toEqual(first);
  });

  it("low is always <= high for a non-degenerate sample set", () => {
    const result = bootstrapCi([1, 5, 2, 8, 3, 9, 4, 7, 6, 10], 7, 500);
    expect(result.low).toBeLessThanOrEqual(result.high);
  });

  it("fast-check: low <= high always, for any non-empty sample set and seed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (samples, seed) => {
          const result = bootstrapCi(samples, seed, 200);
          return result.low <= result.high;
        },
      ),
    );
  });

  it("fast-check: same seed + same samples always reproduce the identical interval", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1000, max: 1000, noNaN: true }), { minLength: 1, maxLength: 20 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (samples, seed) => {
          const first = bootstrapCi(samples, seed, 150);
          const second = bootstrapCi(samples, seed, 150);
          return first.low === second.low && first.high === second.high && first.n === second.n;
        },
      ),
    );
  });

  it("fast-check: a constant samples array always degenerates to a point interval", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 1000, noNaN: true }),
        fc.integer({ min: 2, max: 20 }),
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        (value, length, seed) => {
          const samples = Array.from({ length }, () => value);
          const result = bootstrapCi(samples, seed, 200);
          return result.low === value && result.high === value;
        },
      ),
    );
  });
});

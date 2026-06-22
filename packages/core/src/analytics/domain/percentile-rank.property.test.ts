/**
 * percentile-rank property tests (Phase 6, Plan 06-03) — fast-check, per tdd.md numerical rule.
 *
 * Invariants:
 *   - Bounds: result always within [0, 100] for any value + (possibly empty) history.
 *   - Monotonicity: for a fixed history, a larger value yields a rank ≥ the smaller value's rank.
 *   - Inclusivity: percentileRank(x, history containing x) ≥ 100·(occurrences of x)/n.
 *
 * fc.float v4 requires 32-bit bounds via Math.fround() (Phase 1/5 precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { percentileRank } from "./percentile-rank.ts";

const valueArb = fc.float({ min: Math.fround(-5), max: Math.fround(5), noNaN: true });
const historyArb = fc.array(valueArb, { maxLength: 300 });

describe("percentileRank — properties", () => {
  it("bounds: result is always within [0, 100]", () => {
    fc.assert(
      fc.property(valueArb, historyArb, (value, history) => {
        const r = percentileRank(value, history);
        return r >= 0 && r <= 100;
      }),
      { numRuns: 1000 },
    );
  });

  it("monotonicity: larger value ⇒ rank ≥ smaller value's rank (fixed history)", () => {
    fc.assert(
      fc.property(valueArb, valueArb, historyArb, (a, b, history) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return percentileRank(hi, history) >= percentileRank(lo, history);
      }),
      { numRuns: 1000 },
    );
  });

  it("inclusivity: rank(x, history∋x) ≥ 100·occurrences(x)/n", () => {
    fc.assert(
      fc.property(
        valueArb,
        fc.array(valueArb, { maxLength: 100 }),
        (x, rest) => {
          // Insert at least one occurrence of x so it is guaranteed present.
          const history = [...rest, x];
          const n = history.length;
          const occurrences = history.filter((h) => h === x).length;
          const expectedFloor = (100 * occurrences) / n;
          // tolerance for float division
          return percentileRank(x, history) >= expectedFloor - 1e-9;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

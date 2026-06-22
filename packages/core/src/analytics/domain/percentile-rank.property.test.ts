/**
 * percentile-rank property tests (Phase 6, Plan 06-03) — fast-check, per tdd.md numerical rule.
 *
 * Invariants:
 *   - Empty history → null (06-08 / WR-01): no prior distribution to rank against.
 *   - Bounds: for NON-empty history the result is within [0, 100] for any value.
 *   - Monotonicity: for a fixed NON-empty history, a larger value yields a rank ≥ the smaller's.
 *   - Inclusivity: percentileRank(x, history containing x) ≥ 100·(occurrences of x)/n.
 *
 * fc.float v4 requires 32-bit bounds via Math.fround() (Phase 1/5 precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { percentileRank } from "./percentile-rank.ts";

const valueArb = fc.float({ min: Math.fround(-5), max: Math.fround(5), noNaN: true });
const historyArb = fc.array(valueArb, { maxLength: 300 });

// Non-empty history arbitrary — the [0,100] / monotonicity invariants only hold when there is a
// distribution to rank against. Empty history is covered by its own null property below.
const nonEmptyHistoryArb = fc.array(valueArb, { minLength: 1, maxLength: 300 });

describe("percentileRank — properties", () => {
  it("empty history ⇒ null (no prior distribution)", () => {
    fc.assert(
      fc.property(valueArb, (value) => percentileRank(value, []) === null),
      { numRuns: 1000 },
    );
  });

  it("bounds: result is always within [0, 100] for non-empty history", () => {
    fc.assert(
      fc.property(valueArb, nonEmptyHistoryArb, (value, history) => {
        const r = percentileRank(value, history);
        return r !== null && r >= 0 && r <= 100;
      }),
      { numRuns: 1000 },
    );
  });

  it("monotonicity: larger value ⇒ rank ≥ smaller value's rank (fixed non-empty history)", () => {
    fc.assert(
      fc.property(valueArb, valueArb, nonEmptyHistoryArb, (a, b, history) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const rHi = percentileRank(hi, history);
        const rLo = percentileRank(lo, history);
        return rHi !== null && rLo !== null && rHi >= rLo;
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
          const r = percentileRank(x, history);
          // history always contains x (non-empty) → r is a number, never null.
          // tolerance for float division
          return r !== null && r >= expectedFloor - 1e-9;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

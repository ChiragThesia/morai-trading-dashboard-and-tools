/**
 * ablation-delta.test.ts — leave-one-rule-out rank delta (BT-04).
 *
 * ablationDelta only diffs two already-ranked id lists (baseline vs ablated); it never
 * re-scores. The core invariant (27-CONTEXT.md): zeroing a rule whose raw contribution to
 * a candidate was positive never yields an improved (lower-numbered) rank for that
 * candidate — a rescore that only ever removes value from one candidate can only push its
 * rank index up (worse) or leave it unchanged, never down (better).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { assertDefined } from "@morai/shared";
import { ablationDelta } from "./ablation-delta.ts";

describe("ablationDelta", () => {
  it("returns the rank-index delta when a candidate drops in the ablated ranking", () => {
    const baseline = ["a", "b", "c"];
    const ablated = ["b", "a", "c"]; // "a" moved from rank 1 (index 0) to rank 2 (index 1)
    expect(ablationDelta(baseline, ablated, "a")).toBe(1);
  });

  it("returns 0 when the candidate's rank is unchanged", () => {
    const baseline = ["a", "b", "c"];
    const ablated = ["a", "c", "b"];
    expect(ablationDelta(baseline, ablated, "a")).toBe(0);
  });

  it("returns a negative delta when the candidate's rank improves", () => {
    const baseline = ["a", "b", "c"];
    const ablated = ["c", "a", "b"]; // "c" moved from rank 3 to rank 1
    expect(ablationDelta(baseline, ablated, "c")).toBe(-2);
  });

  it("returns null when the candidate is missing from either ranking", () => {
    expect(ablationDelta(["a", "b"], ["a", "b"], "z")).toBeNull();
    expect(ablationDelta([], [], "a")).toBeNull();
  });

  it("returns 0 for a single-candidate ranking (n=1)", () => {
    expect(ablationDelta(["a"], ["a"], "a")).toBe(0);
  });

  it("fast-check: zeroing a positive-contribution rule never improves a candidate's rank", () => {
    const candidateArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 8 }),
      score: fc.double({ min: -1000, max: 1000, noNaN: true }),
    });

    fc.assert(
      fc.property(
        fc.uniqueArray(candidateArb, { selector: (c) => c.id, minLength: 2, maxLength: 12 }),
        fc.nat(),
        fc.double({ min: 0.0001, max: 500, noNaN: true }), // positive raw contribution
        (candidates, targetIdxRaw, contribution) => {
          const targetIdx = targetIdxRaw % candidates.length;
          const target = candidates[targetIdx];
          assertDefined(target, "fast-check: target candidate missing");

          const rankOf = (
            list: ReadonlyArray<{ readonly id: string; readonly score: number }>,
          ): ReadonlyArray<string> =>
            [...list]
              .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)))
              .map((c) => c.id);

          const baselineRanked = rankOf(candidates);
          // Ablate: remove the positive contribution from the target candidate ONLY — every
          // other candidate's score is untouched, so the target's score can only fall.
          const ablatedCandidates = candidates.map((c) =>
            c.id === target.id ? { ...c, score: c.score - contribution } : c,
          );
          const ablatedRanked = rankOf(ablatedCandidates);

          const delta = ablationDelta(baselineRanked, ablatedRanked, target.id);
          return delta !== null && delta >= 0;
        },
      ),
    );
  });
});

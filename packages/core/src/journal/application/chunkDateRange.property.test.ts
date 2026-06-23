/**
 * chunkDateRange.property.test.ts — fast-check properties for the pure date-window chunker
 * (BRK-04). Mirrors the numRuns≥1000 convention in syncTransactions.property.test.ts.
 *
 * Locked properties over any valid [from,to] and positive maxDays:
 *   A (no gaps)        — the union of all chunk day-spans equals the inclusive [from,to] day set.
 *   B (no overlap)     — chunk spans are pairwise disjoint (adjacent windows share no day).
 *   C (cap per window) — every chunk spans ≤ maxDays days inclusive.
 *   D (invalid input)  — maxDays ≤ 0 → Result.err; from > to → Result.err.
 *
 * No node:* in core (incl. tests — the no-restricted-imports rule). Day math uses Date
 * arithmetic on UTC midnight, the same idiom as syncTransactions.ts. No any/as/! (typescript.md).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { chunkDateRange } from "./chunkDateRange.ts";

const DAY_MS = 86_400_000;

// Format a UTC-midnight epoch-day offset back to YYYY-MM-DD.
function toYmd(epochDayMs: number): string {
  return new Date(epochDayMs).toISOString().slice(0, 10);
}

// Parse YYYY-MM-DD to a UTC-midnight epoch ms (the inverse of toYmd).
function fromYmd(ymd: string): number {
  return new Date(ymd + "T00:00:00Z").getTime();
}

// Expand a window into the inclusive set of day-strings it covers.
function daysOf(window: { from: string; to: string }): string[] {
  const start = fromYmd(window.from);
  const end = fromYmd(window.to);
  const days: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) days.push(toYmd(t));
  return days;
}

// fast-check arbitrary: a valid [from,to] (0..720 day span from a base date) and a maxDays
// in [1, 400]. The base date stays away from epoch edges so UTC math is unambiguous.
const validInput = fc
  .record({
    baseDayOffset: fc.integer({ min: 0, max: 4000 }), // days after 2020-01-01
    span: fc.integer({ min: 0, max: 720 }), // inclusive extra days → to = from + span
    maxDays: fc.integer({ min: 1, max: 400 }),
  })
  .map(({ baseDayOffset, span, maxDays }) => {
    const fromMs = fromYmd("2020-01-01") + baseDayOffset * DAY_MS;
    const toMs = fromMs + span * DAY_MS;
    return { from: toYmd(fromMs), to: toYmd(toMs), maxDays };
  });

describe("chunkDateRange properties", () => {
  it("A: chunks cover [from,to] with NO gaps (union equals the inclusive day set) (numRuns≥1000)", () => {
    fc.assert(
      fc.property(validInput, ({ from, to, maxDays }) => {
        const result = chunkDateRange(from, to, maxDays);
        if (!result.ok) return false;
        const covered = result.value.flatMap(daysOf);
        const expected = daysOf({ from, to });
        // Same length and same ordered sequence → contiguous, no gaps, no extras.
        return JSON.stringify(covered) === JSON.stringify(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it("B: chunk spans are pairwise disjoint — NO day appears twice (numRuns≥1000)", () => {
    fc.assert(
      fc.property(validInput, ({ from, to, maxDays }) => {
        const result = chunkDateRange(from, to, maxDays);
        if (!result.ok) return false;
        const covered = result.value.flatMap(daysOf);
        const unique = new Set(covered);
        return unique.size === covered.length;
      }),
      { numRuns: 1000 },
    );
  });

  it("C: every window spans ≤ maxDays days inclusive (numRuns≥1000)", () => {
    fc.assert(
      fc.property(validInput, ({ from, to, maxDays }) => {
        const result = chunkDateRange(from, to, maxDays);
        if (!result.ok) return false;
        return result.value.every((w) => daysOf(w).length <= maxDays);
      }),
      { numRuns: 1000 },
    );
  });

  it("C2: each window's from = previous window's to + 1 day (contiguous, inclusive) (numRuns≥1000)", () => {
    fc.assert(
      fc.property(validInput, ({ from, to, maxDays }) => {
        const result = chunkDateRange(from, to, maxDays);
        if (!result.ok) return false;
        const windows = result.value;
        for (let i = 1; i < windows.length; i++) {
          const prev = windows[i - 1];
          const cur = windows[i];
          if (prev === undefined || cur === undefined) return false;
          if (fromYmd(cur.from) !== fromYmd(prev.to) + DAY_MS) return false;
        }
        // First window starts at `from`, last window ends at `to`.
        const first = windows[0];
        const last = windows[windows.length - 1];
        if (first === undefined || last === undefined) return false;
        return first.from === from && last.to === to;
      }),
      { numRuns: 1000 },
    );
  });

  it("D: maxDays ≤ 0 → Result.err (numRuns≥1000)", () => {
    fc.assert(
      fc.property(
        validInput,
        fc.integer({ min: -400, max: 0 }),
        ({ from, to }, badMax) => {
          const result = chunkDateRange(from, to, badMax);
          return result.ok === false;
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("D2: from > to → Result.err (numRuns≥1000)", () => {
    fc.assert(
      fc.property(validInput, ({ from, to, maxDays }) => {
        fc.pre(from !== to);
        // Swap so from is strictly after to.
        const result = chunkDateRange(to, from, maxDays);
        // Only a genuinely inverted range (to < from) must err.
        if (fromYmd(to) < fromYmd(from)) return result.ok === false;
        return true;
      }),
      { numRuns: 1000 },
    );
  });
});

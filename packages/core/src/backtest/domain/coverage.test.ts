/**
 * coverage.test.ts — replayed-of-total coverage, gap cohorts excluded (BT-04).
 *
 * Locked constraint (27-CONTEXT.md/27-RESEARCH.md): a cohort flagged spot 0/NaN counts
 * toward the day's total but NEVER toward "replayed" — a gap cohort is never counted as
 * successfully replayed.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { coveragePercent, type CoverageCohort } from "./coverage.ts";

describe("coveragePercent", () => {
  it("returns empty perDay and a zeroed overall for an empty cohort list", () => {
    const result = coveragePercent([]);
    expect(result.perDay).toEqual([]);
    expect(result.overall).toEqual({ date: "overall", replayed: 0, total: 0, coveragePct: 0 });
  });

  it("counts a gap cohort toward total but never toward replayed", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-01", isGap: false },
      { date: "2026-07-01", isGap: true },
      { date: "2026-07-01", isGap: true },
    ];
    const result = coveragePercent(cohorts);
    expect(result.perDay).toEqual([
      { date: "2026-07-01", replayed: 1, total: 3, coveragePct: (100 * 1) / 3 },
    ]);
  });

  it("reports 100% coverage when no cohort is a gap", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-02", isGap: false },
      { date: "2026-07-02", isGap: false },
    ];
    expect(coveragePercent(cohorts).perDay).toEqual([
      { date: "2026-07-02", replayed: 2, total: 2, coveragePct: 100 },
    ]);
  });

  it("reports 0% coverage when every cohort for a day is a gap", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-03", isGap: true },
      { date: "2026-07-03", isGap: true },
    ];
    expect(coveragePercent(cohorts).perDay).toEqual([
      { date: "2026-07-03", replayed: 0, total: 2, coveragePct: 0 },
    ]);
  });

  it("groups multiple days and sorts perDay ascending by date", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-05", isGap: false },
      { date: "2026-07-01", isGap: true },
      { date: "2026-07-01", isGap: false },
    ];
    const result = coveragePercent(cohorts);
    expect(result.perDay.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-05"]);
    expect(result.overall).toEqual({
      date: "overall",
      replayed: 2,
      total: 3,
      coveragePct: (100 * 2) / 3,
    });
  });

  it("fast-check: replayed is never greater than total, per day and overall", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            date: fc.constantFrom("2026-07-01", "2026-07-02", "2026-07-03"),
            isGap: fc.boolean(),
          }),
          { maxLength: 40 },
        ),
        (cohorts) => {
          const result = coveragePercent(cohorts);
          const perDayOk = result.perDay.every((d) => d.replayed <= d.total);
          return perDayOk && result.overall.replayed <= result.overall.total;
        },
      ),
    );
  });

  it("fast-check: a gap cohort is never counted as replayed (replayed = total - gapCount)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { maxLength: 40 }), // one entry per cohort, all same day
        (gapFlags) => {
          const cohorts: CoverageCohort[] = gapFlags.map((isGap) => ({ date: "2026-07-09", isGap }));
          const result = coveragePercent(cohorts);
          const gapCount = gapFlags.filter(Boolean).length;
          const expectedReplayed = gapFlags.length - gapCount;
          return result.overall.replayed === expectedReplayed && result.overall.total === gapFlags.length;
        },
      ),
    );
  });
});

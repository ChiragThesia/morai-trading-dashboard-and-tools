/**
 * coverage.test.ts — replayed-of-total coverage, gap AND empty-universe slots excluded from
 * "replayed" but counted DISTINCTLY (BT-04, WR-03).
 *
 * Locked constraint (27-CONTEXT.md/27-RESEARCH.md): a cohort with no/degenerate chain data
 * ("gap") and a real-data cohort with zero surviving candidates ("empty-universe") both count
 * toward the day's total but NEVER toward "replayed" — and the two are reported separately so
 * a thin-real-data footprint is not mislabeled as a data gap.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { coveragePercent, type CoverageCohort } from "./coverage.ts";

describe("coveragePercent", () => {
  it("returns empty perDay and a zeroed overall for an empty cohort list", () => {
    const result = coveragePercent([]);
    expect(result.perDay).toEqual([]);
    expect(result.overall).toEqual({
      date: "overall",
      replayed: 0,
      gap: 0,
      emptyUniverse: 0,
      total: 0,
      coveragePct: 0,
    });
  });

  it("counts gap and empty-universe toward total but never replayed, and distinctly (WR-03)", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-01", kind: "replayed" },
      { date: "2026-07-01", kind: "gap" },
      { date: "2026-07-01", kind: "empty-universe" },
    ];
    const result = coveragePercent(cohorts);
    expect(result.perDay).toEqual([
      { date: "2026-07-01", replayed: 1, gap: 1, emptyUniverse: 1, total: 3, coveragePct: (100 * 1) / 3 },
    ]);
  });

  it("reports 100% coverage when every cohort is replayed", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-02", kind: "replayed" },
      { date: "2026-07-02", kind: "replayed" },
    ];
    expect(coveragePercent(cohorts).perDay).toEqual([
      { date: "2026-07-02", replayed: 2, gap: 0, emptyUniverse: 0, total: 2, coveragePct: 100 },
    ]);
  });

  it("reports 0% coverage when every cohort for a day is a gap or empty universe", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-03", kind: "gap" },
      { date: "2026-07-03", kind: "empty-universe" },
    ];
    expect(coveragePercent(cohorts).perDay).toEqual([
      { date: "2026-07-03", replayed: 0, gap: 1, emptyUniverse: 1, total: 2, coveragePct: 0 },
    ]);
  });

  it("groups multiple days and sorts perDay ascending by date", () => {
    const cohorts: CoverageCohort[] = [
      { date: "2026-07-05", kind: "replayed" },
      { date: "2026-07-01", kind: "gap" },
      { date: "2026-07-01", kind: "replayed" },
    ];
    const result = coveragePercent(cohorts);
    expect(result.perDay.map((d) => d.date)).toEqual(["2026-07-01", "2026-07-05"]);
    expect(result.overall).toEqual({
      date: "overall",
      replayed: 2,
      gap: 1,
      emptyUniverse: 0,
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
            kind: fc.constantFrom<CoverageCohort["kind"]>("replayed", "gap", "empty-universe"),
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

  it("fast-check: replayed = total - gap - emptyUniverse (nothing double-counted)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<CoverageCohort["kind"]>("replayed", "gap", "empty-universe"), { maxLength: 40 }),
        (kinds) => {
          const cohorts: CoverageCohort[] = kinds.map((kind) => ({ date: "2026-07-09", kind }));
          const { overall } = coveragePercent(cohorts);
          return (
            overall.replayed === overall.total - overall.gap - overall.emptyUniverse &&
            overall.total === kinds.length
          );
        },
      ),
    );
  });
});

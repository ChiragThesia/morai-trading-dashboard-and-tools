/**
 * coverage — replayed-of-total cohort coverage, gap cohorts excluded (BT-04).
 *
 * Reduces a flat list of per-cohort {date, isGap} records into per-day and overall
 * replayed/total figures. A gap cohort (spot 0/NaN) counts toward `total` but NEVER
 * toward `replayed` — this IS the "thin real-data footprint" visibility 27-CONTEXT.md
 * asks the report to surface, not silently absorb. Pure — no I/O, no clock.
 */

export type CoverageCohort = {
  readonly date: string; // YYYY-MM-DD
  readonly isGap: boolean; // true = spot 0/NaN, excluded from "replayed"
};

export type CoverageDayResult = {
  readonly date: string;
  readonly replayed: number;
  readonly total: number;
  readonly coveragePct: number;
};

export type CoveragePercentResult = {
  readonly perDay: ReadonlyArray<CoverageDayResult>;
  readonly overall: CoverageDayResult;
};

function pct(replayed: number, total: number): number {
  return total === 0 ? 0 : (100 * replayed) / total;
}

export function coveragePercent(cohorts: ReadonlyArray<CoverageCohort>): CoveragePercentResult {
  const byDay = new Map<string, { replayed: number; total: number }>();
  for (const c of cohorts) {
    const entry = byDay.get(c.date) ?? { replayed: 0, total: 0 };
    entry.total += 1;
    if (!c.isGap) entry.replayed += 1;
    byDay.set(c.date, entry);
  }

  const perDay: CoverageDayResult[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, { replayed, total }]) => ({ date, replayed, total, coveragePct: pct(replayed, total) }));

  const totalReplayed = cohorts.filter((c) => !c.isGap).length;
  const totalCohorts = cohorts.length;
  const overall: CoverageDayResult = {
    date: "overall",
    replayed: totalReplayed,
    total: totalCohorts,
    coveragePct: pct(totalReplayed, totalCohorts),
  };

  return { perDay, overall };
}

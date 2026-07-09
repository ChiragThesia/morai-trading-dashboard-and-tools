/**
 * coverage — replayed-of-total cohort coverage, gap AND empty-universe slots excluded (BT-04).
 *
 * Reduces a flat list of per-cohort {date, kind} records into per-day and overall figures. A
 * "gap" cohort (no/degenerate chain, spot 0/NaN) and an "empty-universe" cohort (real chain
 * data but zero surviving candidates — all gate-dropped or none forward-replayable) BOTH count
 * toward `total` but NEVER toward `replayed`. They are tallied SEPARATELY (WR-03) so a thin
 * real-data footprint (empty universe) is never mislabeled as a data gap — the two tell
 * different stories about why coverage is low. Pure — no I/O, no clock.
 */

export type CoverageSlotKind = "replayed" | "gap" | "empty-universe";

export type CoverageCohort = {
  readonly date: string; // YYYY-MM-DD
  readonly kind: CoverageSlotKind;
};

export type CoverageDayResult = {
  readonly date: string;
  readonly replayed: number;
  readonly gap: number; // no/degenerate chain — a true data gap
  readonly emptyUniverse: number; // real data, zero surviving candidates
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

type Tally = { replayed: number; gap: number; emptyUniverse: number; total: number };

function tally(cohorts: ReadonlyArray<CoverageCohort>): Tally {
  const t: Tally = { replayed: 0, gap: 0, emptyUniverse: 0, total: 0 };
  for (const c of cohorts) {
    t.total += 1;
    if (c.kind === "replayed") t.replayed += 1;
    else if (c.kind === "gap") t.gap += 1;
    else t.emptyUniverse += 1;
  }
  return t;
}

export function coveragePercent(cohorts: ReadonlyArray<CoverageCohort>): CoveragePercentResult {
  const byDay = new Map<string, CoverageCohort[]>();
  for (const c of cohorts) {
    const entry = byDay.get(c.date) ?? [];
    entry.push(c);
    byDay.set(c.date, entry);
  }

  const perDay: CoverageDayResult[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, dayCohorts]) => {
      const t = tally(dayCohorts);
      return { date, ...t, coveragePct: pct(t.replayed, t.total) };
    });

  const t = tally(cohorts);
  const overall: CoverageDayResult = { date: "overall", ...t, coveragePct: pct(t.replayed, t.total) };

  return { perDay, overall };
}

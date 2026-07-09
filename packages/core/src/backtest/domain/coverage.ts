/**
 * coverage — replayed-of-total cohort coverage, gap cohorts excluded (BT-04). RED stub —
 * see coverage.test.ts for the behavior contract.
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

export function coveragePercent(_cohorts: ReadonlyArray<CoverageCohort>): CoveragePercentResult {
  throw new Error("not implemented");
}

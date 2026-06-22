/**
 * makeComputeAnalyticsUseCase — the compute-analytics use-case.
 *
 * 06-04 implemented the TERM-STRUCTURE half; 06-05 adds the skew/RR half: read the per-strike
 * smile, write the full smile to skew_observations (R1), then per (underlying, expiration) compute
 * the 25Δ risk-reversal (interpolateRiskReversal — null when unbracketable, R2) + its trailing-
 * window rank (percentileRank over readRrHistory). The use-case calls the 06-03 domain functions;
 * it does NOT reimplement interpolation or rank.
 *
 * Term-structure algorithm (SPEC R3):
 *   1. Read calendar_snapshots for the current cycle (ForReadingCalendarSnapshotsForCycle,
 *      scoped to the injected now() — the most recent snapshot cycle on or before now).
 *   2. For each snapshot row, build a TermStructureObservationRow with
 *      `value = row.termSlope` PASSED THROUGH UNCHANGED — never recomputed (T-06-07). frontIv
 *      and backIv are copied for context; snapshotTime + calendarId come from the source row.
 *   3. Skip NaN-slope continuity rows — a NaN term-structure value is never written (D-06).
 *   4. Write via ForWritingTermStructureObservations (idempotent at the repo).
 *
 * Pure application: imports only @morai/shared + local ports. No I/O, no Date.now() (now is
 * injected per architecture-boundaries.md §2). Returns Result<void, StorageError>.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForReadingSmileSource,
  ForReadingCalendarSnapshotsForCycle,
  ForWritingSkewObservations,
  ForWritingRiskReversalObservations,
  ForWritingTermStructureObservations,
  ForReadingRiskReversalHistory,
  SmileQuote,
  SkewObservationRow,
  RiskReversalObservationRow,
  TermStructureObservationRow,
  StorageError,
} from "./ports.ts";
import { interpolateRiskReversal } from "../domain/risk-reversal.ts";
import { percentileRank } from "../domain/percentile-rank.ts";

export type ComputeAnalyticsDeps = {
  /** Skew/RR-half source — read the per-strike smile (exercised in 06-05). */
  readonly readSmile: ForReadingSmileSource;
  /** Term-structure source — calendar_snapshots rows for the cycle (term_slope passthrough). */
  readonly readSnapshots: ForReadingCalendarSnapshotsForCycle;
  /** Skew-half writer (06-05). */
  readonly writeSkew: ForWritingSkewObservations;
  /** RR-half writer (06-05). */
  readonly writeRr: ForWritingRiskReversalObservations;
  /** Term-structure writer (idempotent at the repo). */
  readonly writeTerm: ForWritingTermStructureObservations;
  /** RR trailing-history reader (06-05). */
  readonly readRrHistory: ForReadingRiskReversalHistory;
  /** Clock injection — never call Date.now() in core (architecture-boundaries.md §2). */
  readonly now: () => Date;
};

/** Driver port returned by the factory. */
export type ForRunningComputeAnalytics = () => Promise<Result<void, StorageError>>;

export function makeComputeAnalyticsUseCase(
  deps: ComputeAnalyticsDeps,
): ForRunningComputeAnalytics {
  return async (): Promise<Result<void, StorageError>> => {
    const cycle = deps.now();

    // ── Term-structure half (SPEC R3) ──────────────────────────────────────────
    const snapshotsResult = await deps.readSnapshots(cycle);
    if (!snapshotsResult.ok) return err(snapshotsResult.error);

    const termRows: TermStructureObservationRow[] = [];
    for (const snap of snapshotsResult.value) {
      // D-06: skip NaN-slope continuity rows — never write a NaN term-structure value.
      if (Number.isNaN(snap.termSlope)) continue;
      termRows.push({
        snapshotTime: snap.snapshotTime,
        calendarId: snap.calendarId,
        // R3 / T-06-07: term_slope is copied THROUGH — no recompute, no rounding.
        value: snap.termSlope,
        frontIv: snap.frontIv,
        backIv: snap.backIv,
      });
    }

    const writeResult = await deps.writeTerm(termRows);
    if (!writeResult.ok) return err(writeResult.error);

    // ── Skew / risk-reversal half (SPEC R1 + R2) ───────────────────────────────
    const smileResult = await deps.readSmile(cycle);
    if (!smileResult.ok) return err(smileResult.error);
    const smile = smileResult.value;

    // R1: write the full per-strike smile — one row per (underlying, expiration, strike).
    const skewRows: SkewObservationRow[] = smile.map((q) => ({
      snapshotTime: cycle,
      underlying: q.underlying,
      expiration: q.expiration,
      strike: q.strike,
      iv: q.iv,
      delta: q.delta,
      moneyness: q.moneyness,
    }));
    const skewWrite = await deps.writeSkew(skewRows);
    if (!skewWrite.ok) return err(skewWrite.error);

    // R2: per (underlying, expiration) group → 25Δ risk-reversal + trailing-window rank.
    const groups = new Map<string, { underlying: string; expiration: string; points: SmileQuote[] }>();
    for (const q of smile) {
      const key = `${q.underlying}|${q.expiration}`;
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, { underlying: q.underlying, expiration: q.expiration, points: [q] });
      } else {
        existing.points.push(q);
      }
    }

    const rrRows: RiskReversalObservationRow[] = [];
    for (const group of groups.values()) {
      // R2 prohibition: null when ±25Δ cannot be bracketed — never fabricated.
      const riskReversal = interpolateRiskReversal(group.points);

      let rrRank: number | null = null;
      if (riskReversal !== null) {
        const historyResult = await deps.readRrHistory({
          underlying: group.underlying,
          expiration: group.expiration,
          beforeOrAt: cycle,
        });
        if (!historyResult.ok) return err(historyResult.error);
        rrRank = percentileRank(riskReversal, historyResult.value);
      }

      rrRows.push({
        snapshotTime: cycle,
        underlying: group.underlying,
        expiration: group.expiration,
        riskReversal,
        rrRank,
      });
    }

    const rrWrite = await deps.writeRr(rrRows);
    if (!rrWrite.ok) return err(rrWrite.error);

    return ok(undefined);
  };
}

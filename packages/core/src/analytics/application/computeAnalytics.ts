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
    // now() bounds resolution ONLY (architecture-boundaries §2). It is NEVER a stamped value:
    // every persisted snapshot_time derives from DATA (the resolved cycle instant). See 06-GAPS.md
    // (CR-01/CR-02 locked design).
    const now = deps.now();

    // ── Term-structure half (SPEC R3) ──────────────────────────────────────────
    // Resolve the snapshot cycle = the latest snapshot ≤ now (readSnapshotsForCycle). All rows in
    // a cycle share one snapshotTime; that instant is the canonical cycle anchor when present.
    const snapshotsResult = await deps.readSnapshots(now);
    if (!snapshotsResult.ok) return err(snapshotsResult.error);
    const snapshots = snapshotsResult.value;

    // The snapshot anchor (one shared instant) — undefined when no snapshots exist for the cycle.
    const snapshotAnchor = snapshots[0]?.snapshotTime;

    const termRows: TermStructureObservationRow[] = [];
    for (const snap of snapshots) {
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
    // The smile read is a bounded "latest leg cycle ≤ anchor" read (CR-01). Anchor = the snapshot
    // anchor when present, else now() (the bounded read resolves the latest leg cycle ≤ that upper
    // bound). The DATA instant the cohort resolved to comes back as cycleTime — that is what we
    // stamp skew/RR rows with, NEVER now() and NEVER the raw anchor (they may differ when no
    // snapshots exist).
    const smileAnchor = snapshotAnchor ?? now;
    const smileResult = await deps.readSmile(smileAnchor);
    if (!smileResult.ok) return err(smileResult.error);
    const { cycleTime, quotes } = smileResult.value;

    // No BSM-solved cohort ≤ anchor → 0 skew/RR rows. Combined with 0 snapshots this is the clean
    // no-op (term half already wrote nothing).
    if (cycleTime === null) return ok(undefined);

    // Structural single-anchor (06-GAPS.md locked design / SC1): when snapshots exist for the
    // cycle, ALL THREE tables share the SNAPSHOT anchor so skew_snapshot_time == term_snapshot_time
    // by construction (not just by coincidence). Only when no snapshots exist does the cycle fall
    // back to the smile's own resolved leg instant (skew/RR only; no term rows were written).
    const stampInstant = snapshotAnchor ?? cycleTime;

    // R1: write the full per-strike smile — one row per (underlying, expiration, strike), stamped
    // with the resolved cycle instant.
    const skewRows: SkewObservationRow[] = quotes.map((q) => ({
      snapshotTime: stampInstant,
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
    for (const q of quotes) {
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
          // Trailing window bounded by the resolved cycle anchor, NOT now().
          beforeOrAt: stampInstant,
        });
        if (!historyResult.ok) return err(historyResult.error);
        rrRank = percentileRank(riskReversal, historyResult.value);
      }

      rrRows.push({
        snapshotTime: stampInstant,
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

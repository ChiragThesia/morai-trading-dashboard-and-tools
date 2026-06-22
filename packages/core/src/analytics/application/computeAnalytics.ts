/**
 * makeComputeAnalyticsUseCase — the compute-analytics use-case.
 *
 * 06-04 implements the TERM-STRUCTURE half; 06-05 adds the skew/RR half (readSmile/writeSkew/
 * writeRr/readRrHistory are accepted now but only the term-structure path is exercised here).
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
  TermStructureObservationRow,
  StorageError,
} from "./ports.ts";

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

    // Skew/RR half (06-05) intentionally not run here — this is the term-structure slice.
    return ok(undefined);
  };
}

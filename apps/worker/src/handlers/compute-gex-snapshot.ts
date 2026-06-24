import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningComputeGexSnapshot } from "@morai/core";

type ComputeGexSnapshotHandlerDeps = {
  /** The wired computeGexSnapshot use-case (composition root provides this). */
  readonly computeGexSnapshotUseCase: ForRunningComputeGexSnapshot;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeComputeGexSnapshotHandler — thin adapter wrapping the computeGexSnapshot use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday gate → call use-case → throw on err.
 *
 * T-08-11: RTH + NYSE holiday gate applied BEFORE the use-case call so a holiday/off-RTH run
 *   never writes a GEX row. This is the TERMINAL job in the analytics chain
 *   (no further boss.send — D-01, RESEARCH Open Question 2).
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputeGexSnapshotHandler(
  deps: ComputeGexSnapshotHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // T-08-11: RTH + NYSE holiday gate — no-op outside market hours or on holidays.
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("compute-gex-snapshot: skipping — outside RTH or NYSE holiday");
      return;
    }

    const result = await deps.computeGexSnapshotUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }
    // Terminal job — no boss.send (GEX snapshot is the final step in the chain — D-01).
  };
}

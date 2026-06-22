import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningComputeAnalytics } from "@morai/core";

type ComputeAnalyticsHandlerDeps = {
  /** The wired computeAnalytics use-case (composition root provides this). */
  readonly computeAnalyticsUseCase: ForRunningComputeAnalytics;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeComputeAnalyticsHandler — thin adapter wrapping the computeAnalytics use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday gate → call use-case → throw on err.
 *
 * T-06-10: RTH + NYSE holiday gate applied BEFORE the use-case call so a holiday/off-RTH run
 *   never writes derived rows. This is the TERMINAL job in the snapshot→analytics chain
 *   (no further boss.send).
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputeAnalyticsHandler(
  deps: ComputeAnalyticsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // T-06-10: RTH + NYSE holiday gate — no-op outside market hours or on holidays.
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("compute-analytics: skipping — outside RTH or NYSE holiday");
      return;
    }

    const result = await deps.computeAnalyticsUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }
    // Terminal job — no boss.send (the snapshot→analytics chain ends here).
  };
}

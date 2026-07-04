import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningComputePicker } from "@morai/core";

type ComputePickerHandlerDeps = {
  /** The wired computePicker use-case (composition root provides this). */
  readonly computePickerUseCase: ForRunningComputePicker;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeComputePickerHandler — thin adapter wrapping the computePicker use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday gate → call use-case → throw on err.
 *
 * D-04: chain-triggered by compute-gex-snapshot on success (fires right after a fresh GEX
 *   context is available). No cron — this queue is never scheduled by schedule.ts.
 * RTH + NYSE holiday gate mirrors compute-gex-snapshot's T-08-11 discipline so a holiday/off-RTH
 *   enqueue (a stale send or manual trigger) never writes a picker snapshot.
 * Terminal job — no further boss.send (compute-picker is the last step in the analytics chain).
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputePickerHandler(
  deps: ComputePickerHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // RTH + NYSE holiday gate — no-op outside market hours or on holidays.
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("compute-picker: skipping — outside RTH or NYSE holiday");
      return;
    }

    const result = await deps.computePickerUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }
    // Terminal job — no boss.send (compute-picker is the new terminal job — D-04).
  };
}

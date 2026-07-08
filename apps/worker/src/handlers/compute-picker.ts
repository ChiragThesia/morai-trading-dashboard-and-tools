import type { Job } from "pg-boss";
import type { ForRunningComputePicker } from "@morai/core";

type ComputePickerHandlerDeps = {
  /** The wired computePicker use-case (composition root provides this). */
  readonly computePickerUseCase: ForRunningComputePicker;
};

/**
 * makeComputePickerHandler — thin adapter wrapping the computePicker use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → throw on err.
 *
 * D-04: chain-triggered by compute-gex-snapshot on success (fires right after a fresh GEX
 *   context is available). No cron — this queue is never scheduled by schedule.ts.
 * 24/7 compute: no RTH/holiday gate — the user checks candidates at any hour, and the
 *   picker write is idempotent (first-write-wins on the cohort's observedAt, WR-01), so
 *   off-hours re-runs on a frozen cohort are no-ops. The journal gate lives solely in
 *   snapshot-calendars.
 * Terminal job — no further enqueue (compute-picker is the last step in the analytics chain).
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputePickerHandler(
  deps: ComputePickerHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.computePickerUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }
    // Terminal job — no further enqueue (compute-picker is the new terminal job — D-04).
  };
}

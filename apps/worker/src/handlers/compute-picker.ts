import type { Job } from "pg-boss";
import type { ForRunningComputePicker } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

type ComputePickerHandlerDeps = {
  /** The wired computePicker use-case (composition root provides this). */
  readonly computePickerUseCase: ForRunningComputePicker;
  /** pg-boss instance — used only to enqueue compute-exit-advice on success (26-04 chain). */
  readonly boss: BossForChainHandler;
};

/**
 * makeComputePickerHandler — thin adapter wrapping the computePicker use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → boss.send → throw on err.
 *
 * D-04: chain-triggered by compute-gex-snapshot on success (fires right after a fresh GEX
 *   context is available). No cron — this queue is never scheduled by schedule.ts.
 * 24/7 compute: no RTH/holiday gate — the user checks candidates at any hour, and the
 *   picker write is idempotent (first-write-wins on the cohort's observedAt, WR-01), so
 *   off-hours re-runs on a frozen cohort are no-ops. The journal gate lives solely in
 *   snapshot-calendars.
 * 26-04 (EXIT-01): on success, fire-and-forget enqueue of compute-exit-advice with a
 *   singletonKey (prevents duplicate enqueues) — mirrors compute-gex-snapshot → compute-picker
 *   (19-08 D-04). compute-picker is no longer terminal; compute-exit-advice is the new last step.
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

    // 26-04 (EXIT-01): enqueue compute-exit-advice on success; singletonKey prevents duplicate
    // enqueues. void: fire-and-forget — a send failure does not fail the picker job.
    void deps.boss.send("compute-exit-advice", {}, {
      singletonKey: "triggered-by-picker",
    }).catch((e: unknown) => {
      console.warn("compute-picker: failed to enqueue compute-exit-advice", e);
    });
  };
}

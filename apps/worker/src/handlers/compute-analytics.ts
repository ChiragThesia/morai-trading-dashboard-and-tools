import type { Job } from "pg-boss";
import type { ForRunningComputeAnalytics } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

type ComputeAnalyticsHandlerDeps = {
  /** The wired computeAnalytics use-case (composition root provides this). */
  readonly computeAnalyticsUseCase: ForRunningComputeAnalytics;
  /** pg-boss instance — used only to enqueue compute-gex-snapshot on success (08-06 chain, D-01). */
  readonly boss: BossForChainHandler;
};

/**
 * makeComputeAnalyticsHandler — thin adapter wrapping the computeAnalytics use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → boss.send → throw on err.
 *
 * 24/7 compute: no RTH/holiday gate (T-06-10 retired) — derived-row writes are idempotent
 *   per cohort, and the journal gate lives solely in snapshot-calendars.
 * 08-06 (D-01 chain extension): on success, fire-and-forget enqueue of compute-gex-snapshot with a
 *   singletonKey (prevents duplicate enqueues, T-08-10) — mirrors snapshot-calendars → compute-analytics
 *   pattern. compute-analytics is no longer terminal; compute-gex-snapshot is the new last step
 *   (RESEARCH Open Question 2).
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputeAnalyticsHandler(
  deps: ComputeAnalyticsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.computeAnalyticsUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }

    // D-01 (08-06): enqueue compute-gex-snapshot on success; singletonKey prevents duplicate enqueues (T-08-10).
    // void: fire-and-forget — a send failure does not fail the analytics job (T-08-12 accept).
    void deps.boss.send("compute-gex-snapshot", {}, {
      singletonKey: "triggered-by-analytics",
    }).catch((e: unknown) => {
      console.warn("compute-analytics: failed to enqueue compute-gex-snapshot", e);
    });
  };
}

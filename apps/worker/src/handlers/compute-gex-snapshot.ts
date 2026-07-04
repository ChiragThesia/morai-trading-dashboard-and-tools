import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningComputeGexSnapshot } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

type ComputeGexSnapshotHandlerDeps = {
  /** The wired computeGexSnapshot use-case (composition root provides this). */
  readonly computeGexSnapshotUseCase: ForRunningComputeGexSnapshot;
  /** pg-boss instance — used only to enqueue compute-picker on success (19-08 chain, D-04). */
  readonly boss: BossForChainHandler;
  /** Clock injection — testable without Date.now() in handler. */
  readonly now: () => Date;
};

/**
 * makeComputeGexSnapshotHandler — thin adapter wrapping the computeGexSnapshot use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → RTH+holiday gate → call use-case → boss.send → throw on err.
 *
 * T-08-11: RTH + NYSE holiday gate applied BEFORE the use-case call so a holiday/off-RTH run
 *   never writes a GEX row.
 * 19-08 (D-04 chain extension): on success, fire-and-forget enqueue of compute-picker with a
 *   singletonKey (prevents duplicate enqueues, T-19-18) — mirrors compute-analytics →
 *   compute-gex-snapshot (08-06 D-01). compute-gex-snapshot is no longer terminal; compute-picker
 *   is the new last step (it needs the fresh GEX context for scoring criterion 7).
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

    // 19-08 (D-04): enqueue compute-picker on success; singletonKey prevents duplicate
    // enqueues (T-19-18). void: fire-and-forget — a send failure does not fail the gex job.
    void deps.boss.send("compute-picker", {}, {
      singletonKey: "triggered-by-gex",
    }).catch((e: unknown) => {
      console.warn("compute-gex-snapshot: failed to enqueue compute-picker", e);
    });
  };
}

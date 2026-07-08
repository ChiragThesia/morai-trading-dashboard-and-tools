import type { Job } from "pg-boss";
import type { ForRunningFetchChain } from "@morai/core";

// Minimal boss interface — only what this handler uses (D-08: no manual trigger)
// Exported for test doubles — avoids `as` casts in test files.
export type BossForChainHandler = {
  readonly send: (
    name: string,
    data: object,
    options: { readonly singletonKey: string },
  ) => Promise<string | null>;
};

type FetchCboeChainHandlerDeps = {
  /** The wired fetchChain use-case (composition root provides this). */
  readonly fetchChainUseCase: ForRunningFetchChain;
  /** pg-boss instance — used only to enqueue compute on success (D-07). */
  readonly boss: BossForChainHandler;
};

/**
 * makeFetchCboeChainHandler — thin adapter wrapping the fetchChain use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → map Result → boss.send.
 *
 * 24/7 fetch: no RTH/holiday gate (D-06 retired) — off-hours vendors return frozen closing
 *   quotes and leg_observations dedups on its (time, contract) PK, so re-fetches are no-ops.
 * D-07: On success, enqueue compute-bsm-greeks with singletonKey to prevent duplicates.
 * T-02-18: array-guard prevents undefined job from reaching use-case (Pitfall 2).
 */
export function makeFetchCboeChainHandler(
  deps: FetchCboeChainHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.fetchChainUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }

    // D-07: enqueue compute-bsm-greeks on success; singletonKey prevents duplicate enqueues
    // void: pg-boss send is fire-and-forget here; failure does not fail the chain job (WR-02)
    void deps.boss.send("compute-bsm-greeks", {}, {
      singletonKey: "triggered-by-chain",
    }).catch((e: unknown) => {
      console.warn("fetch-cboe-chain: failed to enqueue compute-bsm-greeks", e);
    });
  };
}

import type { Job } from "pg-boss";
import type { ForRunningComputeExitAdvice } from "@morai/core";

type ComputeExitAdviceHandlerDeps = {
  /** The wired computeExitAdvice use-case (composition root provides this). */
  readonly computeExitAdviceUseCase: ForRunningComputeExitAdvice;
};

/**
 * makeComputeExitAdviceHandler — thin adapter wrapping the computeExitAdvice use-case as a
 * pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → throw on err.
 *
 * 26-04 (EXIT-01): chain-triggered by compute-picker on success — the new last step in the
 * analytics chain (fetch-schwab-chain -> ... -> compute-picker -> compute-exit-advice).
 * Terminal job — no further enqueue.
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2, same precedent as
 * compute-picker.ts / compute-gex-snapshot.ts).
 */
export function makeComputeExitAdviceHandler(
  deps: ComputeExitAdviceHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    if (job === undefined) return;

    const result = await deps.computeExitAdviceUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
    // Terminal job — no further enqueue.
  };
}

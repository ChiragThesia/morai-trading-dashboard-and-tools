import type { Job } from "pg-boss";

// Import via @morai/core (return type of makeComputeBsmGreeksUseCase)
type ComputeBsmGreeksUseCase = () => Promise<{ ok: boolean; error?: { message: string } }>;

type ComputeBsmGreeksHandlerDeps = {
  /** The wired computeBsmGreeks use-case (composition root provides this). */
  readonly computeBsmGreeksUseCase: ComputeBsmGreeksUseCase;
};

/**
 * makeComputeBsmGreeksHandler — thin adapter wrapping the computeBsmGreeks use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → map Result → throw on err.
 *
 * This handler runs on two triggers:
 *   1. Sparse hourly RTH fallback schedule (0 10-16 * * 1-5 ET) — D-07
 *   2. Chained after fetch-cboe-chain success via boss.send with singletonKey — D-07
 * The singletonKey on the chain-triggered enqueue ensures only one compute runs at a time.
 *
 * No RTH gate here — the cron schedule (0 10-16 * * 1-5) already gates to RTH hours.
 * D-08: no manual trigger registration.
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeComputeBsmGreeksHandler(
  deps: ComputeBsmGreeksHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.computeBsmGreeksUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      const message = result.error?.message ?? "computeBsmGreeks use-case failed";
      throw new Error(message);
    }
  };
}

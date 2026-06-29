import type { Job } from "pg-boss";
import type { ForRunningFetchCot } from "@morai/core";

type FetchCotHandlerDeps = {
  /** The wired fetchCot use-case (composition root provides this). */
  readonly fetchCot: ForRunningFetchCot;
};

/**
 * makeFetchCotHandler — thin adapter wrapping the fetchCot use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → throw on err (pg-boss retry).
 *
 * COT-01: weekly CFTC COT report fetch (Friday 17:00 ET cron, D-07).
 * No RTH gate — CFTC data is published weekly regardless of NYSE hours.
 * No NYSE holiday gate — CFTC publishes regardless of NYSE calendar.
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 * Idempotency: duplicate runs for the same week persist 0 new rows
 * via the repo's ON CONFLICT (contract_code, as_of) DO NOTHING (D-09).
 */
export function makeFetchCotHandler(
  deps: FetchCotHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.fetchCot();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      const message = result.error.message ?? "fetchCot use-case failed";
      throw new Error(message);
    }
  };
}

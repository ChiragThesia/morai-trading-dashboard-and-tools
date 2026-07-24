import type { Job } from "pg-boss";
import type { ForRunningFetchNews } from "@morai/core";

type FetchNewsHandlerDeps = {
  /** The wired fetchNews use-case (composition root provides this). */
  readonly fetchNews: ForRunningFetchNews;
};

/**
 * makeFetchNewsHandler — thin adapter wrapping the fetchNews use-case as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → throw on err (pg-boss retry).
 *
 * D28: Alpaca News fetch every 5 min, 24/7 — no RTH gate, no NYSE holiday gate
 * (the wire publishes around the clock). When the Alpaca keys are unset the
 * composition root substitutes a no-op handler instead — this handler assumes
 * a fully-wired use-case.
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 * Idempotency: re-fetched ids refresh rows via the repo's ON CONFLICT (id) DO UPDATE.
 */
export function makeFetchNewsHandler(
  deps: FetchNewsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.fetchNews();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      const message = result.error.message ?? "fetchNews use-case failed";
      throw new Error(message);
    }
  };
}

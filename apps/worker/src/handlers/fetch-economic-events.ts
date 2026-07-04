import type { Job } from "pg-boss";
import type { ForFetchingEconomicEvents, ForPersistingEconomicEvents } from "@morai/core";

type FetchEconomicEventsHandlerDeps = {
  /** Fetch the unified FRED+FOMC-seed events (composition root provides this). */
  readonly fetchEconomicEvents: ForFetchingEconomicEvents;
  /** Persist the fetched events to economic_events (composition root provides this). */
  readonly persistEconomicEvents: ForPersistingEconomicEvents;
};

/**
 * makeFetchEconomicEventsHandler — thin adapter wrapping fetch+persist as a pg-boss job.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → fetch → persist → throw on err (pg-boss retry).
 *
 * D-14: weekly cron (Friday ET) — runs regardless of RTH, mirroring fetch-cot (CFTC data is
 * published on its own schedule, independent of NYSE market hours).
 * T-19-19: a failed fetch/persist throws so pg-boss retries; compute-picker never blocks on
 * this job — it reads whatever economic_events rows already exist and tags eventsContextStatus
 * honestly (D-17) rather than waiting on a fresh events fetch.
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makeFetchEconomicEventsHandler(
  deps: FetchEconomicEventsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const fetchResult = await deps.fetchEconomicEvents();
    if (!fetchResult.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(fetchResult.error.message);
    }

    const persistResult = await deps.persistEconomicEvents(fetchResult.value);
    if (!persistResult.ok) {
      throw new Error(persistResult.error.message);
    }
  };
}

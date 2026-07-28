import type { Job } from "pg-boss";
import type { ForRecordingCalendarRanking } from "@morai/core";

type PersistCalendarRankingHandlerDeps = {
  /** The wired recordCalendarRanking use-case (composition root provides this). */
  readonly recordCalendarRankingUseCase: ForRecordingCalendarRanking;
};

/**
 * makePersistCalendarRankingHandler — thin adapter wrapping the recordCalendarRanking use-case.
 *
 * Thin-adapter rule (architecture-boundaries.md §3): zero business logic here.
 * Pattern: array-guard → call use-case → throw on err.
 *
 * IT CANNOT FAIL A CYCLE, BY CONSTRUCTION rather than by swallowing. This queue is NOT in the
 * ingest chain: nothing enqueues it and nothing waits on it, so a failed write is a gap in the
 * ranking history and never a broken pipeline. That is why the failure still THROWS — every
 * other worker handler reserves `console.warn` for the fire-and-forget chain enqueue and throws
 * on its own use-case, and a historian that swallows its own errors is a table that quietly
 * stops filling. The write is idempotent, so pg-boss's retry costs nothing.
 *
 * CRON, NOT CHAIN-TRIGGERED, and the offset is measured. `readChainForPicker` anchors its window
 * on `max(time) WHERE bsm_iv IS NOT NULL`, so a new cohort's `asOf` advances the moment its
 * FIRST leg solves — chaining off the ingest pipeline would fire during compute-bsm-greeks'
 * drain, and first-write-wins would make that starved ranking the cycle's permanent record.
 * Measured 2026-07-28: the 18:00:22Z cohort carried 853 unsolved put legs at 18:05Z and 0 by
 * 18:14Z. The cron runs at :25 and :55 — ~25 minutes behind the half-hourly chain fetch, and 5
 * minutes ahead of the next one. `no_iv_legs` is stored on every row so a cycle that beat the
 * drain anyway is identifiable rather than invisible.
 *
 * 24/7: no RTH/holiday gate, matching compute-picker — the chain fetch itself is 24/7 and the
 * write is idempotent, so an off-hours run against a frozen cohort is a no-op.
 *
 * T-02-18: array-guard for pg-boss v12 undefined element (Pitfall 2).
 */
export function makePersistCalendarRankingHandler(
  deps: PersistCalendarRankingHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    const result = await deps.recordCalendarRankingUseCase();
    if (!result.ok) {
      // Throw to signal failure to pg-boss — marks job as failed for retry/alerting
      throw new Error(result.error.message);
    }

    // A cap that starts biting turns the history into a top-N sample, which is the one thing a
    // percentile-scored engine cannot be validated against. It is invisible in the data, so it
    // is loud here. 0 of 0 is an empty cohort, not a truncation.
    const { rowsWritten, expiryPairs } = result.value;
    if (rowsWritten > 0 && rowsWritten < expiryPairs) {
      console.warn(
        `persist-calendar-ranking: TRUNCATED — stored ${rowsWritten} of ${expiryPairs} expiry pairs; raise PERSIST_LIMIT in recordCalendarRanking.ts`,
      );
    }
  };
}

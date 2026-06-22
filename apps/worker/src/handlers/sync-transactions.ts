/**
 * sync-transactions handler — populates the fills table from Schwab transactions (A4 / JRNL-01).
 *
 * Runs BEFORE sync-fills so sync-fills has real input to pair. Thin adapter
 * (architecture-boundaries.md §3): zero business logic.
 * Pattern: array-guard → RTH+holiday gate → Zod-parse payload → call use-case → throw on error.
 *
 * Gate: RTH + NYSE holiday (ingest only during market hours, mirrors sync-fills — D-12).
 * Payload: {} (no required fields; Zod validates the shape at the boundary).
 *
 * Pitfall 2 (pg-boss v12): array element can be undefined.
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSyncTransactions } from "@morai/core";

// Payload schema — sync-transactions uses no required fields (object guard only).
export const syncTransactionsPayload = z.object({}).passthrough();
export type SyncTransactionsPayload = z.infer<typeof syncTransactionsPayload>;

export type SyncTransactionsHandlerDeps = {
  readonly syncTransactionsUseCase: ForRunningSyncTransactions;
  readonly now: () => Date;
};

/**
 * makeSyncTransactionsHandler — RTH-gated sync-transactions job handler.
 *
 * Array-guard: if (job === undefined) return (pg-boss v12 Pitfall 2).
 * RTH gate: skip outside RTH or on NYSE holidays.
 * Payload: Zod-parsed — throw on invalid payload for pg-boss retry.
 * Result: throw on !result.ok to signal failure to pg-boss for retry/alerting.
 */
export function makeSyncTransactionsHandler(
  deps: SyncTransactionsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // D-12: RTH + NYSE holiday gate — ingest only during market hours
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("sync-transactions: skipping — outside RTH or NYSE holiday");
      return;
    }

    // Zod-parse payload at handler boundary (parse-don't-cast)
    const payloadResult = syncTransactionsPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(
        `sync-transactions: invalid payload: ${payloadResult.error.message}`,
      );
    }

    // Call use-case — throw on failure to signal pg-boss for retry/alerting
    const result = await deps.syncTransactionsUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
}

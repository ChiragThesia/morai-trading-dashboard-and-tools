/**
 * sync-fills handler — pairs broker fills into calendar events during RTH (JOB-01/JRNL-01).
 *
 * Thin adapter (architecture-boundaries.md §3): zero business logic.
 * Pattern: array-guard → RTH+holiday gate → call use-case → throw on error.
 *
 * Gate: RTH + NYSE holiday (sync-fills only during market hours — D-12).
 * Payload: {} (no required fields for the full-sweep variant; Zod validates at boundary).
 *
 * T-05-19: Zod-parses job.data before use; parse failure throws for pg-boss retry.
 * T-02-18 / Pitfall 2: array-guard prevents undefined job.
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSyncFills } from "@morai/core";
import type { BossForChainHandler } from "./fetch-cboe-chain.ts";

// Payload schema — sync-fills full-sweep uses no required fields
// Extensible for calendar-scoped variant (rebuild-journal 05-08 will add calendarId)
export const syncFillsPayload = z.object({}).passthrough();
export type SyncFillsPayload = z.infer<typeof syncFillsPayload>;

export type SyncFillsHandlerDeps = {
  readonly syncFillsUseCase: ForRunningSyncFills;
  readonly now: () => Date;
  /** pg-boss — used only to enqueue register-open-calendars on success. */
  readonly boss: BossForChainHandler;
};

/**
 * makeSyncFillsHandler — RTH-gated sync-fills job handler.
 *
 * Array-guard: if (job === undefined) return (pg-boss v12 Pitfall 2).
 * RTH gate: skip outside RTH or on NYSE holidays (sync-fills requires live market fills).
 * Payload: Zod-parsed (syncFillsPayload) — throw on invalid payload for pg-boss retry.
 * Result: throw on !result.ok to signal failure to pg-boss for retry/alerting.
 */
export function makeSyncFillsHandler(
  deps: SyncFillsHandlerDeps,
): (jobs: ReadonlyArray<Job<unknown> | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job<unknown> | undefined>): Promise<void> => {
    // Pitfall 2 (pg-boss v12): array element can be undefined
    if (job === undefined) return;

    // D-12: RTH + NYSE holiday gate — sync-fills only during market hours
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("sync-fills: skipping — outside RTH or NYSE holiday");
      return;
    }

    // T-05-19: Zod-parse payload at handler boundary (parse-don't-cast).
    // pg-boss delivers data:null on some cron fires (prod regression 2026-07-09/10:
    // "expected object, received null") — a null/absent payload IS the normal
    // full-sweep payload, so it is treated as {}.
    const payloadResult = syncFillsPayload.safeParse(job.data ?? {});
    if (!payloadResult.success) {
      throw new Error(`sync-fills: invalid payload: ${payloadResult.error.message}`);
    }

    // Call use-case — throw on failure to signal pg-boss for retry/alerting
    const result = await deps.syncFillsUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    // Broker book is the source of truth (2026-07-20): rolls create new legs the
    // calendar registry (exit advisor, journal) only learns about through
    // register-open-calendars — previously on-demand only, so after a roll the
    // registry sat stale until an operator ran it. Enqueue on every successful
    // sync so the registry follows the book. Fire-and-forget (D-03 pattern):
    // send failure must not fail the sync job; singletonKey dedups.
    void deps.boss.send("register-open-calendars", {}, {
      singletonKey: "triggered-by-sync-fills",
    }).catch((e: unknown) => {
      console.warn("sync-fills: failed to enqueue register-open-calendars", e);
    });
  };
}

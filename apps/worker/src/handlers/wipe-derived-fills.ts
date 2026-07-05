/**
 * wipe-derived-fills handler — on-demand, account-wide data-correction job
 * (journal-pnl-opennetdebit-units round 3: fills-side-correction follow-up).
 *
 * Deletes every row in fills, calendar_events, orphan_fills (one Postgres transaction,
 * all-or-nothing) so a subsequent backfill-transactions re-ingest writes fresh,
 * correctly-signed fills instead of no-op'ing against the existing wrong-side rows
 * (writeFills is onConflictDoNothing on the fill id PK). Does NOT touch calendars or
 * calendar_snapshots (see packages/core/.../ports.ts ForWipingDerivedFills for the full
 * rationale).
 *
 * Thin adapter (architecture-boundaries.md §3): zero business logic.
 *
 * Gate:
 *   - NO RTH gate — on-demand job, runs anytime when triggered
 *   - Payload: {} — account-wide, no calendarId (occSymbols are shared across calendars,
 *     so there is no clean per-calendar fill scope; mirrors sync-fills' full-sweep payload)
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { ForRunningWipeDerivedFills } from "@morai/core";

export const wipeDerivedFillsPayload = z.object({}).passthrough();

export type WipeDerivedFillsHandlerDeps = {
  readonly wipeDerivedFillsUseCase: ForRunningWipeDerivedFills;
  readonly now: () => Date;
};

export function makeWipeDerivedFillsHandler(
  deps: WipeDerivedFillsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — on-demand job, runs anytime

    // Zod-parse the payload at the handler boundary (JOB-01 requirement)
    const payloadResult = wipeDerivedFillsPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(`wipe-derived-fills: invalid payload: ${payloadResult.error.message}`);
    }

    const result = await deps.wipeDerivedFillsUseCase();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  };
}

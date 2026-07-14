/**
 * repair-journal-history handler — on-demand operator repair job (HIST-04).
 *
 * Thin adapter over repairJournalHistory (plan 05's rebuild engine, one/all-calendar scope,
 * before/after coverage). trigger_job's own schema (packages/contracts/src/jobs.ts
 * triggerJobPayload) carries only an optional calendarId — no trimOutsideWindow field — so a
 * remote trigger_job caller can never smuggle the destructive trim flag through (T-40-15);
 * the CLI (repair-journal-history.ts) is the only --trim entry point.
 *
 * Gate:
 *   - NO RTH gate — on-demand job, runs anytime
 *   - Payload: { calendarId?: uuid, trimOutsideWindow?: boolean } — absent calendarId → "all"
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { ForRunningRepairJournalHistory } from "@morai/core";

export const repairJournalHistoryPayload = z.object({
  calendarId: z.string().uuid().optional(),
  trimOutsideWindow: z.boolean().optional(),
});

export type RepairJournalHistoryHandlerDeps = {
  readonly repairJournalHistoryUseCase: ForRunningRepairJournalHistory;
  readonly now: () => Date;
};

export function makeRepairJournalHistoryHandler(
  deps: RepairJournalHistoryHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — on-demand job, runs anytime

    // Zod-parse the payload at the handler boundary (JOB-01 requirement)
    const payloadResult = repairJournalHistoryPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(
        `repair-journal-history: invalid payload: ${payloadResult.error.message}`,
      );
    }

    // exactOptionalPropertyTypes: never pass an explicit `trimOutsideWindow: undefined` — omit
    // the key entirely so the use-case's own default (heal-only, D-08) applies.
    const { calendarId, trimOutsideWindow } = payloadResult.data;
    const scope = calendarId ?? "all";
    const result = await deps.repairJournalHistoryUseCase({
      scope,
      ...(trimOutsideWindow !== undefined ? { trimOutsideWindow } : {}),
    });
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    // Observability: one line per run. healed = Σ(after.nonGapRows − before.nonGapRows) across
    // the repaired calendars; errors = Σ errorCount (lost heal-write races, WR-01).
    const reports = result.value;
    const healed = reports.reduce((sum, r) => sum + (r.after.nonGapRows - r.before.nonGapRows), 0);
    const errors = reports.reduce((sum, r) => sum + r.errorCount, 0);
    console.warn(
      `repair-journal-history: scope=${scope} calendars=${reports.length} healed=${healed} errors=${errors}`,
    );
  };
}

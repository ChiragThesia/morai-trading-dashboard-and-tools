/**
 * rebuild-journal handler — on-demand journal rebuild for one calendar (JRNL-01).
 *
 * SIGNATURE ONLY — handler body throws "not implemented".
 * Plan 05-08 provides the implementation.
 *
 * Gate:
 *   - NO RTH gate — on-demand job, runs anytime when triggered
 *   - Payload: { calendarId: string } — Zod-parsed at handler boundary
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { ForRebuildingJournal } from "@morai/core";

export const rebuildJournalPayload = z.object({
  calendarId: z.string().uuid(),
});

export type RebuildJournalHandlerDeps = {
  readonly rebuildJournalUseCase: ForRebuildingJournal;
  readonly now: () => Date;
};

export function makeRebuildJournalHandler(
  deps: RebuildJournalHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — on-demand job, runs anytime

    // Zod-parse the payload at the handler boundary (JOB-01 requirement)
    const payloadResult = rebuildJournalPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(`rebuild-journal: invalid payload: ${payloadResult.error.message}`);
    }

    throw new Error("not implemented");
  };
}

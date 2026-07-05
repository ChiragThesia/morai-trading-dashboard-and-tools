/**
 * recompute-snapshot-pnl handler — on-demand data-correction job (JRNL-01 pnl-unit-mismatch fix).
 *
 * Re-derives pnl_open on every stored calendar_snapshots row for one calendar from its CURRENT
 * openNetDebit + qty. Used after correcting a calendar's openNetDebit (e.g. rebuild-journal fixes
 * a unit-mismatch bug — dollars stored where points were expected) so the frozen historical
 * pnl_open un-stales. Mirrors rebuild-journal.ts exactly.
 *
 * Gate:
 *   - NO RTH gate — on-demand job, runs anytime when triggered
 *   - Payload: { calendarId: string } — Zod-parsed at handler boundary
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { ForRunningRecomputeSnapshotPnl } from "@morai/core";

export const recomputeSnapshotPnlPayload = z.object({
  calendarId: z.string().uuid(),
});

export type RecomputeSnapshotPnlHandlerDeps = {
  readonly recomputeSnapshotPnlUseCase: ForRunningRecomputeSnapshotPnl;
  readonly now: () => Date;
};

export function makeRecomputeSnapshotPnlHandler(
  deps: RecomputeSnapshotPnlHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // No RTH gate — on-demand job, runs anytime

    // Zod-parse the payload at the handler boundary (JOB-01 requirement)
    const payloadResult = recomputeSnapshotPnlPayload.safeParse(job.data);
    if (!payloadResult.success) {
      throw new Error(`recompute-snapshot-pnl: invalid payload: ${payloadResult.error.message}`);
    }

    const { calendarId } = payloadResult.data;
    const result = await deps.recomputeSnapshotPnlUseCase(calendarId);
    if (!result.ok) {
      if (result.error.kind === "not-found") {
        throw new Error(`recompute-snapshot-pnl: calendar ${calendarId} not found`);
      }
      throw new Error(result.error.message);
    }
  };
}

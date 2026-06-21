/**
 * sync-fills handler — pairs Schwab fills into calendar events during RTH (JOB-01/JRNL-01).
 *
 * SIGNATURE ONLY — handler body throws "not implemented".
 * Plan 05-07 provides the implementation.
 *
 * Gate:
 *   - RTH gate: YES — sync-fills only runs during market hours (isWithinRth + isNyseHoliday)
 *   - No RTH means no fills to process (Schwab doesn't fill outside RTH for our strategy)
 */

import type { Job } from "pg-boss";
import { isWithinRth, isNyseHoliday } from "@morai/core";
import type { ForRunningSyncFills } from "@morai/core";

export type SyncFillsHandlerDeps = {
  readonly syncFillsUseCase: ForRunningSyncFills;
  readonly now: () => Date;
};

export function makeSyncFillsHandler(
  deps: SyncFillsHandlerDeps,
): (jobs: ReadonlyArray<Job | undefined>) => Promise<void> {
  return async ([job]: ReadonlyArray<Job | undefined>): Promise<void> => {
    // pg-boss v12: array element can be undefined
    if (job === undefined) return;

    // RTH + NYSE holiday gate — sync-fills only runs during market hours
    const now = deps.now();
    if (!isWithinRth(now) || isNyseHoliday(now)) {
      console.warn("sync-fills: skipping — outside RTH or NYSE holiday");
      return;
    }

    throw new Error("not implemented");
  };
}

// Silence unused import warnings — used in the implementation placeholder
void isWithinRth;
void isNyseHoliday;

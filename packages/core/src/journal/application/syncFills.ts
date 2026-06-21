/**
 * syncFills.ts — pair Schwab fills into calendar OPEN/CLOSE/ROLL events (JRNL-01).
 *
 * SIGNATURE ONLY — function body throws "not implemented".
 * Plan 05-07 provides the implementation.
 *
 * Orchestration steps:
 *   1. Read unprocessed fills (ForReadingUnprocessedFills)
 *   2. For each fill: match to calendar leg (ForReadingCalendarLegs)
 *      - No match → park as orphan (ForStoringOrphanFill, D-05)
 *      - Match → aggregate partial fills (aggregatePartialFills, D-04)
 *   3. Classify aggregated fills as OPEN/CLOSE/ROLL (classifyFill/detectRoll, D-02/D-03)
 *   4. Compute P&L on CLOSE/ROLL events (computePnl, D-08/D-09)
 *   5. Store calendar events idempotently (ForStoringCalendarEvent)
 */

import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingUnprocessedFills,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  StorageError,
} from "./ports.ts";

// ─── Deps type ────────────────────────────────────────────────────────────────

export type SyncFillsDeps = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly storeOrphanFill: ForStoringOrphanFill;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly now: () => Date;
};

// Driver port type for this use-case
export type ForRunningSyncFills = () => Promise<Result<void, StorageError>>;

// ─── Use-case factory ─────────────────────────────────────────────────────────

export function makeSyncFillsUseCase(deps: SyncFillsDeps): ForRunningSyncFills {
  return async (): Promise<Result<void, StorageError>> => {
    throw new Error("not implemented");
  };
}

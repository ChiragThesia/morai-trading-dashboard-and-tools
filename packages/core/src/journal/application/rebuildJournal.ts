/**
 * rebuildJournal.ts — delete-then-reinsert L1 events for one calendar (JRNL-01, D-10).
 *
 * SIGNATURE ONLY — function body throws "not implemented".
 * Plan 05-08 provides the implementation.
 *
 * Orchestration steps (ordered):
 *   1. deleteCalendarEvents(calendarId) — clear all existing events
 *   2. resetCalendarAmounts(calendarId) — clear openNetDebit + closeNetCredit
 *   3. syncFillsForCalendar(calendarId) — re-pair fills → events for this calendar
 *
 * The "source of truth" for the L1 layer is the fills table (JRNL-01).
 * This operation is safe to repeat: same fills → same events (fillIdsHash determinism).
 */

import type { Result } from "@morai/shared";
import type {
  ForDeletingCalendarEvents,
  ForResettingCalendarAmounts,
  StorageError,
} from "./ports.ts";

// ─── Deps type ────────────────────────────────────────────────────────────────

export type RebuildJournalDeps = {
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  /** Scoped sync: re-pairs fills for the given calendarId only */
  readonly syncFillsForCalendar: (calendarId: string) => Promise<Result<void, StorageError>>;
  readonly now: () => Date;
};

// Driver port type for this use-case
export type ForRebuildingJournal = (
  calendarId: string,
) => Promise<Result<void, StorageError>>;

// ─── Use-case factory ─────────────────────────────────────────────────────────

export function makeRebuildJournalUseCase(deps: RebuildJournalDeps): ForRebuildingJournal {
  return async (calendarId: string): Promise<Result<void, StorageError>> => {
    // Step 1: Delete all existing calendar_events for this calendar (D-10)
    const deleteResult = await deps.deleteCalendarEvents(calendarId);
    if (!deleteResult.ok) return deleteResult;

    // Step 2: Reset openNetDebit / closeNetCredit to NULL (clear derived P&L totals)
    const resetResult = await deps.resetCalendarAmounts(calendarId);
    if (!resetResult.ok) return resetResult;

    // Step 3: Re-run sync-fills scoped to this calendar — rebuild events from fills
    // Same fills → same events (fillIdsHash determinism). SC5: P&L reconciles after rebuild.
    return deps.syncFillsForCalendar(calendarId);
  };
}

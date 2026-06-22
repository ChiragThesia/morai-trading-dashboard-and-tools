/**
 * rebuildJournal.ts — delete-then-reinsert L1 events for one calendar (JRNL-01, D-10).
 *
 * Orchestration steps (ordered):
 *   1. deleteCalendarEvents(calendarId)    — clear all existing events
 *   2. resetCalendarAmounts(calendarId)    — clear openNetDebit + closeNetCredit → NULL
 *   3. syncFillsForCalendar(calendarId)    — re-pair fills → events for THIS calendar (scoped, A2)
 *   4. recomputeCalendarAmounts(calendarId) — write openNetDebit/closeNetCredit from the
 *                                             rebuilt events (WR-08 reconciliation, SC5)
 *
 * The "source of truth" for the L1 layer is the fills table (JRNL-01).
 * This operation is safe to repeat: same fills → same events (fillIdsHash determinism).
 * Step 4 (WR-08): without recompute the calendar aggregates stay NULL after a rebuild, so
 * SC5 reconciliation (P&L totals match the summed events) would not hold. recompute runs
 * AFTER the scoped sync so the events it sums already exist.
 */

import type { Result } from "@morai/shared";
import type {
  ForDeletingCalendarEvents,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  StorageError,
} from "./ports.ts";

// ─── Deps type ────────────────────────────────────────────────────────────────

export type RebuildJournalDeps = {
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  /** Scoped sync: re-pairs fills for the given calendarId only (A2/CR-04) */
  readonly syncFillsForCalendar: (calendarId: string) => Promise<Result<void, StorageError>>;
  /** WR-08: recompute + write openNetDebit/closeNetCredit from the rebuilt events */
  readonly recomputeCalendarAmounts: ForRecomputingCalendarAmounts;
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
    // Same fills → same events (fillIdsHash determinism).
    const syncResult = await deps.syncFillsForCalendar(calendarId);
    if (!syncResult.ok) return syncResult;

    // Step 4 (WR-08): recompute openNetDebit/closeNetCredit from the rebuilt events.
    // Runs LAST so the events it sums already exist. SC5: P&L totals reconcile after rebuild.
    return deps.recomputeCalendarAmounts(calendarId);
  };
}

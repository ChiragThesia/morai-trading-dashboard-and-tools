/**
 * wipeDerivedFills.ts — account-wide data-correction use-case (journal-pnl-opennetdebit-units
 * debug session, round 3: fills-side-correction follow-up).
 *
 * Deletes every row in fills, calendar_events, orphan_fills so a subsequent
 * backfill-transactions re-ingest writes fresh, correctly-signed fills instead of
 * no-op'ing against the existing wrong-side rows (writeFills is onConflictDoNothing on the
 * fill id PK). Thin delegation to the ForWipingDerivedFills port, which performs the actual
 * 3-table DELETE inside one Postgres transaction (all-or-nothing) at the adapter — see
 * ports.ts for the full rationale and the calendars/calendar_snapshots exclusion.
 */

import type { Result } from "@morai/shared";
import type { ForWipingDerivedFills, StorageError } from "./ports.ts";

export type WipeDerivedFillsDeps = {
  readonly wipeDerivedFills: ForWipingDerivedFills;
};

// Driver port type for this use-case — account-wide, takes no arguments.
export type ForRunningWipeDerivedFills = () => Promise<
  Result<
    {
      readonly fillsDeleted: number;
      readonly eventsDeleted: number;
      readonly orphansDeleted: number;
    },
    StorageError
  >
>;

export function makeWipeDerivedFillsUseCase(
  deps: WipeDerivedFillsDeps,
): ForRunningWipeDerivedFills {
  return async () => deps.wipeDerivedFills();
}

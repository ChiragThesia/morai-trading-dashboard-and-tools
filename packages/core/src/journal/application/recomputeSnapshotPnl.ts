/**
 * recomputeSnapshotPnl.ts — one-time data-correction use-case (JRNL-01): re-derive pnl_open on
 * every stored calendar_snapshots row for a calendar, from its CURRENT openNetDebit + qty.
 *
 * Why: pnl_open is frozen at snapshot-write time (D-05: pnl_open = (net_mark - openNetDebit) *
 * qty * 100, see snapshotCalendars.ts computeSnapshotPnl). If openNetDebit is corrected after
 * the fact — e.g. the JRNL-01 unit-mismatch bug (dollars stored where points were expected)
 * fixed via rebuild-journal — every historical snapshot row still carries the pnl_open computed
 * from the STALE value. This use-case re-derives every row's pnl_open purely from its
 * already-stored net_mark; no online fetch, no broker call.
 *
 * Reads the calendar's CURRENT openNetDebit/qty (ForGettingCalendarById), then delegates the
 * read-all/recompute-all/write-back work to ForRecomputingSnapshotPnl (adapter-side, matching
 * the ForRecomputingCalendarAmounts precedent used by rebuildJournal.ts).
 */

import { err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  CalendarNotFound,
  ForGettingCalendarById,
  ForRecomputingSnapshotPnl,
  StorageError,
} from "./ports.ts";

export type RecomputeSnapshotPnlDeps = {
  readonly getCalendarById: ForGettingCalendarById;
  readonly recomputeSnapshotPnl: ForRecomputingSnapshotPnl;
};

export type ForRunningRecomputeSnapshotPnl = (
  calendarId: string,
) => Promise<Result<{ readonly rowsUpdated: number }, StorageError | CalendarNotFound>>;

export function makeRecomputeSnapshotPnlUseCase(
  deps: RecomputeSnapshotPnlDeps,
): ForRunningRecomputeSnapshotPnl {
  return async (calendarId: string) => {
    const calResult = await deps.getCalendarById(calendarId);
    if (!calResult.ok) return calResult;

    const cal = calResult.value;
    if (cal === null) return err<CalendarNotFound>({ kind: "not-found" });

    return deps.recomputeSnapshotPnl(calendarId, cal.openNetDebit, cal.qty);
  };
}

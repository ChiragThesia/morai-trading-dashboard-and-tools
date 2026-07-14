/**
 * repairJournalHistory use-case (HIST-04) — the operator repair orchestrator: rebuilds the
 * full journal history for ONE calendar or ALL calendars, reusing the plan-05 rebuild engine,
 * and reports per-calendar before/after coverage (rows, non-gap rows, distinct days).
 *
 * D-08 safety rule: the default run is heal-only — deleteSnapshotsOutsideWindow is called
 * ONLY when trimOutsideWindow is explicitly true (never by default, never via trigger_job —
 * plan 07 Task 2's job handler never sets this flag; it is CLI-only).
 *
 * Idempotent: a second run heals nothing new (the rebuild engine's healSnapshot is fill-only)
 * and deletes nothing new (window already trimmed) — before/after counts converge.
 * Result-threaded, no try/catch, clock injected (no Date.now() in core).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { isGapRow } from "../domain/attribution.ts";
import type {
  Calendar,
  ForListingCalendars,
  ForReadingJournal,
  ForDeletingSnapshotsOutsideWindow,
  SnapshotRow,
  StorageError,
} from "./ports.ts";
import type { ForRunningRebuildCalendarHistory } from "./rebuildCalendarHistory.ts";

export type RepairJournalHistoryInput = {
  /** A single calendarId, or the literal "all" to repair every calendar (open + closed). */
  readonly scope: string;
  /** D-08: post-close/pre-open trim — opt-in only, never the default. */
  readonly trimOutsideWindow?: boolean;
};

/** Per-calendar coverage snapshot for the operator before/after report. */
export type RepairCoverage = {
  readonly rows: number;
  readonly nonGapRows: number;
  readonly days: number;
};

export type CalendarRepairReport = {
  readonly calendarId: string;
  readonly before: RepairCoverage;
  readonly after: RepairCoverage;
  /** Deleted-row count from the trim step; null when trimOutsideWindow was not requested. */
  readonly deleted: number | null;
  /**
   * WR-01 (40-REVIEW.md): slots where the rebuild engine's healSnapshot call errored (e.g. a
   * lost concurrent-write race) — surfaced for operator visibility. Never aborts the repair;
   * see rebuildCalendarHistory.ts's RebuildCoverage.errorCount.
   */
  readonly errorCount: number;
};

export type RepairJournalHistoryDeps = {
  readonly listCalendars: ForListingCalendars;
  readonly readJournal: ForReadingJournal;
  readonly rebuildCalendarHistory: ForRunningRebuildCalendarHistory;
  readonly deleteSnapshotsOutsideWindow: ForDeletingSnapshotsOutsideWindow;
  /** Clock injection — never call Date.now() in core (architecture-boundaries.md §2) */
  readonly now: () => Date;
};

export type ForRunningRepairJournalHistory = (
  input: RepairJournalHistoryInput,
) => Promise<Result<ReadonlyArray<CalendarRepairReport>, StorageError>>;

function computeCoverage(rows: ReadonlyArray<SnapshotRow>): RepairCoverage {
  const days = new Set(rows.map((row) => row.time.toISOString().slice(0, 10)));
  const nonGapRows = rows.filter((row) => !isGapRow(row)).length;
  return { rows: rows.length, nonGapRows, days: days.size };
}

/**
 * makeRepairJournalHistoryUseCase — factory returning the operator repair driver port.
 *
 * "all" enumerates every calendar via listCalendars(undefined); a single scope filters that
 * same list down to the one matching id (no separate ForGettingCalendarById dependency).
 * For each target: reads before-coverage, rebuilds [openedAt, closedAt ?? now] via the plan-05
 * engine (which itself clamps to the real life window, D-08), optionally trims rows outside
 * the window (opt-in only), then reads after-coverage.
 */
export function makeRepairJournalHistoryUseCase(
  deps: RepairJournalHistoryDeps,
): ForRunningRepairJournalHistory {
  return async (input) => {
    const now = deps.now();

    const listResult = await deps.listCalendars(undefined);
    if (!listResult.ok) return err(listResult.error);

    const targets: ReadonlyArray<Calendar> =
      input.scope === "all"
        ? listResult.value
        : listResult.value.filter((calendar) => calendar.id === input.scope);

    const reports: CalendarRepairReport[] = [];

    for (const calendar of targets) {
      const beforeResult = await deps.readJournal(calendar.id);
      if (!beforeResult.ok) return err(beforeResult.error);
      const before = computeCoverage(beforeResult.value ?? []);

      const rebuildResult = await deps.rebuildCalendarHistory(calendar, {
        from: calendar.openedAt,
        to: calendar.closedAt ?? now,
      });
      if (!rebuildResult.ok) return err(rebuildResult.error);

      let deleted: number | null = null;
      if (input.trimOutsideWindow === true) {
        const trimResult = await deps.deleteSnapshotsOutsideWindow(
          calendar.id,
          calendar.openedAt,
          calendar.closedAt,
        );
        if (!trimResult.ok) return err(trimResult.error);
        deleted = trimResult.value.deletedCount;
      }

      const afterResult = await deps.readJournal(calendar.id);
      if (!afterResult.ok) return err(afterResult.error);
      const after = computeCoverage(afterResult.value ?? []);

      reports.push({ calendarId: calendar.id, before, after, deleted, errorCount: rebuildResult.value.errorCount });
    }

    return ok(reports);
  };
}

/**
 * repair-journal-history.ts — operator repair CLI (HIST-04).
 *
 * Thin composition-root wiring over repairJournalHistory (plan 05's rebuild engine, plan 07's
 * one/all-calendar orchestrator) — mirrors fix-pnl-reingest.ts's import.meta.main pattern.
 * TDD-exempt (tdd.md Scope: pure wiring); the orchestrated logic itself is fully tested in
 * repairJournalHistory.test.ts.
 *
 * Usage:
 *   bun apps/worker/src/repair-journal-history.ts <calendarId> [--trim]
 *   bun apps/worker/src/repair-journal-history.ts --all [--trim]
 *
 * D-08 / T-40-04: --all must be explicit (never a silent default); --trim is opt-in and
 * deletes post-close/pre-open rows outside a calendar's life window, printing the exact count.
 * Every step is idempotent — a partial failure is safe to re-run.
 *
 * Guarded by import.meta.main (same pattern as fix-pnl-reingest.ts) so importing this module
 * never boots it. No secret/token in output (workflow.md Data Discipline).
 */

import { makeRepairJournalHistoryUseCase, makeRebuildCalendarHistoryUseCase } from "@morai/core";
import type { CalendarRepairReport } from "@morai/core";

type ErrorLike = { readonly kind: string; readonly message?: string };
function describeError(e: ErrorLike): string {
  return e.message ?? e.kind;
}

type ParsedRepairArgs =
  | { readonly ok: true; readonly scope: string; readonly trim: boolean }
  | { readonly ok: false; readonly message: string };

const USAGE =
  "usage: repair-journal-history.ts <calendarId> [--trim]  OR  repair-journal-history.ts --all [--trim]";

/**
 * parseRepairArgs — pure argv parser (D-08 / T-40-04 policy lives here): --all must be an
 * explicit flag (never a silent default when no positional arg is given); --trim is a separate
 * opt-in flag. Exactly one of --all or a single calendarId positional is required.
 */
export function parseRepairArgs(argv: ReadonlyArray<string>): ParsedRepairArgs {
  const trim = argv.includes("--trim");
  const wantsAll = argv.includes("--all");
  const positional = argv.filter((arg) => arg !== "--trim" && arg !== "--all");

  if (wantsAll && positional.length > 0) {
    return { ok: false, message: `pass either --all or a single calendarId, not both.\n${USAGE}` };
  }
  if (wantsAll) {
    return { ok: true, scope: "all", trim };
  }
  const [calendarId] = positional;
  if (positional.length === 1 && calendarId !== undefined) {
    return { ok: true, scope: calendarId, trim };
  }
  return { ok: false, message: USAGE };
}

function printReportRow(report: CalendarRepairReport): void {
  const deletedStr = report.deleted === null ? "n/a" : String(report.deleted);
  console.warn(
    `${report.calendarId}  rows ${report.before.rows}→${report.after.rows}  ` +
      `nonGap ${report.before.nonGapRows}→${report.after.nonGapRows}  ` +
      `days ${report.before.days}→${report.after.days}  deleted ${deletedStr}`,
  );
}

// ─── CLI entrypoint (thin composition root — TDD-exempt wiring) ──────────────────────
// Guarded by import.meta.main so importing this module (e.g. from a test) does not boot it.
if (import.meta.main) {
  const parsed = parseRepairArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`repair-journal-history: ${parsed.message}`);
    process.exit(1);
  }

  const { bootWorkerConfig } = await import("./config.ts");
  const {
    makeDb,
    makePostgresCalendarsRepo,
    makePostgresCalendarSnapshotsRepo,
    makePostgresLegObservationsRepo,
  } = await import("@morai/adapters");

  const config = bootWorkerConfig();
  const db = makeDb(config.DATABASE_URL);
  const calendarsRepo = makePostgresCalendarsRepo(db);
  const calendarSnapshotsRepo = makePostgresCalendarSnapshotsRepo(db);
  const legObsRepo = makePostgresLegObservationsRepo(db);

  // Mirrors apps/worker/src/main.ts's rebuildCalendarHistoryUseCase wiring exactly — the same
  // plan-05 engine self-heal-journal already runs on a cron.
  const rebuildCalendarHistoryUseCase = makeRebuildCalendarHistoryUseCase({
    resolveLegObservationForSlot: legObsRepo.resolveLegObservationForSlot,
    healSnapshot: calendarSnapshotsRepo.healSnapshot,
    now: () => new Date(),
  });

  const repairJournalHistoryUseCase = makeRepairJournalHistoryUseCase({
    listCalendars: calendarsRepo.listCalendars,
    readJournal: calendarSnapshotsRepo.readJournal,
    rebuildCalendarHistory: rebuildCalendarHistoryUseCase,
    deleteSnapshotsOutsideWindow: calendarSnapshotsRepo.deleteSnapshotsOutsideWindow,
    now: () => new Date(),
  });

  console.warn(
    `repair-journal-history: repairing scope=${parsed.scope}${parsed.trim ? " (--trim enabled)" : ""}...`,
  );
  const result = await repairJournalHistoryUseCase({
    scope: parsed.scope,
    ...(parsed.trim ? { trimOutsideWindow: true } : {}),
  });
  if (!result.ok) {
    console.error(`repair-journal-history: FAILED: ${describeError(result.error)}`);
    console.error(
      "repair-journal-history: every step is idempotent — safe to re-run.",
    );
    process.exit(1);
  }

  console.warn("");
  console.warn("repair-journal-history: BEFORE/AFTER coverage");
  for (const report of result.value) {
    printReportRow(report);
  }
  console.warn("");
  console.warn(`repair-journal-history: done. ${result.value.length} calendar(s) repaired.`);
  process.exit(0);
}

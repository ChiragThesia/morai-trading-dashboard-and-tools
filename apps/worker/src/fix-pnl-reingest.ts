/**
 * fix-pnl-reingest.ts — ONE-OFF prod data-correction script
 * (journal-pnl-opennetdebit-units, round 3: fills-side-correction follow-up).
 *
 * Run ONCE, via `railway run`, after the fills-side signing fix (mapSide/netAmount, commit
 * c7fb350) is deployed. Corrects the historical journal P&L for every calendar that was
 * backfilled BEFORE that fix — their `fills.side` rows were written by the old, wrongly-signed
 * logic and cannot be corrected in place (no raw broker JSON is stored to recover the sign
 * from). See .planning/debug/journal-pnl-opennetdebit-units.md for the full root-cause chain.
 *
 * Sequence (single process, sequential — no cross-step empty-window gap):
 *   1. WIPE fills + calendar_events + orphan_fills (wipeDerivedFillsUseCase). `writeFills` is
 *      onConflictDoNothing, so re-ingesting into non-empty fills would silently no-op.
 *   2. BACKFILL Schwab transactions over [2026-04-16, today] (runBackfill, the exact use-case
 *      + trader-token wiring backfill-transactions.ts's CLI uses) — re-ingests fills with the
 *      fixed adapter, so `fills.side` is now correct.
 *   3. For EVERY calendar (calendarsRepo.listCalendars(undefined) — open + closed, enumerated,
 *      never hardcoded): rebuild-journal (re-pairs fills → events, recomputes openNetDebit from
 *      the now-correctly-signed events), then recompute-snapshot-pnl (re-derives every frozen
 *      calendar_snapshots.pnl_open row from the corrected openNetDebit).
 *   4. Print a BEFORE/AFTER openNetDebit table for every calendar.
 *
 * CRITICAL FAILURE MODE: if the wipe (step 1) succeeds but the backfill (step 2) fails, fills /
 * calendar_events / orphan_fills are now EMPTY (the wipe already ran) and the journal is broken
 * until this script is re-run successfully. The script prints a loud warning and exits nonzero
 * in that case — do not deploy or trigger any other journal job until a re-run succeeds.
 *
 * Every step checks its Result and aborts (message + exit(1)) on failure. A per-calendar
 * rebuild/recompute failure aborts the remaining calendars but does not undo calendars already
 * corrected in this run — every step here is idempotent, so re-running the whole script is safe.
 *
 * Guarded by import.meta.main (same pattern as backfill-transactions.ts) so importing this
 * module never boots it. Thin composition root — TDD-exempt wiring (tdd.md Scope): it only
 * sequences already-tested use-cases (wipeDerivedFillsUseCase, runBackfill,
 * rebuildJournalUseCase, recomputeSnapshotPnlUseCase), no new business logic.
 *
 * No any/as/! (typescript.md). No secret/token in output (workflow.md Data Discipline).
 */

import { createHash, randomUUID } from "node:crypto";
import {
  hashFillIds,
  makeRebuildJournalUseCase,
  makeRecomputeSnapshotPnlUseCase,
  makeSyncFillsForCalendarUseCase,
  makeWipeDerivedFillsUseCase,
  SCHWAB_TX_MAX_RANGE_DAYS,
} from "@morai/core";
import type { Calendar } from "@morai/core";
import { runBackfill } from "./backfill-transactions.ts";

// Earliest backfilled calendar opened 2026-04-16 (journal-pnl-opennetdebit-units debug file).
const BACKFILL_FROM = "2026-04-16";

/** Every error shape in this file carries `kind`; StorageError/BackfillError also carry `message`. */
type ErrorLike = { readonly kind: string; readonly message?: string };
function describeError(e: ErrorLike): string {
  return e.message ?? e.kind;
}

// ─── CLI entrypoint (thin composition root — TDD-exempt wiring) ──────────────────────
// Guarded by import.meta.main so importing this module (e.g. from a test) does not boot it.
if (import.meta.main) {
  const { bootWorkerConfig } = await import("./config.ts");
  const {
    makeDb,
    makePostgresFillsRepo,
    makePostgresCalendarsRepo,
    makePostgresCalendarEventsRepo,
    makePostgresOrphanFillsRepo,
    makePostgresCalendarSnapshotsRepo,
    makePostgresBrokerTokensRepo,
    makeAccountHashResolver,
    makeSchwabTransactionsAdapter,
  } = await import("@morai/adapters");

  const config = bootWorkerConfig();
  const db = makeDb(config.DATABASE_URL);
  const fillsRepo = makePostgresFillsRepo(db);
  const calendarsRepo = makePostgresCalendarsRepo(db);
  const calendarEventsRepo = makePostgresCalendarEventsRepo(db);
  const orphanFillsRepo = makePostgresOrphanFillsRepo(db);
  const calendarSnapshotsRepo = makePostgresCalendarSnapshotsRepo(db);

  const USER_AGENT = "morai-worker/0.0.1";

  // Trader on-demand token + account-hash resolver — mirrors backfill-transactions.ts exactly.
  const brokerTokensRepo = makePostgresBrokerTokensRepo(
    db,
    config.TOKEN_ENCRYPTION_KEY,
  );
  const traderGetAccessToken = async () => {
    const result = await brokerTokensRepo.readTokens("trader");
    if (!result.ok || result.value === null) {
      return {
        ok: false as const,
        error: { kind: "auth-expired" as const, appId: "trader" as const },
      };
    }
    return { ok: true as const, value: result.value.accessToken };
  };
  const traderDeps = {
    fetch: globalThis.fetch,
    getAccessToken: traderGetAccessToken,
    userAgent: USER_AGENT,
  };
  const accountHashResolver = makeAccountHashResolver(traderDeps);
  const transactionsAdapter = makeSchwabTransactionsAdapter(traderDeps);

  const fetchTransactionsResolved = async (
    _accountHash: string,
    windowFrom: string,
    windowTo: string,
  ) => {
    const hashResult = await accountHashResolver.resolveAccountHash();
    if (!hashResult.ok) return hashResult;
    return transactionsAdapter.fetchTransactions(
      hashResult.value,
      windowFrom,
      windowTo,
    );
  };

  const sha256Hex = (input: string): string =>
    createHash("sha256").update(input).digest("hex");

  // Journal use-case wiring — mirrors apps/worker/src/main.ts exactly.
  const syncFillsForCalendarUseCase = makeSyncFillsForCalendarUseCase({
    readUnprocessedFillsForCalendar: fillsRepo.readUnprocessedFillsForCalendar,
    readCalendarLegs: fillsRepo.readCalendarLegs,
    storeCalendarEvent: calendarEventsRepo.storeCalendarEvent,
    storeOrphanFill: orphanFillsRepo.storeOrphanFill,
    resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
    readCalendarEvents: calendarEventsRepo.readCalendarEvents,
    markFillsProcessed: fillsRepo.markFillsProcessed,
    // journal-pnl-opennetdebit-units round 5 (bug 2): auto-transition a calendar's status
    // once its rebuilt events prove it's fully closed.
    transitionCalendarClosed: calendarsRepo.transitionCalendarClosed,
    newId: () => randomUUID(),
    hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
    now: () => new Date(),
  });

  const rebuildJournalUseCase = makeRebuildJournalUseCase({
    deleteCalendarEvents: calendarEventsRepo.deleteCalendarEvents,
    resetCalendarAmounts: fillsRepo.resetCalendarAmounts,
    resetFillsProcessedForCalendar: fillsRepo.resetFillsProcessedForCalendar,
    syncFillsForCalendar: syncFillsForCalendarUseCase,
    recomputeCalendarAmounts: fillsRepo.recomputeCalendarAmounts,
    now: () => new Date(),
  });

  const recomputeSnapshotPnlUseCase = makeRecomputeSnapshotPnlUseCase({
    getCalendarById: calendarsRepo.getCalendarById,
    recomputeSnapshotPnl: calendarSnapshotsRepo.recomputeSnapshotPnl,
  });

  const wipeDerivedFillsUseCase = makeWipeDerivedFillsUseCase({
    wipeDerivedFills: fillsRepo.wipeDerivedFills,
  });

  // Step 0: enumerate every calendar (open + closed) and capture its BEFORE openNetDebit.
  console.warn("fix-pnl-reingest: reading calendars (before state)...");
  const beforeList = await calendarsRepo.listCalendars(undefined);
  if (!beforeList.ok) {
    console.error(
      `fix-pnl-reingest: failed to list calendars: ${describeError(beforeList.error)}`,
    );
    process.exit(1);
  }
  const before: ReadonlyArray<Calendar> = beforeList.value;
  console.warn(`fix-pnl-reingest: found ${before.length} calendar(s).`);

  // Step 1: wipe fills + calendar_events + orphan_fills (one transaction, all-or-nothing).
  console.warn(
    "fix-pnl-reingest: wiping fills, calendar_events, orphan_fills...",
  );
  const wipeResult = await wipeDerivedFillsUseCase();
  if (!wipeResult.ok) {
    console.error(
      `fix-pnl-reingest: wipe FAILED: ${describeError(wipeResult.error)}`,
    );
    console.error(
      "fix-pnl-reingest: the wipe runs inside one transaction, so nothing was deleted. Safe to re-run.",
    );
    process.exit(1);
  }
  console.warn(
    `fix-pnl-reingest: wiped ${wipeResult.value.fillsDeleted} fill(s), ` +
      `${wipeResult.value.eventsDeleted} event(s), ${wipeResult.value.orphansDeleted} orphan(s).`,
  );

  // Step 2: re-ingest from Schwab with the fixed adapter. If this fails, fills are now EMPTY.
  const to = new Date().toISOString().slice(0, 10);
  console.warn(
    `fix-pnl-reingest: backfilling Schwab transactions ${BACKFILL_FROM}..${to}...`,
  );
  const backfillResult = await runBackfill({
    fetchTransactions: fetchTransactionsResolved,
    writeFills: fillsRepo.writeFills,
    hashFillIds: (ids) => hashFillIds(ids, sha256Hex),
    // Not authoritative on this path — fetchTransactionsResolved re-resolves the real hash
    // per call. Threaded only because RunBackfillDeps requires the field (see
    // backfill-transactions.ts's identical sentinel).
    accountHash: "resolved-per-call-see-fetchTransactionsResolved",
    now: () => new Date(),
    from: BACKFILL_FROM,
    to,
    maxDays: SCHWAB_TX_MAX_RANGE_DAYS,
  });
  if (!backfillResult.ok) {
    console.error(
      `fix-pnl-reingest: backfill FAILED: ${backfillResult.error.message}`,
    );
    console.error(
      "fix-pnl-reingest: *** CRITICAL *** fills / calendar_events / orphan_fills were ALREADY " +
        "WIPED in step 1 and are now EMPTY. The journal is broken until this script is re-run " +
        "successfully once Schwab auth/connectivity is restored. Do NOT deploy or trigger any " +
        "other journal job until then.",
    );
    process.exit(1);
  }
  console.warn(
    `fix-pnl-reingest: backfill complete (${backfillResult.value.windows} window(s) over ` +
      `${backfillResult.value.from}..${backfillResult.value.to}).`,
  );

  // Step 3: rebuild-journal + recompute-snapshot-pnl for every enumerated calendar.
  const results: Array<{
    readonly id: string;
    readonly before: number;
    readonly after: number | null;
  }> = [];

  for (const cal of before) {
    console.warn(`fix-pnl-reingest: calendar ${cal.id} — rebuilding journal...`);
    const rebuildResult = await rebuildJournalUseCase(cal.id);
    if (!rebuildResult.ok) {
      console.error(
        `fix-pnl-reingest: rebuild-journal FAILED for calendar ${cal.id}: ${describeError(rebuildResult.error)}`,
      );
      console.error(
        `fix-pnl-reingest: ${results.length}/${before.length} calendar(s) already corrected in this run ` +
          "(unaffected by this failure) — re-running this script is safe (idempotent).",
      );
      process.exit(1);
    }

    console.warn(
      `fix-pnl-reingest: calendar ${cal.id} — recomputing snapshot pnl...`,
    );
    const recomputeResult = await recomputeSnapshotPnlUseCase(cal.id);
    if (!recomputeResult.ok) {
      console.error(
        `fix-pnl-reingest: recompute-snapshot-pnl FAILED for calendar ${cal.id}: ${describeError(recomputeResult.error)}`,
      );
      console.error(
        `fix-pnl-reingest: ${results.length}/${before.length} calendar(s) already corrected in this run ` +
          "(unaffected by this failure) — re-running this script is safe (idempotent).",
      );
      process.exit(1);
    }
    console.warn(
      `fix-pnl-reingest: calendar ${cal.id} — recomputed ${recomputeResult.value.rowsUpdated} snapshot row(s).`,
    );

    const afterResult = await calendarsRepo.getCalendarById(cal.id);
    if (!afterResult.ok) {
      console.error(
        `fix-pnl-reingest: failed to re-read calendar ${cal.id} after correction: ${describeError(afterResult.error)}`,
      );
      process.exit(1);
    }
    results.push({
      id: cal.id,
      before: cal.openNetDebit,
      after: afterResult.value === null ? null : afterResult.value.openNetDebit,
    });
  }

  // Step 4: BEFORE/AFTER openNetDebit table.
  console.warn("");
  console.warn("fix-pnl-reingest: BEFORE/AFTER openNetDebit");
  console.warn("calendar_id                              before      after");
  for (const r of results) {
    const afterStr = r.after === null ? "MISSING" : r.after.toFixed(2);
    console.warn(
      `${r.id}  ${r.before.toFixed(2).padStart(10)}  ${afterStr.padStart(9)}`,
    );
  }
  console.warn("");
  console.warn(`fix-pnl-reingest: done. ${results.length} calendar(s) corrected.`);
  process.exit(0);
}

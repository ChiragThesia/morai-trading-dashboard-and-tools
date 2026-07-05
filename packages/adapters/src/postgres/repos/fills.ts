/**
 * makePostgresFillsRepo — Postgres implementation of the fills data-path ports (A1 + A3).
 *
 * Ports:
 *   - readUnprocessedFills           (ForReadingUnprocessedFills)
 *   - readUnprocessedFillsForCalendar (ForReadingUnprocessedFillsForCalendar)
 *   - readCalendarLegs               (ForReadingCalendarLegs)
 *   - resetCalendarAmounts           (ForResettingCalendarAmounts)
 *   - recomputeCalendarAmounts       (ForRecomputingCalendarAmounts — A3)
 *   - writeFills                     (ForWritingFills — idempotent on id PK)
 *
 * Unprocessed-fills exclusion rule (WR-A2, plan 05-15 — supersedes the 05-12 orphan-only rule):
 *   A fill is "processed" iff its processed_at column is set OR its id is parked in orphan_fills.
 *   markFillsProcessed sets processed_at = NOW() once syncFills has incorporated a bucket's fills
 *   into exactly ONE calendar_event (paired) or after orphan parking. So readUnprocessedFills
 *   returns fills WHERE processed_at IS NULL AND id NOT IN orphan_fills — paired fills are never
 *   re-read or re-paired (no unbounded re-pair, no partial-fill double-count). Later fills for
 *   the same order/leg arrive unprocessed and form a NEW event covering only the new fills.
 *
 * Leg matching: calendar legs are NOT stored as OCC symbols — they are derived from
 * (underlying, strike, optionType, front/backExpiry) via formatOccSymbol, exactly as
 * getOpenCalendarLegs in calendars.ts. readCalendarLegs / the calendar-scoped read compute
 * each calendar's two leg OCC symbols and match against fills.occ_symbol in TypeScript.
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 */

import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
import type {
  ForReadingUnprocessedFills,
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  ForMarkingFillsProcessed,
  ForResettingFillsProcessedForCalendar,
  ForWritingFills,
  ForWipingDerivedFills,
  RawFill,
  CalendarLegEntry,
  StorageError,
} from "@morai/core";
import { eq, and, isNull, inArray, notInArray } from "drizzle-orm";
import { fills, calendars, calendarEvents, orphanFills } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresFillsRepo = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly recomputeCalendarAmounts: ForRecomputingCalendarAmounts;
  readonly markFillsProcessed: ForMarkingFillsProcessed;
  readonly resetFillsProcessedForCalendar: ForResettingFillsProcessedForCalendar;
  readonly writeFills: ForWritingFills;
  readonly wipeDerivedFills: ForWipingDerivedFills;
};

// Map a calendar's status to the positionEffect carried on its legs.
function statusToPositionEffect(
  status: string,
): "OPENING" | "CLOSING" | "UNKNOWN" {
  if (status === "open") return "OPENING";
  if (status === "closed") return "CLOSING";
  return "UNKNOWN";
}

// Derive the front + back leg OCC symbols for a calendar row, matching getOpenCalendarLegs.
function calendarLegSymbols(row: {
  underlying: string;
  strike: number;
  optionType: "C" | "P";
  frontExpiry: string;
  backExpiry: string;
}): { front: OccSymbol; back: OccSymbol } {
  const strikePoints = row.strike / 1000; // schema stores ×1000 int
  const root = row.underlying === "SPXW" ? "SPXW" : "SPX";
  const front = formatOccSymbol({
    root,
    expiry: new Date(row.frontExpiry + "T12:00:00Z"),
    type: row.optionType,
    strike: strikePoints,
  });
  const back = formatOccSymbol({
    root,
    expiry: new Date(row.backExpiry + "T12:00:00Z"),
    type: row.optionType,
    strike: strikePoints,
  });
  return { front, back };
}

function mapFillRow(row: typeof fills.$inferSelect): RawFill {
  return {
    id: row.id,
    orderId: row.orderId,
    occSymbol: row.occSymbol,
    side: row.side === "sell" ? "sell" : "buy",
    qty: row.qty,
    price: parseFloat(row.price),
    filledAt: row.filledAt,
    commission: row.commission !== null ? parseFloat(row.commission) : null,
    fees: row.fees !== null ? parseFloat(row.fees) : null,
  };
}

export function makePostgresFillsRepo(db: Db): PostgresFillsRepo {
  // ─── writeFills (ForWritingFills) ──────────────────────────────────────────
  const writeFills: ForWritingFills = async (
    rows: ReadonlyArray<RawFill>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) return ok(undefined);
    try {
      await db
        .insert(fills)
        .values(
          rows.map((f) => ({
            id: f.id,
            orderId: f.orderId,
            occSymbol: f.occSymbol,
            side: f.side,
            qty: f.qty,
            price: String(f.price),
            filledAt: f.filledAt,
            commission: f.commission !== null ? String(f.commission) : null,
            fees: f.fees !== null ? String(f.fees) : null,
          })),
        )
        .onConflictDoNothing(); // idempotent on id PK (T-05-12-01)
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readUnprocessedFills (ForReadingUnprocessedFills) ──────────────────────
  // WR-A2: fills WHERE processed_at IS NULL AND id NOT IN orphan_fills (exclusion rule above).
  const readUnprocessedFills: ForReadingUnprocessedFills = async (): Promise<
    Result<ReadonlyArray<RawFill>, StorageError>
  > => {
    try {
      const parked = await db.select({ fillId: orphanFills.fillId }).from(orphanFills);
      const parkedIds = parked.map((p) => p.fillId);

      const rows =
        parkedIds.length === 0
          ? await db.select().from(fills).where(isNull(fills.processedAt))
          : await db
              .select()
              .from(fills)
              .where(and(isNull(fills.processedAt), notInArray(fills.id, parkedIds)));

      return ok(rows.map(mapFillRow));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── markFillsProcessed (ForMarkingFillsProcessed) ──────────────────────────
  // WR-A2: stamp processed_at = NOW() so these fills are never re-read/re-paired.
  // No-op on an empty array; idempotent (re-stamping an already-processed id is harmless).
  const markFillsProcessed: ForMarkingFillsProcessed = async (
    fillIds: ReadonlyArray<string>,
  ): Promise<Result<void, StorageError>> => {
    if (fillIds.length === 0) return ok(undefined);
    try {
      await db
        .update(fills)
        .set({ processedAt: new Date() })
        .where(inArray(fills.id, [...fillIds]));
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── resetFillsProcessedForCalendar (ForResettingFillsProcessedForCalendar) ──
  // WR-A2 rebuild support: clear processed_at for the calendar's leg fills so the scoped
  // re-pair re-reads them (delete scope == sync scope). Leg matching mirrors
  // readUnprocessedFillsForCalendar (derive the two leg OCC symbols, match fills.occ_symbol).
  const resetFillsProcessedForCalendar: ForResettingFillsProcessedForCalendar = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    try {
      const calRows = await db
        .select({
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
        })
        .from(calendars)
        .where(eq(calendars.id, calendarId))
        .limit(1);

      const cal = calRows[0];
      if (cal === undefined) return ok(undefined);

      const { front, back } = calendarLegSymbols(cal);
      await db
        .update(fills)
        .set({ processedAt: null })
        .where(inArray(fills.occSymbol, [front, back]));
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Malformed (non-uuid) calendarId → no calendar matches
      if (message.includes("invalid input syntax for type uuid")) return ok(undefined);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readUnprocessedFillsForCalendar (ForReadingUnprocessedFillsForCalendar) ─
  // Unprocessed fills whose OCC symbol is one of the target calendar's two legs.
  const readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar =
    async (
      calendarId: string,
    ): Promise<Result<ReadonlyArray<RawFill>, StorageError>> => {
      try {
        const calRows = await db
          .select({
            underlying: calendars.underlying,
            strike: calendars.strike,
            optionType: calendars.optionType,
            frontExpiry: calendars.frontExpiry,
            backExpiry: calendars.backExpiry,
          })
          .from(calendars)
          .where(eq(calendars.id, calendarId))
          .limit(1);

        const cal = calRows[0];
        if (cal === undefined) return ok([]);

        const { front, back } = calendarLegSymbols(cal);
        const legSet = new Set<string>([front, back]);

        const unprocessed = await readUnprocessedFills();
        if (!unprocessed.ok) return unprocessed;

        return ok(unprocessed.value.filter((f) => legSet.has(f.occSymbol)));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Malformed (non-uuid) calendarId → no calendar matches
        if (message.includes("invalid input syntax for type uuid")) return ok([]);
        return err<StorageError>({ kind: "storage-error", message });
      }
    };

  // ─── readCalendarLegs (ForReadingCalendarLegs) ──────────────────────────────
  // Find every calendar leg whose derived OCC symbol equals the given symbol.
  const readCalendarLegs: ForReadingCalendarLegs = async (
    occSymbol: string,
  ): Promise<Result<ReadonlyArray<CalendarLegEntry>, StorageError>> => {
    try {
      const calRows = await db
        .select({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          status: calendars.status,
        })
        .from(calendars);

      const entries: CalendarLegEntry[] = [];
      for (const cal of calRows) {
        const { front, back } = calendarLegSymbols(cal);
        const positionEffect = statusToPositionEffect(cal.status);
        if (front === occSymbol) {
          entries.push({ calendarId: cal.id, legOccSymbol: front, positionEffect });
        }
        if (back === occSymbol) {
          entries.push({ calendarId: cal.id, legOccSymbol: back, positionEffect });
        }
      }
      return ok(entries);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── resetCalendarAmounts (ForResettingCalendarAmounts) ─────────────────────
  const resetCalendarAmounts: ForResettingCalendarAmounts = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .update(calendars)
        .set({ openNetDebit: null, closeNetCredit: null })
        .where(eq(calendars.id, calendarId));
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── recomputeCalendarAmounts (ForRecomputingCalendarAmounts — A3 / WR-08 / WR-A1) ──
  // WR-A1: sum by eventType (NOT by sign). OPEN.netAmount → open_net_debit; CLOSE.netAmount
  // → close_net_credit (CLOSE netAmount is negative, D-08 — abs it); ROLL splits via its
  // persisted components (roll_open_debit → open_net_debit, roll_close_credit →
  // close_net_credit) so a calendar containing a roll reconciles after rebuild (SC5).
  const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    try {
      const rows = await db
        .select({
          eventType: calendarEvents.eventType,
          netAmount: calendarEvents.netAmount,
          rollOpenDebit: calendarEvents.rollOpenDebit,
          rollCloseCredit: calendarEvents.rollCloseCredit,
        })
        .from(calendarEvents)
        .where(eq(calendarEvents.calendarId, calendarId));

      let openDebit = 0;
      let closeCredit = 0;
      for (const row of rows) {
        const amount = parseFloat(row.netAmount);
        switch (row.eventType) {
          case "OPEN":
            openDebit += amount; // OPEN debit is positive (D-08)
            break;
          case "CLOSE":
            closeCredit += -amount; // CLOSE credit is negative (D-08) → abs
            break;
          case "ROLL":
            // ROLL combined netAmount is sign-ambiguous — split via persisted components.
            if (row.rollOpenDebit !== null) openDebit += parseFloat(row.rollOpenDebit);
            if (row.rollCloseCredit !== null) closeCredit += parseFloat(row.rollCloseCredit);
            break;
        }
      }

      await db
        .update(calendars)
        .set({
          openNetDebit: String(openDebit),
          closeNetCredit: String(closeCredit),
        })
        .where(eq(calendars.id, calendarId));
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── wipeDerivedFills (ForWipingDerivedFills — journal-pnl-opennetdebit-units round 3) ──
  // Account-wide DELETE of the 3 derived trade tables inside ONE transaction (all-or-nothing
  // — money-path atomicity, mirrors recomputeSnapshotPnl's transaction wrap). calendar_events
  // and orphan_fills are deleted before fills (defensive ordering — no FK is declared on any
  // of the three tables today, but this ordering stays safe if one is ever added). Does NOT
  // touch calendars or calendar_snapshots — see ports.ts for the full rationale.
  const wipeDerivedFills: ForWipingDerivedFills = async (): Promise<
    Result<
      {
        readonly fillsDeleted: number;
        readonly eventsDeleted: number;
        readonly orphansDeleted: number;
      },
      StorageError
    >
  > => {
    try {
      const counts = await db.transaction(async (tx) => {
        const deletedEvents = await tx
          .delete(calendarEvents)
          .returning({ id: calendarEvents.id });
        const deletedOrphans = await tx
          .delete(orphanFills)
          .returning({ fillId: orphanFills.fillId });
        const deletedFills = await tx.delete(fills).returning({ id: fills.id });
        return {
          fillsDeleted: deletedFills.length,
          eventsDeleted: deletedEvents.length,
          orphansDeleted: deletedOrphans.length,
        };
      });
      return ok(counts);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    readUnprocessedFills,
    readUnprocessedFillsForCalendar,
    readCalendarLegs,
    resetCalendarAmounts,
    recomputeCalendarAmounts,
    markFillsProcessed,
    resetFillsProcessedForCalendar,
    writeFills,
    wipeDerivedFills,
  };
}

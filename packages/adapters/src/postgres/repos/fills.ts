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
 * Unprocessed-fills exclusion rule (plan 05-12, documented):
 *   A fill is "processed" iff its id is present in orphan_fills. calendar_events stores only
 *   fill_ids_hash (a SHA-256, not per-fill ids), so fills cannot be joined to events by id;
 *   re-emission into calendar_events is absorbed by its fill_ids_hash UNIQUE constraint
 *   (onConflictDoNothing). So readUnprocessedFills returns all fills NOT in orphan_fills.
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
  ForWritingFills,
  RawFill,
  CalendarLegEntry,
  StorageError,
} from "@morai/core";
import { eq, notInArray } from "drizzle-orm";
import { fills, calendars, calendarEvents, orphanFills } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresFillsRepo = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly recomputeCalendarAmounts: ForRecomputingCalendarAmounts;
  readonly writeFills: ForWritingFills;
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
  // All fills whose id is NOT parked in orphan_fills (documented exclusion rule above).
  const readUnprocessedFills: ForReadingUnprocessedFills = async (): Promise<
    Result<ReadonlyArray<RawFill>, StorageError>
  > => {
    try {
      const parked = await db.select({ fillId: orphanFills.fillId }).from(orphanFills);
      const parkedIds = parked.map((p) => p.fillId);

      const rows =
        parkedIds.length === 0
          ? await db.select().from(fills)
          : await db.select().from(fills).where(notInArray(fills.id, parkedIds));

      return ok(rows.map(mapFillRow));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
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

  // ─── recomputeCalendarAmounts (ForRecomputingCalendarAmounts — A3 / WR-08) ──
  // Recompute open_net_debit (sum of positive net_amounts) and close_net_credit
  // (absolute sum of negative net_amounts) from calendar_events, then write them.
  const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    try {
      const rows = await db
        .select({ netAmount: calendarEvents.netAmount })
        .from(calendarEvents)
        .where(eq(calendarEvents.calendarId, calendarId));

      let openDebit = 0;
      let closeCredit = 0;
      for (const row of rows) {
        const amount = parseFloat(row.netAmount);
        if (amount >= 0) {
          openDebit += amount;
        } else {
          closeCredit += -amount;
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

  return {
    readUnprocessedFills,
    readUnprocessedFillsForCalendar,
    readCalendarLegs,
    resetCalendarAmounts,
    recomputeCalendarAmounts,
    writeFills,
  };
}

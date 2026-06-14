import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
import type {
  ForGettingOpenCalendars,
  ForPingingDb,
  ForRegisteringCalendar,
  ForListingCalendars,
  ForClosingCalendar,
  ForGettingCalendarById,
  ForGettingOpenCalendarLegs,
  Calendar,
  StorageError,
  CalendarNotFound,
  CalendarAlreadyClosed,
} from "@morai/core";
import { sql, eq, desc } from "drizzle-orm";
import { calendars } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresCalendarsRepo — Postgres implementation of the calendars ports.
 *
 * Implements: ForGettingOpenCalendars, ForPingingDb, ForRegisteringCalendar,
 * ForListingCalendars, ForClosingCalendar, ForGettingCalendarById,
 * ForGettingOpenCalendarLegs.
 *
 * T-01-09: Drizzle uses parameterized queries; no raw template interpolation.
 * D-05: postgres.js driver on direct/session Supabase URL.
 */
export type PostgresCalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  readonly registerCalendar: ForRegisteringCalendar;
  readonly listCalendars: ForListingCalendars;
  readonly closeCalendar: ForClosingCalendar;
  readonly getCalendarById: ForGettingCalendarById;
  readonly getOpenCalendarLegs: ForGettingOpenCalendarLegs;
  readonly seedOpenCalendar: (calendar: Calendar) => Promise<void>;
};

type CalendarRow = {
  id: string;
  underlying: string;
  strike: number;
  optionType: "C" | "P";
  frontExpiry: string;
  backExpiry: string;
  qty: number;
  status: "open" | "closed";
  openedAt: Date;
  closedAt: Date | null;
  openNetDebit: string | null;
  notes: string | null;
};

function mapRow(row: CalendarRow): Calendar {
  return {
    id: row.id,
    underlying: row.underlying,
    strike: row.strike,
    optionType: row.optionType,
    frontExpiry: row.frontExpiry,
    backExpiry: row.backExpiry,
    qty: row.qty,
    openNetDebit: row.openNetDebit !== null ? parseFloat(row.openNetDebit) : 0,
    status: row.status,
    openedAt: row.openedAt,
    closedAt: row.closedAt,
    notes: row.notes,
  };
}

export function makePostgresCalendarsRepo(db: Db): PostgresCalendarsRepo {
  const getOpenCalendars: ForGettingOpenCalendars = async (): Promise<
    Result<ReadonlyArray<Calendar>, StorageError>
  > => {
    try {
      const rows = await db
        .select({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          qty: calendars.qty,
          status: calendars.status,
          openedAt: calendars.openedAt,
          closedAt: calendars.closedAt,
          openNetDebit: calendars.openNetDebit,
          notes: calendars.notes,
        })
        .from(calendars)
        .where(eq(calendars.status, "open"));

      return ok(rows.map(mapRow));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const pingDb: ForPingingDb = async (): Promise<Result<void, StorageError>> => {
    try {
      await db.execute(sql`SELECT 1`);
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const registerCalendar: ForRegisteringCalendar = async (
    input,
  ): Promise<Result<Calendar, StorageError>> => {
    try {
      const [row] = await db
        .insert(calendars)
        .values({
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: String(input.openNetDebit),
          status: "open",
          openedAt: input.openedAt,
          notes: input.notes ?? null,
        })
        .returning({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          qty: calendars.qty,
          status: calendars.status,
          openedAt: calendars.openedAt,
          closedAt: calendars.closedAt,
          openNetDebit: calendars.openNetDebit,
          notes: calendars.notes,
        });
      if (row === undefined) {
        return err<StorageError>({
          kind: "storage-error",
          message: "insert returned no row",
        });
      }
      return ok(mapRow(row));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const listCalendars: ForListingCalendars = async (
    filter?: "open" | "closed",
  ): Promise<Result<ReadonlyArray<Calendar>, StorageError>> => {
    try {
      const query = db
        .select({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          qty: calendars.qty,
          status: calendars.status,
          openedAt: calendars.openedAt,
          closedAt: calendars.closedAt,
          openNetDebit: calendars.openNetDebit,
          notes: calendars.notes,
        })
        .from(calendars)
        .orderBy(desc(calendars.openedAt));

      const rows =
        filter !== undefined
          ? await query.where(eq(calendars.status, filter))
          : await query;

      return ok(rows.map(mapRow));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const closeCalendar: ForClosingCalendar = async (
    id: string,
    closeNetCredit: number,
  ): Promise<
    Result<Calendar, StorageError | CalendarNotFound | CalendarAlreadyClosed>
  > => {
    try {
      // Fetch current row to check existence and status.
      // Postgres throws on invalid UUID format — treat that as not-found (T-03-05).
      const existing = await db
        .select({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          qty: calendars.qty,
          status: calendars.status,
          openedAt: calendars.openedAt,
          closedAt: calendars.closedAt,
          openNetDebit: calendars.openNetDebit,
          notes: calendars.notes,
        })
        .from(calendars)
        .where(eq(calendars.id, id))
        .limit(1);

      const current = existing[0];
      if (current === undefined) {
        return err<CalendarNotFound>({ kind: "not-found" });
      }
      if (current.status === "closed") {
        return err<CalendarAlreadyClosed>({ kind: "already-closed" });
      }

      // Update to closed
      const [updated] = await db
        .update(calendars)
        .set({
          status: "closed",
          closedAt: new Date(),
          closeNetCredit: String(closeNetCredit),
        })
        .where(eq(calendars.id, id))
        .returning({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          qty: calendars.qty,
          status: calendars.status,
          openedAt: calendars.openedAt,
          closedAt: calendars.closedAt,
          openNetDebit: calendars.openNetDebit,
          notes: calendars.notes,
        });

      if (updated === undefined) {
        return err<StorageError>({
          kind: "storage-error",
          message: "update returned no row",
        });
      }
      return ok(mapRow(updated));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Postgres throws "invalid input syntax for type uuid" for non-UUID id strings.
      // Treat as not-found — a malformed id cannot match any row (T-03-05).
      if (message.includes("invalid input syntax for type uuid")) {
        return err<CalendarNotFound>({ kind: "not-found" });
      }
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const getCalendarById: ForGettingCalendarById = async (
    id: string,
  ): Promise<Result<Calendar | null, StorageError>> => {
    try {
      const rows = await db
        .select({
          id: calendars.id,
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
          qty: calendars.qty,
          status: calendars.status,
          openedAt: calendars.openedAt,
          closedAt: calendars.closedAt,
          openNetDebit: calendars.openNetDebit,
          notes: calendars.notes,
        })
        .from(calendars)
        .where(eq(calendars.id, id))
        .limit(1);

      const row = rows[0];
      return ok(row !== undefined ? mapRow(row) : null);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Postgres throws "invalid input syntax for type uuid" for non-UUID id strings.
      // Treat as not-found — a malformed id matches no row.
      if (message.includes("invalid input syntax for type uuid")) {
        return ok(null);
      }
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const getOpenCalendarLegs: ForGettingOpenCalendarLegs = async (): Promise<
    Result<ReadonlyArray<OccSymbol>, StorageError>
  > => {
    try {
      const rows = await db
        .select({
          underlying: calendars.underlying,
          strike: calendars.strike,
          optionType: calendars.optionType,
          frontExpiry: calendars.frontExpiry,
          backExpiry: calendars.backExpiry,
        })
        .from(calendars)
        .where(eq(calendars.status, "open"));

      const symbolSet = new Set<OccSymbol>();
      for (const row of rows) {
        // OCC formatOccSymbol takes strike in points (not ×1000 int), so divide by 1000
        const strikePoints = row.strike / 1000;
        const front = formatOccSymbol({
          root: row.underlying === "SPXW" ? "SPXW" : "SPX",
          expiry: new Date(row.frontExpiry + "T12:00:00Z"),
          type: row.optionType,
          strike: strikePoints,
        });
        const back = formatOccSymbol({
          root: row.underlying === "SPXW" ? "SPXW" : "SPX",
          expiry: new Date(row.backExpiry + "T12:00:00Z"),
          type: row.optionType,
          strike: strikePoints,
        });
        symbolSet.add(front);
        symbolSet.add(back);
      }
      return ok([...symbolSet]);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const seedOpenCalendar = async (calendar: Calendar): Promise<void> => {
    await db.insert(calendars).values({
      id: calendar.id,
      underlying: calendar.underlying,
      strike: calendar.strike,
      optionType: calendar.optionType,
      frontExpiry: calendar.frontExpiry,
      backExpiry: calendar.backExpiry,
      qty: calendar.qty,
      status: "open",
      openedAt: calendar.openedAt,
      openNetDebit: String(calendar.openNetDebit),
      notes: calendar.notes,
    });
  };

  return {
    getOpenCalendars,
    pingDb,
    registerCalendar,
    listCalendars,
    closeCalendar,
    getCalendarById,
    getOpenCalendarLegs,
    seedOpenCalendar,
  };
}

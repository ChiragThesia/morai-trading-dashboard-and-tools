import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForGettingOpenCalendars,
  ForPingingDb,
  Calendar,
  StorageError,
} from "@morai/core";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { calendars } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresCalendarsRepo — Postgres implementation of the calendars port.
 *
 * Implements ForGettingOpenCalendars and ForPingingDb using Drizzle + postgres.js.
 * Maps all DB errors to StorageError — never throws across the port boundary.
 *
 * T-01-09: Drizzle uses parameterized queries; no raw template interpolation.
 * D-05: postgres.js driver on direct/session Supabase URL.
 */
export type PostgresCalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  readonly seedOpenCalendar: (calendar: Calendar) => Promise<void>;
};

function mapCalendarRow(row: {
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
}): Calendar {
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

      return ok(rows.map(mapCalendarRow));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({
        kind: "storage-error",
        message,
      });
    }
  };

  const pingDb: ForPingingDb = async (): Promise<Result<void, StorageError>> => {
    try {
      await db.execute(sql`SELECT 1`);
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({
        kind: "storage-error",
        message,
      });
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

  return { getOpenCalendars, pingDb, seedOpenCalendar };
}

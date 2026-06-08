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
  readonly seedOpenCalendar: (calendar: {
    id: string;
    underlying: string;
    openedAt: Date;
  }) => Promise<void>;
};

export function makePostgresCalendarsRepo(db: Db): PostgresCalendarsRepo {
  const getOpenCalendars: ForGettingOpenCalendars = async (): Promise<
    Result<ReadonlyArray<Calendar>, StorageError>
  > => {
    try {
      const rows = await db
        .select({
          id: calendars.id,
          underlying: calendars.underlying,
          openedAt: calendars.openedAt,
        })
        .from(calendars)
        .where(eq(calendars.status, "open"));

      const result: ReadonlyArray<Calendar> = rows.map((row) => ({
        id: row.id,
        underlying: row.underlying,
        openedAt: row.openedAt,
      }));

      return ok(result);
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

  const seedOpenCalendar = async (calendar: {
    id: string;
    underlying: string;
    openedAt: Date;
  }): Promise<void> => {
    await db.insert(calendars).values({
      id: calendar.id,
      underlying: calendar.underlying,
      // Strike required by schema; seed uses a sentinel value (SPX 0 = synthetic)
      strike: 0,
      frontExpiry: "2099-01-01",
      backExpiry: "2099-01-01",
      qty: 1,
      status: "open",
      openedAt: calendar.openedAt,
    });
  };

  return { getOpenCalendars, pingDb, seedOpenCalendar };
}

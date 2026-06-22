import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runCalendarEventsContractTests } from "../../__contract__/calendar-events.contract.ts";
import { makePostgresCalendarEventsRepo } from "./calendar-events.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres calendar-events adapter.
 * Requires Docker (testcontainers postgres:16 with migrations applied).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * Verifies:
 * - storeCalendarEvent: idempotent on fillIdsHash UNIQUE (SC4 / T-05-17)
 * - readCalendarEvents: ordered by evented_at ASC, scoped to calendarId
 * - deleteCalendarEvents: removes all events for a calendarId, leaves others intact
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres calendar-events adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // Truncate in FK-safe order (calendar_events FK → calendars)
    await db.execute(sql`TRUNCATE TABLE calendar_events, calendars CASCADE`);
  });

  runCalendarEventsContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresCalendarEventsRepo(db);
      return {
        storeCalendarEvent: repo.storeCalendarEvent,
        readCalendarEvents: repo.readCalendarEvents,
        deleteCalendarEvents: repo.deleteCalendarEvents,
        countEvents: async (calendarId: string): Promise<number> => {
          const rows = await db.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM calendar_events WHERE calendar_id = ${calendarId}::uuid`,
          );
          const row = rows[0];
          if (row === undefined) return 0;
          const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
          const cnt = rec["cnt"];
          if (typeof cnt === "number") return cnt;
          if (typeof cnt === "string") return Number(cnt);
          return 0;
        },
      };
    },
    () => ({
      seedCalendar: async (id: string): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(
          sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
              VALUES (${id}::uuid, 'SPX', 7100000, 'P', '2026-06-20', '2026-09-19', 1, 'open', NOW(), '15.50')
              ON CONFLICT DO NOTHING`,
        );
      },
    }),
  );
});

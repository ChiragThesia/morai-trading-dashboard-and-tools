import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { runCalendarEventsContractTests } from "../../__contract__/calendar-events.contract.ts";
import { makePostgresCalendarEventsRepo } from "./calendar-events.ts";
import { makeMemoryCalendarEventsRepo } from "../../memory/calendar-events.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";
import type { CalendarEvent } from "@morai/core";

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
        readCalendarEventByHash: repo.readCalendarEventByHash,
        deleteCalendarEvents: repo.deleteCalendarEvents,
        readRealizedPnlByCalendar: repo.readRealizedPnlByCalendar,
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

/**
 * readRecentClosedCalendars — the PLAY-02 anti-criteria brake read port (28-02).
 * Verifies the Postgres JOIN against real Postgres AND parity with the in-memory twin.
 */
describe.skipIf(shouldSkip)("readRecentClosedCalendars (28-02, PLAY-02)", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.execute(sql`TRUNCATE TABLE calendar_events, calendars CASCADE`);
  });

  const CAL_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const CAL_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const HASH_1 = "d".repeat(64);
  const HASH_2 = "e".repeat(64);
  const HASH_3 = "f".repeat(64);

  async function seedCalendarWithDebit(
    id: string,
    openNetDebit: number,
  ): Promise<void> {
    if (!db) throw new Error("db not initialized");
    await db.execute(
      sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
          VALUES (${id}::uuid, 'SPX', 7100000, 'P', '2026-06-20', '2026-09-19', 1, 'open', NOW(), ${String(openNetDebit)})
          ON CONFLICT DO NOTHING`,
    );
  }

  function makeCloseEvent(
    calendarId: string,
    fillIdsHash: string,
    eventedAt: Date,
    realizedPnl: number | null,
    legOccSymbol = "O:SPX260620P07100000",
  ): CalendarEvent {
    return {
      id: "00000000-0000-4000-8000-000000000001",
      calendarId,
      eventType: "CLOSE",
      eventedAt,
      fillIdsHash,
      legOccSymbol,
      rolledFromOccSymbol: null,
      qty: 1,
      avgPrice: 15.5,
      netAmount: -15.5,
      realizedPnl,
      legBreakdown: null,
      entryThesis: null,
      rollOpenDebit: null,
      rollCloseCredit: null,
    };
  }

  it("excludes a calendar whose only CLOSE event is before sinceDate", async () => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresCalendarEventsRepo(db);
    await seedCalendarWithDebit(CAL_A, 20);
    await repo.storeCalendarEvent(
      makeCloseEvent(CAL_A, HASH_1, new Date("2026-06-10T14:00:00Z"), -1),
    );

    const result = await repo.readRecentClosedCalendars("2026-06-15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("includes a calendar closed exactly on sinceDate", async () => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresCalendarEventsRepo(db);
    await seedCalendarWithDebit(CAL_A, 20);
    await repo.storeCalendarEvent(
      makeCloseEvent(CAL_A, HASH_1, new Date("2026-06-15T00:00:00Z"), -5),
    );

    const result = await repo.readRecentClosedCalendars("2026-06-15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.calendarId).toBe(CAL_A);
    expect(result.value[0]?.openNetDebit).toBeCloseTo(20, 5);
    expect(result.value[0]?.realizedPnl).toBeCloseTo(-5, 5);
    expect(result.value[0]?.closedAt.toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  it("sums realizedPnl across a calendar's two leg CLOSE events into one row (D-04)", async () => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresCalendarEventsRepo(db);
    await seedCalendarWithDebit(CAL_B, 10);
    await repo.storeCalendarEvent(
      makeCloseEvent(
        CAL_B,
        HASH_1,
        new Date("2026-06-16T14:00:00Z"),
        2,
        "O:SPX260620P07100000",
      ),
    );
    await repo.storeCalendarEvent(
      makeCloseEvent(
        CAL_B,
        HASH_2,
        new Date("2026-06-16T15:00:00Z"),
        3,
        "O:SPX260919P07100000",
      ),
    );

    const result = await repo.readRecentClosedCalendars("2026-06-15");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.calendarId).toBe(CAL_B);
    expect(result.value[0]?.realizedPnl).toBeCloseTo(5, 5);
    expect(result.value[0]?.closedAt.toISOString()).toBe("2026-06-16T15:00:00.000Z");
  });

  it("Postgres repo and the in-memory twin return identical rows for the same fixture", async () => {
    if (!db) throw new Error("db not initialized");
    const pgRepo = makePostgresCalendarEventsRepo(db);
    const memRepo = makeMemoryCalendarEventsRepo();

    await seedCalendarWithDebit(CAL_A, 20);
    await seedCalendarWithDebit(CAL_B, 10);
    memRepo.seedCalendar(CAL_A, 20);
    memRepo.seedCalendar(CAL_B, 10);

    const events = [
      makeCloseEvent(CAL_A, HASH_1, new Date("2026-06-15T00:00:00Z"), -5),
      makeCloseEvent(CAL_B, HASH_2, new Date("2026-06-16T14:00:00Z"), 2, "O:SPX260620P07100000"),
      makeCloseEvent(CAL_B, HASH_3, new Date("2026-06-16T15:00:00Z"), 3, "O:SPX260919P07100000"),
    ];
    for (const event of events) {
      await pgRepo.storeCalendarEvent(event);
      await memRepo.storeCalendarEvent(event);
    }

    const pgResult = await pgRepo.readRecentClosedCalendars("2026-06-15");
    const memResult = await memRepo.readRecentClosedCalendars("2026-06-15");
    expect(pgResult.ok).toBe(true);
    expect(memResult.ok).toBe(true);
    if (!pgResult.ok || !memResult.ok) return;

    const normalize = (rows: typeof pgResult.value) =>
      [...rows]
        .sort((a, b) => a.calendarId.localeCompare(b.calendarId))
        .map((r) => ({
          calendarId: r.calendarId,
          closedAt: r.closedAt.toISOString(),
          openNetDebit: r.openNetDebit,
          realizedPnl: r.realizedPnl,
        }));

    expect(normalize(pgResult.value)).toEqual(normalize(memResult.value));
  });
});

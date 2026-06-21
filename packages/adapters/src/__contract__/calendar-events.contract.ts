/**
 * Shared contract-test suite for the calendar-events persistence ports.
 *
 * Run this suite against both:
 *   - The Postgres adapter (testcontainers) — packages/adapters/src/postgres/repos/calendar-events.contract.test.ts
 *   - The in-memory twin — packages/adapters/src/memory/calendar-events.contract.test.ts
 *
 * Asserts:
 * - storeCalendarEvent: insert → one row
 * - storeCalendarEvent idempotency: same fillIdsHash twice → one row (onConflictDoNothing)
 * - storeCalendarEvent: different fillIdsHash → two rows
 * - readCalendarEvents: returns events for a given calendarId in eventedAt ASC order
 * - readCalendarEvents: returns empty array for unknown calendarId
 * - deleteCalendarEvents: removes all events for calendarId; leaves other calendars' events intact
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForDeletingCalendarEvents,
  StorageError,
} from "@morai/core";
import type { CalendarEvent } from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type CalendarEventsRepo = {
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  /** Count rows in calendar_events for the given calendarId */
  readonly countEvents: (calendarId: string) => Promise<number>;
};

// ─── Seed helpers ─────────────────────────────────────────────────────────────

export type CalendarEventsSeedContext = {
  /** Seed a calendar row into the calendars table (needed for FK) */
  seedCalendar: (id: string) => Promise<void>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH_1 = "a".repeat(64); // 64-char SHA-256 hex placeholder
const HASH_2 = "b".repeat(64);
const HASH_3 = "c".repeat(64);

function makeCalendarEvent(
  calendarId: string,
  fillIdsHash: string,
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    calendarId,
    eventType: "OPEN",
    eventedAt: new Date("2026-06-15T14:00:00Z"),
    fillIdsHash,
    legOccSymbol: "O:SPX260620P07100000",
    rolledFromOccSymbol: null,
    qty: 1,
    avgPrice: 15.5,
    netAmount: 15.5,
    realizedPnl: null,
    legBreakdown: null,
    entryThesis: null,
    ...overrides,
  };
}

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runCalendarEventsContractTests(
  makeRepo: (seed: CalendarEventsSeedContext) => CalendarEventsRepo,
  getSeedContext: () => CalendarEventsSeedContext,
): void {
  describe("calendar-events persistence contract", () => {
    let repo: CalendarEventsRepo;
    let seed: CalendarEventsSeedContext;

    beforeEach(() => {
      seed = getSeedContext();
      repo = makeRepo(seed);
    });

    describe("storeCalendarEvent — idempotency", () => {
      it("inserts one row on first store", async () => {
        await seed.seedCalendar(CAL_A);
        const event = makeCalendarEvent(CAL_A, HASH_1);

        const result = await repo.storeCalendarEvent(event);
        expect(result.ok).toBe(true);

        const count = await repo.countEvents(CAL_A);
        expect(count).toBe(1);
      });

      it("same fillIdsHash twice → exactly one row (onConflictDoNothing)", async () => {
        await seed.seedCalendar(CAL_A);
        const event = makeCalendarEvent(CAL_A, HASH_1);

        await repo.storeCalendarEvent(event);
        await repo.storeCalendarEvent(event); // duplicate — must be no-op

        const count = await repo.countEvents(CAL_A);
        expect(count).toBe(1);
      });

      it("different fillIdsHash → two rows", async () => {
        await seed.seedCalendar(CAL_A);
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_1));
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_2));

        const count = await repo.countEvents(CAL_A);
        expect(count).toBe(2);
      });
    });

    describe("readCalendarEvents — ordering and scope", () => {
      it("returns events for calendarId ordered by eventedAt ASC", async () => {
        await seed.seedCalendar(CAL_A);
        const t1 = new Date("2026-06-15T14:00:00Z");
        const t2 = new Date("2026-06-15T15:00:00Z");

        // Insert out of order
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_2, { eventedAt: t2 }));
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_1, { eventedAt: t1 }));

        const result = await repo.readCalendarEvents(CAL_A);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.eventedAt.getTime()).toBeLessThan(result.value[1]?.eventedAt.getTime() ?? 0);
      });

      it("returns empty array for a calendarId with no events", async () => {
        await seed.seedCalendar(CAL_A);

        const result = await repo.readCalendarEvents(CAL_A);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });

    describe("deleteCalendarEvents — scoped delete", () => {
      it("removes all events for calendarId, leaves other calendars intact", async () => {
        await seed.seedCalendar(CAL_A);
        await seed.seedCalendar(CAL_B);

        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_1));
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_2));
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_B, HASH_3));

        const result = await repo.deleteCalendarEvents(CAL_A);
        expect(result.ok).toBe(true);

        expect(await repo.countEvents(CAL_A)).toBe(0);
        expect(await repo.countEvents(CAL_B)).toBe(1);
      });
    });
  });
}

// Silence unused import — StorageError is used in type annotations above
export type { StorageError };

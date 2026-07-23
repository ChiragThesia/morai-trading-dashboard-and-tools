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
  ForReadingCalendarEventByHash,
  ForDeletingCalendarEvents,
  ForReadingRealizedPnlByCalendar,
  StorageError,
} from "@morai/core";
import type { CalendarEvent } from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type CalendarEventsRepo = {
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly readCalendarEventByHash: ForReadingCalendarEventByHash;
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  readonly readRealizedPnlByCalendar: ForReadingRealizedPnlByCalendar;
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
    // WR-A1: explicit ROLL open/close components — null for OPEN/CLOSE, set for ROLL.
    rollOpenDebit: null,
    rollCloseCredit: null,
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

      it("WR-A1: a ROLL event round-trips its rollOpenDebit / rollCloseCredit components", async () => {
        await seed.seedCalendar(CAL_A);
        const roll = makeCalendarEvent(CAL_A, HASH_1, {
          eventType: "ROLL",
          rolledFromOccSymbol: "O:SPX260620P07100000",
          legOccSymbol: "O:SPX260919P07100000",
          netAmount: 1, // combined: openDebit(6) − closeCredit(5)
          rollOpenDebit: 6,
          rollCloseCredit: 5,
        });
        const stored = await repo.storeCalendarEvent(roll);
        expect(stored.ok).toBe(true);

        const result = await repo.readCalendarEvents(CAL_A);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const read = result.value.find((e) => e.eventType === "ROLL");
        expect(read).toBeDefined();
        expect(read?.rollOpenDebit).toBeCloseTo(6, 5);
        expect(read?.rollCloseCredit).toBeCloseTo(5, 5);
      });

      it("WR-A1: OPEN/CLOSE events keep null roll components on round-trip", async () => {
        await seed.seedCalendar(CAL_A);
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_2, { eventType: "OPEN" }));

        const result = await repo.readCalendarEvents(CAL_A);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const read = result.value[0];
        expect(read?.rollOpenDebit).toBeNull();
        expect(read?.rollCloseCredit).toBeNull();
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

    describe("readCalendarEventByHash — global hash lookup (plan 20-10)", () => {
      it("returns the event matching the given fillIdsHash, no calendarId needed", async () => {
        await seed.seedCalendar(CAL_A);
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_1));

        const result = await repo.readCalendarEventByHash(HASH_1);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value?.fillIdsHash).toBe(HASH_1);
        expect(result.value?.calendarId).toBe(CAL_A);
      });

      it("returns null for an unknown fillIdsHash", async () => {
        await seed.seedCalendar(CAL_A);
        await repo.storeCalendarEvent(makeCalendarEvent(CAL_A, HASH_1));

        const result = await repo.readCalendarEventByHash(HASH_3);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
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

    describe("readRealizedPnlByCalendar — Trade Ledger aggregate", () => {
      it("sums realizedPnl across CLOSE AND ROLL events per calendar", async () => {
        await seed.seedCalendar(CAL_A);
        await seed.seedCalendar(CAL_B);

        await repo.storeCalendarEvent(
          makeCalendarEvent(CAL_A, HASH_1, { eventType: "CLOSE", realizedPnl: -100.5 }),
        );
        await repo.storeCalendarEvent(
          makeCalendarEvent(CAL_A, HASH_2, {
            eventType: "ROLL",
            realizedPnl: -71.2,
            rollOpenDebit: 40.08,
            rollCloseCredit: 41.58,
          }),
        );
        // OPEN events never contribute (realizedPnl null on OPEN anyway).
        await repo.storeCalendarEvent(
          makeCalendarEvent(CAL_B, HASH_3, { eventType: "OPEN", realizedPnl: null }),
        );

        const result = await repo.readRealizedPnlByCalendar();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value[CAL_A]).toBeCloseTo(-171.7, 10);
        // CAL_B has no CLOSE/ROLL events → absent from the record entirely.
        expect(CAL_B in result.value).toBe(false);
      });

      it("a calendar whose every CLOSE/ROLL event has null realizedPnl maps to null, never 0", async () => {
        await seed.seedCalendar(CAL_A);
        await repo.storeCalendarEvent(
          makeCalendarEvent(CAL_A, HASH_1, { eventType: "CLOSE", realizedPnl: null }),
        );

        const result = await repo.readRealizedPnlByCalendar();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(CAL_A in result.value).toBe(true);
        expect(result.value[CAL_A]).toBeNull();
      });

      it("returns an empty record when no CLOSE/ROLL events exist", async () => {
        const result = await repo.readRealizedPnlByCalendar();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(Object.keys(result.value)).toHaveLength(0);
      });
    });
  });
}

// Silence unused import — StorageError is used in type annotations above
export type { StorageError };

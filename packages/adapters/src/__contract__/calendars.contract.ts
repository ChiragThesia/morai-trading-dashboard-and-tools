import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForGettingOpenCalendars,
  ForPingingDb,
  Calendar,
  ForRegisteringCalendar,
  ForListingCalendars,
  ForClosingCalendar,
  ForGettingCalendarById,
  ForGettingOpenCalendarLegs,
} from "@morai/core";

/**
 * Shared contract-test suite for the calendars repository port.
 * Run this suite against BOTH the Postgres adapter (testcontainers)
 * and the in-memory adapter (no Docker needed).
 *
 * Factory receives a repo that satisfies all calendar port types.
 */
export type CalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  readonly seedOpenCalendar?: (calendar: Calendar) => Promise<void>;
  readonly registerCalendar: ForRegisteringCalendar;
  readonly listCalendars: ForListingCalendars;
  readonly closeCalendar: ForClosingCalendar;
  readonly getCalendarById: ForGettingCalendarById;
  readonly getOpenCalendarLegs: ForGettingOpenCalendarLegs;
};

// Zod v4 valid UUID (version 1-8 in position 13, variant bits in position 17)
const TEST_UUID = "11111111-1111-1111-8111-111111111111";

function makeCalendarSeed(overrides?: Partial<Calendar>): Calendar {
  return {
    id: TEST_UUID,
    underlying: "SPX",
    strike: 7100000,
    optionType: "C",
    frontExpiry: "2026-02-21",
    backExpiry: "2026-03-21",
    qty: 1,
    openNetDebit: 5.5,
    status: "open",
    openedAt: new Date("2026-01-02T14:30:00Z"),
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

export function runCalendarsContractTests(
  makeRepo: () => CalendarsRepo,
): void {
  describe("calendars contract", () => {
    let repo: CalendarsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    describe("pingDb", () => {
      it("returns ok(undefined) against a reachable store", async () => {
        const result = await repo.pingDb();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBeUndefined();
        }
      });
    });

    describe("getOpenCalendars", () => {
      it("returns ok([]) when the store is empty", async () => {
        const result = await repo.getOpenCalendars();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toEqual([]);
        }
      });

      it("returns ok([calendar]) after seeding one open calendar", async () => {
        if (!repo.seedOpenCalendar) {
          return;
        }
        const calendar = makeCalendarSeed();
        await repo.seedOpenCalendar(calendar);

        const result = await repo.getOpenCalendars();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(1);
          const cal = result.value[0];
          expect(cal).toBeDefined();
          if (cal !== undefined) {
            expect(cal.id).toBe(calendar.id);
            expect(cal.underlying).toBe(calendar.underlying);
            expect(cal.openedAt.toISOString()).toBe(
              calendar.openedAt.toISOString(),
            );
          }
        }
      });
    });

    describe("registerCalendar", () => {
      it("inserts and returns the created calendar with a UUID", async () => {
        const result = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(typeof result.value.id).toBe("string");
          expect(result.value.id.length).toBeGreaterThan(0);
          expect(result.value.underlying).toBe("SPX");
          expect(result.value.status).toBe("open");
          expect(result.value.closedAt).toBeNull();
          expect(result.value.openNetDebit).toBe(5.5);
        }
      });

      it("status is open after registration", async () => {
        const result = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.status).toBe("open");
        }
      });
    });

    describe("listCalendars", () => {
      it("returns empty array when no calendars registered", async () => {
        const result = await repo.listCalendars();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(0);
        }
      });

      it("lists all calendars when no filter", async () => {
        await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        const result = await repo.listCalendars();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.length).toBeGreaterThanOrEqual(1);
        }
      });

      it("filters to only open calendars when status=open", async () => {
        const reg = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(reg.ok).toBe(true);
        const result = await repo.listCalendars("open");
        expect(result.ok).toBe(true);
        if (result.ok) {
          for (const cal of result.value) {
            expect(cal.status).toBe("open");
          }
        }
      });
    });

    describe("closeCalendar", () => {
      it("returns not-found when id is unknown", async () => {
        // Use a valid UUID that doesn't exist in the store
        const result = await repo.closeCalendar(
          "00000000-0000-0000-0000-000000000000",
          3.25,
        );
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("not-found");
        }
      });

      it("closes an open calendar — status becomes closed", async () => {
        const reg = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(reg.ok).toBe(true);
        if (!reg.ok) return;
        const id = reg.value.id;

        const result = await repo.closeCalendar(id, 3.25);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.status).toBe("closed");
          expect(result.value.closedAt).not.toBeNull();
        }
      });

      it("returns already-closed when closing an already-closed calendar", async () => {
        const reg = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(reg.ok).toBe(true);
        if (!reg.ok) return;
        const id = reg.value.id;

        // Close once
        await repo.closeCalendar(id, 3.25);
        // Close again
        const result = await repo.closeCalendar(id, 3.25);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.kind).toBe("already-closed");
        }
      });
    });

    describe("getCalendarById", () => {
      it("returns null for an unknown id", async () => {
        // Use a valid UUID format that doesn't exist in the store
        const result = await repo.getCalendarById(
          "00000000-0000-0000-0000-000000000000",
        );
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toBeNull();
        }
      });

      it("returns the calendar for a known id", async () => {
        const reg = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(reg.ok).toBe(true);
        if (!reg.ok) return;
        const id = reg.value.id;

        const result = await repo.getCalendarById(id);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).not.toBeNull();
          if (result.value !== null) {
            expect(result.value.id).toBe(id);
          }
        }
      });
    });

    describe("getOpenCalendarLegs", () => {
      it("returns empty array when no open calendars exist", async () => {
        const result = await repo.getOpenCalendarLegs();
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value).toHaveLength(0);
        }
      });

      it("returns front+back OCC symbols for each open calendar", async () => {
        const reg = await repo.registerCalendar({
          underlying: "SPX",
          strike: 7100000,
          optionType: "C",
          frontExpiry: "2026-02-21",
          backExpiry: "2026-03-21",
          qty: 1,
          openNetDebit: 5.5,
          openedAt: new Date("2026-01-02T14:30:00Z"),
        });
        expect(reg.ok).toBe(true);

        const result = await repo.getOpenCalendarLegs();
        expect(result.ok).toBe(true);
        if (result.ok) {
          // One open calendar → 2 OCC symbols (front + back leg)
          expect(result.value).toHaveLength(2);
          // Each OCC symbol should be a 21-char string
          for (const sym of result.value) {
            expect(typeof sym).toBe("string");
            expect(sym.length).toBe(21);
          }
        }
      });
    });
  });
}

import { describe } from "vitest";
import { runCalendarEventsContractTests } from "../__contract__/calendar-events.contract.ts";
import { makeMemoryCalendarEventsRepo } from "./calendar-events.ts";
import type { CalendarEventsSeedContext } from "../__contract__/calendar-events.contract.ts";

/**
 * Contract test for the in-memory calendar-events adapter.
 * No Docker required — runs always.
 *
 * Verifies twin parity with the Postgres adapter per architecture-boundaries §8.
 * In particular: storeCalendarEvent with same fillIdsHash twice MUST be a no-op (SC4).
 */
describe("in-memory calendar-events adapter", () => {
  runCalendarEventsContractTests(
    (_seed) => {
      const repo = makeMemoryCalendarEventsRepo();
      return {
        storeCalendarEvent: repo.storeCalendarEvent,
        readCalendarEvents: repo.readCalendarEvents,
        deleteCalendarEvents: repo.deleteCalendarEvents,
        countEvents: repo.countEvents,
      };
    },
    (): CalendarEventsSeedContext => ({
      seedCalendar: async (_id: string): Promise<void> => {
        // In-memory adapter has no FK constraint; seedCalendar is a no-op.
        // The memory repo accepts any calendarId without needing prior registration.
      },
    }),
  );
});

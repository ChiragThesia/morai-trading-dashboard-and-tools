/**
 * makeMemoryCalendarEventsRepo — in-memory twin of the Postgres calendar-events adapter.
 *
 * Implements ForStoringCalendarEvent, ForReadingCalendarEvents, ForDeletingCalendarEvents
 * using plain Maps — no Docker, no network, always available for unit tests.
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * Idempotency semantics mirror Postgres:
 *   storeCalendarEvent: Map keyed on fillIdsHash — same hash = no-op (onConflictDoNothing).
 *   deleteCalendarEvents: removes all events for a calendarId.
 *
 * seedCalendar: not required for calendar-events (no FK check in this adapter).
 * countEvents: test helper — count rows for a calendarId.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForDeletingCalendarEvents,
  CalendarEvent,
  StorageError,
} from "@morai/core";

export type MemoryCalendarEventsRepo = {
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  /** countEvents — test helper: count events for a calendarId */
  readonly countEvents: (calendarId: string) => Promise<number>;
  /** seedCalendar — no-op for this adapter (no FK constraint); provided for contract parity */
  readonly seedCalendar: (id: string) => void;
};

export function makeMemoryCalendarEventsRepo(): MemoryCalendarEventsRepo {
  // Key: fillIdsHash (UNIQUE constraint equivalent)
  const store = new Map<string, CalendarEvent>();

  const storeCalendarEvent: ForStoringCalendarEvent = async (
    event: CalendarEvent,
  ): Promise<Result<void, StorageError>> => {
    if (!store.has(event.fillIdsHash)) {
      store.set(event.fillIdsHash, event); // onConflictDoNothing equivalent
    }
    return ok(undefined);
  };

  const readCalendarEvents: ForReadingCalendarEvents = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<CalendarEvent>, StorageError>> => {
    const rows = [...store.values()]
      .filter((e) => e.calendarId === calendarId)
      .sort((a, b) => a.eventedAt.getTime() - b.eventedAt.getTime());
    return ok(rows);
  };

  const deleteCalendarEvents: ForDeletingCalendarEvents = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    for (const [hash, event] of store.entries()) {
      if (event.calendarId === calendarId) {
        store.delete(hash);
      }
    }
    return ok(undefined);
  };

  const countEvents = async (calendarId: string): Promise<number> => {
    return [...store.values()].filter((e) => e.calendarId === calendarId).length;
  };

  const seedCalendar = (_id: string): void => {
    // No FK constraint in the in-memory adapter; no-op for contract test parity.
  };

  return { storeCalendarEvent, readCalendarEvents, deleteCalendarEvents, countEvents, seedCalendar };
}

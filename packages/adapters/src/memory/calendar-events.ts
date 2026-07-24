/**
 * makeMemoryCalendarEventsRepo — in-memory twin of the Postgres calendar-events adapter.
 *
 * Implements ForStoringCalendarEvent, ForReadingCalendarEvents, ForDeletingCalendarEvents,
 * ForReadingRecentClosedCalendars using plain Maps — no Docker, no network, always available
 * for unit tests.
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * Idempotency semantics mirror Postgres:
 *   storeCalendarEvent: Map keyed on fillIdsHash — same hash = no-op (onConflictDoNothing).
 *   deleteCalendarEvents: removes all events for a calendarId.
 *
 * seedCalendar: no FK check in this adapter, so `id` alone works for the shared contract
 * suite; the optional `openNetDebit` param (28-02) feeds readRecentClosedCalendars, mirroring
 * the Postgres JOIN's calendars.open_net_debit column.
 * countEvents: test helper — count rows for a calendarId.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForReadingCalendarEventByHash,
  ForDeletingCalendarEvents,
  ForReadingRecentClosedCalendars,
  RecentClosedCalendar,
  CalendarEvent,
  StorageError,
} from "@morai/core";

export type MemoryCalendarEventsRepo = {
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly readCalendarEventByHash: ForReadingCalendarEventByHash;
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  readonly readRecentClosedCalendars: ForReadingRecentClosedCalendars;
  /** countEvents — test helper: count events for a calendarId */
  readonly countEvents: (calendarId: string) => Promise<number>;
  /**
   * seedCalendar — registers a calendarId (no FK constraint in this adapter, so `id` alone
   * is already contract-compatible). `openNetDebit` is optional (28-02, PLAY-02): readRecentClosedCalendars
   * needs it for parity with the Postgres JOIN's calendars.open_net_debit column; omitted
   * calendars default to 0, mirroring the Postgres repo's null-debit-to-0 convention.
   */
  readonly seedCalendar: (id: string, openNetDebit?: number) => void;
};

export function makeMemoryCalendarEventsRepo(): MemoryCalendarEventsRepo {
  // Key: fillIdsHash (UNIQUE constraint equivalent)
  const store = new Map<string, CalendarEvent>();
  // 28-02 (PLAY-02): calendars.open_net_debit twin — keyed by calendarId, populated via seedCalendar.
  const openNetDebits = new Map<string, number>();

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

  // Store is keyed on fillIdsHash (the DB UNIQUE constraint) — a direct lookup (plan 20-10).
  const readCalendarEventByHash: ForReadingCalendarEventByHash = async (
    fillIdsHash: string,
  ): Promise<Result<CalendarEvent | null, StorageError>> => {
    return ok(store.get(fillIdsHash) ?? null);
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

  // ─── readRecentClosedCalendars (ForReadingRecentClosedCalendars, 28-02/PLAY-02) ──
  // Twin of the Postgres JOIN: group this calendarId's CLOSE events on/after sinceDate,
  // SUM realizedPnl (skipping nulls — null only when every event in the group is null,
  // matching Postgres SUM's NULL-ignoring semantics), MAX eventedAt as closedAt.
  const readRecentClosedCalendars: ForReadingRecentClosedCalendars = async (
    sinceDate: string,
  ): Promise<Result<ReadonlyArray<RecentClosedCalendar>, StorageError>> => {
    const sinceMs = new Date(sinceDate).getTime();
    const byCalendar = new Map<string, CalendarEvent[]>();
    for (const event of store.values()) {
      if (event.eventType !== "CLOSE") continue;
      if (event.eventedAt.getTime() < sinceMs) continue;
      const bucket = byCalendar.get(event.calendarId) ?? [];
      bucket.push(event);
      byCalendar.set(event.calendarId, bucket);
    }

    const rows: RecentClosedCalendar[] = [...byCalendar.entries()].map(([calendarId, events]) => {
      const closedAt = new Date(Math.max(...events.map((e) => e.eventedAt.getTime())));
      const nonNullPnls = events
        .map((e) => e.realizedPnl)
        .filter((pnl): pnl is number => pnl !== null);
      const realizedPnl = nonNullPnls.length > 0 ? nonNullPnls.reduce((a, b) => a + b, 0) : null;
      return {
        calendarId,
        closedAt,
        openNetDebit: openNetDebits.get(calendarId) ?? 0,
        realizedPnl,
      };
    });

    return ok(rows);
  };

  const seedCalendar = (id: string, openNetDebit?: number): void => {
    if (openNetDebit !== undefined) openNetDebits.set(id, openNetDebit);
  };

  return {
    storeCalendarEvent,
    readCalendarEvents,
    readCalendarEventByHash,
    deleteCalendarEvents,
    readRecentClosedCalendars,
    countEvents,
    seedCalendar,
  };
}

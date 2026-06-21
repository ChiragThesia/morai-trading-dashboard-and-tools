/**
 * makePostgresCalendarEventsRepo — Postgres implementation of the calendar-events ports.
 *
 * storeCalendarEvent: INSERT onConflictDoNothing on fill_ids_hash UNIQUE constraint (SC4).
 * readCalendarEvents: SELECT ordered by evented_at ASC for a calendarId.
 * deleteCalendarEvents: DELETE all rows for a calendarId (used by rebuild-journal).
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * T-05-17: onConflictDoNothing makes re-run a no-op (SC4 idempotency).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForDeletingCalendarEvents,
  CalendarEvent,
  StorageError,
} from "@morai/core";
import { eq, asc } from "drizzle-orm";
import { calendarEvents } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresCalendarEventsRepo = {
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
};

export function makePostgresCalendarEventsRepo(db: Db): PostgresCalendarEventsRepo {
  // ─── storeCalendarEvent (ForStoringCalendarEvent) ─────────────────────────────
  // Idempotent INSERT — fill_ids_hash UNIQUE constraint absorbs duplicates (SC4).
  const storeCalendarEvent: ForStoringCalendarEvent = async (
    event: CalendarEvent,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .insert(calendarEvents)
        .values({
          // Omit `id` — let defaultRandom() generate a fresh UUID per insert.
          // The idempotency key is fillIdsHash UNIQUE, not the PK.
          // Passing a caller-supplied id would conflict on PK when the same CalendarEvent
          // object is inserted twice (different fillIdsHash case uses same fixture id).
          calendarId: event.calendarId,
          eventType: event.eventType,
          eventedAt: event.eventedAt,
          fillIdsHash: event.fillIdsHash,
          legOccSymbol: event.legOccSymbol,
          rolledFromOccSymbol: event.rolledFromOccSymbol,
          qty: event.qty,
          avgPrice: String(event.avgPrice),
          netAmount: String(event.netAmount),
          realizedPnl: event.realizedPnl !== null ? String(event.realizedPnl) : null,
          legBreakdown: event.legBreakdown,
          entryThesis: event.entryThesis,
        })
        .onConflictDoNothing(); // T-05-17: fill_ids_hash UNIQUE → re-run = no-op (SC4)
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readCalendarEvents (ForReadingCalendarEvents) ────────────────────────────
  // Returns all events for a calendarId ordered by evented_at ASC.
  // Returns empty array when no events exist (not null — caller handles missing calendar).
  const readCalendarEvents: ForReadingCalendarEvents = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<CalendarEvent>, StorageError>> => {
    try {
      const rows = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.calendarId, calendarId))
        .orderBy(asc(calendarEvents.eventedAt));

      const mapped: CalendarEvent[] = rows.map((row) => ({
        id: row.id,
        calendarId: row.calendarId,
        eventType: row.eventType,
        eventedAt: row.eventedAt,
        fillIdsHash: row.fillIdsHash,
        legOccSymbol: row.legOccSymbol,
        rolledFromOccSymbol: row.rolledFromOccSymbol ?? null,
        qty: row.qty,
        avgPrice: parseFloat(row.avgPrice),
        netAmount: parseFloat(row.netAmount),
        realizedPnl: row.realizedPnl !== null ? parseFloat(row.realizedPnl) : null,
        legBreakdown: row.legBreakdown ?? null,
        entryThesis: row.entryThesis ?? null,
      }));

      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── deleteCalendarEvents (ForDeletingCalendarEvents) ────────────────────────
  // Removes ALL calendar_events rows for a calendarId.
  // Used by rebuild-journal (D-10) before re-running sync-fills for a calendar.
  const deleteCalendarEvents: ForDeletingCalendarEvents = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.calendarId, calendarId));
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { storeCalendarEvent, readCalendarEvents, deleteCalendarEvents };
}

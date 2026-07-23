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

import { ok, err, assertDefined } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForReadingCalendarEventByHash,
  ForDeletingCalendarEvents,
  ForReadingRecentClosedCalendars,
  ForReadingRealizedPnlByCalendar,
  RecentClosedCalendar,
  CalendarEvent,
  StorageError,
} from "@morai/core";
import { eq, asc, and, gte, max, sum, inArray } from "drizzle-orm";
import { calendarEvents, calendars } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresCalendarEventsRepo = {
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly readCalendarEventByHash: ForReadingCalendarEventByHash;
  readonly deleteCalendarEvents: ForDeletingCalendarEvents;
  readonly readRecentClosedCalendars: ForReadingRecentClosedCalendars;
  readonly readRealizedPnlByCalendar: ForReadingRealizedPnlByCalendar;
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
          // WR-A1: persist the explicit ROLL split components (null for OPEN/CLOSE).
          rollOpenDebit: event.rollOpenDebit !== null ? String(event.rollOpenDebit) : null,
          rollCloseCredit:
            event.rollCloseCredit !== null ? String(event.rollCloseCredit) : null,
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
        rollOpenDebit: row.rollOpenDebit !== null ? parseFloat(row.rollOpenDebit) : null,
        rollCloseCredit:
          row.rollCloseCredit !== null ? parseFloat(row.rollCloseCredit) : null,
        legBreakdown: row.legBreakdown ?? null,
        entryThesis: row.entryThesis ?? null,
      }));

      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readCalendarEventByHash (ForReadingCalendarEventByHash) ─────────────────
  // Looks up a single event by its globally UNIQUE fill_ids_hash (plan 20-10) — no
  // calendarId needed, since fill_ids_hash is already the DB idempotency key.
  const readCalendarEventByHash: ForReadingCalendarEventByHash = async (
    fillIdsHash: string,
  ): Promise<Result<CalendarEvent | null, StorageError>> => {
    try {
      const rows = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.fillIdsHash, fillIdsHash))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return ok(null);

      return ok({
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
        rollOpenDebit: row.rollOpenDebit !== null ? parseFloat(row.rollOpenDebit) : null,
        rollCloseCredit:
          row.rollCloseCredit !== null ? parseFloat(row.rollCloseCredit) : null,
        legBreakdown: row.legBreakdown ?? null,
        entryThesis: row.entryThesis ?? null,
      });
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

  // ─── readRecentClosedCalendars (ForReadingRecentClosedCalendars, 28-02/PLAY-02) ──
  // ONE JOIN — calendars ⋈ calendar_events WHERE event_type = 'CLOSE' — never an N+1 loop
  // over closed calendars (Pitfall 4). GROUP BY calendars.id (the PK) so Postgres accepts
  // the un-aggregated calendars.open_net_debit column via functional dependency; realizedPnl
  // is SUM()'d across a calendar's leg CLOSE events (D-04), never recomputed.
  const readRecentClosedCalendars: ForReadingRecentClosedCalendars = async (
    sinceDate: string,
  ): Promise<Result<ReadonlyArray<RecentClosedCalendar>, StorageError>> => {
    try {
      const rows = await db
        .select({
          calendarId: calendars.id,
          closedAt: max(calendarEvents.eventedAt),
          openNetDebit: calendars.openNetDebit,
          realizedPnl: sum(calendarEvents.realizedPnl),
        })
        .from(calendarEvents)
        .innerJoin(calendars, eq(calendarEvents.calendarId, calendars.id))
        .where(
          and(
            eq(calendarEvents.eventType, "CLOSE"),
            gte(calendarEvents.eventedAt, new Date(sinceDate)),
          ),
        )
        .groupBy(calendars.id);

      const mapped: RecentClosedCalendar[] = rows.map((row) => {
        assertDefined(
          row.closedAt,
          "readRecentClosedCalendars: grouped CLOSE row missing eventedAt",
        );
        return {
          calendarId: row.calendarId,
          closedAt: row.closedAt,
          openNetDebit: row.openNetDebit !== null ? parseFloat(row.openNetDebit) : 0,
          realizedPnl: row.realizedPnl !== null ? parseFloat(row.realizedPnl) : null,
        };
      });

      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readRealizedPnlByCalendar (ForReadingRealizedPnlByCalendar, Trade Ledger) ──
  // ONE GROUP BY over CLOSE **and** ROLL events (ROLL rows carry the closed leg's
  // realized P&L — the PLAY-02 CLOSE-only aggregate deliberately excludes them, the
  // ledger must not). SUM ignores nulls and yields NULL for an all-null group — mapped
  // to null, never 0. Calendars with no CLOSE/ROLL events are absent (GROUP BY).
  const readRealizedPnlByCalendar: ForReadingRealizedPnlByCalendar = async (): Promise<
    Result<Readonly<Record<string, number | null>>, StorageError>
  > => {
    try {
      const rows = await db
        .select({
          calendarId: calendarEvents.calendarId,
          realizedPnl: sum(calendarEvents.realizedPnl),
        })
        .from(calendarEvents)
        .where(inArray(calendarEvents.eventType, ["CLOSE", "ROLL"]))
        .groupBy(calendarEvents.calendarId);

      const record: Record<string, number | null> = {};
      for (const row of rows) {
        record[row.calendarId] = row.realizedPnl !== null ? parseFloat(row.realizedPnl) : null;
      }
      return ok(record);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return {
    storeCalendarEvent,
    readCalendarEvents,
    readCalendarEventByHash,
    deleteCalendarEvents,
    readRecentClosedCalendars,
    readRealizedPnlByCalendar,
  };
}

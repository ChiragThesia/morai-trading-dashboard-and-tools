import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
import { resolveRootCandidates } from "@morai/core";
import type {
  ForGettingOpenCalendars,
  ForPingingDb,
  ForRegisteringCalendar,
  ForListingCalendars,
  ForClosingCalendar,
  ForTransitioningCalendarClosed,
  ForGettingCalendarById,
  ForGettingOpenCalendarLegs,
  Calendar,
  StorageError,
  CalendarNotFound,
  CalendarAlreadyClosed,
} from "@morai/core";

/**
 * makeMemoryCalendarsRepo — in-memory twin of the Postgres adapter.
 *
 * Implements all calendar ports using a plain Map — no Docker, no network,
 * always available.
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 */
export type MemoryCalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  readonly registerCalendar: ForRegisteringCalendar;
  readonly listCalendars: ForListingCalendars;
  readonly closeCalendar: ForClosingCalendar;
  readonly transitionCalendarClosed: ForTransitioningCalendarClosed;
  readonly getCalendarById: ForGettingCalendarById;
  readonly getOpenCalendarLegs: ForGettingOpenCalendarLegs;
  readonly seedOpenCalendar: (calendar: Calendar) => Promise<void>;
};

export function makeMemoryCalendarsRepo(): MemoryCalendarsRepo {
  // Backing store: id → Calendar (full extended type)
  const store = new Map<string, Calendar>();

  const getOpenCalendars: ForGettingOpenCalendars = async (): Promise<
    Result<ReadonlyArray<Calendar>, StorageError>
  > => {
    return ok([...store.values()].filter((c) => c.status === "open"));
  };

  const pingDb: ForPingingDb = async (): Promise<
    Result<void, StorageError>
  > => {
    return ok(undefined);
  };

  const registerCalendar: ForRegisteringCalendar = async (
    input,
  ): Promise<Result<Calendar, StorageError>> => {
    const id = crypto.randomUUID();
    const calendar: Calendar = {
      id,
      underlying: input.underlying,
      strike: input.strike,
      optionType: input.optionType,
      frontExpiry: input.frontExpiry,
      backExpiry: input.backExpiry,
      qty: input.qty,
      openNetDebit: input.openNetDebit,
      status: "open",
      openedAt: input.openedAt,
      closedAt: null,
      notes: input.notes ?? null,
    };
    store.set(id, calendar);
    return ok(calendar);
  };

  const listCalendars: ForListingCalendars = async (
    filter?: "open" | "closed",
  ): Promise<Result<ReadonlyArray<Calendar>, StorageError>> => {
    const all = [...store.values()];
    const filtered =
      filter !== undefined ? all.filter((c) => c.status === filter) : all;
    // Sort openedAt desc (most recent first)
    const sorted = filtered.sort(
      (a, b) => b.openedAt.getTime() - a.openedAt.getTime(),
    );
    return ok(sorted);
  };

  const closeCalendar: ForClosingCalendar = async (
    id: string,
    closeNetCredit: number,
  ): Promise<
    Result<Calendar, StorageError | CalendarNotFound | CalendarAlreadyClosed>
  > => {
    const existing = store.get(id);
    if (existing === undefined) {
      return err<CalendarNotFound>({ kind: "not-found" });
    }
    if (existing.status === "closed") {
      return err<CalendarAlreadyClosed>({ kind: "already-closed" });
    }
    // closeNetCredit is stored in the DB by the Postgres adapter but is not part of
    // the Calendar domain type (it lives in the calendars table only).
    // The in-memory twin captures status + closedAt only.
    const updated: Calendar = {
      ...existing,
      status: "closed",
      closedAt: new Date(),
    };
    // closeNetCredit is intentionally not stored in-memory (not in Calendar type)
    const _closeNetCredit = closeNetCredit; // acknowledge param without void-floating
    void _closeNetCredit;
    store.set(id, updated);
    return ok(updated);
  };

  // ─── transitionCalendarClosed (ForTransitioningCalendarClosed — round 5 bug 2) ──────
  const transitionCalendarClosed: ForTransitioningCalendarClosed = async (
    calendarId: string,
    closedAt: Date,
  ): Promise<Result<void, StorageError>> => {
    const existing = store.get(calendarId);
    if (existing === undefined || existing.status === "closed") return ok(undefined);
    store.set(calendarId, { ...existing, status: "closed", closedAt });
    return ok(undefined);
  };

  const getCalendarById: ForGettingCalendarById = async (
    id: string,
  ): Promise<Result<Calendar | null, StorageError>> => {
    return ok(store.get(id) ?? null);
  };

  const getOpenCalendarLegs: ForGettingOpenCalendarLegs = async (): Promise<
    Result<ReadonlyArray<OccSymbol>, StorageError>
  > => {
    // HIST-01: a calendar's front/back legs can carry DIFFERENT OCC roots — build BOTH
    // candidate-root symbols for each leg (costless over-inclusion, Set dedups). Mirrors
    // the Postgres twin exactly (architecture-boundaries rule 8).
    const symbolSet = new Set<OccSymbol>();
    for (const calendar of store.values()) {
      if (calendar.status !== "open") continue;
      // OCC formatOccSymbol takes strike in points (not ×1000 int), so divide by 1000
      const strikePoints = calendar.strike / 1000;
      for (const root of resolveRootCandidates(calendar.underlying)) {
        symbolSet.add(
          formatOccSymbol({
            root,
            expiry: new Date(calendar.frontExpiry + "T12:00:00Z"),
            type: calendar.optionType,
            strike: strikePoints,
          }),
        );
        symbolSet.add(
          formatOccSymbol({
            root,
            expiry: new Date(calendar.backExpiry + "T12:00:00Z"),
            type: calendar.optionType,
            strike: strikePoints,
          }),
        );
      }
    }
    return ok([...symbolSet]);
  };

  const seedOpenCalendar = async (calendar: Calendar): Promise<void> => {
    store.set(calendar.id, calendar);
  };

  return {
    getOpenCalendars,
    pingDb,
    registerCalendar,
    listCalendars,
    closeCalendar,
    transitionCalendarClosed,
    getCalendarById,
    getOpenCalendarLegs,
    seedOpenCalendar,
  };
}

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForGettingOpenCalendars,
  ForPingingDb,
  Calendar,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryCalendarsRepo — in-memory twin of the Postgres adapter.
 *
 * Implements the ForGettingOpenCalendars and ForPingingDb ports using a plain
 * Map — no Docker, no network, always available.
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 */
export type MemoryCalendarsRepo = {
  readonly getOpenCalendars: ForGettingOpenCalendars;
  readonly pingDb: ForPingingDb;
  readonly seedOpenCalendar: (calendar: Calendar) => Promise<void>;
};

export function makeMemoryCalendarsRepo(): MemoryCalendarsRepo {
  // Backing store: id → Calendar (full extended type from Phase 3)
  const store = new Map<string, Calendar>();

  const getOpenCalendars: ForGettingOpenCalendars = async (): Promise<
    Result<ReadonlyArray<Calendar>, StorageError>
  > => {
    return ok([...store.values()]);
  };

  const pingDb: ForPingingDb = async (): Promise<
    Result<void, StorageError>
  > => {
    return ok(undefined);
  };

  const seedOpenCalendar = async (calendar: Calendar): Promise<void> => {
    store.set(calendar.id, calendar);
  };

  return { getOpenCalendars, pingDb, seedOpenCalendar };
}

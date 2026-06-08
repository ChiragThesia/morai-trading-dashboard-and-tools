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
  readonly seedOpenCalendar: (calendar: {
    id: string;
    underlying: string;
    openedAt: Date;
  }) => Promise<void>;
};

export function makeMemoryCalendarsRepo(): MemoryCalendarsRepo {
  // Backing store: id → Calendar
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

  const seedOpenCalendar = async (calendar: {
    id: string;
    underlying: string;
    openedAt: Date;
  }): Promise<void> => {
    store.set(calendar.id, {
      id: calendar.id,
      underlying: calendar.underlying,
      openedAt: calendar.openedAt,
    });
  };

  return { getOpenCalendars, pingDb, seedOpenCalendar };
}

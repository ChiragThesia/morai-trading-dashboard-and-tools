import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  EconomicEvent,
  ForPersistingEconomicEvents,
  ForReadingEconomicEvents,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryEconomicEventsRepo — in-memory twin of the Postgres economic-events adapter.
 *
 * Implements ForPersistingEconomicEvents + ForReadingEconomicEvents using a Map keyed by
 * `${date}|${name}`. A second insert for the same key REPLACES the stored row, mirroring
 * onConflictDoUpdate on (event_date, event_name) — idempotent re-fetch/re-seed.
 *
 * Always returns ok(...) — no network or DB calls, no error paths.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same PR
 * (architecture-boundaries.md §8).
 */
export type MemoryEconomicEventsRepo = {
  readonly persistEconomicEvents: ForPersistingEconomicEvents;
  readonly readEconomicEvents: ForReadingEconomicEvents;
};

export function makeMemoryEconomicEventsRepo(): MemoryEconomicEventsRepo {
  // Key: `${date}|${name}` — mirrors the composite PK (event_date, event_name)
  const store = new Map<string, EconomicEvent>();

  const keyOf = (row: EconomicEvent): string => `${row.date}|${row.name}`;

  const persistEconomicEvents: ForPersistingEconomicEvents = async (
    rows: ReadonlyArray<EconomicEvent>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      store.set(keyOf(row), row); // onConflictDoUpdate: existing key → replace
    }
    return ok(undefined);
  };

  const readEconomicEvents: ForReadingEconomicEvents = async (): Promise<
    Result<ReadonlyArray<EconomicEvent>, StorageError>
  > => {
    return ok([...store.values()]);
  };

  return { persistEconomicEvents, readEconomicEvents };
}

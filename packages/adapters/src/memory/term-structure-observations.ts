/**
 * makeMemoryTermStructureObservationsRepo — in-memory twin of the Postgres term-structure adapter.
 *
 * Implements ForWritingTermStructureObservations + ForReadingTermStructureSeries using a plain
 * Map — no Docker, no network, always available for unit tests.
 *
 * Architecture law: every driven port change updates the in-memory adapter in the same PR
 * (architecture-boundaries.md §8). Idempotency mirrors Postgres onConflictDoNothing:
 *   key = `${snapshotTime.toISOString()}|${calendarId}` (the composite PK grain).
 *   A second write of the same grain is a no-op.
 *
 * value round-trips exactly (it is held as a number, never re-encoded) so the term_slope
 * passthrough (T-06-07) cannot drift through this twin.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForWritingTermStructureObservations,
  ForReadingTermStructureSeries,
  TermStructureObservationRow,
  StorageError,
} from "@morai/core";

export type MemoryTermStructureObservationsRepo = {
  readonly storeTermStructureObservations: ForWritingTermStructureObservations;
  readonly readTermStructureSeries: ForReadingTermStructureSeries;
  /** countObservations — test helper: count rows (optionally for one calendarId) */
  readonly countObservations: (calendarId?: string) => Promise<number>;
};

export function makeMemoryTermStructureObservationsRepo(): MemoryTermStructureObservationsRepo {
  // Key: `${snapshotTime.toISOString()}|${calendarId}` (composite-PK grain)
  const store = new Map<string, TermStructureObservationRow>();

  const keyOf = (row: TermStructureObservationRow): string =>
    `${row.snapshotTime.toISOString()}|${row.calendarId}`;

  const storeTermStructureObservations: ForWritingTermStructureObservations = async (
    rows: ReadonlyArray<TermStructureObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      const key = keyOf(row);
      if (!store.has(key)) store.set(key, row); // onConflictDoNothing equivalent
    }
    return ok(undefined);
  };

  const readTermStructureSeries: ForReadingTermStructureSeries = async (query: {
    readonly calendarId?: string;
  }): Promise<Result<ReadonlyArray<TermStructureObservationRow>, StorageError>> => {
    const rows = [...store.values()]
      .filter((r) => query.calendarId === undefined || r.calendarId === query.calendarId)
      .sort((a, b) => a.snapshotTime.getTime() - b.snapshotTime.getTime());
    return ok(rows);
  };

  const countObservations = async (calendarId?: string): Promise<number> => {
    return [...store.values()].filter(
      (r) => calendarId === undefined || r.calendarId === calendarId,
    ).length;
  };

  return { storeTermStructureObservations, readTermStructureSeries, countObservations };
}

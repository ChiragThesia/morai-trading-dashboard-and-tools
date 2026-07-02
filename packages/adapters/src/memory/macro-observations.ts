import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingMacroObservation,
  ForReadingMacroObservations,
  MacroObservationRow,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryMacroObservationsRepo — in-memory twin of the Postgres
 * macro-observations adapter.
 *
 * Implements ForPersistingMacroObservation + ForReadingMacroObservations using a
 * Map keyed by `${date}|${seriesId}`. A second insert for the same key REPLACES
 * the stored row, mirroring onConflictDoUpdate on (date, series_id) — MAC-01
 * idempotency (D-05): re-runs never duplicate but may revise the value.
 *
 * Always returns ok(...) — no network or DB calls, no error paths.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in
 * the same PR (architecture-boundaries.md §8).
 */
export type MemoryMacroObservationsRepo = {
  readonly insertMacroObservation: ForPersistingMacroObservation;
  readonly readMacroObservations: ForReadingMacroObservations;
};

export function makeMemoryMacroObservationsRepo(): MemoryMacroObservationsRepo {
  // Key: `${date}|${seriesId}` — mirrors the composite PK (date, series_id)
  const store = new Map<string, MacroObservationRow>();

  const keyOf = (row: MacroObservationRow): string =>
    `${row.date}|${row.seriesId}`;

  const insertMacroObservation: ForPersistingMacroObservation = async (
    row: MacroObservationRow,
  ): Promise<Result<void, StorageError>> => {
    store.set(keyOf(row), row); // onConflictDoUpdate: existing key → replace
    return ok(undefined);
  };

  const readMacroObservations: ForReadingMacroObservations = async (): Promise<
    Result<ReadonlyArray<MacroObservationRow>, StorageError>
  > => {
    return ok([...store.values()]);
  };

  return { insertMacroObservation, readMacroObservations };
}

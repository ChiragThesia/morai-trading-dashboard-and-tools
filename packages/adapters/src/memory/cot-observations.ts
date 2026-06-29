import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingCotObservation,
  ForReadingCotObservations,
  CotObservationRow,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryCotObservationsRepo — in-memory twin of the Postgres COT observations adapter.
 *
 * Implements ForPersistingCotObservation + ForReadingCotObservations using a Map keyed
 * by `${contractCode}|${asOf}`. A second insert for the same key is a no-op, mirroring
 * onConflictDoNothing on (contract_code, as_of) — COT-01 idempotency (D-09).
 *
 * Always returns ok(...) — no network or DB calls, no error paths.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the
 * same PR (architecture-boundaries.md §8).
 */
export type MemoryCotObservationsRepo = {
  readonly insertCotObservation: ForPersistingCotObservation;
  readonly listCotObservations: ForReadingCotObservations;
};

export function makeMemoryCotObservationsRepo(): MemoryCotObservationsRepo {
  // Key: `${contractCode}|${asOf}` — mirrors the UNIQUE(contract_code, as_of) constraint
  const store = new Map<string, CotObservationRow>();

  const keyOf = (row: CotObservationRow): string =>
    `${row.contractCode}|${row.asOf}`;

  // STUB — RED phase: always returns ok(undefined) but does NOT write to the store
  const insertCotObservation: ForPersistingCotObservation = async (
    _row: CotObservationRow,
  ): Promise<Result<void, StorageError>> => {
    // STUB: no-op — tests will fail because store stays empty
    return ok(undefined);
  };

  const listCotObservations: ForReadingCotObservations = async (
    _limit?: number,
  ): Promise<Result<ReadonlyArray<CotObservationRow>, StorageError>> => {
    // STUB: always returns empty array
    return ok([...store.values()]);
  };

  // Expose keyOf for GREEN implementation below (suppresses unused-var warning)
  void keyOf;

  return { insertCotObservation, listCotObservations };
}

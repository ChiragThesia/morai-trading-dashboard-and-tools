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
 * Ordering: listCotObservations returns rows sorted by asOf DESC. YYYY-MM-DD strings
 * compare lexicographically in the same order as chronologically, so localeCompare
 * produces a correct descending sort.
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

  const insertCotObservation: ForPersistingCotObservation = async (
    row: CotObservationRow,
  ): Promise<Result<void, StorageError>> => {
    const key = keyOf(row);
    if (!store.has(key)) {
      store.set(key, row); // onConflictDoNothing: existing key → no-op
    }
    return ok(undefined);
  };

  const listCotObservations: ForReadingCotObservations = async (
    limit?: number,
  ): Promise<Result<ReadonlyArray<CotObservationRow>, StorageError>> => {
    // Sort by asOf DESC — YYYY-MM-DD strings sort lexicographically = chronologically
    const sorted = [...store.values()].sort((a, b) =>
      b.asOf.localeCompare(a.asOf),
    );
    const result = limit !== undefined ? sorted.slice(0, limit) : sorted;
    return ok(result);
  };

  return { insertCotObservation, listCotObservations };
}

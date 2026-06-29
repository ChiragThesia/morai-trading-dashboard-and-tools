import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingCotObservation,
  ForReadingCotObservations,
  CotObservationRow,
  StorageError,
} from "@morai/core";
import type { Db } from "../db.ts";

/**
 * makePostgresCotObservationsRepo — Postgres implementation of
 * ForPersistingCotObservation and ForReadingCotObservations.
 *
 * STUB — RED phase. Replace with real implementation in GREEN.
 */
export type PostgresCotObservationsRepo = {
  readonly insertCotObservation: ForPersistingCotObservation;
  readonly listCotObservations: ForReadingCotObservations;
};

export function makePostgresCotObservationsRepo(
  _db: Db,
): PostgresCotObservationsRepo {
  const insertCotObservation: ForPersistingCotObservation = async (
    _row: CotObservationRow,
  ): Promise<Result<void, StorageError>> => {
    // STUB — does NOT write to DB
    return ok(undefined);
  };

  const listCotObservations: ForReadingCotObservations = async (
    _limit?: number,
  ): Promise<Result<ReadonlyArray<CotObservationRow>, StorageError>> => {
    // STUB — always returns empty array (assertion failures prove RED)
    return ok([]);
  };

  return { insertCotObservation, listCotObservations };
}

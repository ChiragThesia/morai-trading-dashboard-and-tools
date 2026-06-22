/**
 * makeMemorySkewObservationsRepo — in-memory twin of the Postgres skew-observations adapter.
 *
 * Implements ForWritingSkewObservations + ForReadingSkewSmileDetail using a plain Map — no Docker,
 * always available for unit tests. Idempotency mirrors Postgres onConflictDoNothing on the
 * composite PK (snapshot_time, underlying, expiration, strike):
 *   key = `${snapshotTime.toISOString()}|${underlying}|${expiration}|${strike}` — a second write
 *   of the same grain is a no-op. iv/delta/moneyness are held as numbers|null, never re-encoded,
 *   so they round-trip exactly (null stays null).
 *
 * Architecture law (architecture-boundaries.md §8): every driven port change updates this twin.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForWritingSkewObservations,
  ForReadingSkewSmileDetail,
  SkewObservationRow,
  StorageError,
} from "@morai/core";

export type MemorySkewObservationsRepo = {
  readonly storeSkewObservations: ForWritingSkewObservations;
  readonly readSkewSmileDetail: ForReadingSkewSmileDetail;
  /** countObservations — test helper: count rows (optionally for one underlying) */
  readonly countObservations: (underlying?: string) => Promise<number>;
};

export function makeMemorySkewObservationsRepo(): MemorySkewObservationsRepo {
  const store = new Map<string, SkewObservationRow>();

  const keyOf = (row: SkewObservationRow): string =>
    `${row.snapshotTime.toISOString()}|${row.underlying}|${row.expiration}|${row.strike}`;

  const storeSkewObservations: ForWritingSkewObservations = async (
    rows: ReadonlyArray<SkewObservationRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      const key = keyOf(row);
      if (!store.has(key)) store.set(key, row); // onConflictDoNothing equivalent
    }
    return ok(undefined);
  };

  const readSkewSmileDetail: ForReadingSkewSmileDetail = async (query: {
    readonly underlying?: string;
    readonly expiration?: string;
  }): Promise<Result<ReadonlyArray<SkewObservationRow>, StorageError>> => {
    const rows = [...store.values()]
      .filter((r) => query.underlying === undefined || r.underlying === query.underlying)
      .filter((r) => query.expiration === undefined || r.expiration === query.expiration)
      .sort((a, b) => a.snapshotTime.getTime() - b.snapshotTime.getTime());
    return ok(rows);
  };

  const countObservations = async (underlying?: string): Promise<number> =>
    [...store.values()].filter((r) => underlying === undefined || r.underlying === underlying)
      .length;

  return { storeSkewObservations, readSkewSmileDetail, countObservations };
}

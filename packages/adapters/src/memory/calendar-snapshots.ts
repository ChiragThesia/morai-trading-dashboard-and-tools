/**
 * makeMemoryCalendarSnapshotsRepo — in-memory twin of the Postgres adapter.
 *
 * Implements ForPersistingSnapshot, ForReadingJournal, ForResolvingLegSnapshot
 * using plain Maps — no Docker, no network, always available for unit tests.
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * readJournal semantics mirror Postgres (WR-07 parity fix):
 *   - Unknown calendarId → ok(null)  (drives 404 in the route layer)
 *   - Known calendarId, no rows → ok([])
 * Use seedCalendar(id) to register a calendar id as known before persisting
 * snapshots, mirroring the FK that the Postgres adapter enforces via the
 * calendars table.
 *
 * resolveLegSnapshot: backed by seedable LegSnapshot store. Callers seed
 * observations via seedLegSnapshot before calling the use-case.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingSnapshot,
  ForReadingJournal,
  ForResolvingLegSnapshot,
  SnapshotRow,
  LegSnapshot,
  StorageError,
} from "@morai/core";

export type MemoryCalendarSnapshotsRepo = {
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegSnapshot: ForResolvingLegSnapshot;
  /**
   * seedCalendar — register a calendarId as known so readJournal returns
   * ok([]) (not ok(null)) for it. Mirrors the FK enforced by the Postgres
   * calendars table (architecture-boundaries §8 twin parity).
   */
  readonly seedCalendar: (id: string) => void;
  /**
   * seedLegSnapshot — seed a LegSnapshot so resolveLegSnapshot can return it.
   * Key: `${underlying}:${strike}:${optionType}:${expiry}`
   */
  readonly seedLegSnapshot: (
    underlying: string,
    strike: number,
    optionType: "C" | "P",
    expiry: string,
    leg: LegSnapshot,
  ) => void;
};

export function makeMemoryCalendarSnapshotsRepo(): MemoryCalendarSnapshotsRepo {
  // Key: `${time.toISOString()}:${calendarId}` for composite-PK idempotency
  const store = new Map<string, SnapshotRow>();

  // Tracks calendar ids registered via seedCalendar — mirrors the Postgres
  // calendars table FK. readJournal returns null for ids not in this set.
  const knownIds = new Set<string>();

  // Key: `${underlying}:${strike}:${optionType}:${expiry}`
  const legStore = new Map<string, LegSnapshot>();

  const persistSnapshot: ForPersistingSnapshot = async (
    row: SnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    const key = `${row.time.toISOString()}:${row.calendarId}`;
    if (!store.has(key)) store.set(key, row); // onConflictDoNothing equivalent
    return ok(undefined);
  };

  // readJournal mirrors Postgres semantics (architecture-boundaries §8 twin parity):
  //   Unknown calendarId → ok(null)   (drives 404 in the route layer)
  //   Known calendarId, no rows → ok([])
  const readJournal: ForReadingJournal = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<SnapshotRow> | null, StorageError>> => {
    if (!knownIds.has(calendarId)) return ok(null);
    const rows = [...store.values()]
      .filter((r) => r.calendarId === calendarId)
      .sort((a, b) => a.time.getTime() - b.time.getTime());
    return ok(rows);
  };

  const resolveLegSnapshot: ForResolvingLegSnapshot = async (query: {
    readonly underlying: string;
    readonly strike: number;
    readonly optionType: "C" | "P";
    readonly expiry: string;
  }): Promise<Result<LegSnapshot | null, StorageError>> => {
    const key = `${query.underlying}:${query.strike}:${query.optionType}:${query.expiry}`;
    return ok(legStore.get(key) ?? null);
  };

  const seedCalendar = (id: string): void => {
    knownIds.add(id);
  };

  const seedLegSnapshot = (
    underlying: string,
    strike: number,
    optionType: "C" | "P",
    expiry: string,
    leg: LegSnapshot,
  ): void => {
    const key = `${underlying}:${strike}:${optionType}:${expiry}`;
    legStore.set(key, leg);
  };

  return { persistSnapshot, readJournal, resolveLegSnapshot, seedCalendar, seedLegSnapshot };
}

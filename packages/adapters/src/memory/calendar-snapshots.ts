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
import {
  computeSnapshotPnl,
  resolveRootCandidates,
  isGapRow,
} from "@morai/core";
import type {
  ForPersistingSnapshot,
  ForReadingJournal,
  ForResolvingLegSnapshot,
  ForReadingCalendarSnapshotsForCycle,
  ForReadingLatestSnapshotTime,
  ForRecomputingSnapshotPnl,
  ForReadingLatestSnapshotPerOpenCalendarForJournal,
  ForReadingFullSnapshotHistoryForCalendar,
  ForHealingSnapshot,
  ForDeletingSnapshotsOutsideWindow,
  LatestSnapshotForOpenCalendar,
  FullHistorySnapshotRow,
  SnapshotRow,
  LegSnapshot,
  CalendarSnapshotForCycle,
  StorageError,
} from "@morai/core";

export type MemoryCalendarSnapshotsRepo = {
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegSnapshot: ForResolvingLegSnapshot;
  readonly readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle;
  readonly readLatestSnapshotTime: ForReadingLatestSnapshotTime;
  readonly recomputeSnapshotPnl: ForRecomputingSnapshotPnl;
  readonly readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendarForJournal;
  readonly readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar;
  readonly healSnapshot: ForHealingSnapshot;
  readonly deleteSnapshotsOutsideWindow: ForDeletingSnapshotsOutsideWindow;
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
      .sort((a, b) => a.time.getTime() - b.time.getTime())
      .map(withDefaultTrigger);
    return ok(rows);
  };

  // HIST-01: a calendar's two legs can carry DIFFERENT real roots even though
  // calendars.underlying (query.underlying) stores only one — try every candidate root
  // (stored root first, then its sibling) instead of an exact match. Mirrors the
  // Postgres twin's inArray(contracts.root, ...) fix.
  const resolveLegSnapshot: ForResolvingLegSnapshot = async (query: {
    readonly underlying: string;
    readonly strike: number;
    readonly optionType: "C" | "P";
    readonly expiry: string;
  }): Promise<Result<LegSnapshot | null, StorageError>> => {
    for (const root of resolveRootCandidates(query.underlying)) {
      const key = `${root}:${query.strike}:${query.optionType}:${query.expiry}`;
      const leg = legStore.get(key);
      if (leg !== undefined) return ok(leg);
    }
    return ok(null);
  };

  // readSnapshotsForCycle (06-04) — most recent snapshot time ≤ snapshotTime, mapped to the
  // term-slope passthrough shape. Mirrors the Postgres adapter (parseFloat at the numeric boundary;
  // "NaN" → NaN so the use-case skips it). Empty array when no snapshots on or before the time.
  const readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle = async (
    snapshotTime: Date,
  ): Promise<Result<ReadonlyArray<CalendarSnapshotForCycle>, StorageError>> => {
    const onOrBefore = [...store.values()].filter(
      (r) => r.time.getTime() <= snapshotTime.getTime(),
    );
    if (onOrBefore.length === 0) return ok([]);
    const cycleTime = Math.max(...onOrBefore.map((r) => r.time.getTime()));
    const mapped: CalendarSnapshotForCycle[] = onOrBefore
      .filter((r) => r.time.getTime() === cycleTime)
      .map((r) => ({
        snapshotTime: r.time,
        calendarId: r.calendarId,
        termSlope: parseFloat(r.termSlope),
        frontIv: parseFloat(r.frontIv),
        backIv: parseFloat(r.backIv),
      }));
    return ok(mapped);
  };

  // 20-05 (SNAP-01, Pattern 2) twin: max `time` across all stored rows, null when empty.
  // Mirrors the Postgres MAX(time) read — never throws.
  const readLatestSnapshotTime: ForReadingLatestSnapshotTime = async (): Promise<
    Result<Date | null, StorageError>
  > => {
    if (store.size === 0) return ok(null);
    const latestMs = Math.max(...[...store.values()].map((r) => r.time.getTime()));
    return ok(new Date(latestMs));
  };

  // JRNL-01 pnl-unit-mismatch fix: re-derive pnl_open on every stored row for a calendar from
  // the given openNetDebit/qty (D-05 formula), sharing the exact snapshotCalendars.ts formula
  // via computeSnapshotPnl — no online fetch, re-derives purely from each row's netMark.
  const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (
    calendarId: string,
    openNetDebit: number,
    qty: number,
  ): Promise<Result<{ readonly rowsUpdated: number }, StorageError>> => {
    let rowsUpdated = 0;
    for (const [key, row] of store) {
      if (row.calendarId !== calendarId) continue;
      const netMark = parseFloat(row.netMark);
      const pnlOpen = String(computeSnapshotPnl(netMark, openNetDebit, qty));
      store.set(key, { ...row, pnlOpen });
      rowsUpdated += 1;
    }
    return ok({ rowsUpdated });
  };

  // 26-03 (EXIT-02) twin: latest row per known calendar id, no source filtering — the
  // memory model never had the readJournal/mapSnapshotRow cboe-only bug (Pitfall 1) since
  // it never filters by source at all. Closed-calendar exclusion is not modeled at this
  // repo layer (knownIds only tracks "known", mirroring the Postgres seed helper, which
  // always inserts status='open' — see architecture-boundaries.md §8 twin parity).
  const readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendarForJournal = async (): Promise<
    Result<ReadonlyArray<LatestSnapshotForOpenCalendar>, StorageError>
  > => {
    const latestByCalendar = new Map<string, SnapshotRow>();
    for (const row of store.values()) {
      if (!knownIds.has(row.calendarId)) continue;
      const existing = latestByCalendar.get(row.calendarId);
      if (existing === undefined || row.time.getTime() > existing.time.getTime()) {
        latestByCalendar.set(row.calendarId, row);
      }
    }
    const mapped: LatestSnapshotForOpenCalendar[] = [...latestByCalendar.entries()].map(
      ([calendarId, row]) => ({ calendarId, snapshot: withDefaultTrigger(row) }),
    );
    return ok(mapped);
  };

  // 27-03 (BT-03) twin: every row for one calendar, ASC, any source/status — mirrors the
  // Postgres adapter, which performs NO join to calendars (status/existence are irrelevant
  // here, unlike readJournal). A calendar with no rows returns ok([]), not an error.
  const readFullSnapshotHistoryForCalendar: ForReadingFullSnapshotHistoryForCalendar = async (
    calendarId: string,
  ): Promise<Result<ReadonlyArray<FullHistorySnapshotRow>, StorageError>> => {
    const rows: FullHistorySnapshotRow[] = [...store.values()]
      .filter((r) => r.calendarId === calendarId)
      .sort((a, b) => a.time.getTime() - b.time.getTime())
      .map((r) => ({
        calendarId: r.calendarId,
        time: r.time,
        netMark: parseFloat(r.netMark),
        frontIv: parseFloat(r.frontIv),
        backIv: parseFloat(r.backIv),
        dteFront: r.dteFront,
        dteBack: r.dteBack,
        spot: parseFloat(r.spot),
        source: r.source,
      }));
    return ok(rows);
  };

  // healSnapshot (HIST-02, D-03): fill-only conditional write. INSERT when absent; UPDATE when
  // the existing row IS a gap (isGapRow — the LOCKED predicate, never a second definition);
  // NO-OP when the existing row is live (non-gap) — a live row always wins.
  const healSnapshot: ForHealingSnapshot = async (
    row: SnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    const key = `${row.time.toISOString()}:${row.calendarId}`;
    const existing = store.get(key);
    if (existing === undefined || isGapRow(existing)) {
      store.set(key, row);
    }
    return ok(undefined);
  };

  // deleteSnapshotsOutsideWindow (HIST-02, D-08): removes rows outside [openedAt, closedAt]
  // for a calendar; closedAt null (open calendar) trims only the pre-openedAt side.
  const deleteSnapshotsOutsideWindow: ForDeletingSnapshotsOutsideWindow = async (
    calendarId: string,
    openedAt: Date,
    closedAt: Date | null,
  ): Promise<Result<{ readonly deletedCount: number }, StorageError>> => {
    let deletedCount = 0;
    for (const [key, row] of store) {
      if (row.calendarId !== calendarId) continue;
      const t = row.time.getTime();
      const outsideWindow = t < openedAt.getTime() || (closedAt !== null && t > closedAt.getTime());
      if (!outsideWindow) continue;
      store.delete(key);
      deletedCount += 1;
    }
    return ok({ deletedCount });
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

  return {
    persistSnapshot,
    readJournal,
    resolveLegSnapshot,
    readSnapshotsForCycle,
    readLatestSnapshotTime,
    recomputeSnapshotPnl,
    readLatestSnapshotPerOpenCalendar,
    readFullSnapshotHistoryForCalendar,
    healSnapshot,
    deleteSnapshotsOutsideWindow,
    seedCalendar,
    seedLegSnapshot,
  };
}

// SNAP-01 / D-12 (twin parity with Postgres mapSnapshotRow): absent trigger reads as
// "scheduled" — the only other valid value is "event-move".
function withDefaultTrigger(row: SnapshotRow): SnapshotRow {
  return row.trigger === "event-move" ? row : { ...row, trigger: "scheduled" };
}

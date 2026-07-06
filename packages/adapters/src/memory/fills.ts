/**
 * makeMemoryFillsRepo — in-memory twin of the Postgres fills data-path adapter (A1 + A3).
 *
 * Mirrors makePostgresFillsRepo using plain Maps — no Docker, no network.
 * Architecture law: every driven port change updates the in-memory adapter in the same PR
 * (architecture-boundaries.md §8). Behavior must match the Postgres contract (shared suite).
 *
 * Idempotency / semantics mirror Postgres:
 *   - writeFills: Map keyed on fill id — same id = no-op (onConflictDoNothing).
 *   - readUnprocessedFills: all fills whose id is not parked in the orphan set.
 *   - leg matching: derive each calendar's two leg OCC symbols via formatOccSymbol,
 *     exactly as the Postgres adapter (same canonical OSI form).
 */

import { ok, formatOccSymbol } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
import type {
  ForReadingUnprocessedFills,
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  ForMarkingFillsProcessed,
  ForResettingFillsProcessedForCalendar,
  ForWritingFills,
  ForWipingDerivedFills,
  ForReadingFillsByOccSymbols,
  RawFill,
  CalendarLegEntry,
  StorageError,
} from "@morai/core";
// Seed-input shapes for the in-memory twin's test helpers. Defined locally (not imported
// from __contract__) so this production module never depends on test-only code — the
// shared contract test passes structurally-compatible objects (mirrors orphan-fills twin).
export type MemorySeedCalendar = {
  readonly id: string;
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string; // YYYY-MM-DD
  readonly backExpiry: string; // YYYY-MM-DD
  readonly qty: number;
  readonly status: "open" | "closed";
  readonly openNetDebit: number | null;
};

// WR-A4: full event shape so the twin can model a ROLL (eventType + components), keeping
// twin/Postgres recompute parity once WR-A1 sums by eventType. Defined locally (no __contract__
// import) — the shared contract passes structurally-compatible objects.
export type MemorySeedEvent = {
  readonly calendarId: string;
  readonly eventType: "OPEN" | "CLOSE" | "ROLL";
  readonly fillIdsHash: string;
  readonly legOccSymbol: string;
  readonly netAmount: number;
  readonly rolledFromOccSymbol?: string | null;
  readonly rollOpenDebit?: number | null;
  readonly rollCloseCredit?: number | null;
};

export type MemorySeedOrphan = {
  readonly fillId: string;
};

type StoredCalendar = MemorySeedCalendar & {
  openNetDebit: number | null;
  closeNetCredit: number | null;
};

export type MemoryFillsRepo = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly recomputeCalendarAmounts: ForRecomputingCalendarAmounts;
  readonly markFillsProcessed: ForMarkingFillsProcessed;
  readonly resetFillsProcessedForCalendar: ForResettingFillsProcessedForCalendar;
  readonly writeFills: ForWritingFills;
  readonly wipeDerivedFills: ForWipingDerivedFills;
  readonly readFillsByOccSymbols: ForReadingFillsByOccSymbols;
  // ─── Test seed helpers (mirror the Postgres contract harness) ──────────────
  readonly seedCalendar: (cal: MemorySeedCalendar) => void;
  readonly seedEvent: (event: MemorySeedEvent) => void;
  readonly seedOrphan: (orphan: MemorySeedOrphan) => void;
  readonly readCalendarAmounts: (
    calendarId: string,
  ) => { openNetDebit: number | null; closeNetCredit: number | null };
  readonly countFills: () => number;
  readonly readProcessedFillIds: () => ReadonlyArray<string>;
  readonly countEvents: () => number;
  readonly countOrphans: () => number;
};

function calendarLegSymbols(cal: StoredCalendar): { front: OccSymbol; back: OccSymbol } {
  const strikePoints = cal.strike / 1000;
  const root = cal.underlying === "SPXW" ? "SPXW" : "SPX";
  const front = formatOccSymbol({
    root,
    expiry: new Date(cal.frontExpiry + "T12:00:00Z"),
    type: cal.optionType,
    strike: strikePoints,
  });
  const back = formatOccSymbol({
    root,
    expiry: new Date(cal.backExpiry + "T12:00:00Z"),
    type: cal.optionType,
    strike: strikePoints,
  });
  return { front, back };
}

export function makeMemoryFillsRepo(): MemoryFillsRepo {
  const fillStore = new Map<string, RawFill>(); // keyed on fill id (PK)
  const calendarStore = new Map<string, StoredCalendar>(); // keyed on calendar id
  const eventStore: MemorySeedEvent[] = [];
  const orphanIds = new Set<string>();
  const processedIds = new Set<string>(); // WR-A2: processed_at IS NOT NULL equivalent

  const writeFills: ForWritingFills = async (
    rows: ReadonlyArray<RawFill>,
  ): Promise<Result<void, StorageError>> => {
    for (const f of rows) {
      if (!fillStore.has(f.id)) {
        fillStore.set(f.id, f); // onConflictDoNothing equivalent
      }
    }
    return ok(undefined);
  };

  const readUnprocessedFills: ForReadingUnprocessedFills = async (): Promise<
    Result<ReadonlyArray<RawFill>, StorageError>
  > => {
    // WR-A2: exclude processed (processed_at set) AND orphan-parked fills.
    const rows = [...fillStore.values()].filter(
      (f) => !processedIds.has(f.id) && !orphanIds.has(f.id),
    );
    return ok(rows);
  };

  const markFillsProcessed: ForMarkingFillsProcessed = async (
    fillIds: ReadonlyArray<string>,
  ): Promise<Result<void, StorageError>> => {
    for (const id of fillIds) processedIds.add(id); // idempotent; empty array = no-op
    return ok(undefined);
  };

  // WR-A2 rebuild support: clear processed_at for the calendar's leg fills so the scoped
  // re-pair re-reads them (mirrors readUnprocessedFillsForCalendar's leg matching). Round 5
  // (bug 1): ALSO reset any fill sharing an orderId with a leg-matched fill ("order
  // context") — otherwise an order-context fill already marked processed by a SIBLING
  // calendar's earlier rebuild (a shared-leg scenario) never gets reset, and permanently
  // vanishes from every subsequent scoped read (readUnprocessedFillsForCalendar excludes
  // processed fills regardless of which calendar's rebuild is asking).
  const resetFillsProcessedForCalendar: ForResettingFillsProcessedForCalendar = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    const cal = calendarStore.get(calendarId);
    if (cal === undefined) return ok(undefined);
    const { front, back } = calendarLegSymbols(cal);
    const legSet = new Set<string>([front, back]);
    const orderIds = new Set(
      [...fillStore.values()].filter((f) => legSet.has(f.occSymbol)).map((f) => f.orderId),
    );
    for (const f of fillStore.values()) {
      if (legSet.has(f.occSymbol) || orderIds.has(f.orderId)) processedIds.delete(f.id);
    }
    return ok(undefined);
  };

  // journal-pnl-opennetdebit-units round 5 (bug 1): also include order-context fills —
  // see the Postgres adapter's readUnprocessedFillsForCalendar doc comment for the full
  // rationale (a shared leg symbol needs the sibling calendar's unique leg from the SAME
  // order present in the batch for resolveFillMatches to disambiguate it).
  const readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar =
    async (
      calendarId: string,
    ): Promise<Result<ReadonlyArray<RawFill>, StorageError>> => {
      const cal = calendarStore.get(calendarId);
      if (cal === undefined) return ok([]);
      const { front, back } = calendarLegSymbols(cal);
      const legSet = new Set<string>([front, back]);
      const unprocessed = [...fillStore.values()].filter(
        (f) => !processedIds.has(f.id) && !orphanIds.has(f.id),
      );
      const ownMatches = unprocessed.filter((f) => legSet.has(f.occSymbol));
      const orderIds = new Set(ownMatches.map((f) => f.orderId));
      const contextFills = unprocessed.filter(
        (f) => orderIds.has(f.orderId) && !legSet.has(f.occSymbol),
      );
      return ok([...ownMatches, ...contextFills]);
    };

  const readCalendarLegs: ForReadingCalendarLegs = async (
    occSymbol: string,
  ): Promise<Result<ReadonlyArray<CalendarLegEntry>, StorageError>> => {
    const entries: CalendarLegEntry[] = [];
    for (const cal of calendarStore.values()) {
      const { front, back } = calendarLegSymbols(cal);
      if (front === occSymbol) {
        entries.push({ calendarId: cal.id, legOccSymbol: front });
      }
      if (back === occSymbol) {
        entries.push({ calendarId: cal.id, legOccSymbol: back });
      }
    }
    return ok(entries);
  };

  const resetCalendarAmounts: ForResettingCalendarAmounts = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    const cal = calendarStore.get(calendarId);
    if (cal !== undefined) {
      calendarStore.set(calendarId, { ...cal, openNetDebit: null, closeNetCredit: null });
    }
    return ok(undefined);
  };

  const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async (
    calendarId: string,
  ): Promise<Result<void, StorageError>> => {
    const cal = calendarStore.get(calendarId);
    if (cal === undefined) return ok(undefined);
    // WR-A1: sum by eventType (mirror the Postgres adapter exactly for twin parity).
    let openDebit = 0;
    let closeCredit = 0;
    for (const event of eventStore) {
      if (event.calendarId !== calendarId) continue;
      switch (event.eventType) {
        case "OPEN":
          openDebit += event.netAmount; // OPEN debit positive (D-08)
          break;
        case "CLOSE":
          closeCredit += -event.netAmount; // CLOSE credit negative (D-08) → abs
          break;
        case "ROLL":
          if (event.rollOpenDebit !== null && event.rollOpenDebit !== undefined) {
            openDebit += event.rollOpenDebit;
          }
          if (event.rollCloseCredit !== null && event.rollCloseCredit !== undefined) {
            closeCredit += event.rollCloseCredit;
          }
          break;
      }
    }
    calendarStore.set(calendarId, {
      ...cal,
      openNetDebit: openDebit,
      closeNetCredit: closeCredit,
    });
    return ok(undefined);
  };

  // ─── wipeDerivedFills (ForWipingDerivedFills) ───────────────────────────────
  // Account-wide delete of the 3 derived trade tables (fills/calendar_events/orphan_fills).
  // Mirrors the Postgres adapter's transactional 3-table DELETE — in-memory there is no
  // transaction to wrap, but the same "clear all three, touch nothing else" semantics apply.
  // Does NOT touch calendarStore (calendars) — matches the Postgres adapter exactly.
  const wipeDerivedFills: ForWipingDerivedFills = async (): Promise<
    Result<
      {
        readonly fillsDeleted: number;
        readonly eventsDeleted: number;
        readonly orphansDeleted: number;
      },
      StorageError
    >
  > => {
    const fillsDeleted = fillStore.size;
    const eventsDeleted = eventStore.length;
    const orphansDeleted = orphanIds.size;
    fillStore.clear();
    eventStore.length = 0;
    orphanIds.clear();
    processedIds.clear(); // processed_at lives on the fill row — gone with it in real Postgres
    return ok({ fillsDeleted, eventsDeleted, orphansDeleted });
  };

  // ─── readFillsByOccSymbols (ForReadingFillsByOccSymbols — JRNL-02) ──────────
  // ALL fills matching the given OCC symbols, regardless of processed/orphan status —
  // mirrors the Postgres adapter (no processed/orphan filtering here at all).
  const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async (
    occSymbols: ReadonlyArray<string>,
  ): Promise<Result<ReadonlyArray<RawFill>, StorageError>> => {
    const symbolSet = new Set(occSymbols);
    const rows = [...fillStore.values()].filter((f) => symbolSet.has(f.occSymbol));
    return ok(rows);
  };

  // ─── Test seed helpers ──────────────────────────────────────────────────────
  const seedCalendar = (cal: MemorySeedCalendar): void => {
    if (!calendarStore.has(cal.id)) {
      calendarStore.set(cal.id, { ...cal, closeNetCredit: null });
    }
  };
  const seedEvent = (event: MemorySeedEvent): void => {
    eventStore.push(event);
  };
  const seedOrphan = (orphan: MemorySeedOrphan): void => {
    orphanIds.add(orphan.fillId);
  };
  const readCalendarAmounts = (
    calendarId: string,
  ): { openNetDebit: number | null; closeNetCredit: number | null } => {
    const cal = calendarStore.get(calendarId);
    if (cal === undefined) return { openNetDebit: null, closeNetCredit: null };
    return { openNetDebit: cal.openNetDebit, closeNetCredit: cal.closeNetCredit };
  };
  const countFills = (): number => fillStore.size;
  const readProcessedFillIds = (): ReadonlyArray<string> => [...processedIds];
  const countEvents = (): number => eventStore.length;
  const countOrphans = (): number => orphanIds.size;

  return {
    readUnprocessedFills,
    readUnprocessedFillsForCalendar,
    readCalendarLegs,
    resetCalendarAmounts,
    recomputeCalendarAmounts,
    markFillsProcessed,
    resetFillsProcessedForCalendar,
    writeFills,
    wipeDerivedFills,
    readFillsByOccSymbols,
    seedCalendar,
    seedEvent,
    seedOrphan,
    readCalendarAmounts,
    countFills,
    readProcessedFillIds,
    countEvents,
    countOrphans,
  };
}

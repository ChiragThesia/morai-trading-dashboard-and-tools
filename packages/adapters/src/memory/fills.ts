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
  ForWritingFills,
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

export type MemorySeedEvent = {
  readonly calendarId: string;
  readonly netAmount: number;
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
  readonly writeFills: ForWritingFills;
  // ─── Test seed helpers (mirror the Postgres contract harness) ──────────────
  readonly seedCalendar: (cal: MemorySeedCalendar) => void;
  readonly seedEvent: (event: MemorySeedEvent) => void;
  readonly seedOrphan: (orphan: MemorySeedOrphan) => void;
  readonly readCalendarAmounts: (
    calendarId: string,
  ) => { openNetDebit: number | null; closeNetCredit: number | null };
  readonly countFills: () => number;
};

function statusToPositionEffect(
  status: string,
): "OPENING" | "CLOSING" | "UNKNOWN" {
  if (status === "open") return "OPENING";
  if (status === "closed") return "CLOSING";
  return "UNKNOWN";
}

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
    const rows = [...fillStore.values()].filter((f) => !orphanIds.has(f.id));
    return ok(rows);
  };

  const readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar =
    async (
      calendarId: string,
    ): Promise<Result<ReadonlyArray<RawFill>, StorageError>> => {
      const cal = calendarStore.get(calendarId);
      if (cal === undefined) return ok([]);
      const { front, back } = calendarLegSymbols(cal);
      const legSet = new Set<string>([front, back]);
      const rows = [...fillStore.values()].filter(
        (f) => !orphanIds.has(f.id) && legSet.has(f.occSymbol),
      );
      return ok(rows);
    };

  const readCalendarLegs: ForReadingCalendarLegs = async (
    occSymbol: string,
  ): Promise<Result<ReadonlyArray<CalendarLegEntry>, StorageError>> => {
    const entries: CalendarLegEntry[] = [];
    for (const cal of calendarStore.values()) {
      const { front, back } = calendarLegSymbols(cal);
      const positionEffect = statusToPositionEffect(cal.status);
      if (front === occSymbol) {
        entries.push({ calendarId: cal.id, legOccSymbol: front, positionEffect });
      }
      if (back === occSymbol) {
        entries.push({ calendarId: cal.id, legOccSymbol: back, positionEffect });
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
    let openDebit = 0;
    let closeCredit = 0;
    for (const event of eventStore) {
      if (event.calendarId !== calendarId) continue;
      if (event.netAmount >= 0) {
        openDebit += event.netAmount;
      } else {
        closeCredit += -event.netAmount;
      }
    }
    calendarStore.set(calendarId, {
      ...cal,
      openNetDebit: openDebit,
      closeNetCredit: closeCredit,
    });
    return ok(undefined);
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

  return {
    readUnprocessedFills,
    readUnprocessedFillsForCalendar,
    readCalendarLegs,
    resetCalendarAmounts,
    recomputeCalendarAmounts,
    writeFills,
    seedCalendar,
    seedEvent,
    seedOrphan,
    readCalendarAmounts,
    countFills,
  };
}

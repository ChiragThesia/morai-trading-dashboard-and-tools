/**
 * replayExitsForCalendar.test.ts (Phase 27, Plan 05, Task 2) — the BT-03 13-trade
 * walk-forward vs the fills-ledger oracle.
 *
 * Core cannot import @morai/adapters or testcontainers (architecture-boundaries §2) --
 * mirrors replayPickerCohort.test.ts's in-memory-fake precedent.
 *
 * Covers:
 *   - A TAKE-triggering trajectory reproduces the real fills-ledger's direction (fallback
 *     pricing: real openNetDebit on entry, raw netMark on exit -- no as-of-T chain seeded).
 *   - A STOP-triggering trajectory reproduces the opposite direction.
 *   - A gap row (spot=0) mixed into the history is never selected as the exit trigger.
 *   - The as-of-T haircut-fill pricing path is used when chain quotes ARE available at both
 *     entry and exit times (exact value assertion against the haircutFill formula).
 *   - Empty history -> a degenerate false/0 TradeReproduction, no crash.
 *   - StorageError propagation from both reads.
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type { Calendar, CalendarEvent, ForReadingCalendarEvents } from "@morai/core";
import { replayExitsForCalendar } from "./replayExitsForCalendar.ts";
import type {
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingFullSnapshotHistoryForCalendar,
  FullHistorySnapshotRow,
  StorageError,
} from "../application/ports.ts";

const CALENDAR: Calendar = {
  id: "cal-1",
  underlying: "SPX",
  strike: 7500000,
  optionType: "P",
  frontExpiry: "2026-07-31",
  backExpiry: "2026-08-28",
  qty: 1,
  openNetDebit: 1.2,
  status: "closed",
  openedAt: new Date("2026-07-01T14:30:00.000Z"),
  closedAt: new Date("2026-07-10T14:30:00.000Z"),
  notes: null,
};

function row(overrides: Partial<FullHistorySnapshotRow>): FullHistorySnapshotRow {
  return {
    calendarId: CALENDAR.id,
    time: new Date("2026-07-01T14:30:00.000Z"),
    netMark: 1.2,
    frontIv: 0.15,
    backIv: 0.16,
    dteFront: 30,
    dteBack: 58,
    spot: 7500,
    source: "cboe",
    ...overrides,
  };
}

function fakeEvents(events: ReadonlyArray<CalendarEvent>): ForReadingCalendarEvents {
  return async () => ok(events);
}
function fakeHistory(rows: ReadonlyArray<FullHistorySnapshotRow>): ForReadingFullSnapshotHistoryForCalendar {
  return async () => ok(rows);
}
function fakeChain(chain: ReadonlyArray<ChainLegQuoteAsOf> = []): ForReadingChainAsOf {
  return async () => ok(chain);
}

function closeEvent(realizedPnl: number): CalendarEvent {
  return {
    id: "evt-1",
    calendarId: CALENDAR.id,
    eventType: "CLOSE",
    eventedAt: new Date("2026-07-10T14:30:00.000Z"),
    fillIdsHash: "a".repeat(64),
    legOccSymbol: "TEST",
    rolledFromOccSymbol: null,
    qty: 1,
    avgPrice: 1.5,
    netAmount: -150,
    realizedPnl,
    legBreakdown: null,
    entryThesis: null,
    rollOpenDebit: null,
    rollCloseCredit: null,
  };
}

describe("replayExitsForCalendar", () => {
  it("TAKE trajectory reproduces the oracle's positive direction (fallback pricing)", async () => {
    const rows = [
      row({ time: new Date("2026-07-01T14:30:00.000Z"), netMark: 1.2 }),
      row({ time: new Date("2026-07-03T14:30:00.000Z"), netMark: 1.25 }),
      // +15% rung: (1.45 - 1.20) / 1.20 = 0.2083 >= 0.15 -> TAKE
      row({ time: new Date("2026-07-10T14:30:00.000Z"), netMark: 1.45 }),
    ];
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory(rows),
      readCalendarEvents: fakeEvents([closeEvent(30)]),
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.oraclePnl).toBe(30);
    expect(result.value.modeledPnl).toBeCloseTo((1.45 - 1.2) * 100, 6);
    expect(result.value.directionMatch).toBe(true);
    // modeled +25 vs oracle +30 -> ratio 1.2, within the 3x band -> reproduced (WR-02).
    expect(result.value.magnitudeMatch).toBe(true);
    expect(result.value.reproduction).toBe("reproduced");
  });

  it("flags direction-only when the magnitude is outside the 3x tolerance band (WR-02)", async () => {
    const rows = [
      row({ time: new Date("2026-07-01T14:30:00.000Z"), netMark: 1.2 }),
      row({ time: new Date("2026-07-10T14:30:00.000Z"), netMark: 1.45 }), // modeled +25
    ];
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory(rows),
      readCalendarEvents: fakeEvents([closeEvent(1)]), // oracle +1, same sign, |25/1| >> 3
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.directionMatch).toBe(true);
    expect(result.value.magnitudeMatch).toBe(false);
    expect(result.value.reproduction).toBe("direction-only");
  });

  it("flags diverged when direction disagrees (WR-02)", async () => {
    const rows = [
      row({ time: new Date("2026-07-01T14:30:00.000Z"), netMark: 1.2 }),
      row({ time: new Date("2026-07-05T14:30:00.000Z"), netMark: 0.8 }), // modeled negative
    ];
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory(rows),
      readCalendarEvents: fakeEvents([closeEvent(30)]), // oracle positive -> sign mismatch
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.directionMatch).toBe(false);
    expect(result.value.reproduction).toBe("diverged");
  });

  it("STOP trajectory reproduces the oracle's negative direction", async () => {
    const rows = [
      row({ time: new Date("2026-07-01T14:30:00.000Z"), netMark: 1.2 }),
      // -25% rung: (0.80 - 1.20) / 1.20 = -0.333 <= -0.25 -> STOP
      row({ time: new Date("2026-07-05T14:30:00.000Z"), netMark: 0.8 }),
    ];
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory(rows),
      readCalendarEvents: fakeEvents([closeEvent(-35)]),
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.modeledPnl).toBeLessThan(0);
    expect(result.value.directionMatch).toBe(true);
  });

  it("a gap row (spot=0) is never selected as the exit trigger, and the FIRST actionable row wins over later rows", async () => {
    const rows = [
      row({ time: new Date("2026-07-01T14:30:00.000Z"), netMark: 1.2 }),
      // Gap row: absurd netMark that WOULD fire TAKE if not gated by spot=0 -> must be skipped.
      row({ time: new Date("2026-07-02T14:30:00.000Z"), netMark: 99, spot: 0 }),
      // Real TAKE trigger -- the correct (FIRST actionable) exit point.
      row({ time: new Date("2026-07-08T14:30:00.000Z"), netMark: 1.45 }),
      // A later row with a DIFFERENT value -- proves the walk stops at the first actionable
      // row rather than falling through to the last row in the array.
      row({ time: new Date("2026-07-10T14:30:00.000Z"), netMark: 1.3 }),
    ];
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory(rows),
      readCalendarEvents: fakeEvents([closeEvent(30)]),
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // If the gap row had been picked, modeledPnl would reflect netMark=99; if the walk fell
    // through to the last row instead of stopping at the first actionable one, it would
    // reflect netMark=1.30. Both would diverge from the correct netMark=1.45.
    expect(result.value.modeledPnl).toBeCloseTo((1.45 - 1.2) * 100, 6);
  });

  it("prices entry AND exit via the shared haircutFill when as-of-T chain quotes are available", async () => {
    const entryChain: ChainLegQuoteAsOf[] = [
      {
        occSymbol: "FRONT-ENTRY",
        strike: CALENDAR.strike,
        expiration: CALENDAR.frontExpiry,
        contractType: "P",
        bid: 0.9,
        ask: 1.0,
        mark: 0.95,
        bsmIv: 0.15,
        bsmDelta: null,
        bsmGamma: null,
        bsmTheta: null,
        bsmVega: null,
        openInterest: 500,
        underlyingPrice: 7500,
        source: "cboe",
        time: CALENDAR.openedAt,
      },
      {
        occSymbol: "BACK-ENTRY",
        strike: CALENDAR.strike,
        expiration: CALENDAR.backExpiry,
        contractType: "P",
        bid: 2.0,
        ask: 2.1,
        mark: 2.05,
        bsmIv: 0.16,
        bsmDelta: null,
        bsmGamma: null,
        bsmTheta: null,
        bsmVega: null,
        openInterest: 500,
        underlyingPrice: 7500,
        source: "cboe",
        time: CALENDAR.openedAt,
      },
    ];
    const exitTime = new Date("2026-07-10T14:30:00.000Z");
    const exitChain: ChainLegQuoteAsOf[] = entryChain.map((leg) => ({ ...leg, time: exitTime, bid: leg.bid + 0.2, ask: leg.ask + 0.2 }));

    const rows = [
      row({ time: CALENDAR.openedAt, netMark: 1.2 }),
      row({ time: exitTime, netMark: 1.45 }), // still triggers TAKE for exit-point selection
    ];

    const readChainAsOf: ForReadingChainAsOf = async (asOfT: Date) => {
      if (asOfT.getTime() === CALENDAR.openedAt.getTime()) return ok(entryChain);
      return ok(exitChain);
    };

    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory(rows),
      readCalendarEvents: fakeEvents([closeEvent(1)]),
      readChainAsOf,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Manual haircutFill computation (FILL_WIDTH_FRACTION = 0.66):
    // entry: buy back (2.00 + 0.10*0.66=2.066) - sell front (1.00 - 0.10*0.66=0.934) = 1.132
    // exit:  sell back (2.30 - 0.10*0.66=2.234) - buy front (1.10 + 0.10*0.66=1.166) = 1.068
    const expectedModeledPnl = (1.068 - 1.132) * 100;
    expect(result.value.modeledPnl).toBeCloseTo(expectedModeledPnl, 2);
  });

  it("empty history degrades to a false/0 TradeReproduction, no crash", async () => {
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory([]),
      readCalendarEvents: fakeEvents([]),
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      calendarId: CALENDAR.id,
      directionMatch: false,
      magnitudeMatch: false,
      reproduction: "diverged",
      modeledPnl: 0,
      oraclePnl: 0,
    });
  });

  it("propagates a StorageError from readCalendarEvents", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "events read failed" };
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: fakeHistory([]),
      readCalendarEvents: async () => ({ ok: false, error: storageError }),
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("events read failed");
  });

  it("propagates a StorageError from readFullSnapshotHistoryForCalendar", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "history read failed" };
    const result = await replayExitsForCalendar(CALENDAR, {
      readFullSnapshotHistoryForCalendar: async () => ({ ok: false, error: storageError }),
      readCalendarEvents: fakeEvents([]),
      readChainAsOf: fakeChain(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("history read failed");
  });
});

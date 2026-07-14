/**
 * registerOpenCalendars.test.ts — RED→GREEN oracle test (JRNL-02).
 *
 * Feeds the 5 real currently-open Schwab calendar positions (avgPrices from the live
 * position book) through registerOpenCalendars and asserts:
 *   - exactly 5 calendars registered, each with the oracle openNetDebit (back − front, points)
 *   - correct front/back expiries, incl. the SPX/SPXW mixed-root case (7200P/7600P)
 *   - a second run is idempotent (all 5 skipped as already-existing)
 *   - unrelated already-registered (closed) calendars are never touched or re-counted
 *   - openedAt sources from the earliest matching fill when present; falls back to now() when absent
 */
import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { Calendar, RawFill, StorageError, ForListingCalendars, ForReadingFillsByOccSymbols } from "./ports.ts";
import { makeRegisterCalendarUseCase } from "./registerCalendar.ts";
import { makeRegisterOpenCalendarsUseCase } from "./registerOpenCalendars.ts";
import type { PositionLeg, ForFetchingOpenPositionLegs } from "./registerOpenCalendars.ts";
import type { ForRunningRebuildCalendarHistory } from "./rebuildCalendarHistory.ts";

// Backfill test stub — never called unless a test overrides it (existing tests above don't
// exercise the backfill path, only the new HIST-04 on-register-backfill tests below do).
const noopRebuildCalendarHistory: ForRunningRebuildCalendarHistory = async () =>
  ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0 });

// ─── The 5 real open positions (register-open-calendars oracle) ────────────────
function leg(overrides: Partial<PositionLeg> & { occSymbol: string }): PositionLeg {
  return {
    underlyingSymbol: "$SPX",
    longQty: 0,
    shortQty: 0,
    averagePrice: null,
    ...overrides,
  };
}

const OPEN_POSITIONS: PositionLeg[] = [
  // 7400P: 43.3744 = 138.7022 − 95.3278
  leg({ occSymbol: "SPX   260804P07400000", shortQty: 1, averagePrice: 95.3278 }),
  leg({ occSymbol: "SPX   260831P07400000", longQty: 1, averagePrice: 138.7022 }),
  // 7650C: 3.2244 = 41.7722 − 38.5478
  leg({ occSymbol: "SPX   260731C07650000", shortQty: 1, averagePrice: 38.5478 }),
  leg({ occSymbol: "SPX   260803C07650000", longQty: 1, averagePrice: 41.7722 }),
  // 7350P: 3.1244 = 74.5122 − 71.3878
  leg({ occSymbol: "SPX   260731P07350000", shortQty: 1, averagePrice: 71.3878 }),
  leg({ occSymbol: "SPX   260803P07350000", longQty: 1, averagePrice: 74.5122 }),
  // 7200P: 7.2251 = 211.3222 − 204.0971 (mixed root: front SPX, back SPXW)
  leg({ occSymbol: "SPX   261120P07200000", shortQty: 1, averagePrice: 204.0971 }),
  leg({ occSymbol: "SPXW  261130P07200000", longQty: 1, averagePrice: 211.3222 }),
  // 7600P: 6.3751 = 341.4222 − 335.0471 (mixed root: front SPX, back SPXW)
  leg({ occSymbol: "SPX   261120P07600000", shortQty: 1, averagePrice: 335.0471 }),
  leg({ occSymbol: "SPXW  261130P07600000", longQty: 1, averagePrice: 341.4222 }),
];

function fetchOpenPositions(): ForFetchingOpenPositionLegs {
  return async () => ok(OPEN_POSITIONS);
}

function makeFill(occSymbol: string, filledAt: string, id = "fill-1"): RawFill {
  return {
    id,
    orderId: "ORD-1",
    occSymbol,
    side: "buy",
    qty: 1,
    price: 1,
    filledAt: new Date(filledAt),
    commission: null,
    fees: null,
    positionEffect: "OPENING",
  };
}

const NOW = new Date("2026-08-15T14:00:00Z");

describe("makeRegisterOpenCalendarsUseCase", () => {
  it("registers exactly 5 calendars with the oracle openNetDebit + expiries (incl. SPX/SPXW mixed root)", async () => {
    const calendarStore: Calendar[] = [];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });

    const listCalendars: ForListingCalendars = async () => ok(calendarStore);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.registered).toHaveLength(5);
    expect(result.value.skippedExisting).toHaveLength(0);

    const byStrike = new Map(result.value.registered.map((r) => [r.strike, r]));

    const c7400 = byStrike.get(7400000);
    expect(c7400?.optionType).toBe("P");
    expect(c7400?.frontExpiry).toBe("2026-08-04");
    expect(c7400?.backExpiry).toBe("2026-08-31");
    expect(c7400?.openNetDebit).toBeCloseTo(43.3744, 2);

    const c7650 = byStrike.get(7650000);
    expect(c7650?.optionType).toBe("C");
    expect(c7650?.openNetDebit).toBeCloseTo(3.2244, 2);

    const c7350 = byStrike.get(7350000);
    expect(c7350?.openNetDebit).toBeCloseTo(3.1244, 2);

    const c7200 = byStrike.get(7200000);
    expect(c7200?.frontExpiry).toBe("2026-11-20");
    expect(c7200?.backExpiry).toBe("2026-11-30");
    expect(c7200?.openNetDebit).toBeCloseTo(7.2251, 2);
    expect(c7200?.underlying).toBe("SPX"); // front leg's root — mixed-root limitation, see handback

    const c7600 = byStrike.get(7600000);
    expect(c7600?.openNetDebit).toBeCloseTo(6.3751, 2);
    expect(c7600?.underlying).toBe("SPX");

    // openedAt falls back to now() when no fill matches (documented, never fabricated otherwise).
    for (const r of result.value.registered) {
      expect(r.openedAtSource).toBe("fallback-now");
      expect(r.openedAt).toEqual(NOW);
    }
  });

  it("is idempotent — a second run against the same open book skips all 5 as already-existing", async () => {
    const calendarStore: Calendar[] = [];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(calendarStore);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const first = await use();
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.registered).toHaveLength(5);

    const second = await use();
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.registered).toHaveLength(0);
    expect(second.value.skippedExisting).toHaveLength(5);
  });

  it("dedup never touches or re-registers unrelated already-registered (closed) calendars", async () => {
    const existingClosed: Calendar[] = Array.from({ length: 3 }, (_, i) => ({
      id: `closed-${i}`,
      underlying: "SPX",
      strike: 6900000 + i * 1000,
      optionType: "C" as const,
      frontExpiry: "2026-01-16",
      backExpiry: "2026-02-20",
      qty: 1,
      openNetDebit: 5,
      status: "closed" as const,
      openedAt: new Date("2026-01-01T14:00:00Z"),
      closedAt: new Date("2026-02-01T14:00:00Z"),
      notes: null,
    }));

    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(existingClosed);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registered).toHaveLength(5);
    expect(result.value.skippedExisting).toHaveLength(0);
  });

  it("re-registers a candidate whose (underlying,strike,optionType,frontExpiry,backExpiry) matches an existing CLOSED calendar — a closed row is history, not a live dedup match (a re-opened trade must still appear)", async () => {
    // 7650C candidate: front 2026-07-31 / back 2026-08-03. Seed an existing CLOSED calendar
    // with the EXACT same key — simulates the user having traded and closed this exact
    // strike/expiry pair before, then genuinely re-opening it (both legs still unexpired).
    const existingClosed: Calendar = {
      id: "closed-reopened",
      underlying: "SPX",
      strike: 7650000,
      optionType: "C",
      frontExpiry: "2026-07-31",
      backExpiry: "2026-08-03",
      qty: 1,
      openNetDebit: 2,
      status: "closed",
      openedAt: new Date("2026-06-01T14:00:00Z"),
      closedAt: new Date("2026-07-10T14:00:00Z"),
      notes: null,
    };
    const calendarStore: Calendar[] = [existingClosed];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(calendarStore);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All 5 register — the closed row with the matching key does NOT block re-registration.
    expect(result.value.registered).toHaveLength(5);
    expect(result.value.skippedExisting).toHaveLength(0);
    expect(result.value.registered.some((r) => r.strike === 7650000)).toBe(true);
  });

  it("sources openedAt from the earliest OPENING fill, ignoring an earlier CLOSING fill on the same symbols (a shared/reused leg's stale close must not leak in)", async () => {
    const calendarStore: Calendar[] = [];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(calendarStore);

    // An earlier, unrelated trade's CLOSE fill on the same front-leg symbol (e.g. the symbol
    // was reused by a prior now-closed calendar) — dated BEFORE the real OPENING fill for
    // this new position. Must not win as "earliest".
    const staleClose = new Date("2026-01-01T14:00:00Z");
    const realOpen = new Date("2026-07-01T14:30:00Z");
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async (occSymbols) => {
      if (occSymbols.includes("SPX   260804P07400000")) {
        return ok([
          {
            id: "stale-close",
            orderId: "ORD-OLD",
            occSymbol: "SPX   260804P07400000",
            side: "sell",
            qty: 1,
            price: 1,
            filledAt: staleClose,
            commission: null,
            fees: null,
            positionEffect: "CLOSING",
          },
          {
            id: "real-open",
            orderId: "ORD-NEW",
            occSymbol: "SPX   260804P07400000",
            side: "sell",
            qty: 1,
            price: 95.3278,
            filledAt: realOpen,
            commission: null,
            fees: null,
            positionEffect: "OPENING",
          },
        ]);
      }
      return ok([]);
    };

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c7400 = result.value.registered.find((r) => r.strike === 7400000);
    expect(c7400?.openedAt).toEqual(realOpen);
    expect(c7400?.openedAtSource).toBe("fill");
  });

  it("sources openedAt from the earliest matching fill when present", async () => {
    const calendarStore: Calendar[] = [];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(calendarStore);

    const earliestFront = new Date("2026-07-01T14:30:00Z");
    const laterBack = new Date("2026-07-02T14:30:00Z");
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async (occSymbols) => {
      if (
        occSymbols.includes("SPX   260804P07400000") ||
        occSymbols.includes("SPX   260831P07400000")
      ) {
        return ok([
          makeFill("SPX   260804P07400000", earliestFront.toISOString(), "f1"),
          makeFill("SPX   260831P07400000", laterBack.toISOString(), "f2"),
        ]);
      }
      return ok([]);
    };

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const c7400 = result.value.registered.find((r) => r.strike === 7400000);
    expect(c7400?.openedAt).toEqual(earliestFront);
    expect(c7400?.openedAtSource).toBe("fill");

    // Every other calendar had no matching fill → falls back to now().
    const others = result.value.registered.filter((r) => r.strike !== 7400000);
    for (const o of others) {
      expect(o.openedAtSource).toBe("fallback-now");
    }
  });

  it("propagates a fetchOpenPositions error", async () => {
    const fetchOpenPositionsErr: ForFetchingOpenPositionLegs = async () =>
      err({ kind: "fetch-error", message: "boom" });
    const listCalendars: ForListingCalendars = async () => ok([]);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: vi.fn(),
      now: () => NOW,
    });

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositionsErr,
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("fetch-error");
  });

  it("propagates a listCalendars storage error", async () => {
    const storageErr: StorageError = { kind: "storage-error", message: "db down" };
    const listCalendars: ForListingCalendars = async () => err(storageErr);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: vi.fn(),
      now: () => NOW,
    });

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: fetchOpenPositions(),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory: noopRebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("storage-error");
  });

  // ─── HIST-04: on-register backfill (40-07) ────────────────────────────────────
  function singleLegPair(): PositionLeg[] {
    return [
      leg({ occSymbol: "SPX   260804P07400000", shortQty: 1, averagePrice: 95.3278 }),
      leg({ occSymbol: "SPX   260831P07400000", longQty: 1, averagePrice: 138.7022 }),
    ];
  }

  it("a newly-registered calendar triggers a backfill rebuild over [openedAt, now], recording rowsHealed as backfilledSlots", async () => {
    const calendarStore: Calendar[] = [];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(calendarStore);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);
    const rebuildCalls: Array<{ calendar: Calendar; window: { from: Date; to: Date } }> = [];
    const rebuildCalendarHistory: ForRunningRebuildCalendarHistory = async (calendar, window) => {
      rebuildCalls.push({ calendar, window });
      return ok({ slotsConsidered: 4, rowsHealed: 3, honestGapSlots: 1 });
    };

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: async () => ok(singleLegPair()),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registered).toHaveLength(1);
    expect(rebuildCalls).toHaveLength(1);
    expect(rebuildCalls[0]?.calendar.id).toBe(result.value.registered[0]?.calendarId);
    // openedAt falls back to now() (no fills seeded) — so the backfill window is [now, now].
    expect(rebuildCalls[0]?.window).toEqual({ from: NOW, to: NOW });
    expect(result.value.registered[0]?.backfilledSlots).toBe(3);
  });

  it("a rebuild StorageError does not fail the registration — the summary records backfilledSlots: null", async () => {
    const calendarStore: Calendar[] = [];
    let nextId = 1;
    const registerCalendarUseCase = makeRegisterCalendarUseCase({
      persistCalendar: async (input) => {
        const row: Calendar = {
          id: `cal-${nextId++}`,
          underlying: input.underlying,
          strike: input.strike,
          optionType: input.optionType,
          frontExpiry: input.frontExpiry,
          backExpiry: input.backExpiry,
          qty: input.qty,
          openNetDebit: input.openNetDebit,
          status: "open",
          openedAt: input.openedAt,
          closedAt: null,
          notes: input.notes ?? null,
        };
        calendarStore.push(row);
        return ok(row);
      },
      now: () => NOW,
    });
    const listCalendars: ForListingCalendars = async () => ok(calendarStore);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);
    const rebuildCalendarHistory: ForRunningRebuildCalendarHistory = async () =>
      err({ kind: "storage-error", message: "rebuild failed" });

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: async () => ok(singleLegPair()),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registered).toHaveLength(1);
    expect(result.value.registered[0]?.backfilledSlots).toBeNull();
  });

  it("a skipped-existing calendar is never backfilled", async () => {
    const existing: Calendar = {
      id: "cal-existing",
      underlying: "SPX",
      strike: 7400000,
      optionType: "P",
      frontExpiry: "2026-08-04",
      backExpiry: "2026-08-31",
      qty: 1,
      openNetDebit: 43.3744,
      status: "open",
      openedAt: new Date("2026-07-01T14:00:00Z"),
      closedAt: null,
      notes: null,
    };
    const listCalendars: ForListingCalendars = async () => ok([existing]);
    const readFillsByOccSymbols: ForReadingFillsByOccSymbols = async () => ok([]);
    const registerCalendarUseCase = makeRegisterCalendarUseCase({ persistCalendar: vi.fn(), now: () => NOW });
    const rebuildCalendarHistory = vi.fn();

    const use = makeRegisterOpenCalendarsUseCase({
      fetchOpenPositions: async () => ok(singleLegPair()),
      listCalendars,
      readFillsByOccSymbols,
      registerCalendar: registerCalendarUseCase,
      rebuildCalendarHistory,
      now: () => NOW,
    });

    const result = await use();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.registered).toHaveLength(0);
    expect(result.value.skippedExisting).toHaveLength(1);
    expect(rebuildCalendarHistory).not.toHaveBeenCalled();
  });
});

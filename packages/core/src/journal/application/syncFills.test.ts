/**
 * syncFills use-case tests — extended RED suite (plan 05-07).
 *
 * Covers (JRNL-01 / SC4):
 *   - Matched OPENING fill → one OPEN calendar_event
 *   - Unmatched fill → parks in orphan_fills (D-05)
 *   - Re-running against same fill set → storeCalendarEvent called again (DB handles dedup)
 *   - ROLL detection: close+open same orderId, different legOccSymbol → ONE ROLL event (D-03)
 *   - Ambiguous fill (matches TWO calendars) → orphan with reason "ambiguous calendar" (Pitfall 6)
 *   - Partial fills: two fills same (calendarId, legOccSymbol, orderId) → one aggregated event
 *   - CLOSE P&L: realized_pnl populated; legBreakdown populated (D-09 hard requirement)
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type {
  ForStoringCalendarEvent,
  ForReadingUnprocessedFills,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  ForReadingCalendarEvents,
  ForReadingUnprocessedFillsForCalendar,
  ForMarkingFillsProcessed,
  OrphanFillInput,
} from "./ports.ts";
import type { RawFill, CalendarEvent } from "../domain/calendar-event.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// 21-char Schwab-format OCC symbols (parseable by parseSchwabSymbol)
const OCC_FRONT = "SPX   260620P07100000";
const OCC_BACK  = "SPX   260919P07100000";

function makeFill(overrides: Partial<RawFill> = {}): RawFill {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    orderId: "order-001",
    occSymbol: OCC_FRONT,
    side: "buy",
    qty: 1,
    price: 15.5,
    filledAt: new Date("2026-06-15T14:00:00Z"),
    commission: 0.65,
    fees: 0.12,
    ...overrides,
  };
}

// Full orphan record captured by the storeOrphanFill twin (B5 asserts real fields).
type OrphanCapture = OrphanFillInput;

// Deterministic injected ports (C1): the adapter supplies the real sha256/uuid in 05-13.
let idCounter = 0;
const seqId = (): string =>
  `00000000-0000-4000-8000-${String(idCounter++).padStart(12, "0")}`;
const fakeHashFillIds = (ids: ReadonlyArray<string>): string =>
  `hash(${[...ids].sort().join(":")})`;

function buildDeps(opts: {
  fills: RawFill[];
  legMap: Record<
    string,
    Array<{
      calendarId: string;
      legOccSymbol: string;
      positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
    }>
  >;
  storedEvents: CalendarEvent[];
  storedOrphans: OrphanCapture[];
  // Prior OPEN events seeded per calendarId (B1: originalOpenDebit lookup source)
  priorEvents?: Record<string, CalendarEvent[]>;
  // WR-A2: capture fill ids passed to markFillsProcessed (paired + orphaned).
  markedFillIds?: string[];
}) {
  const readUnprocessedFills: ForReadingUnprocessedFills = async () => ok(opts.fills);
  const readCalendarLegs: ForReadingCalendarLegs = async (occSymbol) =>
    ok(opts.legMap[occSymbol] ?? []);
  const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
    opts.storedEvents.push(event);
    return ok(undefined);
  };
  const storeOrphanFill: ForStoringOrphanFill = async (orphan) => {
    opts.storedOrphans.push(orphan);
    return ok(undefined);
  };
  const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
  const readCalendarEvents: ForReadingCalendarEvents = async (calendarId) =>
    ok(opts.priorEvents?.[calendarId] ?? []);
  const markFillsProcessed: ForMarkingFillsProcessed = async (fillIds) => {
    if (opts.markedFillIds !== undefined) opts.markedFillIds.push(...fillIds);
    return ok(undefined);
  };
  idCounter = 0;
  return {
    readUnprocessedFills,
    readCalendarLegs,
    storeCalendarEvent,
    storeOrphanFill,
    resetCalendarAmounts,
    readCalendarEvents,
    markFillsProcessed,
    newId: seqId,
    hashFillIds: fakeHashFillIds,
    now: () => new Date("2026-06-15T14:00:00Z"),
  };
}

// Build a prior OPEN calendar_event for a leg with a given debit (netAmount positive).
function makeOpenEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "open-evt-1",
    calendarId: "cal-1",
    eventType: "OPEN",
    eventedAt: new Date("2026-06-01T14:00:00Z"),
    fillIdsHash: "hash-open-1",
    legOccSymbol: OCC_FRONT,
    rolledFromOccSymbol: null,
    qty: 1,
    avgPrice: 15.0,
    netAmount: 300, // originalOpenDebit
    realizedPnl: null,
    legBreakdown: null,
    entryThesis: null,
    rollOpenDebit: null,
    rollCloseCredit: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeSyncFillsUseCase", () => {
  it("matched fill against a calendar leg → stores one calendar event (OPEN)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];
    const fill = makeFill({ id: "fill-open-1", side: "buy" });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]?.eventType).toBe("OPEN");
    expect(storedEvents[0]?.calendarId).toBe("cal-1");
    expect(storedEvents[0]?.legOccSymbol).toBeDefined();
    // OPEN debit = positive (D-08)
    expect(storedEvents[0]?.netAmount).toBeGreaterThanOrEqual(0);
  });

  it("fill matching no calendar leg → parks in orphan_fills (D-05)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];
    const fill = makeFill({ id: "fill-orphan-1" });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({ fills: [fill], legMap: {}, storedEvents, storedOrphans }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(0);
    expect(storedOrphans).toHaveLength(1);
    expect(storedOrphans[0]?.fillId).toBe("fill-orphan-1");
    expect(storedOrphans[0]?.reason).toBeTruthy();
  });

  it("re-run against same fills → storeCalendarEvent called again but idempotent (no-op on duplicate hash)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    let storeCallCount = 0;
    const fill = makeFill({ id: "fill-idem-1" });

    const readUnprocessedFills: ForReadingUnprocessedFills = async () => ok([fill]);
    const readCalendarLegs: ForReadingCalendarLegs = async () =>
      ok([
        {
          calendarId: "cal-1",
          legOccSymbol: OCC_FRONT,
          positionEffect: "OPENING" as const,
        },
      ]);
    const storeCalendarEvent: ForStoringCalendarEvent = async (_event) => {
      storeCallCount++;
      return ok(undefined); // onConflictDoNothing = always ok, no error on dup
    };
    const storeOrphanFill: ForStoringOrphanFill = async () => ok(undefined);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);

    const readCalendarEvents: ForReadingCalendarEvents = async () => ok([]);
    const markFillsProcessed: ForMarkingFillsProcessed = async () => ok(undefined);

    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills,
      readCalendarLegs,
      storeCalendarEvent,
      storeOrphanFill,
      resetCalendarAmounts,
      readCalendarEvents,
      markFillsProcessed,
      newId: seqId,
      hashFillIds: fakeHashFillIds,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await syncFills();
    await syncFills(); // second run — store called again but DB ignores duplicate hash
    expect(storeCallCount).toBe(2); // called both times; DB deduplication handles uniqueness
  });

  it("ROLL: close front + open back same orderId → ONE ROLL event, not CLOSE+OPEN (D-03)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    // Two fills: close the front leg, open the back leg — same orderId = ROLL
    const fillClose = makeFill({
      id: "fill-roll-close",
      occSymbol: OCC_FRONT,
      side: "sell",
      orderId: "roll-order-1",
      price: 8.0,
    });
    const fillOpen = makeFill({
      id: "fill-roll-open",
      occSymbol: OCC_BACK,
      side: "buy",
      orderId: "roll-order-1",
      price: 20.0,
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fillClose, fillOpen],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "CLOSING" },
          ],
          [OCC_BACK]: [
            { calendarId: "cal-1", legOccSymbol: OCC_BACK, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    // ONE ROLL event, NOT two separate CLOSE+OPEN rows (D-03)
    expect(storedEvents).toHaveLength(1);
    const rollEvent = storedEvents[0];
    expect(rollEvent?.eventType).toBe("ROLL");
    // rolledFromOccSymbol = OLD leg (front leg being closed)
    expect(rollEvent?.rolledFromOccSymbol).toBeDefined();
    expect(rollEvent?.rolledFromOccSymbol).not.toBeNull();
    // legOccSymbol = NEW leg (back leg being opened)
    expect(rollEvent?.legOccSymbol).toBeDefined();
  });

  it("ambiguous fill (matches TWO calendars) → orphan with reason containing 'ambiguous' (Pitfall 6)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];
    const fill = makeFill({ id: "fill-ambiguous-1", occSymbol: OCC_FRONT });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-A", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
            { calendarId: "cal-B", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(0);
    expect(storedOrphans).toHaveLength(1);
    expect(storedOrphans[0]?.fillId).toBe("fill-ambiguous-1");
    expect(storedOrphans[0]?.reason).toContain("ambiguous");
  });

  it("partial fills: two fills same (calendarId, legOccSymbol, orderId) → one aggregated OPEN event (D-04)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    const fill1 = makeFill({ id: "fill-partial-1", orderId: "order-partial", qty: 2, price: 14.0 });
    const fill2 = makeFill({ id: "fill-partial-2", orderId: "order-partial", qty: 3, price: 16.0 });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill1, fill2],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    // Must aggregate into ONE event (not two)
    expect(storedEvents).toHaveLength(1);
    const event = storedEvents[0];
    expect(event?.eventType).toBe("OPEN");
    // qty-weighted avgPrice: (2*14 + 3*16) / 5 = 76/5 = 15.2
    expect(event?.avgPrice).toBeCloseTo(15.2, 4);
    expect(event?.qty).toBe(5);
  });

  it("CLOSE event with no prior OPEN: realized_pnl null (WR-01); legBreakdown populated (D-09)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    const fillClose = makeFill({
      id: "fill-close-1",
      side: "sell",
      orderId: "order-close",
      price: 20.0,
      commission: 0.40,
      fees: 0.10,
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fillClose],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "CLOSING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    expect(storedEvents).toHaveLength(1);
    const closeEvent = storedEvents[0];
    expect(closeEvent?.eventType).toBe("CLOSE");
    // WR-01 (locked decision 2): with no prior OPEN event for the leg, originalOpenDebit is
    // unknown, so realizedPnl is null — never a wrong number. The prior-OPEN lookup that
    // populates it lands in 05-11; this asserts the gap-round corrected interim behavior.
    expect(closeEvent?.realizedPnl).toBeNull();
    // D-09 hard requirement: legBreakdown must still be populated on CLOSE
    expect(closeEvent?.legBreakdown).not.toBeNull();
    expect(closeEvent?.legBreakdown).toBeTruthy();
  });

  // ─── B1: realized-P&L lookup against the prior OPEN event ────────────────────

  it("CLOSE after a prior OPEN: realizedPnl = closeCredit − priorOpenNetAmount − feesOnClose (B1/WR-01)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    // CLOSE the front leg: closeCredit = |price*qty| = 500; feesOnClose = 1 + 1 = 2.
    const fillClose = makeFill({
      id: "fill-close-b1",
      occSymbol: OCC_FRONT,
      side: "sell",
      orderId: "order-close-b1",
      qty: 1,
      price: 500,
      commission: 1,
      fees: 1,
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fillClose],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "CLOSING" },
          ],
        },
        storedEvents,
        storedOrphans,
        // Prior OPEN event for the same leg: originalOpenDebit = netAmount = 300.
        priorEvents: {
          "cal-1": [makeOpenEvent({ legOccSymbol: OCC_FRONT, netAmount: 300 })],
        },
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    expect(storedEvents).toHaveLength(1);
    const closeEvent = storedEvents[0];
    expect(closeEvent?.eventType).toBe("CLOSE");
    // 500 − 300 − 2 = 198
    expect(closeEvent?.realizedPnl).toBeCloseTo(198, 6);
  });

  it("CLOSE with no prior OPEN event → realizedPnl null, never a wrong number (B1/WR-01)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    const fillClose = makeFill({
      id: "fill-close-noprior",
      occSymbol: OCC_FRONT,
      side: "sell",
      orderId: "order-close-noprior",
      qty: 1,
      price: 500,
      commission: 1,
      fees: 1,
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fillClose],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "CLOSING" },
          ],
        },
        storedEvents,
        storedOrphans,
        priorEvents: { "cal-1": [] }, // no prior OPEN for the leg
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]?.realizedPnl).toBeNull();
  });

  it("ROLL: realizedPnl reflects only the closed leg, excludes the new leg's debit (B1/WR-01)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    // Close the front leg (closeCredit = 500, feesOnClose = 2), open the back leg (debit 20).
    const fillClose = makeFill({
      id: "fill-roll-close-b1",
      occSymbol: OCC_FRONT,
      side: "sell",
      orderId: "roll-order-b1",
      qty: 1,
      price: 500,
      commission: 1,
      fees: 1,
    });
    const fillOpen = makeFill({
      id: "fill-roll-open-b1",
      occSymbol: OCC_BACK,
      side: "buy",
      orderId: "roll-order-b1",
      qty: 1,
      price: 20,
      commission: 0,
      fees: 0,
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fillClose, fillOpen],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "CLOSING" },
          ],
          [OCC_BACK]: [
            { calendarId: "cal-1", legOccSymbol: OCC_BACK, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
        // originalOpenDebit of the CLOSED (front) leg = 300.
        priorEvents: {
          "cal-1": [makeOpenEvent({ legOccSymbol: OCC_FRONT, netAmount: 300 })],
        },
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(1);
    const rollEvent = storedEvents[0];
    expect(rollEvent?.eventType).toBe("ROLL");
    // realizedPnl = closeCredit(500) − originalOpenDebit(300) − feesOnClose(2) = 198.
    // The new leg's debit (20) is NOT subtracted (locked decision 2).
    expect(rollEvent?.realizedPnl).toBeCloseTo(198, 6);
  });

  // ─── B5: UNKNOWN aggregate parks each raw fill individually ──────────────────

  it("UNKNOWN aggregate of 2 raw fills → 2 orphan rows, each with real side/filledAt/UUID (B5/WR-07)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    const fill1 = makeFill({
      id: "11111111-1111-4111-8111-111111111111",
      occSymbol: OCC_FRONT,
      orderId: "order-unknown",
      side: "buy",
      qty: 2,
      price: 14,
      filledAt: new Date("2026-06-10T15:30:00Z"),
    });
    const fill2 = makeFill({
      id: "22222222-2222-4222-8222-222222222222",
      occSymbol: OCC_FRONT,
      orderId: "order-unknown",
      side: "sell",
      qty: 3,
      price: 16,
      filledAt: new Date("2026-06-11T16:45:00Z"),
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill1, fill2],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "UNKNOWN" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(0);
    // Each underlying raw fill parked individually — never one synthesized row.
    expect(storedOrphans).toHaveLength(2);

    const o1 = storedOrphans.find((o) => o.fillId === fill1.id);
    const o2 = storedOrphans.find((o) => o.fillId === fill2.id);
    expect(o1).toBeDefined();
    expect(o2).toBeDefined();
    // Real side + real filledAt preserved (not hardcoded "buy"/now).
    expect(o1?.side).toBe("buy");
    expect(o1?.filledAt).toEqual(new Date("2026-06-10T15:30:00Z"));
    expect(o2?.side).toBe("sell");
    expect(o2?.filledAt).toEqual(new Date("2026-06-11T16:45:00Z"));
    // No synthesized non-UUID fillId.
    for (const o of storedOrphans) {
      expect(o.fillId.startsWith("agg-unknown-")).toBe(false);
    }
  });

  it("ROLL: sets rollOpenDebit (open-leg debit) and rollCloseCredit (close-leg credit) (WR-A1)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    // Close front leg (credit = 8*1 = 8), open back leg (debit = 20*1 = 20).
    const fillClose = makeFill({
      id: "fill-roll-close-a1",
      occSymbol: OCC_FRONT,
      side: "sell",
      orderId: "roll-order-a1",
      qty: 1,
      price: 8,
    });
    const fillOpen = makeFill({
      id: "fill-roll-open-a1",
      occSymbol: OCC_BACK,
      side: "buy",
      orderId: "roll-order-a1",
      qty: 1,
      price: 20,
    });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fillClose, fillOpen],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "CLOSING" },
          ],
          [OCC_BACK]: [
            { calendarId: "cal-1", legOccSymbol: OCC_BACK, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(1);
    const roll = storedEvents[0];
    expect(roll?.eventType).toBe("ROLL");
    // rollOpenDebit = open-leg debit (20); rollCloseCredit = close-leg credit (8).
    expect(roll?.rollOpenDebit).toBeCloseTo(20, 6);
    expect(roll?.rollCloseCredit).toBeCloseTo(8, 6);
    // combined netAmount = openDebit − closeCredit = 20 − 8 = 12 (unchanged).
    expect(roll?.netAmount).toBeCloseTo(12, 6);
  });

  it("OPEN/CLOSE events carry null roll components (WR-A1)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];
    const fill = makeFill({ id: "fill-open-null-roll", side: "buy" });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]?.rollOpenDebit).toBeNull();
    expect(storedEvents[0]?.rollCloseCredit).toBeNull();
  });

  // ─── WR-A2: mark-processed tracking ──────────────────────────────────────────

  it("marks a bucket's fills processed once its OPEN event is stored (WR-A2)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];
    const markedFillIds: string[] = [];
    const fill = makeFill({ id: "fill-open-mark", side: "buy" });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill],
        legMap: {
          [OCC_FRONT]: [
            { calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
          ],
        },
        storedEvents,
        storedOrphans,
        markedFillIds,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(1);
    // The composing fill is marked processed so the next sync won't re-read it.
    expect(markedFillIds).toContain("fill-open-mark");
  });

  it("marks orphan-parked fills processed so they are not re-read (WR-A2)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];
    const markedFillIds: string[] = [];
    const fill = makeFill({ id: "fill-orphan-mark" });

    const syncFills = makeSyncFillsUseCase(
      buildDeps({
        fills: [fill],
        legMap: {},
        storedEvents,
        storedOrphans,
        markedFillIds,
      }),
    );

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(1);
    expect(markedFillIds).toContain("fill-orphan-mark");
  });

  it("re-run under processed-tracking: a fill added in a later sync emits exactly ONE new event covering only it (WR-A2)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    // Simulate the data path: a processed Set the reader honors. The first sync marks fillA
    // processed; the second sync's reader returns only fillB (the not-yet-marked fill).
    const processed = new Set<string>();
    const fillA = makeFill({ id: "fill-grow-A", orderId: "order-grow" });
    const fillB = makeFill({ id: "fill-grow-B", orderId: "order-grow" });
    const allFills = [fillA, fillB];

    const storedEvents: CalendarEvent[] = [];

    const readUnprocessedFills: ForReadingUnprocessedFills = async () =>
      ok(allFills.filter((f) => !processed.has(f.id)));
    const readCalendarLegs: ForReadingCalendarLegs = async () =>
      ok([{ calendarId: "cal-1", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" as const }]);
    const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
      storedEvents.push(event);
      return ok(undefined);
    };
    const storeOrphanFill: ForStoringOrphanFill = async () => ok(undefined);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const readCalendarEvents: ForReadingCalendarEvents = async () => ok([]);
    const markFillsProcessed: ForMarkingFillsProcessed = async (fillIds) => {
      for (const id of fillIds) processed.add(id);
      return ok(undefined);
    };

    const deps = {
      readUnprocessedFills,
      readCalendarLegs,
      storeCalendarEvent,
      storeOrphanFill,
      resetCalendarAmounts,
      readCalendarEvents,
      markFillsProcessed,
      newId: seqId,
      hashFillIds: fakeHashFillIds,
      now: () => new Date("2026-06-15T14:00:00Z"),
    };

    // First sync: fillA only is unprocessed.
    processed.add("fill-grow-B"); // pretend B not yet arrived → reader skips it
    const r1 = await makeSyncFillsUseCase(deps)();
    expect(r1.ok).toBe(true);
    expect(storedEvents).toHaveLength(1);
    const firstEvent = storedEvents[0];

    // B "arrives": un-skip it. fillA is now processed (marked during sync 1).
    processed.delete("fill-grow-B");
    const r2 = await makeSyncFillsUseCase(deps)();
    expect(r2.ok).toBe(true);
    // Exactly ONE additional event, covering only fillB — A's event is untouched.
    expect(storedEvents).toHaveLength(2);
    expect(storedEvents[0]).toBe(firstEvent);
    expect(storedEvents[1]?.fillIdsHash).toBe(fakeHashFillIds([fillB.id]));
  });
});

// ─── A2 / CR-04: calendar-scoped sync ──────────────────────────────────────────

describe("makeSyncFillsForCalendarUseCase", () => {
  it("scoped sync for calendar A emits only A's events; B's fills untouched (CR-04)", async () => {
    const { makeSyncFillsForCalendarUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: OrphanCapture[] = [];

    // Fills span calendar A (front leg) and calendar B (back leg).
    const fillA = makeFill({
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      occSymbol: OCC_FRONT,
      orderId: "order-A",
      side: "buy",
    });
    const fillB = makeFill({
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      occSymbol: OCC_BACK,
      orderId: "order-B",
      side: "buy",
    });

    const legMap: Record<
      string,
      Array<{
        calendarId: string;
        legOccSymbol: string;
        positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
      }>
    > = {
      [OCC_FRONT]: [
        { calendarId: "cal-A", legOccSymbol: OCC_FRONT, positionEffect: "OPENING" },
      ],
      [OCC_BACK]: [
        { calendarId: "cal-B", legOccSymbol: OCC_BACK, positionEffect: "OPENING" },
      ],
    };

    // Calendar-scoped fills reader: returns only the target calendar's fills.
    const fillsByCalendar: Record<string, RawFill[]> = {
      "cal-A": [fillA],
      "cal-B": [fillB],
    };
    const readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar =
      async (calendarId) => ok(fillsByCalendar[calendarId] ?? []);

    const readCalendarLegs: ForReadingCalendarLegs = async (occSymbol) =>
      ok(legMap[occSymbol] ?? []);
    const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
      storedEvents.push(event);
      return ok(undefined);
    };
    const storeOrphanFill: ForStoringOrphanFill = async (orphan) => {
      storedOrphans.push(orphan);
      return ok(undefined);
    };
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const readCalendarEvents: ForReadingCalendarEvents = async () => ok([]);
    const markFillsProcessed: ForMarkingFillsProcessed = async () => ok(undefined);

    idCounter = 0;
    const syncForCalendar = makeSyncFillsForCalendarUseCase({
      readUnprocessedFillsForCalendar,
      readCalendarLegs,
      storeCalendarEvent,
      storeOrphanFill,
      resetCalendarAmounts,
      readCalendarEvents,
      markFillsProcessed,
      newId: seqId,
      hashFillIds: fakeHashFillIds,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await syncForCalendar("cal-A");
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    // Only calendar A's event emitted; B is untouched.
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]?.calendarId).toBe("cal-A");
    expect(storedEvents.some((e) => e.calendarId === "cal-B")).toBe(false);
  });
});

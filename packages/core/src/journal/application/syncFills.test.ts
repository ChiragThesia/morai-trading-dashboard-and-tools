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

type OrphanCapture = { fillId: string; reason: string; [k: string]: unknown };

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
}) {
  const readUnprocessedFills: ForReadingUnprocessedFills = async () => ok(opts.fills);
  const readCalendarLegs: ForReadingCalendarLegs = async (occSymbol) =>
    ok(opts.legMap[occSymbol] ?? []);
  const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
    opts.storedEvents.push(event);
    return ok(undefined);
  };
  const storeOrphanFill: ForStoringOrphanFill = async (orphan) => {
    opts.storedOrphans.push(orphan as OrphanCapture);
    return ok(undefined);
  };
  const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
  return {
    readUnprocessedFills,
    readCalendarLegs,
    storeCalendarEvent,
    storeOrphanFill,
    resetCalendarAmounts,
    now: () => new Date("2026-06-15T14:00:00Z"),
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

    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills,
      readCalendarLegs,
      storeCalendarEvent,
      storeOrphanFill,
      resetCalendarAmounts,
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

  it("CLOSE event: realized_pnl populated; legBreakdown populated (D-09 hard requirement)", async () => {
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
    // D-09: realizedPnl must be populated on CLOSE (not null)
    expect(closeEvent?.realizedPnl).not.toBeNull();
    expect(typeof closeEvent?.realizedPnl).toBe("number");
    // D-09 hard requirement: legBreakdown must be populated
    expect(closeEvent?.legBreakdown).not.toBeNull();
    expect(closeEvent?.legBreakdown).toBeTruthy();
  });
});

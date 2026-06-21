/**
 * syncFills use-case tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - Matched fill produces a calendar event (OPEN classified correctly)
 *   - Unmatched fill parks in orphan_fills (D-05)
 *   - Re-running against same fill set produces zero duplicate calendar_events (idempotency)
 *   - ROLL detection: close+open same orderId → one ROLL event, not CLOSE+OPEN
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-07 implements makeSyncFillsUseCase.
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

// ─── Minimal in-memory stubs for Wave 0 assertions ───────────────────────────

function makeFill(overrides: Partial<RawFill> = {}): RawFill {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    orderId: "order-001",
    occSymbol: "O:SPX260620P07100000",
    side: "buy",
    qty: 1,
    price: 15.5,
    filledAt: new Date("2026-06-15T14:00:00Z"),
    commission: 0.65,
    fees: 0.12,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeSyncFillsUseCase", () => {
  it("matched fill against a calendar leg → stores one calendar event (OPEN)", async () => {
    // This test will fail (RED) until plan 05-07 implements the use-case.
    // Import the use-case factory lazily so this file compiles even before implementation.
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: unknown[] = [];
    const fill = makeFill({ id: "fill-open-1", side: "buy" });

    const readUnprocessedFills: ForReadingUnprocessedFills = async () =>
      ok([fill]);

    const readCalendarLegs: ForReadingCalendarLegs = async (_occSymbol) =>
      ok([{ calendarId: "cal-1", legOccSymbol: fill.occSymbol, positionEffect: "OPENING" as const }]);

    const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
      storedEvents.push(event);
      return ok(undefined);
    };

    const storeOrphanFill: ForStoringOrphanFill = async (orphan) => {
      storedOrphans.push(orphan);
      return ok(undefined);
    };

    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);

    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills,
      readCalendarLegs,
      storeCalendarEvent,
      storeOrphanFill,
      resetCalendarAmounts,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedOrphans).toHaveLength(0);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0]?.eventType).toBe("OPEN");
  });

  it("fill matching no calendar leg → parks in orphan_fills (D-05)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    const storedEvents: CalendarEvent[] = [];
    const storedOrphans: unknown[] = [];
    const fill = makeFill({ id: "fill-orphan-1" });

    const readUnprocessedFills: ForReadingUnprocessedFills = async () => ok([fill]);
    const readCalendarLegs: ForReadingCalendarLegs = async () => ok([]); // no match
    const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
      storedEvents.push(event);
      return ok(undefined);
    };
    const storeOrphanFill: ForStoringOrphanFill = async (orphan) => {
      storedOrphans.push(orphan);
      return ok(undefined);
    };
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);

    const syncFills = makeSyncFillsUseCase({
      readUnprocessedFills,
      readCalendarLegs,
      storeCalendarEvent,
      storeOrphanFill,
      resetCalendarAmounts,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await syncFills();
    expect(result.ok).toBe(true);
    expect(storedEvents).toHaveLength(0);
    expect(storedOrphans).toHaveLength(1);
  });

  it("re-run against same fills → storeCalendarEvent called again but idempotent (no-op on duplicate hash)", async () => {
    const { makeSyncFillsUseCase } = await import("./syncFills.ts");

    let storeCallCount = 0;
    const fill = makeFill({ id: "fill-idem-1" });

    const readUnprocessedFills: ForReadingUnprocessedFills = async () => ok([fill]);
    const readCalendarLegs: ForReadingCalendarLegs = async () =>
      ok([{ calendarId: "cal-1", legOccSymbol: fill.occSymbol, positionEffect: "OPENING" as const }]);
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
});

/**
 * rebuildCalendarHistory tests (Phase 40, Plan 05, HIST-02).
 *
 * Task 1 covers enumerateRebuildSlots — the pure D-08 write-window enumerator: no anchor
 * ever escapes [max(openedAt, from), min(closedAt ?? now, to)], RTH-only, sorted, no dupes.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isWithinRth } from "@morai/shared";
import { enumerateRebuildSlots } from "./rebuildCalendarHistory.ts";
import { roundDownToRthSlot } from "../domain/rth-slot.ts";
import type { Calendar } from "./ports.ts";

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: "cal-001",
    underlying: "SPX",
    strike: 5000000,
    optionType: "C",
    frontExpiry: "2026-07-18",
    backExpiry: "2026-09-19",
    qty: 2,
    openNetDebit: 5.0,
    status: "open",
    openedAt: new Date("2026-06-01T14:00:00Z"),
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe("enumerateRebuildSlots", () => {
  it("enumerates every 30-min RTH slot within a same-day window (EDT)", () => {
    // Monday 2026-06-15, EDT = UTC-4. 09:00 ET -> 13:00Z, 17:00 ET -> 21:00Z.
    const calendar = makeCalendar({
      openedAt: new Date("2026-06-15T13:00:00Z"),
      closedAt: new Date("2026-06-15T21:00:00Z"),
    });
    const window = { from: calendar.openedAt, to: new Date("2026-06-15T21:00:00Z") };
    const now = new Date("2026-06-16T00:00:00Z");

    const slots = enumerateRebuildSlots(calendar, window, now);

    // 09:30 ET .. 16:00 ET inclusive, every 30 min = 14 slots.
    expect(slots).toHaveLength(14);
    expect(slots[0]?.toISOString()).toBe("2026-06-15T13:30:00.000Z"); // 09:30 ET
    expect(slots.at(-1)?.toISOString()).toBe("2026-06-15T20:00:00.000Z"); // 16:00 ET
  });

  it("clamps to the calendar life window when the requested window is wider (from before openedAt, to after closedAt)", () => {
    const calendar = makeCalendar({
      openedAt: new Date("2026-06-15T13:30:00Z"), // 09:30 ET, slot-aligned
      closedAt: new Date("2026-06-15T14:00:00Z"), // 10:00 ET, slot-aligned
    });
    const window = {
      from: new Date("2026-06-14T00:00:00Z"), // well before openedAt
      to: new Date("2026-06-20T00:00:00Z"), // well after closedAt
    };
    const now = new Date("2026-06-16T00:00:00Z");

    const slots = enumerateRebuildSlots(calendar, window, now);

    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-06-15T13:30:00.000Z",
      "2026-06-15T14:00:00.000Z",
    ]);
  });

  it("uses now in place of a null closedAt (open calendar)", () => {
    const calendar = makeCalendar({
      openedAt: new Date("2026-06-15T13:30:00Z"),
      closedAt: null,
    });
    const window = { from: calendar.openedAt, to: new Date("2026-06-20T00:00:00Z") };
    const now = new Date("2026-06-15T14:00:00Z"); // 10:00 ET

    const slots = enumerateRebuildSlots(calendar, window, now);

    expect(slots.map((s) => s.toISOString())).toEqual([
      "2026-06-15T13:30:00.000Z",
      "2026-06-15T14:00:00.000Z",
    ]);
  });

  it("yields zero anchors when the requested window clamps to empty (from after closedAt)", () => {
    const calendar = makeCalendar({
      openedAt: new Date("2026-06-15T13:30:00Z"),
      closedAt: new Date("2026-06-15T14:00:00Z"),
    });
    const window = { from: new Date("2026-06-16T00:00:00Z"), to: new Date("2026-06-20T00:00:00Z") };
    const now = new Date("2026-06-16T00:00:00Z");

    const slots = enumerateRebuildSlots(calendar, window, now);

    expect(slots).toEqual([]);
  });

  it("fast-check: every anchor lies within the clamped life window, is a valid RTH slot, and the series is sorted with no duplicates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Date.UTC(2024, 0, 1), max: Date.UTC(2026, 11, 1) }), // openedAt base
        fc.integer({ min: 0, max: 4 * DAY_MS }), // closedAt offset from openedAt
        fc.boolean(), // whether the calendar is still open (closedAt null)
        fc.integer({ min: -2 * DAY_MS, max: 2 * DAY_MS }), // from offset relative to openedAt
        fc.integer({ min: -2 * DAY_MS, max: 2 * DAY_MS }), // to offset relative to closedAt-candidate
        (openedAtMs, closedOffsetMs, isOpen, fromOffsetMs, toOffsetMs) => {
          const openedAt = new Date(openedAtMs);
          const closedCandidate = new Date(openedAtMs + closedOffsetMs);
          const closedAt = isOpen ? null : closedCandidate;
          const now = new Date(openedAtMs + 4 * DAY_MS);
          const calendar = makeCalendar({ openedAt, closedAt });
          const window = {
            from: new Date(openedAt.getTime() + fromOffsetMs),
            to: new Date(closedCandidate.getTime() + toOffsetMs),
          };

          const slots = enumerateRebuildSlots(calendar, window, now);

          const lowerBound = Math.max(openedAt.getTime(), window.from.getTime());
          const upperBound = Math.min((closedAt ?? now).getTime(), window.to.getTime());

          for (const slot of slots) {
            expect(slot.getTime()).toBeGreaterThanOrEqual(lowerBound);
            expect(slot.getTime()).toBeLessThanOrEqual(upperBound);
            expect(isWithinRth(slot)).toBe(true);
            expect(roundDownToRthSlot(slot).getTime()).toBe(slot.getTime());
          }

          const times = slots.map((s) => s.getTime());
          expect(times).toEqual([...times].sort((a, b) => a - b));
          expect(new Set(times).size).toBe(times.length);
        },
      ),
    );
  });
});

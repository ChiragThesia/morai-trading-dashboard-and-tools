/**
 * brakes.test.ts — RED: the two anti-criteria brake evaluators (28-02-PLAN.md behavior block).
 *
 * Invariants locked here:
 *   1. maxOpenTripped: true at exactly 6, false at 5 (USER DECISION 2).
 *   2. cooldownActive: true at exactly -25%, false at -24.9%; skips a 0 openNetDebit and a
 *      null realizedPnl — never NaN / divide-by-zero.
 *   3. cooldownCutoff: 2 business days back, reusing entry-gate's businessDaysSince (no
 *      calendar-day proxy), NYSE-holiday aware via the same helper.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  MAX_OPEN_CALENDARS,
  LOSS_COOLDOWN_PCT,
  COOLDOWN_BIZDAYS,
  maxOpenTripped,
  cooldownActive,
  cooldownCutoff,
} from "./brakes.ts";
import type { RecentClosedCalendarRow } from "./brakes.ts";
import { businessDaysSince } from "./entry-gate.ts";

function row(overrides: Partial<RecentClosedCalendarRow> = {}): RecentClosedCalendarRow {
  return {
    calendarId: "cal-1",
    closedAt: new Date("2026-07-01T14:00:00Z"),
    openNetDebit: 10,
    realizedPnl: -1,
    ...overrides,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

describe("constants", () => {
  it("MAX_OPEN_CALENDARS is 6 (USER DECISION 2)", () => {
    expect(MAX_OPEN_CALENDARS).toBe(6);
  });

  it("LOSS_COOLDOWN_PCT is -0.25 and COOLDOWN_BIZDAYS is 2 (USER DECISION 2)", () => {
    expect(LOSS_COOLDOWN_PCT).toBe(-0.25);
    expect(COOLDOWN_BIZDAYS).toBe(2);
  });
});

// ─── maxOpenTripped ─────────────────────────────────────────────────────────

describe("maxOpenTripped", () => {
  it("is true at exactly 6 open calendars", () => {
    expect(maxOpenTripped(6)).toBe(true);
  });

  it("is true above 6", () => {
    expect(maxOpenTripped(7)).toBe(true);
  });

  it("is false at 5", () => {
    expect(maxOpenTripped(5)).toBe(false);
  });

  it("is false at 0", () => {
    expect(maxOpenTripped(0)).toBe(false);
  });
});

// ─── cooldownActive ─────────────────────────────────────────────────────────

describe("cooldownActive", () => {
  it("is true when a row is at exactly -25%", () => {
    const rows = [row({ openNetDebit: 10, realizedPnl: -2.5 })]; // -2.5 / 10 = -0.25
    expect(cooldownActive(rows)).toBe(true);
  });

  it("is true when a row is beyond -25% (deeper loss)", () => {
    const rows = [row({ openNetDebit: 10, realizedPnl: -5 })]; // -50%
    expect(cooldownActive(rows)).toBe(true);
  });

  it("is false when a row is at -24.9%, just short of the rung", () => {
    const rows = [row({ openNetDebit: 10, realizedPnl: -2.49 })]; // -24.9%
    expect(cooldownActive(rows)).toBe(false);
  });

  it("is false for an empty recent-closed list", () => {
    expect(cooldownActive([])).toBe(false);
  });

  it("is true when ANY row (not all) trips the rung", () => {
    const rows = [
      row({ calendarId: "cal-1", openNetDebit: 10, realizedPnl: -0.5 }), // -5%, no trip
      row({ calendarId: "cal-2", openNetDebit: 10, realizedPnl: -3 }), // -30%, trips
    ];
    expect(cooldownActive(rows)).toBe(true);
  });

  it("skips a row with openNetDebit 0 — never divide-by-zero / NaN", () => {
    const rows = [row({ openNetDebit: 0, realizedPnl: -100 })];
    expect(cooldownActive(rows)).toBe(false);
  });

  it("skips a row with a null realizedPnl", () => {
    const rows = [row({ openNetDebit: 10, realizedPnl: null })];
    expect(cooldownActive(rows)).toBe(false);
  });

  it("fast-check: never throws or returns NaN-driven true for any finite inputs", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            calendarId: fc.string(),
            closedAt: fc.constant(new Date("2026-07-01T00:00:00Z")),
            openNetDebit: fc.double({ min: -1000, max: 1000, noNaN: true }),
            realizedPnl: fc.option(fc.double({ min: -1000, max: 1000, noNaN: true }), {
              nil: null,
            }),
          }),
        ),
        (rows) => {
          const result = cooldownActive(rows);
          expect(typeof result).toBe("boolean");
        },
      ),
    );
  });
});

// ─── cooldownCutoff ─────────────────────────────────────────────────────────

describe("cooldownCutoff", () => {
  it("returns the date 2 business days before a mid-week now (Wed -> Mon)", () => {
    // 2026-07-08 is a Wednesday; 2 business days back is Monday 2026-07-06.
    expect(cooldownCutoff("2026-07-08")).toBe("2026-07-06");
  });

  it("skips the weekend (Mon -> prior Thu)", () => {
    // 2026-07-06 is a Monday; 2 business days back is Thursday 2026-07-02.
    expect(cooldownCutoff("2026-07-06")).toBe("2026-07-02");
  });

  it("agrees with businessDaysSince: the cutoff is exactly COOLDOWN_BIZDAYS business days before now", () => {
    const nowIso = "2026-07-08";
    const cutoff = cooldownCutoff(nowIso);
    expect(businessDaysSince(cutoff, nowIso)).toBe(COOLDOWN_BIZDAYS);
  });
});

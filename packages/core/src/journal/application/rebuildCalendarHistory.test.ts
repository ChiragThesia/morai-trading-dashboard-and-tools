/**
 * rebuildCalendarHistory tests (Phase 40, Plan 05, HIST-02).
 *
 * Task 1 covers enumerateRebuildSlots — the pure D-08 write-window enumerator: no anchor
 * ever escapes [max(openedAt, from), min(closedAt ?? now, to)], RTH-only, sorted, no dupes.
 *
 * Task 2 covers makeRebuildCalendarHistoryUseCase — D-02 byte-identical-to-live-writer reuse
 * of computeLegPairMetrics + computeSnapshotPnl, D-04 honest-gap skip, D-03 fill-only heal
 * (never persistSnapshot), coverage counts, and StorageError propagation from either port.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ok, err, isWithinRth, formatOccSymbol } from "@morai/shared";
import {
  enumerateRebuildSlots,
  makeRebuildCalendarHistoryUseCase,
} from "./rebuildCalendarHistory.ts";
import type { RebuildCalendarHistoryDeps } from "./rebuildCalendarHistory.ts";
import { roundDownToRthSlot } from "../domain/rth-slot.ts";
import { computeLegPairMetrics, computeSnapshotPnl } from "./snapshotCalendars.ts";
import type { Calendar, LegSnapshot, SnapshotRow, ForHealingSnapshot } from "./ports.ts";

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

const TEST_OCC = formatOccSymbol({ root: "SPX", expiry: new Date("2026-07-18T12:00:00Z"), type: "C", strike: 5000 });

function makeLegSnapshot(overrides: Partial<LegSnapshot> = {}): LegSnapshot {
  return {
    occSymbol: TEST_OCC,
    time: new Date("2026-06-15T13:00:00Z"),
    mark: 20.0,
    underlyingPrice: 5010.0,
    ivRaw: 0.22,
    bsmIv: "0.22",
    bsmDelta: "0.55",
    bsmGamma: "0.003",
    bsmTheta: "-1.8",
    bsmVega: "6.2",
    source: "cboe",
    ...overrides,
  };
}

// Capture healSnapshot calls via a typed array (avoids `as` casts on vi.fn mock.calls).
function makeHealCapture(): { healSnapshot: ForHealingSnapshot; rows: SnapshotRow[] } {
  const rows: SnapshotRow[] = [];
  const healSnapshot: ForHealingSnapshot = async (row: SnapshotRow) => {
    rows.push(row);
    return ok(undefined);
  };
  return { healSnapshot, rows };
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

describe("makeRebuildCalendarHistoryUseCase", () => {
  // Single-slot life window (09:30 ET, EDT) — isolates one enumerated slot per test.
  const SLOT_ANCHOR = new Date("2026-06-15T13:30:00Z");
  const SINGLE_SLOT_WINDOW = { from: SLOT_ANCHOR, to: SLOT_ANCHOR };

  function makeDeps(overrides: Partial<RebuildCalendarHistoryDeps> = {}): RebuildCalendarHistoryDeps {
    return {
      resolveLegObservationForSlot: async () => ok(makeLegSnapshot()),
      healSnapshot: async () => ok(undefined),
      now: () => new Date("2026-06-16T00:00:00Z"),
      ...overrides,
    };
  }

  it("builds a row byte-identical to the live writer's composition (D-02 — same computeLegPairMetrics/computeSnapshotPnl, no drift)", async () => {
    const calendar = makeCalendar({ openedAt: SLOT_ANCHOR, closedAt: SLOT_ANCHOR });
    const front = makeLegSnapshot({ mark: 10.0 });
    const back = makeLegSnapshot({ mark: 25.0 });
    const capture = makeHealCapture();

    const resolveLegObservationForSlot: RebuildCalendarHistoryDeps["resolveLegObservationForSlot"] = async (
      query,
    ) => ok(query.expiry === calendar.frontExpiry ? front : back);

    const useCase = makeRebuildCalendarHistoryUseCase(
      makeDeps({ resolveLegObservationForSlot, healSnapshot: capture.healSnapshot }),
    );

    const result = await useCase(calendar, SINGLE_SLOT_WINDOW);

    expect(result.ok).toBe(true);
    expect(capture.rows).toHaveLength(1);

    // Reconstructed the SAME way buildSnapshotRow composes a row — the live writer's exact
    // exported pure functions, same inputs — proving no formula drift (D-02).
    const metrics = computeLegPairMetrics(
      SLOT_ANCHOR,
      front,
      back,
      calendar.qty,
      calendar.frontExpiry,
      calendar.backExpiry,
    );
    const expectedRow: SnapshotRow = {
      ...metrics,
      calendarId: calendar.id,
      pnlOpen: String(computeSnapshotPnl(parseFloat(metrics.netMark), calendar.openNetDebit, calendar.qty)),
      trigger: "scheduled",
    };
    expect(capture.rows[0]).toEqual(expectedRow);
  });

  it("produces an honest gap — no healSnapshot call — when either leg fails to resolve (D-04)", async () => {
    const calendar = makeCalendar({ openedAt: SLOT_ANCHOR, closedAt: SLOT_ANCHOR });
    const capture = makeHealCapture();

    const resolveLegObservationForSlot: RebuildCalendarHistoryDeps["resolveLegObservationForSlot"] = async (
      query,
    ) => ok(query.expiry === calendar.frontExpiry ? makeLegSnapshot() : null);

    const useCase = makeRebuildCalendarHistoryUseCase(
      makeDeps({ resolveLegObservationForSlot, healSnapshot: capture.healSnapshot }),
    );

    const result = await useCase(calendar, SINGLE_SLOT_WINDOW);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ slotsConsidered: 1, rowsHealed: 0, honestGapSlots: 1 });
    }
    expect(capture.rows).toHaveLength(0);
  });

  it("reports coverage counts across multiple slots (one healed, one honest gap)", async () => {
    // Two slot-aligned instants 30 min apart -> exactly 2 enumerated slots (see Task 1 tests).
    const openedAt = new Date("2026-06-15T13:30:00Z"); // 09:30 ET
    const closedAt = new Date("2026-06-15T14:00:00Z"); // 10:00 ET
    const calendar = makeCalendar({ openedAt, closedAt });
    const capture = makeHealCapture();

    const resolveLegObservationForSlot: RebuildCalendarHistoryDeps["resolveLegObservationForSlot"] = async (
      query,
    ) => {
      // Gap the back leg only for the second (10:00) slot.
      if (query.expiry === calendar.backExpiry && query.slotAnchor.getTime() === closedAt.getTime()) {
        return ok(null);
      }
      return ok(makeLegSnapshot());
    };

    const useCase = makeRebuildCalendarHistoryUseCase(
      makeDeps({ resolveLegObservationForSlot, healSnapshot: capture.healSnapshot }),
    );

    const result = await useCase(calendar, { from: openedAt, to: closedAt });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ slotsConsidered: 2, rowsHealed: 1, honestGapSlots: 1 });
    }
    expect(capture.rows).toHaveLength(1);
  });

  it("propagates a StorageError from resolveLegObservationForSlot without calling healSnapshot", async () => {
    const calendar = makeCalendar({ openedAt: SLOT_ANCHOR, closedAt: SLOT_ANCHOR });
    const capture = makeHealCapture();
    const storageError = { kind: "storage-error" as const, message: "boom" };

    const useCase = makeRebuildCalendarHistoryUseCase(
      makeDeps({
        resolveLegObservationForSlot: async () => err(storageError),
        healSnapshot: capture.healSnapshot,
      }),
    );

    const result = await useCase(calendar, SINGLE_SLOT_WINDOW);

    expect(result).toEqual(err(storageError));
    expect(capture.rows).toHaveLength(0);
  });

  it("propagates a StorageError from healSnapshot (fill-only — never persistSnapshot)", async () => {
    const calendar = makeCalendar({ openedAt: SLOT_ANCHOR, closedAt: SLOT_ANCHOR });
    const storageError = { kind: "storage-error" as const, message: "heal failed" };

    const useCase = makeRebuildCalendarHistoryUseCase(
      makeDeps({ healSnapshot: async () => err(storageError) }),
    );

    const result = await useCase(calendar, SINGLE_SLOT_WINDOW);

    expect(result).toEqual(err(storageError));
  });

  it("fast-check: pnlOpen always matches computeSnapshotPnl(netMark, openNetDebit, qty) for any resolved leg pair", () => {
    fc.assert(
      fc.asyncProperty(
        fc.float({ min: Math.fround(-50), max: Math.fround(50), noNaN: true }),
        fc.float({ min: Math.fround(-50), max: Math.fround(50), noNaN: true }),
        fc.float({ min: Math.fround(-20), max: Math.fround(20), noNaN: true }),
        fc.integer({ min: 1, max: 10 }),
        async (frontMark, backMark, openNetDebit, qty) => {
          const calendar = makeCalendar({ openedAt: SLOT_ANCHOR, closedAt: SLOT_ANCHOR, openNetDebit, qty });
          const front = makeLegSnapshot({ mark: frontMark });
          const back = makeLegSnapshot({ mark: backMark });
          const capture = makeHealCapture();

          const resolveLegObservationForSlot: RebuildCalendarHistoryDeps["resolveLegObservationForSlot"] = async (
            query,
          ) => ok(query.expiry === calendar.frontExpiry ? front : back);

          const useCase = makeRebuildCalendarHistoryUseCase(
            makeDeps({ resolveLegObservationForSlot, healSnapshot: capture.healSnapshot }),
          );

          await useCase(calendar, SINGLE_SLOT_WINDOW);

          const netMark = backMark - frontMark;
          const expectedPnl = computeSnapshotPnl(netMark, openNetDebit, qty);
          expect(capture.rows[0]?.pnlOpen).toBe(String(expectedPnl));
        },
      ),
    );
  });
});

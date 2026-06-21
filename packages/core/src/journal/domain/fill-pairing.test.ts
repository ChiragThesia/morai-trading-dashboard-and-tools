/**
 * fill-pairing domain function tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - classifyFill: completeness over all (side, positionEffect) pairs
 *   - aggregatePartialFills: qty round-trip (sumQty equals sum of fill qtys)
 *   - computePnl: monotonicity (increasing closeCredit → increasing P&L)
 *   - detectRoll: same calendarId + orderId + same underlying/strike/type + different expiry
 *   - hashFillIds: determinism (same ids → same hash; sorted order)
 *
 * These tests import the real signatures and fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-03 implements the function bodies.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  classifyFill,
  aggregatePartialFills,
  computePnl,
  detectRoll,
  hashFillIds,
} from "./fill-pairing.ts";
import type { RawFill, AggregatedFill } from "./calendar-event.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRawFill(overrides: Partial<RawFill> = {}): RawFill {
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

function makeAggregatedFill(overrides: Partial<AggregatedFill> = {}): AggregatedFill {
  return {
    calendarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    legOccSymbol: "O:SPX260620P07100000",
    orderId: "order-001",
    sumQty: 2,
    avgPrice: 15.5,
    totalCommission: 1.30,
    totalFees: 0.24,
    positionEffect: "OPENING",
    fillIds: ["fill-1", "fill-2"],
    ...overrides,
  };
}

// ─── classifyFill ─────────────────────────────────────────────────────────────

describe("classifyFill", () => {
  it("buy + OPENING → OPEN", () => {
    expect(classifyFill("buy", "OPENING")).toBe("OPEN");
  });

  it("sell + CLOSING → CLOSE", () => {
    expect(classifyFill("sell", "CLOSING")).toBe("CLOSE");
  });

  it("buy + CLOSING → CLOSE (bought-to-close)", () => {
    expect(classifyFill("buy", "CLOSING")).toBe("CLOSE");
  });

  it("sell + OPENING → OPEN (sold-to-open)", () => {
    expect(classifyFill("sell", "OPENING")).toBe("OPEN");
  });

  it("any + UNKNOWN → UNKNOWN", () => {
    expect(classifyFill("buy", "UNKNOWN")).toBe("UNKNOWN");
    expect(classifyFill("sell", "UNKNOWN")).toBe("UNKNOWN");
  });

  it("(fast-check) completeness: every (side, positionEffect) pair returns one of three values", () => {
    const sides = fc.constantFrom<"buy" | "sell">("buy", "sell");
    const effects = fc.constantFrom<"OPENING" | "CLOSING" | "UNKNOWN">("OPENING", "CLOSING", "UNKNOWN");

    fc.assert(
      fc.property(sides, effects, (side, effect) => {
        const result = classifyFill(side, effect);
        return result === "OPEN" || result === "CLOSE" || result === "UNKNOWN";
      }),
    );
  });
});

// ─── aggregatePartialFills ────────────────────────────────────────────────────

describe("aggregatePartialFills", () => {
  it("single fill → one aggregated group with same qty", () => {
    const fills = [makeRawFill({ id: "fill-1", qty: 3 })];
    const result = aggregatePartialFills(fills);
    expect(result).toHaveLength(1);
    expect(result[0]?.sumQty).toBe(3);
  });

  it("two fills same (orderId, occSymbol) → one group with sumQty", () => {
    const fills = [
      makeRawFill({ id: "fill-1", qty: 2, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
      makeRawFill({ id: "fill-2", qty: 3, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
    ];
    const result = aggregatePartialFills(fills);
    expect(result).toHaveLength(1);
    expect(result[0]?.sumQty).toBe(5);
  });

  it("qty-weighted avgPrice: (2*10 + 3*20) / 5 = 16", () => {
    // D-04: avgPrice = sum(qty*price) / sumQty
    const fills = [
      makeRawFill({ id: "fill-1", qty: 2, price: 10, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
      makeRawFill({ id: "fill-2", qty: 3, price: 20, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
    ];
    const result = aggregatePartialFills(fills);
    expect(result).toHaveLength(1);
    expect(result[0]?.avgPrice).toBeCloseTo(16, 5);
  });

  it("totalCommission and totalFees summed from all fills", () => {
    const fills = [
      makeRawFill({ id: "fill-1", commission: 0.65, fees: 0.10, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
      makeRawFill({ id: "fill-2", commission: 0.65, fees: 0.12, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
    ];
    const result = aggregatePartialFills(fills);
    expect(result).toHaveLength(1);
    expect(result[0]?.totalCommission).toBeCloseTo(1.30, 5);
    expect(result[0]?.totalFees).toBeCloseTo(0.22, 5);
  });

  it("null commission/fees treated as 0", () => {
    const fills = [
      makeRawFill({ id: "fill-1", commission: null, fees: null, orderId: "order-A", occSymbol: "O:SPX260620P07100000" }),
    ];
    const result = aggregatePartialFills(fills);
    expect(result[0]?.totalCommission).toBe(0);
    expect(result[0]?.totalFees).toBe(0);
  });

  it("empty input → empty output", () => {
    expect(aggregatePartialFills([])).toHaveLength(0);
  });

  it("fills with different orderId → two groups", () => {
    const fills = [
      makeRawFill({ id: "fill-1", orderId: "order-A" }),
      makeRawFill({ id: "fill-2", orderId: "order-B" }),
    ];
    const result = aggregatePartialFills(fills);
    expect(result).toHaveLength(2);
  });

  it("(fast-check) qty round-trip: sum of input qtys equals sum of aggregated sumQtys", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            orderId: fc.constantFrom("order-A", "order-B"),
            occSymbol: fc.constantFrom("O:SPX260620P07100000", "O:SPX260718P07100000"),
            side: fc.constantFrom<"buy" | "sell">("buy", "sell"),
            qty: fc.integer({ min: 1, max: 10 }),
            price: fc.float({ min: 0.01, max: 100, noNaN: true }),
            filledAt: fc.date({ min: new Date("2026-01-01"), max: new Date("2026-12-31") }).filter((d) => !isNaN(d.getTime())),
            commission: fc.option(fc.float({ min: 0, max: 5, noNaN: true }), { nil: null }),
            fees: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: null }),
          }),
          { minLength: 0, maxLength: 20 },
        ),
        (fills: ReadonlyArray<RawFill>) => {
          const totalInputQty = fills.reduce((s, f) => s + f.qty, 0);
          const aggregated = aggregatePartialFills(fills);
          const totalAggQty = aggregated.reduce((s, a) => s + a.sumQty, 0);
          return totalInputQty === totalAggQty;
        },
      ),
    );
  });
});

// ─── computePnl ───────────────────────────────────────────────────────────────

describe("computePnl", () => {
  it("positive example: closeCredit 20, openDebit 15, totalFees 0.5 → 4.5", () => {
    // realizedPnl = |closeCredit| - openDebit - totalFees
    // = 20 - 15 - 0.5 = 4.5
    expect(computePnl(15, 20, 0.5)).toBeCloseTo(4.5, 5);
  });

  it("negative example: closeCredit 5, openDebit 15, totalFees 0.5 → -10.5", () => {
    expect(computePnl(15, 5, 0.5)).toBeCloseTo(-10.5, 5);
  });

  it("(fast-check) monotonicity: increasing closeCredit → increasing P&L (holding openDebit + fees constant)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 1000, noNaN: true }),
        fc.float({ min: 0, max: 1000, noNaN: true }),
        fc.float({ min: 0, max: 50, noNaN: true }),
        fc.float({ min: 0.01, max: 10, noNaN: true }),
        (openDebit, closeCredit1, totalFees, delta) => {
          const closeCredit2 = closeCredit1 + delta;
          const pnl1 = computePnl(openDebit, closeCredit1, totalFees);
          const pnl2 = computePnl(openDebit, closeCredit2, totalFees);
          return pnl2 > pnl1;
        },
      ),
    );
  });
});

// ─── detectRoll ───────────────────────────────────────────────────────────────

describe("detectRoll", () => {
  it("same calendarId + orderId + same underlying/strike/type + different expiry → true", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "O:SPX260620P07100000",
      positionEffect: "CLOSING",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "O:SPX260718P07100000",
      positionEffect: "OPENING",
    });
    expect(detectRoll(closing, opening)).toBe(true);
  });

  it("different calendarId → false", () => {
    const closing = makeAggregatedFill({ calendarId: "cal-1", orderId: "order-R" });
    const opening = makeAggregatedFill({ calendarId: "cal-2", orderId: "order-R" });
    expect(detectRoll(closing, opening)).toBe(false);
  });

  it("different orderId → false", () => {
    const closing = makeAggregatedFill({ calendarId: "cal-1", orderId: "order-A" });
    const opening = makeAggregatedFill({ calendarId: "cal-1", orderId: "order-B" });
    expect(detectRoll(closing, opening)).toBe(false);
  });

  it("same expiry on both legs → false (not a roll, just same expiry close+open)", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "O:SPX260620P07100000",
      positionEffect: "CLOSING",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "O:SPX260620P07100000", // same symbol → same expiry
      positionEffect: "OPENING",
    });
    expect(detectRoll(closing, opening)).toBe(false);
  });
});

// ─── hashFillIds ──────────────────────────────────────────────────────────────

describe("hashFillIds", () => {
  it("determinism: same ids → same hash", () => {
    const ids = ["fill-1", "fill-2", "fill-3"];
    expect(hashFillIds(ids)).toBe(hashFillIds(ids));
  });

  it("order-independence: ids in different order → same hash", () => {
    const ids1 = ["fill-a", "fill-b", "fill-c"];
    const ids2 = ["fill-c", "fill-a", "fill-b"];
    expect(hashFillIds(ids1)).toBe(hashFillIds(ids2));
  });

  it("different ids → different hash", () => {
    const hash1 = hashFillIds(["fill-1", "fill-2"]);
    const hash2 = hashFillIds(["fill-1", "fill-3"]);
    expect(hash1).not.toBe(hash2);
  });

  it("produces exactly 64 hex characters (SHA-256)", () => {
    const hash = hashFillIds(["fill-1", "fill-2"]);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("(fast-check) determinism property: always returns same result for same sorted input", () => {
    fc.assert(
      fc.property(
        fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }),
        (ids) => {
          const sorted = [...ids].sort();
          return hashFillIds(sorted) === hashFillIds(sorted);
        },
      ),
    );
  });
});

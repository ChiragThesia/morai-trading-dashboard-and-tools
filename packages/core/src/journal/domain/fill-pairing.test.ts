/**
 * fill-pairing domain function tests (Phase 5, gap-round 05-09).
 *
 * Covers the corrected domain contracts:
 *   - classifyFill: positionEffect → OPEN/CLOSE/UNKNOWN (no dead `side` param)
 *   - aggregatePartialFills: single pre-bucketed group; Result.err on sumQty <= 0
 *   - computeRealizedPnl: closeCredit − originalOpenDebit − feesOnClose
 *   - detectRoll: same root+strike+type + DIFFERENT expiry only
 *   - hashFillIds: pure reference algorithm (sort + ':'-join) with an INJECTED hasher
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { isOk, isErr } from "@morai/shared";
import {
  classifyFill,
  aggregatePartialFills,
  computeRealizedPnl,
  detectRoll,
  hashFillIds,
  resolveFillMatches,
  isCalendarFullyClosed,
} from "./fill-pairing.ts";
import type { RawFill, AggregatedFill, CalendarEvent } from "./calendar-event.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRawFill(overrides: Partial<RawFill> = {}): RawFill {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    orderId: "order-001",
    occSymbol: "SPX   260620P07100000",
    side: "buy",
    qty: 1,
    price: 15.5,
    filledAt: new Date("2026-06-15T14:00:00Z"),
    commission: 0.65,
    fees: 0.12,
    positionEffect: "OPENING",
    ...overrides,
  };
}

function makeAggregatedFill(overrides: Partial<AggregatedFill> = {}): AggregatedFill {
  return {
    calendarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    legOccSymbol: "SPX   260620P07100000",
    orderId: "order-001",
    sumQty: 2,
    avgPrice: 15.5,
    totalCommission: 1.3,
    totalFees: 0.24,
    positionEffect: "OPENING",
    side: "buy",
    fillIds: ["fill-1", "fill-2"],
    ...overrides,
  };
}

// Reference sha256-style hasher stand-in for tests: deterministic, order-sensitive
// on its single string input (the domain function owns sort + join, the hasher is opaque).
function testHasher(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  // expand to a stable 64-char hex so callers can assert width independently of crypto
  return h.toString(16).padStart(8, "0").repeat(8);
}

// ─── classifyFill ─────────────────────────────────────────────────────────────

describe("classifyFill", () => {
  it("OPENING → OPEN", () => {
    expect(classifyFill("OPENING")).toBe("OPEN");
  });

  it("CLOSING → CLOSE", () => {
    expect(classifyFill("CLOSING")).toBe("CLOSE");
  });

  it("UNKNOWN → UNKNOWN", () => {
    expect(classifyFill("UNKNOWN")).toBe("UNKNOWN");
  });

  it("(fast-check) completeness: every positionEffect returns one of three values", () => {
    const effects = fc.constantFrom<"OPENING" | "CLOSING" | "UNKNOWN">(
      "OPENING",
      "CLOSING",
      "UNKNOWN",
    );
    fc.assert(
      fc.property(effects, (effect) => {
        const result = classifyFill(effect);
        return result === "OPEN" || result === "CLOSE" || result === "UNKNOWN";
      }),
    );
  });
});

// ─── aggregatePartialFills ────────────────────────────────────────────────────

describe("aggregatePartialFills", () => {
  it("single fill → ok group with same qty and supplied calendarId/positionEffect", () => {
    const fills = [makeRawFill({ id: "fill-1", qty: 3 })];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.sumQty).toBe(3);
    expect(result.value.calendarId).toBe("cal-1");
    expect(result.value.positionEffect).toBe("OPENING");
  });

  it("two fills → one group with summed qty", () => {
    const fills = [
      makeRawFill({ id: "fill-1", qty: 2 }),
      makeRawFill({ id: "fill-2", qty: 3 }),
    ];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.sumQty).toBe(5);
  });

  it("qty-weighted avgPrice: (2*10 + 3*20) / 5 = 16", () => {
    const fills = [
      makeRawFill({ id: "fill-1", qty: 2, price: 10 }),
      makeRawFill({ id: "fill-2", qty: 3, price: 20 }),
    ];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.avgPrice).toBeCloseTo(16, 5);
  });

  it("totalCommission and totalFees summed; null treated as 0", () => {
    const fills = [
      makeRawFill({ id: "fill-1", commission: 0.65, fees: 0.1 }),
      makeRawFill({ id: "fill-2", commission: null, fees: null }),
    ];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.totalCommission).toBeCloseTo(0.65, 5);
    expect(result.value.totalFees).toBeCloseTo(0.1, 5);
  });

  it("collects all fillIds in order", () => {
    const fills = [
      makeRawFill({ id: "fill-1" }),
      makeRawFill({ id: "fill-2" }),
    ];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.fillIds).toEqual(["fill-1", "fill-2"]);
  });

  // ─── journal-pnl-opennetdebit-units #2: side propagation (D-08 fix) ───────────

  it("propagates side 'buy' from the bucket's fills (journal-pnl-opennetdebit-units #2)", () => {
    const fills = [makeRawFill({ id: "fill-1", side: "buy" })];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.side).toBe("buy");
  });

  it("propagates side 'sell' from the bucket's fills — a sold-to-open leg (journal-pnl-opennetdebit-units #2)", () => {
    const fills = [makeRawFill({ id: "fill-1", side: "sell" })];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.side).toBe("sell");
  });

  // ─── journal-pnl-opennetdebit-units round 4: positionEffect propagation ───────
  //
  // positionEffect used to be supplied externally (derived from the calendar's current
  // status column). It is now read off the bucket's own fills — mirrors side exactly.

  it("propagates positionEffect 'OPENING' from the bucket's fills (journal-pnl-opennetdebit-units round 4)", () => {
    const fills = [makeRawFill({ id: "fill-1", positionEffect: "OPENING" })];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.positionEffect).toBe("OPENING");
  });

  it("propagates positionEffect 'CLOSING' from the bucket's fills — a real historical CLOSE, not the calendar's current status (journal-pnl-opennetdebit-units round 4)", () => {
    const fills = [makeRawFill({ id: "fill-1", positionEffect: "CLOSING" })];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.positionEffect).toBe("CLOSING");
  });

  it("empty input → error (never avgPrice 0)", () => {
    const result = aggregatePartialFills([], "cal-1");
    expect(isErr(result)).toBe(true);
  });

  it("sumQty <= 0 → error, never avgPrice 0", () => {
    const fills = [
      makeRawFill({ id: "fill-1", qty: 2 }),
      makeRawFill({ id: "fill-2", qty: -2 }),
    ];
    const result = aggregatePartialFills(fills, "cal-1");
    expect(isErr(result)).toBe(true);
  });

  it("(fast-check) qty round-trip: ok result sumQty equals sum of positive-qty input", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.uuid(),
            qty: fc.integer({ min: 1, max: 10 }),
            price: fc.float({ min: Math.fround(0.01), max: Math.fround(100), noNaN: true }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (raws) => {
          const fills = raws.map((r) => makeRawFill(r));
          const total = fills.reduce((s, f) => s + f.qty, 0);
          const result = aggregatePartialFills(fills, "cal-1");
          return isOk(result) && result.value.sumQty === total;
        },
      ),
    );
  });
});

// ─── computeRealizedPnl ─────────────────────────────────────────────────────────

describe("computeRealizedPnl", () => {
  it("example: closeCredit 500, originalOpenDebit 300, feesOnClose 2 → 198", () => {
    expect(computeRealizedPnl(500, 300, 2)).toBeCloseTo(198, 5);
  });

  it("ROLL example: new-leg debit (450) is NOT subtracted — still 198", () => {
    // realizedPnl reflects ONLY the closed leg: 500 − 300 − 2 = 198.
    // The 450 new-leg debit is cost basis, never passed to computeRealizedPnl.
    const realized = computeRealizedPnl(500, 300, 2);
    expect(realized).toBeCloseTo(198, 5);
  });

  it("negative example: closeCredit 5, originalOpenDebit 15, feesOnClose 0.5 → -10.5", () => {
    expect(computeRealizedPnl(5, 15, 0.5)).toBeCloseTo(-10.5, 5);
  });

  it("(fast-check) monotonic increasing in closeCredit", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(50), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(10), noNaN: true }),
        (closeCredit1, originalOpenDebit, feesOnClose, delta) => {
          const a = computeRealizedPnl(closeCredit1, originalOpenDebit, feesOnClose);
          const b = computeRealizedPnl(closeCredit1 + delta, originalOpenDebit, feesOnClose);
          return b > a;
        },
      ),
    );
  });

  it("(fast-check) monotonic decreasing in originalOpenDebit", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(50), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(10), noNaN: true }),
        (closeCredit, openDebit1, feesOnClose, delta) => {
          const a = computeRealizedPnl(closeCredit, openDebit1, feesOnClose);
          const b = computeRealizedPnl(closeCredit, openDebit1 + delta, feesOnClose);
          return b < a;
        },
      ),
    );
  });

  it("(fast-check) monotonic decreasing in feesOnClose", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(0), max: Math.fround(50), noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: Math.fround(10), noNaN: true }),
        (closeCredit, openDebit, fees1, delta) => {
          const a = computeRealizedPnl(closeCredit, openDebit, fees1);
          const b = computeRealizedPnl(closeCredit, openDebit, fees1 + delta);
          return b < a;
        },
      ),
    );
  });
});

// ─── detectRoll ───────────────────────────────────────────────────────────────

describe("detectRoll", () => {
  it("same root+strike+type + different expiry → true", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260620P07100000",
      positionEffect: "CLOSING",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260718P07100000",
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

  it("same expiry (same OCC) → false", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260620P07100000",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260620P07100000",
    });
    expect(detectRoll(closing, opening)).toBe(false);
  });

  it("DIFFERENT strike, different expiry → false (not a same-strike roll)", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260620P07100000",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260718P07200000",
    });
    expect(detectRoll(closing, opening)).toBe(false);
  });

  it("DIFFERENT option type, different expiry → false", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260620P07100000",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260718C07100000",
    });
    expect(detectRoll(closing, opening)).toBe(false);
  });

  it("DIFFERENT root, different expiry → false", () => {
    const closing = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPX   260620P07100000",
    });
    const opening = makeAggregatedFill({
      calendarId: "cal-1",
      orderId: "order-R",
      legOccSymbol: "SPXW  260718P07100000",
    });
    expect(detectRoll(closing, opening)).toBe(false);
  });
});

// ─── hashFillIds ──────────────────────────────────────────────────────────────

describe("hashFillIds", () => {
  it("determinism: same ids + same hasher → same hash", () => {
    const ids = ["fill-1", "fill-2", "fill-3"];
    expect(hashFillIds(ids, testHasher)).toBe(hashFillIds(ids, testHasher));
  });

  it("order-independence: ids in different order → same hash", () => {
    const ids1 = ["fill-a", "fill-b", "fill-c"];
    const ids2 = ["fill-c", "fill-a", "fill-b"];
    expect(hashFillIds(ids1, testHasher)).toBe(hashFillIds(ids2, testHasher));
  });

  it("different ids → different hash", () => {
    const hash1 = hashFillIds(["fill-1", "fill-2"], testHasher);
    const hash2 = hashFillIds(["fill-1", "fill-3"], testHasher);
    expect(hash1).not.toBe(hash2);
  });

  it("delegates the joined canonical string to the injected hasher", () => {
    let seen = "";
    const spy = (input: string): string => {
      seen = input;
      return "x".repeat(64);
    };
    const out = hashFillIds(["b", "a", "c"], spy);
    expect(seen).toBe("a:b:c"); // sorted, ':'-joined reference algorithm
    expect(out).toHaveLength(64);
  });

  it("(fast-check) determinism: always same result for same sorted input", () => {
    fc.assert(
      fc.property(fc.array(fc.uuid(), { minLength: 1, maxLength: 20 }), (ids) => {
        return hashFillIds(ids, testHasher) === hashFillIds(ids, testHasher);
      }),
    );
  });
});

// ─── resolveFillMatches (journal-pnl-opennetdebit-units round 5, bug 1) ────────
//
// A leg symbol shared by two DIFFERENT calendars (e.g. the same front-month contract used
// by two calendar spreads opened at different times) makes readCalendarLegs return 2+
// candidates for that occSymbol — every fill on that symbol, for EITHER calendar. The old
// behavior orphan-parked all of them (never guess). This resolves the ambiguity using the
// fill's own broker order as the disambiguating signal: a calendar's OPENING/CLOSING order
// contains BOTH its legs together, so an unambiguous ("anchor") leg in the SAME order tells
// us which calendar every fill in that order belongs to.

describe("resolveFillMatches", () => {
  const CAL_A = "cal-A";
  const CAL_B = "cal-B";
  const SHARED = "SPXW  260618P07275000"; // shared front leg
  const BACK_A = "SPXW  260623P07275000"; // unique to CAL_A
  const BACK_B = "SPXW  260717P07275000"; // unique to CAL_B

  it("single candidate → matched", () => {
    const fill = makeRawFill({ id: "f1", occSymbol: BACK_A, orderId: "order-1" });
    const [resolved] = resolveFillMatches([
      { fill, candidates: [{ calendarId: CAL_A, legOccSymbol: BACK_A }] },
    ]);
    expect(resolved).toEqual({
      kind: "matched",
      fill,
      leg: { calendarId: CAL_A, legOccSymbol: BACK_A },
    });
  });

  it("zero candidates → no-match", () => {
    const fill = makeRawFill({ id: "f1", occSymbol: "SPXW  260101P09999000", orderId: "order-1" });
    const [resolved] = resolveFillMatches([{ fill, candidates: [] }]);
    expect(resolved).toEqual({ kind: "no-match", fill });
  });

  it("ambiguous fill resolved via an anchor leg in the SAME order (round 5 fix)", () => {
    // order-1: CAL_A's back leg (unambiguous, the anchor) + the shared front leg (ambiguous).
    const backFill = makeRawFill({ id: "back-1", occSymbol: BACK_A, orderId: "order-1" });
    const sharedFill = makeRawFill({ id: "shared-1", occSymbol: SHARED, orderId: "order-1" });

    const resolved = resolveFillMatches([
      { fill: backFill, candidates: [{ calendarId: CAL_A, legOccSymbol: BACK_A }] },
      {
        fill: sharedFill,
        candidates: [
          { calendarId: CAL_A, legOccSymbol: SHARED },
          { calendarId: CAL_B, legOccSymbol: SHARED },
        ],
      },
    ]);

    expect(resolved[0]).toEqual({
      kind: "matched",
      fill: backFill,
      leg: { calendarId: CAL_A, legOccSymbol: BACK_A },
    });
    expect(resolved[1]).toEqual({
      kind: "matched",
      fill: sharedFill,
      leg: { calendarId: CAL_A, legOccSymbol: SHARED },
    });
  });

  it("the OTHER calendar's shared-leg fill resolves to CAL_B via ITS OWN order's anchor", () => {
    const backFill = makeRawFill({ id: "back-2", occSymbol: BACK_B, orderId: "order-2" });
    const sharedFill = makeRawFill({ id: "shared-2", occSymbol: SHARED, orderId: "order-2" });

    const resolved = resolveFillMatches([
      { fill: backFill, candidates: [{ calendarId: CAL_B, legOccSymbol: BACK_B }] },
      {
        fill: sharedFill,
        candidates: [
          { calendarId: CAL_A, legOccSymbol: SHARED },
          { calendarId: CAL_B, legOccSymbol: SHARED },
        ],
      },
    ]);

    expect(resolved[1]).toEqual({
      kind: "matched",
      fill: sharedFill,
      leg: { calendarId: CAL_B, legOccSymbol: SHARED },
    });
  });

  it("ambiguous fill with NO anchor in the same order stays ambiguous (never guessed, D-05/WR-01)", () => {
    // The shared leg fill is alone in its order — no sibling leg to disambiguate it.
    const sharedFill = makeRawFill({ id: "shared-3", occSymbol: SHARED, orderId: "order-3" });
    const candidates = [
      { calendarId: CAL_A, legOccSymbol: SHARED },
      { calendarId: CAL_B, legOccSymbol: SHARED },
    ];
    const [resolved] = resolveFillMatches([{ fill: sharedFill, candidates }]);
    expect(resolved).toEqual({ kind: "ambiguous", fill: sharedFill, candidates });
  });

  it("two DIFFERENT anchors in the same order → stays ambiguous (cannot pick one)", () => {
    // Pathological: same order somehow anchors to two distinct calendars. Never guess.
    const anchorA = makeRawFill({ id: "anchor-a", occSymbol: BACK_A, orderId: "order-4" });
    const anchorB = makeRawFill({ id: "anchor-b", occSymbol: BACK_B, orderId: "order-4" });
    const sharedFill = makeRawFill({ id: "shared-4", occSymbol: SHARED, orderId: "order-4" });
    const candidates = [
      { calendarId: CAL_A, legOccSymbol: SHARED },
      { calendarId: CAL_B, legOccSymbol: SHARED },
    ];

    const resolved = resolveFillMatches([
      { fill: anchorA, candidates: [{ calendarId: CAL_A, legOccSymbol: BACK_A }] },
      { fill: anchorB, candidates: [{ calendarId: CAL_B, legOccSymbol: BACK_B }] },
      { fill: sharedFill, candidates },
    ]);

    expect(resolved[2]).toEqual({ kind: "ambiguous", fill: sharedFill, candidates });
  });

  it("preserves input order and count 1:1", () => {
    const f1 = makeRawFill({ id: "f1", occSymbol: BACK_A });
    const f2 = makeRawFill({ id: "f2", occSymbol: "SPXW  209999P09999000" });
    const resolved = resolveFillMatches([
      { fill: f1, candidates: [{ calendarId: CAL_A, legOccSymbol: BACK_A }] },
      { fill: f2, candidates: [] },
    ]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.fill).toBe(f1);
    expect(resolved[1]?.fill).toBe(f2);
  });
});

// ─── isCalendarFullyClosed (journal-pnl-opennetdebit-units round 5, bug 2) ─────

function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt-1",
    calendarId: "cal-1",
    eventType: "OPEN",
    eventedAt: new Date("2026-06-01T14:00:00Z"),
    fillIdsHash: "hash-1",
    legOccSymbol: "SPXW  260618P07275000",
    rolledFromOccSymbol: null,
    qty: 1,
    avgPrice: 50,
    netAmount: 50,
    realizedPnl: null,
    legBreakdown: null,
    entryThesis: null,
    rollOpenDebit: null,
    rollCloseCredit: null,
    ...overrides,
  };
}

describe("isCalendarFullyClosed", () => {
  it("no events → false", () => {
    expect(isCalendarFullyClosed([])).toBe(false);
  });

  it("one OPEN event, no close → false (still open)", () => {
    const events = [makeCalendarEvent({ eventType: "OPEN", legOccSymbol: "front", qty: 1 })];
    expect(isCalendarFullyClosed(events)).toBe(false);
  });

  it("OPEN + CLOSE on the SAME leg, same qty → true (net zero)", () => {
    const events = [
      makeCalendarEvent({ id: "e1", eventType: "OPEN", legOccSymbol: "front", qty: 1 }),
      makeCalendarEvent({ id: "e2", eventType: "CLOSE", legOccSymbol: "front", qty: 1 }),
    ];
    expect(isCalendarFullyClosed(events)).toBe(true);
  });

  it("OPEN qty 2, CLOSE qty 1 on the same leg → false (partially closed)", () => {
    const events = [
      makeCalendarEvent({ id: "e1", eventType: "OPEN", legOccSymbol: "front", qty: 2 }),
      makeCalendarEvent({ id: "e2", eventType: "CLOSE", legOccSymbol: "front", qty: 1 }),
    ];
    expect(isCalendarFullyClosed(events)).toBe(false);
  });

  it("two legs (front+back), only ONE closed → false (65aac62e-shaped: not yet fully unwound)", () => {
    const events = [
      makeCalendarEvent({ id: "e1", eventType: "OPEN", legOccSymbol: "front", qty: 1 }),
      makeCalendarEvent({ id: "e2", eventType: "OPEN", legOccSymbol: "back", qty: 1 }),
      makeCalendarEvent({ id: "e3", eventType: "CLOSE", legOccSymbol: "front", qty: 1 }),
    ];
    expect(isCalendarFullyClosed(events)).toBe(false);
  });

  it("two legs, BOTH closed → true (the real 65aac62e shape: OPEN+OPEN then CLOSE+CLOSE)", () => {
    const events = [
      makeCalendarEvent({ id: "e1", eventType: "OPEN", legOccSymbol: "front", qty: 1 }),
      makeCalendarEvent({ id: "e2", eventType: "OPEN", legOccSymbol: "back", qty: 1 }),
      makeCalendarEvent({ id: "e3", eventType: "CLOSE", legOccSymbol: "front", qty: 1 }),
      makeCalendarEvent({ id: "e4", eventType: "CLOSE", legOccSymbol: "back", qty: 1 }),
    ];
    expect(isCalendarFullyClosed(events)).toBe(true);
  });

  it("ROLL nets the rolled-from leg to zero but the new leg stays open → false", () => {
    const events = [
      makeCalendarEvent({ id: "e1", eventType: "OPEN", legOccSymbol: "old-leg", qty: 1 }),
      makeCalendarEvent({
        id: "e2",
        eventType: "ROLL",
        legOccSymbol: "new-leg",
        rolledFromOccSymbol: "old-leg",
        qty: 1,
      }),
    ];
    expect(isCalendarFullyClosed(events)).toBe(false);
  });

  it("ROLL then a final CLOSE on the new leg → true (fully unwound)", () => {
    const events = [
      makeCalendarEvent({ id: "e1", eventType: "OPEN", legOccSymbol: "old-leg", qty: 1 }),
      makeCalendarEvent({
        id: "e2",
        eventType: "ROLL",
        legOccSymbol: "new-leg",
        rolledFromOccSymbol: "old-leg",
        qty: 1,
      }),
      makeCalendarEvent({ id: "e3", eventType: "CLOSE", legOccSymbol: "new-leg", qty: 1 }),
    ];
    expect(isCalendarFullyClosed(events)).toBe(true);
  });
});

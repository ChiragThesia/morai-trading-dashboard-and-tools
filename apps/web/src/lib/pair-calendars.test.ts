import { describe, it, expect } from "vitest";
import { assertDefined } from "@morai/shared";
import { pairPositionsIntoCalendars, bookUnrealizedPnl } from "./pair-calendars.ts";
import type { BrokerPositionResponse } from "@morai/contracts";

/**
 * Calendar pairing: the broker returns single option legs. A calendar spread is two legs at the
 * same root + strike + type with different expiries (short front / long back). The Positions view
 * must show ONE calendar per pair, not 6 loose legs.
 */

function leg(p: Partial<BrokerPositionResponse> & { occSymbol: string; putCall: "C" | "P" }): BrokerPositionResponse {
  return {
    occSymbol: p.occSymbol,
    putCall: p.putCall,
    longQty: p.longQty ?? 0,
    shortQty: p.shortQty ?? 0,
    averagePrice: p.averagePrice ?? null,
    marketValue: p.marketValue ?? null,
    underlyingSymbol: p.underlyingSymbol ?? "$SPX",
  };
}

// SPXW 7425 P calendar: short Aug-07 front, long Aug-31 back
const FRONT = leg({ occSymbol: "SPXW  260807P07425000", putCall: "P", shortQty: 1, averagePrice: 127.0478, marketValue: -17875 });
const BACK = leg({ occSymbol: "SPXW  260831P07425000", putCall: "P", longQty: 1, averagePrice: 159.4222, marketValue: 20975 });
const NOW = new Date("2026-06-28T00:00:00Z");

describe("pairPositionsIntoCalendars", () => {
  it("pairs two same-strike/type legs into one calendar (front=nearer expiry, back=farther)", () => {
    const out = pairPositionsIntoCalendars([BACK, FRONT], NOW); // order-independent
    expect(out.calendars).toHaveLength(1);
    expect(out.singles).toHaveLength(0);
    const cal = out.calendars[0];
    assertDefined(cal, "calendar present");
    expect(cal.strike).toBe(7425);
    expect(cal.optionType).toBe("P");
    expect(cal.front.occSymbol).toBe(FRONT.occSymbol); // Aug-07 is the front
    expect(cal.back.occSymbol).toBe(BACK.occSymbol); // Aug-31 is the back
    expect(cal.dteFront).toBeLessThan(cal.dteBack);
  });

  it("nets unrealized P&L across both legs", () => {
    const out = pairPositionsIntoCalendars([FRONT, BACK], NOW);
    const cal = out.calendars[0];
    assertDefined(cal, "calendar present");
    // unreal per leg = marketValue − averagePrice·(longQty−shortQty)·100
    const frontUnreal = -17875 - 127.0478 * (0 - 1) * 100; // = -17875 + 12704.78
    const backUnreal = 20975 - 159.4222 * (1 - 0) * 100; // = 20975 - 15942.22
    expect(cal.netUnreal).toBeCloseTo(frontUnreal + backUnreal, 2);
  });

  it("groups multiple distinct calendars and keeps an unpaired leg as a single", () => {
    const nov7200Front = leg({ occSymbol: "SPX   261120P07200000", putCall: "P", shortQty: 1, averagePrice: 204.0971, marketValue: -22105 });
    const nov7200Back = leg({ occSymbol: "SPXW  261130P07200000", putCall: "P", longQty: 1, averagePrice: 211.3222, marketValue: 22840 });
    const orphan = leg({ occSymbol: "SPXW  260910C06000000", putCall: "C", longQty: 1, averagePrice: 10, marketValue: 1100 });

    const out = pairPositionsIntoCalendars([FRONT, BACK, nov7200Front, nov7200Back, orphan], NOW);
    expect(out.calendars).toHaveLength(2); // 7425P Aug + 7200P Nov
    expect(out.singles).toHaveLength(1);
    const single = out.singles[0];
    assertDefined(single, "single present");
    expect(single.occSymbol).toBe(orphan.occSymbol);
  });
});

describe("bookUnrealizedPnl", () => {
  // Regression: the header strip summed marketValue·(longQty−shortQty), which flips
  // every short leg's sign and totals NOTIONAL magnitude (~+$38.9k for these two legs),
  // not P&L. Correct book P&L = Σ legUnreal ≈ −$137 (the near-flat calendar).
  it("sums unrealized P&L across legs (NOT notional magnitude)", () => {
    const frontUnreal = -17875 - 127.0478 * (0 - 1) * 100; // short leg
    const backUnreal = 20975 - 159.4222 * (1 - 0) * 100; // long leg
    const expected = frontUnreal + backUnreal; // ≈ −137.44

    expect(bookUnrealizedPnl([FRONT, BACK])).toBeCloseTo(expected, 2);
    // Guard against the old bug: marketValue·netQty would give +38850.
    expect(bookUnrealizedPnl([FRONT, BACK])).not.toBeCloseTo(38850, 0);
  });

  it("skips legs missing marks", () => {
    const noMarks = leg({ occSymbol: "SPXW  260910C06000000", putCall: "C", longQty: 1, averagePrice: null, marketValue: null });
    expect(bookUnrealizedPnl([noMarks])).toBe(0);
  });
});

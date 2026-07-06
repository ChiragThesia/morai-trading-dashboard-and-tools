/**
 * position-pairing.test.ts — RED: pairPositionsIntoCalendarCandidates groups the 5 real
 * open Schwab positions (register-open-calendars oracle) into calendar spreads.
 *
 * Mirrors apps/web/src/lib/pair-calendars.ts's grouping algorithm (same underlying+strike+type
 * keying, front/back split by expiry) but operates on the minimal PositionLeg domain shape so
 * packages/core stays free of the @morai/contracts dependency (architecture-boundaries §2).
 */
import { describe, it, expect } from "vitest";
import { pairPositionsIntoCalendarCandidates } from "./position-pairing.ts";
import type { PositionLeg } from "./position-pairing.ts";

function leg(overrides: Partial<PositionLeg> & { occSymbol: string }): PositionLeg {
  return {
    underlyingSymbol: "$SPX",
    longQty: 0,
    shortQty: 0,
    averagePrice: null,
    ...overrides,
  };
}

describe("pairPositionsIntoCalendarCandidates", () => {
  it("pairs the 5 real open calendars from the live position book (register-open-calendars oracle)", () => {
    const positions: PositionLeg[] = [
      // 7400P: front 260804P07400000 (avg 95.3278) / back 260831P07400000 (avg 138.7022)
      leg({ occSymbol: "SPX   260804P07400000", shortQty: 1, averagePrice: 95.3278 }),
      leg({ occSymbol: "SPX   260831P07400000", longQty: 1, averagePrice: 138.7022 }),
      // 7650C: front 260731C07650000 (avg 38.5478) / back 260803C07650000 (avg 41.7722)
      leg({ occSymbol: "SPX   260731C07650000", shortQty: 1, averagePrice: 38.5478 }),
      leg({ occSymbol: "SPX   260803C07650000", longQty: 1, averagePrice: 41.7722 }),
      // 7350P: front 260731P07350000 (avg 71.3878) / back 260803P07350000 (avg 74.5122)
      leg({ occSymbol: "SPX   260731P07350000", shortQty: 1, averagePrice: 71.3878 }),
      leg({ occSymbol: "SPX   260803P07350000", longQty: 1, averagePrice: 74.5122 }),
      // 7200P: front SPX-rooted standard 261120P07200000 (avg 204.0971) /
      //        back SPXW-rooted weekly 261130P07200000 (avg 211.3222) — mixed root
      leg({ occSymbol: "SPX   261120P07200000", shortQty: 1, averagePrice: 204.0971 }),
      leg({ occSymbol: "SPXW  261130P07200000", longQty: 1, averagePrice: 211.3222 }),
      // 7600P: front SPX-rooted standard 261120P07600000 (avg 335.0471) /
      //        back SPXW-rooted weekly 261130P07600000 (avg 341.4222) — mixed root
      leg({ occSymbol: "SPX   261120P07600000", shortQty: 1, averagePrice: 335.0471 }),
      leg({ occSymbol: "SPXW  261130P07600000", longQty: 1, averagePrice: 341.4222 }),
    ];

    const candidates = pairPositionsIntoCalendarCandidates(positions);

    expect(candidates).toHaveLength(5);

    const byStrike = new Map(candidates.map((c) => [c.strike, c]));

    const c7400 = byStrike.get(7400);
    expect(c7400?.optionType).toBe("P");
    expect(c7400?.frontExpiry).toBe("2026-08-04");
    expect(c7400?.backExpiry).toBe("2026-08-31");
    expect(c7400?.front.averagePrice).toBeCloseTo(95.3278, 4);
    expect(c7400?.back.averagePrice).toBeCloseTo(138.7022, 4);

    const c7650 = byStrike.get(7650);
    expect(c7650?.optionType).toBe("C");
    expect(c7650?.frontExpiry).toBe("2026-07-31");
    expect(c7650?.backExpiry).toBe("2026-08-03");

    const c7350 = byStrike.get(7350);
    expect(c7350?.optionType).toBe("P");
    expect(c7350?.frontExpiry).toBe("2026-07-31");
    expect(c7350?.backExpiry).toBe("2026-08-03");

    // Mixed SPX/SPXW root case — pairing still succeeds (keyed on underlyingSymbol, not root),
    // and the front leg's actual root is preserved for the caller to use.
    const c7200 = byStrike.get(7200);
    expect(c7200?.optionType).toBe("P");
    expect(c7200?.frontExpiry).toBe("2026-11-20");
    expect(c7200?.backExpiry).toBe("2026-11-30");
    expect(c7200?.frontRoot).toBe("SPX");

    const c7600 = byStrike.get(7600);
    expect(c7600?.optionType).toBe("P");
    expect(c7600?.frontExpiry).toBe("2026-11-20");
    expect(c7600?.backExpiry).toBe("2026-11-30");
    expect(c7600?.frontRoot).toBe("SPX");
  });

  it("drops an odd leg out — a single unpaired leg is not a calendar", () => {
    const positions: PositionLeg[] = [
      leg({ occSymbol: "SPX   260804P07400000", shortQty: 1, averagePrice: 95 }),
    ];
    expect(pairPositionsIntoCalendarCandidates(positions)).toHaveLength(0);
  });

  it("skips unparseable OCC symbols", () => {
    const positions: PositionLeg[] = [
      leg({ occSymbol: "not-a-valid-occ-symbol", shortQty: 1, averagePrice: 1 }),
      leg({ occSymbol: "SPX   260804P07400000", shortQty: 1, averagePrice: 95 }),
    ];
    expect(pairPositionsIntoCalendarCandidates(positions)).toHaveLength(0);
  });

  it("groups by underlyingSymbol + strike + type, not by OCC root — a differing underlyingSymbol never pairs", () => {
    const positions: PositionLeg[] = [
      leg({ occSymbol: "SPX   260804P07400000", underlyingSymbol: "$SPX", averagePrice: 1 }),
      leg({ occSymbol: "SPX   260831P07400000", underlyingSymbol: "OTHER", averagePrice: 1 }),
    ];
    expect(pairPositionsIntoCalendarCandidates(positions)).toHaveLength(0);
  });

  it("returns empty for an empty position book", () => {
    expect(pairPositionsIntoCalendarCandidates([])).toHaveLength(0);
  });
});

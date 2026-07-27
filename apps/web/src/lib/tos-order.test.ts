/**
 * tos-order.test.ts — TDD RED→GREEN for the candidate → TOS order-string builder (copy-out).
 *
 * Produces a Thinkorswim calendar order line the user can paste into TOS, e.g.
 *   BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC
 * Back (longer-dated) leg first, then the front; strike + type; @debit-in-points; the [AM]
 * settlement tag is attached only when that expiry is a standard monthly (3rd Friday).
 */
import { describe, it, expect } from "vitest";
import type { PickerCandidate } from "@morai/contracts";
import { buildTosCalendarOrder, buildTosPairOrder } from "./tos-order.ts";
import { parseTosOrder } from "./tos-parser.ts";

function candidate(overrides: {
  strike: number;
  putCall: "P" | "C";
  frontDte: number;
  backDte: number;
  debit: number;
}): PickerCandidate {
  const leg = (dte: number): PickerCandidate["frontLeg"] => ({
    strike: overrides.strike,
    putCall: overrides.putCall,
    dte,
    iv: 0.15,
  });
  return {
    id: "x",
    name: "test",
    score: 40,
    breakdown: [],
    context: [],
    bucket: "standard",
    debit: overrides.debit,
    theta: 40,
    vega: 300,
    delta: 1,
    gamma: null,
    fwdIv: 0.15,
    fwdIvGuard: "ok",
    slope: 0.1,
    fwdEdge: -0.02,
    expectedMove: 200,
    frontEvents: [],
    backEvents: [],
    frontLeg: leg(overrides.frontDte),
    backLeg: leg(overrides.backDte),
    exitPlan: {
      profitTargetPct: 0.25,
      stopPct: 0.175,
      manageShortDte: 21,
      closeByExpiry: "2026-08-14",
      thetaCapturePct: null,
    },
  };
}

describe("buildTosCalendarOrder", () => {
  it("reproduces the target TOS format with an [AM] tag on the 3rd-Friday back leg", () => {
    // asOf 2026-07-02: +43d = 14 Aug (weekly, no tag), +78d = 18 Sep 2026 (3rd Friday → [AM]).
    const order = buildTosCalendarOrder(
      candidate({ strike: 7425, putCall: "P", frontDte: 43, backDte: 78, debit: 4875 }),
      "2026-07-02",
    );
    expect(order).toBe("BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC");
  });

  it("emits debit in points (debit/100, 2dp) and no [AM] tag when neither leg is a 3rd Friday", () => {
    // Top fixture candidate: 7500P, front +21d = 23 Jul (Thu), back +43d = 14 Aug (2nd Fri).
    const order = buildTosCalendarOrder(
      candidate({ strike: 7500, putCall: "P", frontDte: 21, backDte: 43, debit: 4628 }),
      "2026-07-02",
    );
    expect(order).toBe("BUY +1 CALENDAR SPX 100 14 AUG 26/23 JUL 26 7500 PUT @46.28 LMT GTC");
  });

  it("renders CALL for a call calendar", () => {
    const order = buildTosCalendarOrder(
      candidate({ strike: 7500, putCall: "C", frontDte: 21, backDte: 43, debit: 4628 }),
      "2026-07-02",
    );
    expect(order).toContain("7500 CALL");
  });
});

// ─── buildTosPairOrder — the Analyzer's picked front/back legs ─────────────────

describe("buildTosPairOrder — a TOS order line for two legs picked off the chain", () => {
  const PAIR = {
    strike: 7_425_000,
    contractType: "P",
    root: "SPX",
    frontExpiry: "2026-08-14",
    backExpiry: "2026-09-18",
    debit: 48.75,
  } as const;

  it("lists the BACK expiry first, then the front — the long-calendar convention", () => {
    expect(buildTosPairOrder(PAIR)).toBe(
      "BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC",
    );
  });

  // CAUGHT IN LIVE UAT. `formatTosDate` tags [AM] on any third Friday, because the older
  // candidate builder had no root to consult and "third Friday" was the only available proxy for
  // "the AM-settled monthly". It is the WRONG proxy once the root is known: SPXW is PM-settled on
  // every date it lists, including third Fridays. A real SPXW 7400P Aug-21/Sep-18 calendar came
  // out tagged `[AM]` on BOTH legs, which selects the wrong contract in Thinkorswim.
  it("never tags an SPXW leg [AM] — SPXW is PM-settled even on a third Friday", () => {
    const spxw = buildTosPairOrder({
      ...PAIR,
      root: "SPXW",
      frontExpiry: "2026-08-21",
      backExpiry: "2026-09-18",
    });
    expect(spxw).not.toContain("[AM]");
    expect(spxw).toBe("BUY +1 CALENDAR SPX 100 18 SEP 26/21 AUG 26 7425 PUT @48.75 LMT GTC");
  });

  it("tags an SPX third-Friday leg [AM] on BOTH legs when both are monthlies", () => {
    const spx = buildTosPairOrder({
      ...PAIR,
      root: "SPX",
      frontExpiry: "2026-08-21",
      backExpiry: "2026-09-18",
    });
    expect(spx).toBe(
      "BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/21 AUG 26 [AM] 7425 PUT @48.75 LMT GTC",
    );
  });

  it("does not tag an SPX leg that is not a third Friday", () => {
    // SPX lists non-monthly dates too; only the third-Friday monthly settles AM.
    expect(buildTosPairOrder({ ...PAIR, root: "SPX", frontExpiry: "2026-08-14" })).toContain(
      "/14 AUG 26 7425",
    );
  });

  it("divides the ×1000 strike down and keeps half-point strikes exact", () => {
    expect(buildTosPairOrder({ ...PAIR, strike: 7_412_500 })).toContain("7412.5 PUT");
  });

  it("renders CALL for a call pair", () => {
    expect(buildTosPairOrder({ ...PAIR, contractType: "C" })).toContain("7425 CALL");
  });

  it("takes the debit in index points as given — never a /100 dollar conversion", () => {
    // chain-math's calendarDebit already returns index points, unlike PickerCandidate.debit
    // (dollars). Dividing again would understate a $4875 calendar as @0.49.
    expect(buildTosPairOrder({ ...PAIR, debit: 4.5 })).toContain("@4.50 ");
  });

  it("omits the price when there is no fillable debit, leaving a MKT-shaped line", () => {
    expect(buildTosPairOrder({ ...PAIR, debit: null })).toBe(
      "BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT LMT GTC",
    );
  });

  // The load-bearing check: the string this builds must survive the parser the paste box
  // feeds. A builder that emits a line parseTosOrder rejects is worse than no button.
  it("round-trips through parseTosOrder — same strike, wing, and both expiries", () => {
    const order = buildTosPairOrder(PAIR);
    const parsed = parseTosOrder(order, new Date(Date.UTC(2026, 6, 27)), 7411.98, 0.045);
    expect(parsed).not.toBeNull();
    expect(parsed?.strike).toBe(7425);
    expect(parsed?.type).toBe("P");
    expect(parsed?.frontExpiry).toBe("2026-08-14");
    expect(parsed?.backExpiry).toBe("2026-09-18");
    expect(parsed?.debit).toBeCloseTo(48.75, 10);
  });
});

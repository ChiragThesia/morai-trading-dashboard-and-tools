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
import { buildTosCalendarOrder } from "./tos-order.ts";

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
    debit: overrides.debit,
    theta: 40,
    vega: 300,
    delta: 1,
    fwdIv: 0.15,
    fwdIvGuard: "ok",
    slope: 0.1,
    fwdEdge: -0.02,
    expectedMove: 200,
    frontEvents: [],
    backEvents: [],
    frontLeg: leg(overrides.frontDte),
    backLeg: leg(overrides.backDte),
    exitPlan: { profitTargetPct: 0.25, stopPct: 0.175, manageShortDte: 21, closeByExpiry: "2026-08-14" },
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

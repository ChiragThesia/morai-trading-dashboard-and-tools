/**
 * pair.test.ts — the ungated calendar arithmetic for two picked legs.
 *
 * These are the four formulas the browser still owns (`apps/web/src/lib/chain-math.ts`:
 * `hSkew`, `edge`, `netCalendarGreeks`, `calendarDebit`). The tests below pin the core side's
 * behaviour; the differential test at
 * `apps/server/src/adapters/chain-surface-differential.test.ts` pins that the two agree.
 */

import { describe, it, expect } from "vitest";
import { pairMetrics } from "./pair.ts";
import type { PairLeg } from "./pair.ts";
import type { CohortLeg } from "./types.ts";

function leg(over: Partial<CohortLeg> = {}): CohortLeg {
  return {
    strike: 7400,
    iv: 0.162,
    bid: 60,
    ask: 62,
    mid: 61,
    openInterest: 39,
    extrinsic: 61,
    delta: -0.5,
    gamma: 0.0004,
    theta: -2.9,
    vega: 5.1,
    tradeable: true,
    ...over,
  };
}

const FRONT_T = 15.27 / 365.25;
const BACK_T = 45.27 / 365.25;

function pair(frontOver: Partial<CohortLeg> = {}, backOver: Partial<CohortLeg> = {}): {
  front: PairLeg;
  back: PairLeg;
} {
  return {
    front: { t: FRONT_T, leg: leg(frontOver) },
    back: { t: BACK_T, leg: leg(backOver) },
  };
}

describe("pairMetrics — horizontal skew", () => {
  it("is frontIv − backIv, positive when the front is the rich one", () => {
    const { front, back } = pair({ iv: 0.18 }, { iv: 0.16 });
    expect(pairMetrics(front, back).hSkew).toBeCloseTo(0.02, 12);
  });
});

describe("pairMetrics — forward vol and the edge over it", () => {
  it("edge is frontIv − fwdIv, measured on the SETTLEMENT clock", () => {
    const { front, back } = pair({ iv: 0.20 }, { iv: 0.17 });
    const m = pairMetrics(front, back);
    // The forward-variance identity, written out: sqrt((tb·σb² − tf·σf²) / (tb − tf)).
    const expected = Math.sqrt(
      (BACK_T * 0.17 * 0.17 - FRONT_T * 0.2 * 0.2) / (BACK_T - FRONT_T),
    );
    expect(m.fwdIv).not.toBeNull();
    expect(m.fwdIv ?? 0).toBeCloseTo(expected, 12);
    expect(m.edge ?? 0).toBeCloseTo(0.2 - expected, 12);
  });

  it("returns NULL, never 0, when the structure is inverted", () => {
    // A negative radicand prices no forward vol, so there is no edge to quote. Substituting 0
    // here would render as "this calendar is fairly priced" — a fabricated reading the reader
    // cannot distinguish from a measured one. (The incumbent picker's scorer does exactly that
    // at scoring.ts:139; neither this module nor the browser copy ever has.)
    const { front, back } = pair({ iv: 0.40 }, { iv: 0.10 });
    const m = pairMetrics(front, back);
    expect(m.fwdIv).toBeNull();
    expect(m.edge).toBeNull();
  });

  it("returns null when the back leg is not strictly later — the identity divides by tb − tf", () => {
    for (const backT of [FRONT_T, FRONT_T - 0.001]) {
      const m = pairMetrics(
        { t: FRONT_T, leg: leg({ iv: 0.18 }) },
        { t: backT, leg: leg({ iv: 0.16 }) },
      );
      expect(m.fwdIv).toBeNull();
      expect(m.edge).toBeNull();
    }
  });

  it("still measures hSkew, net and debit on a pair whose forward vol has no solution", () => {
    // A degraded input nulls its OWN field and nothing else.
    const { front, back } = pair({ iv: 0.40 }, { iv: 0.10 });
    const m = pairMetrics(front, back);
    expect(m.hSkew).toBeCloseTo(0.3, 12);
    expect(m.debit).not.toBeNull();
  });
});

describe("pairMetrics — net greeks", () => {
  it("is back MINUS front: long the back, short the front", () => {
    const { front, back } = pair(
      { delta: -0.5, gamma: 0.0006, theta: -2.9, vega: 5.1 },
      { delta: -0.48, gamma: 0.0004, theta: -1.8, vega: 9.4 },
    );
    const net = pairMetrics(front, back).net;
    expect(net.delta).toBeCloseTo(0.02, 12);
    expect(net.gamma).toBeCloseTo(-0.0002, 12);
    expect(net.theta).toBeCloseTo(1.1, 12);
    expect(net.vega).toBeCloseTo(4.3, 12);
    // The sign convention IS the trade: a calendar is net-short gamma and net-long vega.
    expect(net.gamma).toBeLessThan(0);
    expect(net.vega).toBeGreaterThan(0);
  });

  it("is UNSCALED — index points per contract, never ×100 dollars", () => {
    // The retired picker engine multiplied its net greeks by 100 into dollars and labelled them
    // the same as the browser's unscaled ones (candidate-selection.ts:433-445), which put two
    // unit spaces on one screen. This engine's numbers are the browser's numbers.
    const { front, back } = pair({ vega: 5 }, { vega: 9 });
    expect(pairMetrics(front, back).net.vega).toBe(4);
  });
});

describe("pairMetrics — the entry debit at the fill haircut", () => {
  it("buys the back and sells the front, crossing 0.66 of each width", () => {
    const { front, back } = pair({ bid: 60, ask: 62 }, { bid: 100, ask: 104 });
    // buy back at 100 + 0.66·4 = 102.64; sell front at 62 − 0.66·2 = 60.68.
    expect(pairMetrics(front, back).debit ?? 0).toBeCloseTo(102.64 - 60.68, 10);
  });

  it("is dearer than the mid-to-mid debit — ranking on mid overstates every edge", () => {
    const { front, back } = pair({ bid: 60, ask: 62 }, { bid: 100, ask: 104 });
    expect(pairMetrics(front, back).debit ?? 0).toBeGreaterThan(102 - 61);
  });

  it("is null when a leg has no offer or its market is crossed", () => {
    for (const bad of [{ bid: 0, ask: 0 }, { bid: 5, ask: 4 }]) {
      expect(pairMetrics(pair(bad).front, pair().back).debit).toBeNull();
      expect(pairMetrics(pair().front, pair(undefined, bad).back).debit).toBeNull();
    }
  });
});

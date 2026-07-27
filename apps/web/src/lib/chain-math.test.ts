/**
 * chain-math.test.ts — the Analyzer chain table's per-row arithmetic.
 *
 * These are DATA functions, not scoring functions: every one of them either
 * returns a number the user can check by hand or returns `null`. Nothing here
 * ranks, weights, or judges a calendar — that is the whole point of the rework.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmGreeks } from "@morai/quant";
import {
  mid,
  hSkew,
  vSkewVsAtm,
  forwardIv,
  edge,
  calendarDebit,
  legGreeks,
  netGreeks,
  buildCalendarRow,
  DEFAULT_RATE,
  DEFAULT_DIV,
} from "./chain-math.ts";
import type { ChainRow } from "./chain-contract.ts";

function row(over: Partial<ChainRow>): ChainRow {
  return {
    strike: 6400_000,
    expiration: "2026-08-21",
    contractType: "P",
    dte: 30,
    bsmIv: 0.14,
    bid: 40,
    ask: 42,
    openInterest: 1200,
    underlyingPrice: 6500,
    source: "schwab",
    observedAt: "2026-07-26T18:00:00.000Z",
    ...over,
  };
}

describe("mid", () => {
  it("averages bid and ask", () => {
    expect(mid(40, 42)).toBe(41);
  });
});

describe("hSkew — horizontal (calendar) skew", () => {
  it("is back IV minus front IV", () => {
    expect(hSkew(0.14, 0.16)).toBeCloseTo(0.02, 12);
  });

  it("is negative when the term structure is inverted", () => {
    expect(hSkew(0.2, 0.16)).toBeCloseTo(-0.04, 12);
  });

  it("is null when either leg has no IV — never 0", () => {
    expect(hSkew(null, 0.16)).toBeNull();
    expect(hSkew(0.14, null)).toBeNull();
  });
});

describe("vSkewVsAtm — vertical skew against the same expiry's ATM", () => {
  it("is this strike's IV minus the ATM IV", () => {
    expect(vSkewVsAtm(0.18, 0.14)).toBeCloseTo(0.04, 12);
  });

  it("is null when either IV is missing", () => {
    expect(vSkewVsAtm(null, 0.14)).toBeNull();
    expect(vSkewVsAtm(0.18, null)).toBeNull();
  });
});

describe("forwardIv — the vol the market prices between the two expiries", () => {
  it("matches the forward-variance identity", () => {
    // sqrt((60·0.16² − 30·0.14²) / 30)
    const expected = Math.sqrt((60 * 0.16 * 0.16 - 30 * 0.14 * 0.14) / 30);
    expect(forwardIv(30, 0.14, 60, 0.16)).toBeCloseTo(expected, 12);
  });

  it("is null (not NaN) when the structure is inverted enough to go negative", () => {
    expect(forwardIv(30, 0.9, 31, 0.1)).toBeNull();
  });

  it("is null when the two legs share a DTE (no forward period)", () => {
    expect(forwardIv(30, 0.14, 30, 0.16)).toBeNull();
  });

  it("is null when either IV is missing", () => {
    expect(forwardIv(30, null, 60, 0.16)).toBeNull();
  });

  it("never returns NaN for any well-ordered pair (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 200 }),
        fc.double({ min: 0.01, max: 2, noNaN: true }),
        fc.double({ min: 0.01, max: 2, noNaN: true }),
        (tf, gap, ivf, ivb) => {
          const out = forwardIv(tf, ivf, tf + gap, ivb);
          expect(out === null || Number.isFinite(out)).toBe(true);
        },
      ),
    );
  });
});

describe("edge — front IV minus the implied forward IV", () => {
  it("is positive when the front is rich against the forward", () => {
    const fwd = forwardIv(30, 0.2, 60, 0.18);
    expect(fwd).not.toBeNull();
    if (fwd === null) return;
    expect(edge(30, 0.2, 60, 0.18)).toBeCloseTo(0.2 - fwd, 12);
  });

  it("is null when the forward is undefined — never a fabricated 0", () => {
    expect(edge(30, 0.9, 31, 0.1)).toBeNull();
  });
});

describe("calendarDebit", () => {
  it("is the back mid minus the front mid", () => {
    expect(calendarDebit(41, 68)).toBeCloseTo(27, 12);
  });
});

describe("legGreeks", () => {
  it("prices one leg through @morai/quant with the strike un-scaled", () => {
    const got = legGreeks(row({ strike: 6400_000, dte: 30, bsmIv: 0.14 }));
    const want = bsmGreeks(6500, 6400, 30 / 365, 0.14, DEFAULT_RATE, DEFAULT_DIV, "P");
    expect(got).not.toBeNull();
    expect(got?.delta).toBeCloseTo(want.delta, 12);
    expect(got?.theta).toBeCloseTo(want.theta, 12);
    expect(got?.vega).toBeCloseTo(want.vega, 12);
    expect(got?.gamma).toBeCloseTo(want.gamma, 12);
  });

  it("is null when the leg has no IV", () => {
    expect(legGreeks(row({ bsmIv: null }))).toBeNull();
  });

  it("is null at expiry (T = 0) instead of dividing by zero", () => {
    expect(legGreeks(row({ dte: 0 }))).toBeNull();
  });
});

describe("netGreeks — short front, long back", () => {
  it("subtracts the front leg from the back leg", () => {
    const front = { delta: -0.3, gamma: 0.001, theta: -5, vega: 4 };
    const back = { delta: -0.4, gamma: 0.0008, theta: -3, vega: 9 };
    expect(netGreeks(front, back)).toEqual({
      delta: -0.4 - -0.3,
      gamma: 0.0008 - 0.001,
      theta: -3 - -5,
      vega: 9 - 4,
    });
  });

  it("is null when either leg is unpriced", () => {
    expect(netGreeks(null, { delta: 1, gamma: 1, theta: 1, vega: 1 })).toBeNull();
    expect(netGreeks({ delta: 1, gamma: 1, theta: 1, vega: 1 }, null)).toBeNull();
  });
});

describe("buildCalendarRow — one joined table row", () => {
  const front = row({ expiration: "2026-08-21", dte: 26, bsmIv: 0.15, bid: 40, ask: 42 });
  const back = row({ expiration: "2026-09-18", dte: 54, bsmIv: 0.17, bid: 66, ask: 70 });

  it("carries the display strike (÷1000) and both legs", () => {
    const built = buildCalendarRow(front, back, 0.14, 0.16);
    expect(built.strike).toBe(6400);
    expect(built.front.dte).toBe(26);
    expect(built.back.dte).toBe(54);
  });

  it("computes hSkew, both vSkews, edge and debit from the two legs", () => {
    const built = buildCalendarRow(front, back, 0.14, 0.16);
    expect(built.hSkew).toBeCloseTo(0.02, 12);
    expect(built.frontVSkew).toBeCloseTo(0.01, 12);
    expect(built.backVSkew).toBeCloseTo(0.01, 12);
    expect(built.debit).toBeCloseTo(68 - 41, 12);
    expect(built.edge).toBeCloseTo(0.15 - (forwardIv(26, 0.15, 54, 0.17) ?? 0), 12);
  });

  it("keeps every derived number null when the front leg has no IV", () => {
    const built = buildCalendarRow(row({ bsmIv: null, dte: 26 }), back, 0.14, 0.16);
    expect(built.hSkew).toBeNull();
    expect(built.edge).toBeNull();
    expect(built.frontVSkew).toBeNull();
    expect(built.net).toBeNull();
    // The debit is quote-derived, so it survives a missing IV.
    expect(built.debit).toBeCloseTo(68 - 41, 12);
  });
});

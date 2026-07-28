/**
 * calendar-rank.test.ts — the calendar-engine wire contract (spec.mdx §11).
 *
 * The nullability tests are the point. `ffStrike`, `thetaCarry`, `vSkewFront`, `vSkewBack`,
 * `realizedVol` and every breakdown term's `raw`/`percentile` are genuinely `number | null` in
 * the engine — null-honesty is the whole posture of `domain/candidate.ts`. A schema that made
 * any of them required would parse fine against a hand-written fixture and throw on the first
 * real snapshot.
 */

import { describe, it, expect } from "vitest";
import { rankedCalendar, rankedCalendarResponse, rankCalendarsQuery } from "./calendar-rank.ts";

const LEG = {
  strike: 7400,
  iv: 0.1712,
  bid: 61.2,
  ask: 62.4,
  mid: 61.8,
  openInterest: 39,
  extrinsic: 61.8,
  delta: -0.48,
  gamma: 0.00042,
  theta: -1.84,
  vega: 6.12,
  tradeable: true,
};

const TERM = { raw: 0.0771, percentile: 96.4, weight: 45, contribution: 43.38 };

const ROW = {
  root: "SPXW",
  strike: 7400,
  frontExpiration: "2026-08-21",
  backExpiration: "2026-09-18",
  frontDte: 25,
  backDte: 53,
  gapDays: 28,
  score: 91.2,
  breakdown: { fwdEdge: TERM, deltaBalance: TERM },
  fwdIv: 0.1589,
  cushion: 0.0021,
  ffAtm: 0.0771,
  slope: 0.0184,
  frontRefIv: 0.1712,
  backRefIv: 0.161,
  ffStrike: 0.0684,
  hSkew: 0.0102,
  vSkewFront: 0.0008,
  vSkewBack: -0.0004,
  frontIv: 0.1712,
  backIv: 0.161,
  net: { delta: 0.021, gamma: -0.00018, theta: 1.12, vega: 8.4 },
  thetaCarry: 0.0074,
  debit: 21.4,
  spreadCost: 2.4,
  frontLeg: LEG,
  backLeg: LEG,
};

const DROPS = {
  "front-dte-floor": 12,
  "front-dte-ceiling": 3,
  "back-dte-ceiling": 1,
  "gap-floor": 44,
  "root-mismatch": 8,
  "not-tradeable": 91,
  "no-iv-legs": 994,
  "term-inverted": 6,
  "no-atm-reference": 2,
};

const BODY = {
  asOf: "2026-07-27T16:00:00.000Z",
  spot: 7401.89,
  candidates: [ROW],
  totalCandidates: 2454,
  expiryPairs: 124,
  drops: DROPS,
  realizedVol: 0.1128,
  frontDteMax: 60,
};

describe("rankedCalendar", () => {
  it("parses a fully-measured row", () => {
    const parsed = rankedCalendar.parse(ROW);
    expect(parsed.root).toBe("SPXW");
    expect(parsed.strike).toBe(7400);
    expect(parsed.breakdown.fwdEdge.contribution).toBeCloseTo(43.38, 6);
  });

  it("accepts null in every genuinely-nullable measurement", () => {
    const parsed = rankedCalendar.parse({
      ...ROW,
      ffStrike: null,
      vSkewFront: null,
      vSkewBack: null,
      thetaCarry: null,
      breakdown: {
        fwdEdge: TERM,
        deltaBalance: { raw: null, percentile: null, weight: 0, contribution: 0 },
      },
    });
    expect(parsed.ffStrike).toBeNull();
    expect(parsed.vSkewFront).toBeNull();
    expect(parsed.vSkewBack).toBeNull();
    expect(parsed.thetaCarry).toBeNull();
    expect(parsed.breakdown.deltaBalance.raw).toBeNull();
    expect(parsed.breakdown.deltaBalance.percentile).toBeNull();
  });

  it("rejects a root outside the SPX/SPXW union", () => {
    expect(() => rankedCalendar.parse({ ...ROW, root: "SPY" })).toThrow();
  });

  it("rejects a missing measurement rather than defaulting it to zero", () => {
    const { fwdIv: _dropped, ...withoutFwdIv } = ROW;
    expect(() => rankedCalendar.parse(withoutFwdIv)).toThrow();
  });

  it("rejects a breakdown missing one of the two terms", () => {
    expect(() => rankedCalendar.parse({ ...ROW, breakdown: { fwdEdge: TERM } })).toThrow();
  });
});

describe("rankedCalendarResponse", () => {
  it("parses the envelope with every drop reason and a solved realized vol", () => {
    const parsed = rankedCalendarResponse.parse(BODY);
    expect(parsed.asOf).toBe("2026-07-27T16:00:00.000Z");
    expect(parsed.totalCandidates).toBe(2454);
    expect(parsed.expiryPairs).toBe(124);
    expect(parsed.drops["gap-floor"]).toBe(44);
  });

  it("accepts a null realizedVol — the VRP term dropping out is a reported state", () => {
    const parsed = rankedCalendarResponse.parse({ ...BODY, realizedVol: null });
    expect(parsed.realizedVol).toBeNull();
  });

  it("parses an empty ranking — no candidates is data, not an error", () => {
    const parsed = rankedCalendarResponse.parse({
      ...BODY,
      candidates: [],
      totalCandidates: 0,
      expiryPairs: 0,
    });
    expect(parsed.candidates).toEqual([]);
  });

  it("rejects a non-ISO asOf", () => {
    expect(() => rankedCalendarResponse.parse({ ...BODY, asOf: "2026-07-27" })).toThrow();
  });

  it("rejects an envelope missing a drop reason", () => {
    const { "gap-floor": _dropped, ...partialDrops } = DROPS;
    expect(() => rankedCalendarResponse.parse({ ...BODY, drops: partialDrops })).toThrow();
  });
});

describe("rankCalendarsQuery", () => {
  it("coerces the string query params HTTP actually delivers", () => {
    const parsed = rankCalendarsQuery.parse({ frontDteMax: "45", limit: "10", contractType: "C" });
    expect(parsed).toEqual({ frontDteMax: 45, limit: 10, contractType: "C" });
  });

  it("leaves every param absent so the use-case's own defaults apply", () => {
    expect(rankCalendarsQuery.parse({})).toEqual({});
  });

  it("rejects a non-numeric, zero, fractional or over-cap value", () => {
    expect(rankCalendarsQuery.safeParse({ frontDteMax: "soon" }).success).toBe(false);
    expect(rankCalendarsQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(rankCalendarsQuery.safeParse({ limit: "2.5" }).success).toBe(false);
    // Nothing past 90 DTE is ingested, so a larger ceiling could only mislead.
    expect(rankCalendarsQuery.safeParse({ frontDteMax: "365" }).success).toBe(false);
  });

  it("rejects a contractType outside the C/P union", () => {
    expect(rankCalendarsQuery.safeParse({ contractType: "X" }).success).toBe(false);
  });
});

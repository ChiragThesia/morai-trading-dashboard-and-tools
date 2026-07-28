/**
 * Priced-chain contract tests.
 *
 * `pricedChainResponse` is the single Zod schema source for GET /api/chain/priced and its
 * get_priced_chain MCP twin (MCP-02). What these tests actually defend is NULL-HONESTY: every
 * field the engine can fail to measure must survive as null, because 24.4% of the live put wing
 * had no usable IV on 2026-07-28 and a schema that rejected those rows would force the engine to
 * fabricate greeks it never computed.
 */

import { describe, it, expect } from "vitest";
import { pricedChainQuery, pricedChainResponse, pricedChainStrike } from "./chain-surface.ts";

const pricedStrike = {
  strike: 7400,
  iv: 0.162,
  bid: 48.6,
  ask: 50.2,
  openInterest: 2417,
  delta: -0.4913,
  gamma: 0.000_912,
  theta: -2.8821,
  vega: 5.1042,
  vSkew: 0,
};

/** The row a strike gets when its IV never solved. Every derived field null, market intact. */
const gapStrike = {
  strike: 7425,
  iv: null,
  bid: 58.0,
  ask: 60.5,
  openInterest: 66,
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  vSkew: null,
};

const validResponse = {
  asOf: "2026-07-28T15:30:00.000Z",
  spot: 7401.89,
  contractType: "P",
  cohorts: [
    {
      root: "SPXW",
      expiration: "2026-08-14",
      dte: 17,
      t: 0.046_9,
      atmStrike: 7400,
      atmIv: 0.162,
      strikes: [pricedStrike, gapStrike],
    },
  ],
};

describe("pricedChainStrike", () => {
  it("parses a fully-priced strike", () => {
    expect(() => pricedChainStrike.parse(pricedStrike)).not.toThrow();
  });

  it("parses an unpriceable strike — every derived field null, the market still there", () => {
    const parsed = pricedChainStrike.parse(gapStrike);
    expect(parsed.iv).toBeNull();
    expect(parsed.delta).toBeNull();
    expect(parsed.vSkew).toBeNull();
    // The row exists BECAUSE these survive: dropping it would be a hidden filter on a screen
    // whose whole contract is that it hides nothing.
    expect(parsed.bid).toBe(58.0);
    expect(parsed.openInterest).toBe(66);
  });

  it("keeps the strike in POINTS, not the ×1000 integer the raw chain carries", () => {
    expect(pricedChainStrike.parse(pricedStrike).strike).toBe(7400);
  });

  it("rejects a non-integer open interest — contracts do not come in fractions", () => {
    expect(() => pricedChainStrike.parse({ ...pricedStrike, openInterest: 12.5 })).toThrow();
  });
});

describe("pricedChainResponse", () => {
  it("parses a fully-populated snapshot", () => {
    expect(() => pricedChainResponse.parse(validResponse)).not.toThrow();
  });

  it("accepts a null spot rather than forcing a zero the index never traded at", () => {
    const parsed = pricedChainResponse.parse({ ...validResponse, spot: null, cohorts: [] });
    expect(parsed.spot).toBeNull();
  });

  it("accepts an empty cohort list — no data is an answer, not an error", () => {
    expect(() => pricedChainResponse.parse({ ...validResponse, cohorts: [] })).not.toThrow();
  });

  it("accepts a cohort whose ATM strike never solved", () => {
    const cohort = { ...validResponse.cohorts[0], atmIv: null };
    const parsed = pricedChainResponse.parse({ ...validResponse, cohorts: [cohort] });
    expect(parsed.cohorts[0]?.atmIv).toBeNull();
  });

  it("rejects an unknown root — SPX and SPXW are the whole vocabulary", () => {
    const cohort = { ...validResponse.cohorts[0], root: "SPXQ" };
    expect(() => pricedChainResponse.parse({ ...validResponse, cohorts: [cohort] })).toThrow();
  });

  it("rejects a non-ISO asOf — the wire instant is always a full datetime", () => {
    expect(() => pricedChainResponse.parse({ ...validResponse, asOf: "2026-07-28" })).toThrow();
  });
});

describe("pricedChainQuery", () => {
  it("accepts an empty query — the wing default lives in the use-case", () => {
    expect(pricedChainQuery.parse({})).toEqual({});
  });

  it("accepts either wing and rejects anything else", () => {
    expect(pricedChainQuery.parse({ contractType: "C" }).contractType).toBe("C");
    expect(() => pricedChainQuery.parse({ contractType: "X" })).toThrow();
  });
});

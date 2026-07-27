/**
 * candidate.test.ts — enumeration under the gates, and every measured quantity.
 *
 * The load-bearing claim in this file is that the term-structure signal is read off each
 * cohort's 50-DELTA IVs, not off the traded strike's own two IVs. Measured on the live chain,
 * the top candidates ranked by per-strike forward factor all sat 250–300 points from spot at
 * roughly double the near-the-money reading — that is SPX put skew leaking into a
 * term-structure measurement, and it would make the engine recommend deep OTM puts.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildCohorts } from "./cohort.ts";
import { enumerateCandidates, FRONT_DTE_FLOOR, GAP_DAYS_FLOOR, BACK_DTE_CEILING } from "./candidate.ts";
import type { CalendarChainQuote, Carry, Cohort } from "./types.ts";

const NOW = new Date("2026-07-27T16:00:00.000Z");
const FLAT: Carry = { rate: 0.045, divYield: 0.013 };
const SPOT = 7401.89;

/**
 * A five-strike put ladder around spot with a linear skew: `ivAtm` at 7400, rising by
 * `skewPerStrike` for every 50 points down. Bids/asks are set from a rough put value so the
 * legs are tradeable and the deeper strikes are cheaper.
 */
function ladder(over: {
  root?: "SPX" | "SPXW";
  expiration: string;
  ivAtm: number;
  skewPerStrike?: number;
  tradeable?: boolean;
  strikes?: ReadonlyArray<number>;
}): CalendarChainQuote[] {
  const strikes = over.strikes ?? [7300, 7350, 7400, 7450, 7500];
  const skew = over.skewPerStrike ?? 0.004;
  return strikes.map((k) => {
    const iv = over.ivAtm + ((7400 - k) / 50) * skew;
    const value = Math.max(20, 60 + (k - 7400) * 0.4);
    return {
      time: NOW,
      strike: k * 1000,
      expiration: over.expiration,
      contractType: "P" as const,
      underlyingPrice: SPOT,
      bsmIv: String(iv),
      root: over.root ?? ("SPXW" as const),
      bid: over.tradeable === false ? 0 : value,
      ask: value + 1,
      openInterest: 39,
      source: "cboe" as const,
    };
  });
}

function cohortsFrom(...groups: ReadonlyArray<CalendarChainQuote>[]): ReadonlyArray<Cohort> {
  return buildCohorts(groups.flat(), {
    now: NOW,
    contractType: "P",
    carryOf: () => null,
    defaultCarry: FLAT,
  });
}

const OPTS = { frontDteMax: 60 };

describe("the floors are the trader's rule and cannot be crossed", () => {
  it("exposes the floors as hard constants", () => {
    expect(FRONT_DTE_FLOOR).toBe(15);
    expect(GAP_DAYS_FLOOR).toBe(15);
    expect(BACK_DTE_CEILING).toBe(90);
  });

  it("never enumerates a front leg below 15 DTE", () => {
    // 2026-08-10 is 14 DTE from 2026-07-27. One day under the floor.
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-10", ivAtm: 0.17 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    const { candidates, drops } = enumerateCandidates(cohorts, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["front-dte-floor"]).toBeGreaterThan(0);
  });

  it("enumerates a front leg at exactly 15 DTE — the floor is inclusive", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.frontDte === 15)).toBe(true);
  });

  it("never enumerates a gap below 15 days", () => {
    // 2026-08-11 (15 DTE) and 2026-08-25 (29 DTE) — a 14-day gap.
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-08-25", ivAtm: 0.16 }),
    );
    const { candidates, drops } = enumerateCandidates(cohorts, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["gap-floor"]).toBeGreaterThan(0);
  });

  it("enumerates a gap of exactly 15 days", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-08-26", ivAtm: 0.16 }),
    );
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.gapDays === 15)).toBe(true);
  });

  it("covers every window the trader actually uses", () => {
    // 15/30, 21/45, 30/60 and 21/60 must all be reachable under the default ceiling.
    const windows: ReadonlyArray<readonly [string, string]> = [
      ["2026-08-11", "2026-08-26"], // 15 / 30
      ["2026-08-17", "2026-09-10"], // 21 / 45
      ["2026-08-26", "2026-09-25"], // 30 / 60
      ["2026-08-17", "2026-09-25"], // 21 / 60
    ];
    for (const [front, back] of windows) {
      const cohorts = cohortsFrom(
        ladder({ expiration: front, ivAtm: 0.17 }),
        ladder({ expiration: back, ivAtm: 0.16 }),
      );
      const { candidates } = enumerateCandidates(cohorts, OPTS);
      expect(candidates.length, `${front} / ${back}`).toBeGreaterThan(0);
    }
  });
});

describe("the ceilings are knobs, and the back ceiling is a data bound", () => {
  it("respects a configured front ceiling", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-26", ivAtm: 0.17 }), // 30 DTE
      ladder({ expiration: "2026-09-25", ivAtm: 0.16 }), // 60 DTE
    );
    expect(enumerateCandidates(cohorts, { frontDteMax: 60 }).candidates.length).toBeGreaterThan(0);
    const tight = enumerateCandidates(cohorts, { frontDteMax: 25 });
    expect(tight.candidates).toHaveLength(0);
    expect(tight.drops["front-dte-ceiling"]).toBeGreaterThan(0);
  });

  it("never enumerates a back leg past 90 DTE — nothing beyond it is ingested", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }), // 15 DTE
      ladder({ expiration: "2026-11-01", ivAtm: 0.16 }), // 97 DTE
    );
    const { candidates, drops } = enumerateCandidates(cohorts, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["back-dte-ceiling"]).toBeGreaterThan(0);
  });

  it("refuses a front floor below 15 even when asked", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-10", ivAtm: 0.17 }), // 14 DTE
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    // The floor is the trader's rule, not a parameter. There is no option to lower it, and a
    // hostile ceiling cannot smuggle one in.
    expect(enumerateCandidates(cohorts, { frontDteMax: 5 }).candidates).toHaveLength(0);
  });
});

describe("pairing rules", () => {
  it("never pairs across roots", () => {
    const cohorts = cohortsFrom(
      ladder({ root: "SPX", expiration: "2026-08-21", ivAtm: 0.17 }),
      ladder({ root: "SPXW", expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    const { candidates, drops } = enumerateCandidates(cohorts, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["root-mismatch"]).toBeGreaterThan(0);
  });

  it("only pairs strikes present in BOTH expiries", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17, strikes: [7350, 7400, 7450] }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16, strikes: [7400, 7450, 7500] }),
    );
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    expect(candidates.map((c) => c.strike).sort((a, b) => a - b)).toEqual([7400, 7450]);
  });

  it("requires BOTH legs tradeable", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16, tradeable: false }),
    );
    const { candidates, drops } = enumerateCandidates(cohorts, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["not-tradeable"]).toBeGreaterThan(0);
  });

  it("never pairs a cohort with itself, and never pairs backwards", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    expect(candidates.every((c) => c.backDte > c.frontDte)).toBe(true);
    expect(candidates.every((c) => c.frontExpiration !== c.backExpiration)).toBe(true);
  });
});

describe("an inverted term structure is dropped with a reason, never scored as zero", () => {
  it("drops the pair when the forward-variance radicand goes negative", () => {
    // Front IV far above back IV over a long gap inverts the structure: there is no forward
    // vol to price, so there is no edge to quote. The incumbent substitutes 0 here.
    // The ladder must reach far enough ITM that BOTH cohorts bracket 50 delta, or the pair drops
    // as `no-atm-reference` before the inversion is ever tested. At 90% IV the at-the-money put
    // is only 46 delta, so the bracket needs strikes well above spot.
    const wide = [7300, 7400, 7500, 7600, 7700];
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.9, strikes: wide }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.1, strikes: wide }),
    );
    expect(cohorts.every((x) => x.atm50Iv !== null)).toBe(true);
    const { candidates, drops } = enumerateCandidates(cohorts, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["term-inverted"]).toBeGreaterThan(0);
  });

  it("drops the pair when either cohort has no 50-delta reference IV", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    const blinded = cohorts.map((c) =>
      c.dte === 46 ? { ...c, atm50Iv: null, atm50BracketWidth: null } : c,
    );
    const { candidates, drops } = enumerateCandidates(blinded, OPTS);
    expect(candidates).toHaveLength(0);
    expect(drops["no-atm-reference"]).toBeGreaterThan(0);
  });
});

describe("the term-structure signal reads the 50-delta IVs, not the traded strike's", () => {
  const cohorts = cohortsFrom(
    // Front carries a STEEP skew, back is nearly flat. At a deep strike the two strike IVs
    // imply a very different forward factor than the two 50-delta IVs do.
    ladder({ expiration: "2026-08-11", ivAtm: 0.17, skewPerStrike: 0.02 }),
    ladder({ expiration: "2026-09-11", ivAtm: 0.168, skewPerStrike: 0.001 }),
  );

  it("gives every candidate in a pair the SAME ffAtm, because it is strike-invariant", () => {
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    expect(candidates.length).toBeGreaterThan(1);
    const unique = new Set(candidates.map((c) => c.ffAtm.toFixed(12)));
    expect(unique.size).toBe(1);
  });

  it("computes ffAtm from the two cohorts' own atm50Iv and t", () => {
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    const front = cohorts.find((c) => c.expiration === "2026-08-11");
    const back = cohorts.find((c) => c.expiration === "2026-09-11");
    expect(front?.atm50Iv).not.toBeNull();
    expect(back?.atm50Iv).not.toBeNull();
    if (front?.atm50Iv == null || back?.atm50Iv == null) return;

    const rad =
      (back.t * back.atm50Iv * back.atm50Iv - front.t * front.atm50Iv * front.atm50Iv) /
      (back.t - front.t);
    const fwd = Math.sqrt(rad);
    const expected = front.atm50Iv / fwd - 1;

    const first = candidates[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.fwdIv).toBeCloseTo(fwd, 12);
    expect(first.ffAtm).toBeCloseTo(expected, 12);
    expect(first.cushion).toBeCloseTo(back.atm50Iv - fwd, 12);
    // The two reference IVs are carried, not recoverable-by-inversion — the VRP term needs the
    // front one, and a reader checking ffAtm by hand needs both.
    expect(first.frontRefIv).toBe(front.atm50Iv);
    expect(first.backRefIv).toBe(back.atm50Iv);
  });

  it("still reports the per-strike reading separately, and it DIFFERS at a skewed strike", () => {
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    const deep = candidates.find((c) => c.strike === 7300);
    expect(deep).toBeDefined();
    if (deep === undefined) return;
    expect(deep.ffStrike).not.toBeNull();
    // This gap is exactly the skew leak the engine refuses to score.
    expect(Math.abs((deep.ffStrike ?? 0) - deep.ffAtm)).toBeGreaterThan(0.005);
  });
});

describe("greeks, carry and cost", () => {
  const cohorts = cohortsFrom(
    ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
    ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
  );
  const { candidates } = enumerateCandidates(cohorts, OPTS);
  const at7400 = candidates.find((c) => c.strike === 7400);

  it("nets greeks as back MINUS front — long the back leg, short the front", () => {
    expect(at7400).toBeDefined();
    if (at7400 === undefined) return;
    const front = cohorts
      .find((c) => c.expiration === "2026-08-11")
      ?.legs.find((l) => l.strike === 7400);
    const back = cohorts
      .find((c) => c.expiration === "2026-09-11")
      ?.legs.find((l) => l.strike === 7400);
    expect(front).toBeDefined();
    expect(back).toBeDefined();
    if (front === undefined || back === undefined) return;

    expect(at7400.net.delta).toBeCloseTo(back.delta - front.delta, 12);
    expect(at7400.net.gamma).toBeCloseTo(back.gamma - front.gamma, 12);
    expect(at7400.net.theta).toBeCloseTo(back.theta - front.theta, 12);
    expect(at7400.net.vega).toBeCloseTo(back.vega - front.vega, 12);
  });

  it("is net-short gamma and net-long vega, the calendar's signature", () => {
    expect(at7400?.net.gamma ?? 1).toBeLessThan(0);
    expect(at7400?.net.vega ?? -1).toBeGreaterThan(0);
  });

  it("reports thetaCarry positive when the front decays faster per unit of extrinsic", () => {
    // Raw net theta would rank the most dangerous front expiry, because theta is bought with
    // short gamma in exact proportion. Normalising by extrinsic is the doctrine's own form:
    // he measures theta as a share of remaining extrinsic, ~3%/day at 30 DTE and ~10% at 10.
    expect(at7400?.thetaCarry).not.toBeNull();
    expect(at7400?.thetaCarry ?? -1).toBeGreaterThan(0);
  });

  it("prices the debit at the fill haircut, not at mid", () => {
    expect(at7400).toBeDefined();
    if (at7400 === undefined) return;
    const frontMid = 60.5;
    const backMid = 60.5;
    const midDebit = backMid - frontMid;
    // Buying the back up and selling the front down both work against you, so the honest
    // debit is strictly worse than the mid-to-mid figure.
    expect(at7400.debit).toBeGreaterThan(midDebit);
  });

  it("reports the round-trip spread cost in the same units as the debit", () => {
    expect(at7400?.spreadCost ?? -1).toBeGreaterThan(0);
    // Each leg is quoted 1 point wide in this ladder, so crossing both costs 2.
    expect(at7400?.spreadCost ?? 0).toBeCloseTo(2, 9);
  });
});

describe("properties", () => {
  it("is invariant to cohort order", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-08-26", ivAtm: 0.165 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
      ladder({ root: "SPX", expiration: "2026-08-21", ivAtm: 0.168 }),
      ladder({ root: "SPX", expiration: "2026-09-18", ivAtm: 0.162 }),
    );
    const a = enumerateCandidates(cohorts, OPTS);
    const b = enumerateCandidates([...cohorts].reverse(), OPTS);
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
  });

  it("never emits NaN in any numeric field", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.05, max: 0.9, noNaN: true }),
        fc.double({ min: 0.05, max: 0.9, noNaN: true }),
        (ivFront, ivBack) => {
          const cohorts = cohortsFrom(
            ladder({ expiration: "2026-08-11", ivAtm: ivFront }),
            ladder({ expiration: "2026-09-11", ivAtm: ivBack }),
          );
          const { candidates } = enumerateCandidates(cohorts, OPTS);
          for (const c of candidates) {
            for (const v of [
              c.fwdIv, c.cushion, c.ffAtm, c.slope, c.hSkew, c.frontIv, c.backIv,
              c.net.delta, c.net.gamma, c.net.theta, c.net.vega, c.debit, c.spreadCost,
            ]) {
              expect(Number.isNaN(v)).toBe(false);
            }
            for (const v of [c.ffStrike, c.thetaCarry, c.vSkewFront, c.vSkewBack]) {
              if (v !== null) expect(Number.isNaN(v)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("emits every candidate exactly once", () => {
    const cohorts = cohortsFrom(
      ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ladder({ expiration: "2026-08-26", ivAtm: 0.165 }),
      ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    );
    const { candidates } = enumerateCandidates(cohorts, OPTS);
    const keys = candidates.map(
      (c) => `${c.root}|${c.strike}|${c.frontExpiration}|${c.backExpiration}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * score.test.ts — the four-term cross-sectional score.
 *
 * Why cross-sectional and not absolute: every threshold the doctrine publishes is calibrated
 * on single names at 60–105% implied vol, and SPX runs at 16%. His calendar entry gate is a
 * Forward Factor of 16–20%; measured across all 2,465 candidates in a live SPX snapshot the
 * maximum was 14.4% and the median 0.36%, so the gate fires zero times. An engine built on his
 * constants returns an empty list every day and looks like it is working.
 *
 * So each term is a percentile WITHIN the snapshot. That has three consequences worth testing:
 * the score is scale-free, it always populates a ranking, and it says nothing about whether the
 * best candidate today is good in absolute terms — which is why the raw values ride along in
 * the breakdown.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scoreCandidates, SCORE_WEIGHTS } from "./score.ts";
import type { Candidate, NetGreeks } from "./candidate.ts";
import type { CohortLeg } from "./types.ts";

function leg(over: Partial<CohortLeg> = {}): CohortLeg {
  return {
    strike: 7400,
    iv: 0.16,
    bid: 60,
    ask: 61,
    mid: 60.5,
    openInterest: 39,
    extrinsic: 60.5,
    delta: -0.5,
    gamma: 0.0002,
    theta: -1.2,
    vega: 4.5,
    tradeable: true,
    ...over,
  };
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  const net: NetGreeks = { delta: 0.01, gamma: -0.0001, theta: 0.6, vega: 2.2 };
  return {
    root: "SPXW",
    strike: 7400,
    frontExpiration: "2026-08-11",
    backExpiration: "2026-09-11",
    frontDte: 15,
    backDte: 46,
    gapDays: 31,
    fwdIv: 0.155,
    cushion: 0.005,
    ffAtm: 0.03,
    slope: -0.01,
    frontRefIv: 0.162,
    backRefIv: 0.16,
    ffStrike: 0.031,
    hSkew: 0.002,
    vSkewFront: 0,
    vSkewBack: 0,
    frontIv: 0.162,
    backIv: 0.16,
    net,
    thetaCarry: 0.01,
    debit: 3.2,
    spreadCost: 2,
    frontLeg: leg(),
    backLeg: leg({ iv: 0.16, theta: -0.6 }),
    carrySource: { front: "implied", back: "implied" },
    ...over,
  };
}

describe("weights", () => {
  it("sums to 100 across exactly two terms", () => {
    const values = Object.values(SCORE_WEIGHTS);
    expect(values).toHaveLength(2);
    expect(values.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("puts the most weight on the forward-vol edge — the calendar IS that trade", () => {
    expect(SCORE_WEIGHTS.fwdEdge).toBe(70);
    expect(SCORE_WEIGHTS.deltaBalance).toBe(30);
  });

  /**
   * REGRESSION (live chain, 2026-07-28). `frontVrp` was a score term at weight 25, justified in
   * the spec as "the only term that looks outside the chain — therefore the only one not
   * collinear with fwdEdge". Both halves of that were false as implemented.
   *
   * It ranked `frontRefIv − realizedVol`, and `realizedVol` is ONE SCALAR for the whole
   * snapshot. `percentileRank` counts `h <= value`, so subtracting the same constant from every
   * candidate leaves every comparison unchanged: measured against the live chain, doubling
   * realized vol from 0.12 to 0.30 produced a byte-identical ranking. The one input that came
   * from outside the chain could not move the answer.
   *
   * What remained was `frontRefIv`, which is a per-COHORT constant — 21 distinct values across
   * 7,951 candidates — and a higher front IV lowers forward vol, so it drives `fwdEdge` up too.
   * Measured correlation of the two terms' percentiles: 0.954. A quarter of the score was
   * `fwdEdge` a second time.
   *
   * A variance risk premium on ONE underlying is not a cross-sectional quantity at all. It is
   * context for the whole snapshot, and it is reported there (`CalendarRanking.realizedVol`).
   */
  it("does not score frontVrp — one scalar cannot rank a snapshot against itself", () => {
    expect(Object.keys(SCORE_WEIGHTS)).not.toContain("frontVrp");
  });

  /**
   * REGRESSION (live chain, 2026-07-27). `thetaCarry` was a score term at weight 20 and it put
   * the top-ranked candidate 721 points out of the money, at the 93rd percentile of that term.
   *
   * Theta as a fraction of remaining extrinsic is U-SHAPED in strike, with its MINIMUM at the
   * money. Measured across one dense pair's ladder:
   *
   *   strike 6660 (736 OTM)  thetaPerExtrinsic 0.03022
   *   strike 7380 (16 OTM)   thetaPerExtrinsic 0.00744   <- minimum
   *   strike 7640 (244 ITM)  thetaPerExtrinsic 0.02852
   *
   * So ranking it "higher is better" is an instruction to pick the most extreme strike available.
   * The doctrine's use of theta-as-a-share-of-extrinsic compares TENORS at the money (3%/day at
   * 30 DTE, 10% at 10 DTE); it was never a strike discriminator. It stays on the candidate as a
   * reported metric and is never scored.
   */
  it("does not score thetaCarry at all", () => {
    expect(Object.keys(SCORE_WEIGHTS)).not.toContain("thetaCarry");
  });
});

describe("scoring is a ranking within the snapshot", () => {
  it("gives the best candidate on every term a score of 100, and the worst the sample floor", () => {
    // The rank is INCLUSIVE — a value is ranked against a distribution that contains itself —
    // so the lowest candidate in a sample of n sits at 100/n, not at 0. With n = 2 that is 50.
    // Nothing downstream cares, because the ranking is what is consumed, but the floor is real
    // and is asserted rather than left to surprise a future reader.
    const best = candidate({ strike: 7400, ffAtm: 0.09, frontRefIv: 0.2, thetaCarry: 0.05, net: { delta: 0, gamma: -1, theta: 1, vega: 1 } });
    const worst = candidate({ strike: 7300, ffAtm: -0.05, frontRefIv: 0.13, thetaCarry: 0.001, net: { delta: 0.9, gamma: -1, theta: 1, vega: 1 } });
    const scored = scoreCandidates([best, worst]);

    expect(scored[0]?.strike).toBe(7400);
    expect(scored[0]?.score).toBe(100);
    expect(scored[1]?.score).toBeCloseTo(50, 9);
  });

  it("drives the sample floor toward zero as the candidate set grows", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      candidate({ strike: 7000 + i * 5, ffAtm: i / 1000, frontRefIv: 0.13 + i / 1000, thetaCarry: i / 10000, net: { delta: (50 - i) / 100, gamma: -1, theta: 1, vega: 1 } }),
    );
    const scored = scoreCandidates(many);
    expect(scored[0]?.score).toBe(100);
    expect(scored[scored.length - 1]?.score ?? 100).toBeCloseTo(2, 9);
  });

  it("is scale-free: multiplying every raw metric by a constant leaves the order alone", () => {
    // The whole point of ranking rather than thresholding. A 16% Forward Factor on KRE and a
    // 7% one on SPX are the same signal at different scales.
    const spx = [0.01, 0.03, 0.07].map((ff, i) => candidate({ strike: 7300 + i * 50, ffAtm: ff }));
    const kre = [0.1, 0.3, 0.7].map((ff, i) => candidate({ strike: 7300 + i * 50, ffAtm: ff }));
    const a = scoreCandidates(spx).map((c) => c.strike);
    const b = scoreCandidates(kre).map((c) => c.strike);
    expect(a).toEqual(b);
  });

  it("ranks a higher forward factor above a lower one, all else equal", () => {
    const cands = [
      candidate({ strike: 7350, ffAtm: 0.01 }),
      candidate({ strike: 7400, ffAtm: 0.08 }),
      candidate({ strike: 7450, ffAtm: 0.04 }),
    ];
    expect(scoreCandidates(cands).map((c) => c.strike)).toEqual([
      7400, 7450, 7350,
    ]);
  });

  it("prefers a smaller absolute net delta, all else equal", () => {
    const cands = [
      candidate({ strike: 7350, net: { delta: 0.4, gamma: -1, theta: 1, vega: 1 } }),
      candidate({ strike: 7400, net: { delta: -0.01, gamma: -1, theta: 1, vega: 1 } }),
      candidate({ strike: 7450, net: { delta: 0.15, gamma: -1, theta: 1, vega: 1 } }),
    ];
    expect(scoreCandidates(cands).map((c) => c.strike)).toEqual([
      7400, 7450, 7350,
    ]);
  });

  it("IGNORES the front leg's own implied vol level — that is not a cross-sectional signal", () => {
    // `frontVrp` used to rank exactly this and nothing else. Two candidates differing ONLY in
    // frontRefIv must now tie on score and fall through to the tie-break.
    const cands = [
      candidate({ strike: 7350, frontRefIv: 0.13 }),
      candidate({ strike: 7400, frontRefIv: 0.22 }),
    ];
    const scored = scoreCandidates(cands);
    expect(scored[0]?.score).toBe(scored[1]?.score);
  });

  it("IGNORES thetaCarry when ranking, however extreme it is", () => {
    // The regression above in one assertion: a candidate with 20x the normalised carry must not
    // outrank one with a better forward-vol edge, because carry is not a strike signal.
    const cands = [
      candidate({ strike: 7350, thetaCarry: 0.2, ffAtm: 0.01 }),
      candidate({ strike: 7400, thetaCarry: 0.001, ffAtm: 0.08 }),
    ];
    expect(scoreCandidates(cands)[0]?.strike).toBe(7400);
  });
});

describe("the breakdown is the argument, not decoration", () => {
  it("reports every term's raw value, percentile, weight and contribution", () => {
    const scored = scoreCandidates([
      candidate({ ffAtm: 0.05 }),
      candidate({ strike: 7350, ffAtm: 0.01 }),
    ]);
    const top = scored[0];
    expect(top).toBeDefined();
    if (top === undefined) return;

    expect(top.breakdown.fwdEdge.raw).toBeCloseTo(0.05, 12);
    expect(top.breakdown.fwdEdge.percentile).toBe(100);
    expect(top.breakdown.fwdEdge.weight).toBe(70);
    expect(top.breakdown.fwdEdge.contribution).toBeCloseTo(70, 9);

    // deltaBalance raw is the signed net delta itself, so a reader sees the number they know.
    expect(top.breakdown.deltaBalance.raw).toBeCloseTo(0.01, 12);
  });

  it("sums the contributions to exactly the score", () => {
    const scored = scoreCandidates(
      [0.01, 0.03, 0.05, 0.07].map((ff, i) => candidate({ strike: 7300 + i * 50, ffAtm: ff })),
    );
    for (const c of scored) {
      const sum = Object.values(c.breakdown).reduce((a, t) => a + t.contribution, 0);
      expect(sum).toBeCloseTo(c.score, 9);
    }
  });
});

describe("missing inputs degrade honestly", () => {
  it("scores a null net delta at the bottom of that term rather than skipping it", () => {
    // A candidate that cannot show a value on an ACTIVE term must not be rewarded for the gap.
    const cands = [
      candidate({ strike: 7350, net: { delta: Number.NaN, gamma: -1, theta: 1, vega: 1 } }),
      candidate({ strike: 7400, net: { delta: 0.01, gamma: -1, theta: 1, vega: 1 } }),
    ];
    const scored = scoreCandidates(cands);
    const missing = scored.find((c) => c.strike === 7350);
    expect(missing?.breakdown.deltaBalance.raw).toBeNull();
    expect(missing?.breakdown.deltaBalance.percentile).toBeNull();
    expect(missing?.breakdown.deltaBalance.contribution).toBe(0);
  });

  it("drops a term unmeasurable across the WHOLE snapshot, and renormalises the rest", () => {
    // A term nobody can show a value on is ABSENT, not merely bad — it cannot discriminate, so
    // leaving it in at zero would cap every score at 70 and make snapshots incomparable.
    const nan = { delta: Number.NaN, gamma: -1, theta: 1, vega: 1 };
    const cands = [
      candidate({ strike: 7350, ffAtm: 0.01, net: nan }),
      candidate({ strike: 7400, ffAtm: 0.08, net: nan }),
    ];
    const scored = scoreCandidates(cands);
    expect(scored[0]?.score).toBe(100);
    expect(scored[0]?.breakdown.deltaBalance.weight).toBe(0);
    expect(scored[0]?.breakdown.deltaBalance.raw).toBeNull();
    // The surviving term renormalises to 100.
    const active = Object.values(scored[0]?.breakdown ?? {}).reduce((a, t) => a + t.weight, 0);
    expect(active).toBeCloseTo(100, 9);
  });

  it("returns an empty array for an empty candidate set, never a divide by zero", () => {
    expect(scoreCandidates([])).toEqual([]);
  });

  it("gives a single candidate a defined score rather than a null percentile", () => {
    const scored = scoreCandidates([candidate()]);
    expect(scored).toHaveLength(1);
    expect(Number.isFinite(scored[0]?.score ?? Number.NaN)).toBe(true);
  });
});

describe("determinism", () => {
  it("breaks ties in a fully specified order, never by input position", () => {
    // Identical on every scored term; only the identity differs.
    const a = candidate({ strike: 7400, frontExpiration: "2026-08-11" });
    const b = candidate({ strike: 7350, frontExpiration: "2026-08-11" });
    const c = candidate({ strike: 7400, frontExpiration: "2026-08-17" });
    const forward = scoreCandidates([a, b, c]);
    const reverse = scoreCandidates([c, b, a]);
    expect(forward.map((x) => `${x.frontExpiration}|${x.strike}`)).toEqual(
      reverse.map((x) => `${x.frontExpiration}|${x.strike}`),
    );
  });

  it("is invariant to input order for any candidate set", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ff: fc.double({ min: -0.2, max: 0.2, noNaN: true }),
            iv: fc.double({ min: 0.05, max: 0.6, noNaN: true }),
            carry: fc.double({ min: 0, max: 0.1, noNaN: true }),
            delta: fc.double({ min: -1, max: 1, noNaN: true }),
            strike: fc.integer({ min: 7000, max: 7800 }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (specs) => {
          const cands = specs.map((s, i) =>
            candidate({
              strike: s.strike,
              backExpiration: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
              ffAtm: s.ff,
              frontRefIv: s.iv,
              thetaCarry: s.carry,
              net: { delta: s.delta, gamma: -1, theta: 1, vega: 1 },
            }),
          );
          const a = scoreCandidates(cands);
          const b = scoreCandidates([...cands].reverse());
          expect(a.map((x) => x.score)).toEqual(b.map((x) => x.score));
        },
      ),
      { numRuns: 150 },
    );
  });

  it("always produces a score inside [0, 100], sorted descending", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 40 }),
        (ffs) => {
          const scored = scoreCandidates(
            ffs.map((ff, i) => candidate({ strike: 7000 + i, ffAtm: ff })),
          );
          for (const c of scored) {
            expect(c.score).toBeGreaterThanOrEqual(0);
            expect(c.score).toBeLessThanOrEqual(100);
            expect(Number.isNaN(c.score)).toBe(false);
          }
          for (let i = 1; i < scored.length; i += 1) {
            expect(scored[i - 1]?.score ?? 0).toBeGreaterThanOrEqual(scored[i]?.score ?? 0);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

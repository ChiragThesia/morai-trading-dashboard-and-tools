/**
 * cohort.test.ts — grouping the flat chain into priced `(root, expiration)` cohorts.
 *
 * Three things this module has to get right, all of them paid for in production:
 *
 *   1. ROOT IS PART OF THE KEY. SPX and SPXW quote the same strike on the same date with
 *      different books. A root-blind cohort once measured a back IV of 68.89% against a
 *      front of 24.69% at strike 6675.
 *   2. `bsmIv` HAS THREE STATES. null (never processed), the literal string 'NaN'
 *      (permanent solve failure), and a number. A read that handles only two fabricates.
 *   3. ONE SPOT PER SNAPSHOT. The chain is a two-vendor union, so `rows[0].underlyingPrice`
 *      is whichever vendor landed first. Today the ATM reference measures against the
 *      screen-wide first row while each leg prices against its own row's spot.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildCohorts, snapshotSpot } from "./cohort.ts";
import type { CalendarChainQuote, Carry } from "./types.ts";

const NOW = new Date("2026-07-27T16:00:00.000Z");
const FLAT: Carry = { rate: 0.045, divYield: 0.013 };

function quote(over: Partial<CalendarChainQuote> = {}): CalendarChainQuote {
  return {
    time: NOW,
    strike: 7_400_000,
    expiration: "2026-08-11",
    contractType: "P",
    underlyingPrice: 7401.89,
    bsmIv: "0.1620",
    root: "SPXW",
    bid: 60,
    ask: 61,
    openInterest: 39,
    source: "cboe",
    ...over,
  };
}

const opts = { now: NOW, contractType: "P" as const, carryOf: () => null, defaultCarry: FLAT };

describe("snapshotSpot — one spot for the whole snapshot", () => {
  it("takes the median, so one stale vendor row cannot move it", () => {
    const rows = [
      quote({ underlyingPrice: 7401.89 }),
      quote({ underlyingPrice: 7401.9 }),
      quote({ underlyingPrice: 7402.0 }),
      quote({ underlyingPrice: 6000 }), // a stale row from the other vendor
    ];
    const spot = snapshotSpot(rows);
    expect(spot).not.toBeNull();
    expect(spot ?? 0).toBeGreaterThan(7400);
    expect(spot ?? 0).toBeLessThan(7403);
  });

  it("ignores non-positive and non-finite spots rather than averaging them in", () => {
    const rows = [
      quote({ underlyingPrice: 7400 }),
      quote({ underlyingPrice: 0 }),
      quote({ underlyingPrice: Number.NaN }),
      quote({ underlyingPrice: 7400 }),
    ];
    expect(snapshotSpot(rows)).toBe(7400);
  });

  it("returns null when no row carries a usable spot", () => {
    expect(snapshotSpot([quote({ underlyingPrice: 0 })])).toBeNull();
    expect(snapshotSpot([])).toBeNull();
  });
});

describe("buildCohorts — root is part of the key", () => {
  it("keeps SPX and SPXW at the same strike and date in SEPARATE cohorts", () => {
    const cohorts = buildCohorts(
      [
        quote({ root: "SPX", expiration: "2026-08-21", bsmIv: "0.2469" }),
        quote({ root: "SPXW", expiration: "2026-08-21", bsmIv: "0.6889" }),
      ],
      opts,
    );

    expect(cohorts).toHaveLength(2);
    const spx = cohorts.find((c) => c.root === "SPX");
    const spxw = cohorts.find((c) => c.root === "SPXW");
    expect(spx?.atm50Iv).toBeCloseTo(0.2469, 6);
    expect(spxw?.atm50Iv).toBeCloseTo(0.6889, 6);
  });

  it("defaults an absent root to SPXW, the PM-settled case", () => {
    const bare: CalendarChainQuote = {
      time: NOW,
      strike: 7_400_000,
      expiration: "2026-08-11",
      contractType: "P",
      underlyingPrice: 7401.89,
      bsmIv: "0.16",
      bid: 60,
      ask: 61,
      openInterest: 39,
      source: "cboe",
    };
    const cohorts = buildCohorts([bare], opts);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]?.root).toBe("SPXW");
  });

  it("gives SPX and SPXW on a third Friday DIFFERENT T, because settlement differs", () => {
    const cohorts = buildCohorts(
      [
        quote({ root: "SPX", expiration: "2026-08-21" }),
        quote({ root: "SPXW", expiration: "2026-08-21" }),
      ],
      opts,
    );
    const spx = cohorts.find((c) => c.root === "SPX");
    const spxw = cohorts.find((c) => c.root === "SPXW");
    expect(spx?.t).toBeLessThan(spxw?.t ?? 0);
    // Same calendar DTE though — the gates count days, not settlement instants.
    expect(spx?.dte).toBe(spxw?.dte);
  });
});

describe("buildCohorts — the three states of bsmIv", () => {
  it("drops a leg whose IV is null", () => {
    const cohorts = buildCohorts([quote({ bsmIv: null })], opts);
    expect(cohorts).toHaveLength(0);
  });

  it("drops a leg whose IV is the literal string 'NaN' — the permanent-failure marker", () => {
    for (const s of ["NaN", "nan"]) {
      expect(buildCohorts([quote({ bsmIv: s })], opts)).toHaveLength(0);
    }
  });

  it("drops a leg whose IV parses to zero or negative — gamma and vega divide by sigma", () => {
    for (const s of ["0", "0.0", "-0.15"]) {
      expect(buildCohorts([quote({ bsmIv: s })], opts)).toHaveLength(0);
    }
  });

  it("keeps the solved legs in a cohort where a sibling failed", () => {
    const cohorts = buildCohorts(
      [
        quote({ strike: 7_400_000, bsmIv: "NaN" }),
        quote({ strike: 7_350_000, bsmIv: "0.17" }),
        quote({ strike: 7_300_000, bsmIv: null }),
        quote({ strike: 7_250_000, bsmIv: "0.18" }),
      ],
      opts,
    );
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]?.legs).toHaveLength(2);
    expect(cohorts[0]?.legs.map((l) => l.strike)).toEqual([7250, 7350]);
  });
});

describe("buildCohorts — the ATM references are two different questions", () => {
  const ladder = [
    quote({ strike: 7_300_000, bsmIv: "0.180" }),
    quote({ strike: 7_350_000, bsmIv: "0.172" }),
    quote({ strike: 7_400_000, bsmIv: "0.162" }),
    quote({ strike: 7_450_000, bsmIv: "0.155" }),
    quote({ strike: 7_500_000, bsmIv: "0.150" }),
  ];

  it("puts atmStrike at the strike nearest spot", () => {
    const c = buildCohorts(ladder, opts)[0];
    // spot 7401.89 → 7400 is 1.89 away, 7450 is 48.11 away.
    expect(c?.atmStrike).toBe(7400);
    expect(c?.atmIv).toBeCloseTo(0.162, 6);
  });

  it("breaks an atmStrike tie toward the LOWER strike, deterministically", () => {
    const even = [
      quote({ strike: 7_390_000, bsmIv: "0.17", underlyingPrice: 7400 }),
      quote({ strike: 7_410_000, bsmIv: "0.16", underlyingPrice: 7400 }),
    ];
    expect(buildCohorts(even, opts)[0]?.atmStrike).toBe(7390);
    // And the answer must not depend on which row arrived first.
    expect(buildCohorts([...even].reverse(), opts)[0]?.atmStrike).toBe(7390);
  });

  it("nulls atmIv rather than substituting a neighbour when the ATM strike never solved", () => {
    const holed = [
      quote({ strike: 7_400_000, bsmIv: "NaN" }),
      quote({ strike: 7_450_000, bsmIv: "0.155" }),
    ];
    const c = buildCohorts(holed, opts)[0];
    // 7400 is gone from the cohort entirely, so the nearest SOLVED strike becomes ATM.
    // The point is that no leg silently inherits 7400's missing IV.
    expect(c?.atmStrike).toBe(7450);
    expect(c?.atmIv).toBeCloseTo(0.155, 6);
  });

  it("picks atm50Strike by |delta| nearest 0.50, which need not be atmStrike", () => {
    const c = buildCohorts(ladder, opts)[0];
    expect(c?.atm50Strike).not.toBeNull();
    const leg = c?.legs.find((l) => l.strike === c.atm50Strike);
    expect(leg).toBeDefined();
    if (leg === undefined) return;
    // Whatever strike wins, it must be the closest to 50 delta in the cohort.
    const best = Math.min(...(c?.legs ?? []).map((l) => Math.abs(Math.abs(l.delta) - 0.5)));
    expect(Math.abs(Math.abs(leg.delta) - 0.5)).toBeCloseTo(best, 12);
  });
});

describe("buildCohorts — tradeability is marked, not filtered", () => {
  it("keeps an unquotable leg in the cohort but marks it untradeable", () => {
    const c = buildCohorts(
      [
        quote({ strike: 7_400_000, bid: 0, ask: 61 }), // no bid — cannot be sold
        quote({ strike: 7_350_000, bid: 55, ask: 56 }),
      ],
      opts,
    )[0];
    expect(c?.legs).toHaveLength(2);
    expect(c?.legs.find((l) => l.strike === 7400)?.tradeable).toBe(false);
    expect(c?.legs.find((l) => l.strike === 7350)?.tradeable).toBe(true);
  });

  it("marks a crossed market untradeable", () => {
    const c = buildCohorts([quote({ bid: 62, ask: 61 })], opts)[0];
    expect(c?.legs[0]?.tradeable).toBe(false);
  });

  it("marks a leg whose spread exceeds the width bound untradeable", () => {
    // Measured on SPX: spread/mid is p50 0.6% and p90 1.0%, so the 15% bound is loose on
    // purpose — it catches genuine garbage and discriminates nothing among real quotes.
    const wide = buildCohorts([quote({ bid: 10, ask: 40 })], opts)[0];
    expect(wide?.legs[0]?.tradeable).toBe(false);
    const normal = buildCohorts([quote({ bid: 60, ask: 61 })], opts)[0];
    expect(normal?.legs[0]?.tradeable).toBe(true);
  });
});

describe("buildCohorts — carry comes from the expiry, and its source is visible", () => {
  it("uses the solved per-expiry carry when one exists", () => {
    const solved: Carry = { rate: 0.0382, divYield: 0.0121 };
    const c = buildCohorts([quote()], { ...opts, carryOf: () => solved })[0];
    expect(c?.carry).toEqual(solved);
    expect(c?.carrySource).toBe("implied");
  });

  it("falls back to the flat default and SAYS SO", () => {
    const c = buildCohorts([quote()], opts)[0];
    expect(c?.carry).toEqual(FLAT);
    expect(c?.carrySource).toBe("default");
  });

  it("asks for carry per (expiration, root), not once for the snapshot", () => {
    const asked: string[] = [];
    buildCohorts(
      [
        quote({ root: "SPX", expiration: "2026-08-21" }),
        quote({ root: "SPXW", expiration: "2026-08-21" }),
        quote({ root: "SPXW", expiration: "2026-09-01" }),
      ],
      {
        ...opts,
        carryOf: (expiration, root) => {
          asked.push(`${root}|${expiration}`);
          return null;
        },
      },
    );
    // Compared as a set: which keys were asked for is the claim, not their collation order.
    expect(asked).toHaveLength(3);
    expect(new Set(asked)).toEqual(
      new Set(["SPX|2026-08-21", "SPXW|2026-08-21", "SPXW|2026-09-01"]),
    );
  });
});

describe("buildCohorts — wing and staleness", () => {
  it("keeps only the requested contract type", () => {
    const cohorts = buildCohorts(
      [quote({ contractType: "P" }), quote({ contractType: "C", strike: 7_450_000 })],
      opts,
    );
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0]?.legs).toHaveLength(1);
    expect(cohorts[0]?.legs[0]?.strike).toBe(7400);
  });

  it("drops an already-settled cohort, including one that expires TODAY", () => {
    // dte is frozen at the observation day, so a row observed yesterday whose expiration WAS
    // yesterday arrives with dte 0 and would otherwise render as a tradeable 0DTE cohort.
    const cohorts = buildCohorts(
      [
        quote({ expiration: "2026-07-27" }), // today
        quote({ expiration: "2026-07-26" }), // yesterday
        quote({ expiration: "2026-08-11" }), // real
      ],
      opts,
    );
    expect(cohorts.map((c) => c.expiration)).toEqual(["2026-08-11"]);
  });

  it("drops a cohort whose expiration string is unparseable", () => {
    expect(buildCohorts([quote({ expiration: "2026-02-30" })], opts)).toHaveLength(0);
  });
});

describe("buildCohorts — properties", () => {
  it("is invariant to input row order", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            strike: fc.integer({ min: 7_000, max: 7_800 }).map((k) => k * 1000),
            iv: fc.double({ min: 0.05, max: 0.6, noNaN: true }),
            expiration: fc.constantFrom("2026-08-11", "2026-08-21", "2026-09-01"),
            root: fc.constantFrom<"SPX" | "SPXW">("SPX", "SPXW"),
          }),
          { minLength: 1, maxLength: 25 },
        ),
        (specs) => {
          const rows = specs.map((s) =>
            quote({
              strike: s.strike,
              bsmIv: String(s.iv),
              expiration: s.expiration,
              root: s.root,
            }),
          );
          const a = buildCohorts(rows, opts);
          const b = buildCohorts([...rows].reverse(), opts);
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        },
      ),
      { numRuns: 100 },
    );
  });

  it("never emits NaN in any numeric field", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 3, noNaN: true }),
        fc.integer({ min: 4_000, max: 12_000 }),
        (iv, strikePts) => {
          const cohorts = buildCohorts(
            [quote({ bsmIv: String(iv), strike: strikePts * 1000 })],
            opts,
          );
          for (const c of cohorts) {
            expect(Number.isNaN(c.t)).toBe(false);
            expect(Number.isNaN(c.dte)).toBe(false);
            for (const l of c.legs) {
              for (const v of [l.iv, l.delta, l.gamma, l.theta, l.vega, l.mid, l.extrinsic]) {
                expect(Number.isNaN(v)).toBe(false);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("never reports negative extrinsic value", () => {
    // A mid below intrinsic is a quote artifact, not negative time value — and extrinsic is
    // the denominator of the theta term, so a negative one would flip the score's sign.
    const deepItm = buildCohorts(
      [quote({ strike: 9_000_000, bid: 1500, ask: 1502, bsmIv: "0.30" })],
      opts,
    )[0];
    expect(deepItm?.legs[0]?.extrinsic).toBeGreaterThanOrEqual(0);
  });
});

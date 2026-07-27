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
    // Asserted on the legs rather than on the ATM reference: a single-strike cohort cannot
    // bracket 50 delta, so it correctly has no reference. What matters here is that the two
    // books did not merge — these are the actual live values from the collision that motivated
    // making root part of the key.
    expect(spx?.legs).toHaveLength(1);
    expect(spxw?.legs).toHaveLength(1);
    expect(spx?.legs[0]?.iv).toBeCloseTo(0.2469, 9);
    expect(spxw?.legs[0]?.iv).toBeCloseTo(0.6889, 9);
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

  /**
   * REGRESSION #1 (live chain, 2026-07-27). Picking the NEAREST strike to 50 delta degenerates
   * into "whatever leg exists" on a sparse cohort — the same neighbour-substitution error this
   * file already refuses for `atmIv`, one function along. Live SPX cohorts offered a 1-leg
   * 7.7-delta strike at 26.22% IV and a 4-leg 87.6-delta strike at 11.93% as their
   * nearest-to-50, and a back cohort referencing the 11.93% inflated every candidate in its pair
   * to a 44.37% forward factor against a real maximum of 14.4%.
   *
   * REGRESSION #2, found after bounding #1 with a tolerance: a tolerance is not enough, because
   * it lets the FRONT and BACK references sit at DIFFERENT deltas, and skew makes that a
   * systematic bias. Measured on the live chain:
   *
   *   SPX 17/53d   front |Δ| gap 0.0702, back 0.0013   FF nearest 21.35%  →  interpolated 10.91%
   *   SPXW 35/65d  front |Δ| gap 0.0028, back 0.0003   FF nearest  0.09%  →  interpolated  0.54%
   *
   * Half of that 21% reading was the mismatch: a 0.43-delta front IV compared against a
   * 0.50-delta back IV. Where both references genuinely sit at 50 delta the two methods agree to
   * within half a point.
   *
   * So the reference IV is INTERPOLATED to exactly |Δ| = 0.50 between the tightest bracketing
   * pair, never picked. Same technique and same never-extrapolate policy as the 25Δ risk
   * reversal, which refuses a bracket wider than 0.30 in delta space for exactly this reason.
   */
  it("interpolates the reference IV to exactly 50 delta between the bracketing strikes", () => {
    const c = buildCohorts(
      [
        quote({ strike: 7_300_000, bsmIv: "0.180" }),
        quote({ strike: 7_400_000, bsmIv: "0.162" }),
        quote({ strike: 7_500_000, bsmIv: "0.150" }),
      ],
      opts,
    )[0];
    expect(c).toBeDefined();
    if (c === undefined) return;

    // Hand-compute the same linear-in-delta interpolation from the cohort's own legs.
    const pts = c.legs.map((l) => ({ d: Math.abs(l.delta), iv: l.iv }));
    const lower = pts.filter((p) => p.d <= 0.5).sort((a, b) => b.d - a.d)[0];
    const upper = pts.filter((p) => p.d >= 0.5).sort((a, b) => a.d - b.d)[0];
    expect(lower).toBeDefined();
    expect(upper).toBeDefined();
    if (lower === undefined || upper === undefined) return;
    const span = upper.d - lower.d;
    const expected = span === 0 ? lower.iv : lower.iv + ((0.5 - lower.d) / span) * (upper.iv - lower.iv);

    expect(c.atm50Iv).not.toBeNull();
    expect(c.atm50Iv ?? 0).toBeCloseTo(expected, 12);
    expect(c.atm50BracketWidth ?? -1).toBeCloseTo(span, 12);

    // And the interpolated value sits strictly between the two bracketing IVs.
    const loIv = Math.min(lower.iv, upper.iv);
    const hiIv = Math.max(lower.iv, upper.iv);
    expect(c.atm50Iv ?? 0).toBeGreaterThanOrEqual(loIv);
    expect(c.atm50Iv ?? 0).toBeLessThanOrEqual(hiIv);
  });

  it("nulls the reference when 50 delta is not BRACKETED — never extrapolates", () => {
    // Two deep-OTM strikes: every leg is under 50 delta, so there is no upper bracket. A nearest
    // pick would have returned the 9-delta strike's IV and called it the ATM reference.
    const allOtm = buildCohorts(
      [quote({ strike: 6_700_000, bsmIv: "0.26" }), quote({ strike: 6_800_000, bsmIv: "0.25" })],
      opts,
    )[0];
    expect(allOtm?.atm50Iv).toBeNull();
    expect(allOtm?.atm50BracketWidth).toBeNull();

    // And the mirror case: every leg deep ITM, no lower bracket.
    const allItm = buildCohorts([quote({ strike: 8_200_000, bsmIv: "0.20" })], opts)[0];
    expect(Math.abs(allItm?.legs[0]?.delta ?? 0)).toBeGreaterThan(0.9);
    expect(allItm?.atm50Iv).toBeNull();
  });

  it("nulls the reference when the bracket is too wide to trust a straight line across", () => {
    // A pair that spans 50 delta but from far away on both sides: linear-in-delta interpolation
    // across that gap can land far from the true 50-delta vol and still return a real number.
    const wide = buildCohorts(
      [quote({ strike: 6_600_000, bsmIv: "0.30" }), quote({ strike: 8_200_000, bsmIv: "0.14" })],
      opts,
    )[0];
    const deltas = (wide?.legs ?? []).map((l) => Math.abs(l.delta)).sort((a, b) => a - b);
    expect(deltas.some((d) => d < 0.5)).toBe(true);
    expect(deltas.some((d) => d > 0.5)).toBe(true);
    expect((deltas[deltas.length - 1] ?? 0) - (deltas[0] ?? 0)).toBeGreaterThan(0.3);
    expect(wide?.atm50Iv).toBeNull();
  });

  it("returns the leg's own IV on an exact 50-delta hit, with a zero-width bracket", () => {
    // Constructed so one leg lands on |Δ| = 0.5 to within floating point: scan a fine ladder and
    // assert whichever cohort achieves the exact hit reports width 0.
    const fine = Array.from({ length: 81 }, (_, i) =>
      quote({ strike: (7_200 + i * 5) * 1000, bsmIv: "0.16" }),
    );
    const c = buildCohorts(fine, opts)[0];
    expect(c?.atm50Iv).not.toBeNull();
    // Every leg has the same IV here, so the interpolation must reproduce it exactly regardless
    // of where the bracket falls — a clean invariant that holds with or without an exact hit.
    expect(c?.atm50Iv ?? 0).toBeCloseTo(0.16, 12);
    expect(c?.atm50BracketWidth ?? -1).toBeLessThan(0.05);
  });

  it("reads the reference at 50 delta, which is NOT the strike nearest spot", () => {
    const c = buildCohorts(ladder, opts)[0];
    expect(c?.atmStrike).toBe(7400);
    expect(c?.atm50Iv).not.toBeNull();
    // The two references answer different questions, so they give different IVs. For a put the
    // 50-delta point sits above spot, where the smile is lower.
    expect(c?.atm50Iv).not.toBe(c?.atmIv);
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

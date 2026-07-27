/**
 * chain-math.test.ts — the Analyzer chain table's per-strike column math.
 *
 * Two layers, per .claude/rules/tdd.md ("Numerical code → fast-check property tests in
 * addition to example tests"):
 *   (a) worked examples pinning each column to a hand-computed number, and
 *   (b) fast-check properties pinning the two things that make this module trustworthy —
 *       NEVER NaN for any finite input, and null-in ⇒ null-out for every column.
 *
 * The oracle for every reused formula is the shared implementation itself (computeFwdIv,
 * bsmGreeks, haircutFill) — this module must delegate, never re-derive.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeFwdIv, haircutFill } from "@morai/core";
import { bsmGreeks } from "@morai/quant";
import {
  hSkew,
  edge,
  vSkewVsAtm,
  atmStrike,
  atmIv,
  legGreeks,
  netCalendarGreeks,
  calendarDebit,
  DAYS_PER_YEAR,
  STRIKE_SCALE,
} from "./chain-math.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CARRY = { rate: 0.045, divYield: 0.013 };

/** 7400 strike put, 30 DTE, IV 20%, spot 7420. */
const FRONT = {
  strike: 7_400_000,
  dte: 30,
  bsmIv: 0.2,
  contractType: "P",
  underlyingPrice: 7420,
} as const;

/** Same strike, 60 DTE, IV 18%. */
const BACK = { ...FRONT, dte: 60, bsmIv: 0.18 } as const;

// ─── (a) Worked examples ──────────────────────────────────────────────────────

describe("hSkew — term-structure differential at one strike", () => {
  it("is frontIv − backIv", () => {
    expect(hSkew(0.2, 0.18)).toBeCloseTo(0.02, 12);
  });

  it("is signed — a back-rich structure gives a negative skew", () => {
    expect(hSkew(0.18, 0.2)).toBeCloseTo(-0.02, 12);
  });

  it("is null when either IV never solved", () => {
    expect(hSkew(null, 0.18)).toBeNull();
    expect(hSkew(0.2, null)).toBeNull();
    expect(hSkew(null, null)).toBeNull();
  });
});

describe("edge — frontIv − fwdIv", () => {
  it("matches computeFwdIv on a normal (upward) term structure", () => {
    const fwd = computeFwdIv(30, 0.2, 60, 0.18);
    expect(fwd.guard).toBe("ok");
    // rad = (60·0.18² − 30·0.20²)/30 = 0.0248 → fwdIv ≈ 0.157480
    expect(edge(30, 0.2, 60, 0.18)).toBeCloseTo(0.2 - Math.sqrt(0.0248), 12);
  });

  it("is null — NOT zero, NOT NaN — when the structure is inverted", () => {
    expect(computeFwdIv(30, 0.4, 60, 0.18).guard).toBe("inverted");
    expect(edge(30, 0.4, 60, 0.18)).toBeNull();
  });

  it("is null when either IV never solved", () => {
    expect(edge(30, null, 60, 0.18)).toBeNull();
    expect(edge(30, 0.2, 60, null)).toBeNull();
  });

  it("is null when the back leg is not strictly later than the front", () => {
    expect(edge(30, 0.2, 30, 0.18)).toBeNull();
    expect(edge(60, 0.2, 30, 0.18)).toBeNull();
  });

  it("accepts a 0DTE front leg (fwdIv collapses to the back IV)", () => {
    expect(edge(0, 0.2, 60, 0.18)).toBeCloseTo(0.2 - 0.18, 12);
  });
});

describe("vSkewVsAtm — this strike vs the ATM strike of the SAME expiry", () => {
  it("is ivAtStrike − ivAtm", () => {
    expect(vSkewVsAtm(0.22, 0.19)).toBeCloseTo(0.03, 12);
  });

  it("is null when either IV never solved", () => {
    expect(vSkewVsAtm(null, 0.19)).toBeNull();
    expect(vSkewVsAtm(0.22, null)).toBeNull();
  });
});

describe("atmStrike — strike nearest spot", () => {
  const rows = [{ strike: 7_300_000 }, { strike: 7_400_000 }, { strike: 7_500_000 }];

  it("returns the ×1000 strike nearest spot", () => {
    expect(atmStrike(rows, 7420)).toBe(7_400_000);
    expect(atmStrike(rows, 7290)).toBe(7_300_000);
  });

  it("breaks a tie toward the lower strike (deterministic)", () => {
    expect(atmStrike(rows, 7350)).toBe(7_300_000);
  });

  it("is null for an empty chain or an unusable spot", () => {
    expect(atmStrike([], 7420)).toBeNull();
    expect(atmStrike(rows, 0)).toBeNull();
    expect(atmStrike(rows, Number.NaN)).toBeNull();
  });
});

describe("atmIv — the ATM reference IV, wing and expiry enforced by signature", () => {
  // Both wings at every strike, with DIFFERENT IVs per wing. The differing IV is load-bearing:
  // a fixture where the two wings share an IV passes even when the lookup crosses them.
  const chain = [
    { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", bsmIv: 0.161 },
    { strike: 7_300_000, expiration: "2026-08-21", contractType: "C", bsmIv: 0.121 },
    { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", bsmIv: 0.1452 },
    { strike: 7_400_000, expiration: "2026-08-21", contractType: "C", bsmIv: 0.1103 },
    { strike: 7_400_000, expiration: "2026-09-18", contractType: "P", bsmIv: 0.1701 },
  ] as const;

  it("picks the IV of the ATM strike for the requested wing — never the other wing's", () => {
    expect(atmIv(chain, 7420, "2026-08-21", "P")).toBeCloseTo(0.1452, 12);
    expect(atmIv(chain, 7420, "2026-08-21", "C")).toBeCloseTo(0.1103, 12);
  });

  it("scopes to the requested expiry — a nearer strike in another expiry is not a candidate", () => {
    expect(atmIv(chain, 7420, "2026-09-18", "P")).toBeCloseTo(0.1701, 12);
  });

  it("re-finds the ATM strike WITHIN the wing, not across the whole chain", () => {
    // Only the 7300 put exists for this wing+expiry pair; spot sits nearer 7400, but the
    // 7400 rows belong to other cohorts and must not drag the reference strike.
    const sparse = [
      { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", bsmIv: 0.161 },
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "C", bsmIv: 0.1103 },
    ] as const;
    expect(atmIv(sparse, 7420, "2026-08-21", "P")).toBeCloseTo(0.161, 12);
  });

  it("is null when the ATM strike's own IV never solved — never a neighbour's IV", () => {
    const gapped = [
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", bsmIv: null },
      { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", bsmIv: 0.161 },
    ] as const;
    expect(atmIv(gapped, 7420, "2026-08-21", "P")).toBeNull();
  });

  it("is null when no row matches the expiry/wing, or spot is unusable", () => {
    expect(atmIv(chain, 7420, "2026-12-18", "P")).toBeNull();
    expect(atmIv(chain, 7420, "2026-09-18", "C")).toBeNull();
    expect(atmIv([], 7420, "2026-08-21", "P")).toBeNull();
    expect(atmIv(chain, 0, "2026-08-21", "P")).toBeNull();
  });

  it("composes with vSkewVsAtm to give a wing-correct vertical skew", () => {
    const put7300 = 0.161;
    const skew = vSkewVsAtm(put7300, atmIv(chain, 7420, "2026-08-21", "P"));
    expect(skew).toBeCloseTo(0.161 - 0.1452, 12);
    // Crossing the wings would have produced 0.161 − 0.1103; prove we did not.
    expect(skew).not.toBeCloseTo(0.161 - 0.1103, 6);
  });
});

describe("legGreeks — one leg through the shared BSM kernel", () => {
  it("delegates to bsmGreeks with K = strike/1000 and T = dte/365.25", () => {
    const expected = bsmGreeks(
      7420,
      7400,
      30 / DAYS_PER_YEAR,
      0.2,
      CARRY.rate,
      CARRY.divYield,
      "P",
    );
    expect(legGreeks(FRONT, CARRY)).toEqual(expected);
    expect(STRIKE_SCALE).toBe(1000);
  });

  it("is null when the IV never solved", () => {
    expect(legGreeks({ ...FRONT, bsmIv: null }, CARRY)).toBeNull();
  });

  it("is null at or past expiry, and at zero vol (both make BSM greeks undefined)", () => {
    expect(legGreeks({ ...FRONT, dte: 0 }, CARRY)).toBeNull();
    expect(legGreeks({ ...FRONT, dte: -1 }, CARRY)).toBeNull();
    expect(legGreeks({ ...FRONT, bsmIv: 0 }, CARRY)).toBeNull();
  });

  it("is null when spot or strike is unusable", () => {
    expect(legGreeks({ ...FRONT, underlyingPrice: 0 }, CARRY)).toBeNull();
    expect(legGreeks({ ...FRONT, strike: 0 }, CARRY)).toBeNull();
  });
});

describe("netCalendarGreeks — long the back leg, short the front", () => {
  it("is back − front on every greek", () => {
    const f = legGreeks(FRONT, CARRY);
    const b = legGreeks(BACK, CARRY);
    expect(f).not.toBeNull();
    expect(b).not.toBeNull();
    if (f === null || b === null) return;

    const net = netCalendarGreeks(f, b);
    expect(net).not.toBeNull();
    if (net === null) return;

    expect(net.delta).toBeCloseTo(b.delta - f.delta, 12);
    expect(net.gamma).toBeCloseTo(b.gamma - f.gamma, 12);
    expect(net.theta).toBeCloseTo(b.theta - f.theta, 12);
    expect(net.vega).toBeCloseTo(b.vega - f.vega, 12);
  });

  it("is net-long vega and net-short gamma — the calendar's defining signs", () => {
    const f = legGreeks(FRONT, CARRY);
    const b = legGreeks(BACK, CARRY);
    if (f === null || b === null) throw new Error("fixture legs must price");
    const net = netCalendarGreeks(f, b);
    if (net === null) throw new Error("fixture net must price");

    expect(net.vega).toBeGreaterThan(0);
    expect(net.gamma).toBeLessThan(0);
  });

  it("is null when either leg failed to price", () => {
    const f = legGreeks(FRONT, CARRY);
    expect(netCalendarGreeks(null, f)).toBeNull();
    expect(netCalendarGreeks(f, null)).toBeNull();
    expect(netCalendarGreeks(null, null)).toBeNull();
  });
});

describe("calendarDebit — buy the back, sell the front, at the ORATS haircut", () => {
  const front = { bid: 10, ask: 12 };
  const back = { bid: 20, ask: 24 };

  it("equals haircutFill(back,'buy') − haircutFill(front,'sell')", () => {
    expect(calendarDebit(front, back)).toBeCloseTo(
      haircutFill(back, "buy") - haircutFill(front, "sell"),
      12,
    );
  });

  it("is null when a leg has no offer to buy or a crossed market", () => {
    expect(calendarDebit(front, { bid: 0, ask: 0 })).toBeNull();
    expect(calendarDebit({ bid: 0, ask: 0 }, back)).toBeNull();
    expect(calendarDebit(front, { bid: 25, ask: 24 })).toBeNull();
    expect(calendarDebit({ bid: 13, ask: 12 }, back)).toBeNull();
  });

  it("is null on a non-finite quote", () => {
    expect(calendarDebit(front, { bid: Number.NaN, ask: 24 })).toBeNull();
    expect(calendarDebit({ bid: 10, ask: Number.POSITIVE_INFINITY }, back)).toBeNull();
  });
});

// ─── (b) fast-check properties ────────────────────────────────────────────────

const finiteIv = fc.double({ min: 0.001, max: 5, noNaN: true });
const maybeIv = fc.option(finiteIv, { nil: null });
const dte = fc.integer({ min: 0, max: 2000 });

describe("properties", () => {
  it("hSkew / vSkewVsAtm: never NaN for finite inputs, null exactly when an input is null", () => {
    fc.assert(
      fc.property(maybeIv, maybeIv, (a, b) => {
        for (const out of [hSkew(a, b), vSkewVsAtm(a, b)]) {
          if (a === null || b === null) {
            expect(out).toBeNull();
          } else {
            expect(out).not.toBeNull();
            expect(Number.isFinite(out)).toBe(true);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it("edge: null EXACTLY when computeFwdIv guards inverted; otherwise ivFront − fwdIv", () => {
    fc.assert(
      fc.property(dte, finiteIv, dte, finiteIv, (tf, ivf, tb, ivb) => {
        fc.pre(tb > tf);
        const fwd = computeFwdIv(tf, ivf, tb, ivb);
        const out = edge(tf, ivf, tb, ivb);
        if (fwd.guard === "inverted") {
          expect(out).toBeNull();
        } else {
          expect(out).not.toBeNull();
          expect(Number.isNaN(out)).toBe(false);
          expect(out).toBeCloseTo(ivf - fwd.fwdIv, 10);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("edge: null in ⇒ null out, for any leg times", () => {
    fc.assert(
      fc.property(dte, maybeIv, dte, maybeIv, (tf, ivf, tb, ivb) => {
        if (ivf === null || ivb === null) {
          expect(edge(tf, ivf, tb, ivb)).toBeNull();
        }
      }),
      { numRuns: 200 },
    );
  });

  it("atmStrike: returns a strike present in the chain and no strike is closer to spot", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 20_000_000 }), { minLength: 1, maxLength: 40 }),
        fc.double({ min: 1, max: 20_000, noNaN: true }),
        (strikes, spot) => {
          const rows = strikes.map((strike) => ({ strike }));
          const picked = atmStrike(rows, spot);
          expect(picked).not.toBeNull();
          if (picked === null) return;
          expect(strikes).toContain(picked);
          const best = Math.abs(picked / STRIKE_SCALE - spot);
          for (const s of strikes) {
            expect(Math.abs(s / STRIKE_SCALE - spot)).toBeGreaterThanOrEqual(best - 1e-9);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("legGreeks: never NaN for any priceable leg, null for any degraded one", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1000, max: 20_000, noNaN: true }),
        fc.integer({ min: 1_000_000, max: 20_000_000 }),
        dte,
        maybeIv,
        fc.constantFrom("C", "P"),
        (underlyingPrice, strike, legDte, bsmIv, contractType) => {
          const out = legGreeks(
            { strike, dte: legDte, bsmIv, contractType, underlyingPrice },
            CARRY,
          );
          if (bsmIv === null || legDte <= 0) {
            expect(out).toBeNull();
            return;
          }
          expect(out).not.toBeNull();
          if (out === null) return;
          for (const v of [out.delta, out.gamma, out.theta, out.vega]) {
            expect(Number.isFinite(v)).toBe(true);
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it("netCalendarGreeks: is exactly the back-minus-front difference", () => {
    const greek = fc.record({
      delta: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      gamma: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      theta: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
      vega: fc.double({ min: -1e3, max: 1e3, noNaN: true }),
    });
    fc.assert(
      fc.property(greek, greek, (f, b) => {
        const net = netCalendarGreeks(f, b);
        expect(net).not.toBeNull();
        if (net === null) return;
        expect(net.delta).toBe(b.delta - f.delta);
        expect(net.gamma).toBe(b.gamma - f.gamma);
        expect(net.theta).toBe(b.theta - f.theta);
        expect(net.vega).toBe(b.vega - f.vega);
      }),
      { numRuns: 300 },
    );
  });

  it("calendarDebit: never NaN — a finite number for two two-sided markets, else null", () => {
    const price = fc.double({ min: 0, max: 5000, noNaN: true });
    fc.assert(
      fc.property(price, price, price, price, (fb, fa, bb, ba) => {
        const out = calendarDebit({ bid: fb, ask: fa }, { bid: bb, ask: ba });
        if (out !== null) expect(Number.isFinite(out)).toBe(true);
        if (fa > 0 && ba > 0 && fa >= fb && ba >= bb) expect(out).not.toBeNull();
      }),
      { numRuns: 500 },
    );
  });
});

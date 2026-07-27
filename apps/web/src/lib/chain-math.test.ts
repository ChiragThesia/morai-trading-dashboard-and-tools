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
import { yearsToSettlement } from "@morai/core";
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
/** Observation instant every leg below is priced against. Injected, never a clock read. */
const NOW = new Date("2026-07-27T16:00:00.000Z");

const FRONT = {
  strike: 7_400_000,
  dte: 30,
  bsmIv: 0.2,
  contractType: "P",
  underlyingPrice: 7420,
  // 2026-08-26 is 30 calendar days after NOW's UTC date, and a Wednesday — so no root can
  // make it AM-settled, which keeps this fixture's settlement class unambiguous.
  expiration: "2026-08-26",
  root: "SPXW",
} as const;

/** Same strike, 60 DTE, IV 18%. */
// 2026-09-25 is 60 calendar days after NOW's UTC date. The expiration, not `dte`, is what makes
// this the BACK leg now — sharing FRONT's date would give both legs identical T and erase the
// term structure the calendar tests depend on.
const BACK = { ...FRONT, dte: 60, bsmIv: 0.18, expiration: "2026-09-25" } as const;

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

describe("atmIv — the ATM reference IV, wing, expiry and ROOT enforced by signature", () => {
  // Both wings at every strike, with DIFFERENT IVs per wing. The differing IV is load-bearing:
  // a fixture where the two wings share an IV passes even when the lookup crosses them.
  // Every row is SPXW so the root argument is not what makes these pass — the cross-root
  // cases get their own fixture below.
  const chain = [
    { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.161 },
    { strike: 7_300_000, expiration: "2026-08-21", contractType: "C", root: "SPXW", bsmIv: 0.121 },
    { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.1452 },
    { strike: 7_400_000, expiration: "2026-08-21", contractType: "C", root: "SPXW", bsmIv: 0.1103 },
    { strike: 7_400_000, expiration: "2026-09-18", contractType: "P", root: "SPXW", bsmIv: 0.1701 },
  ] as const;

  it("picks the IV of the ATM strike for the requested wing — never the other wing's", () => {
    expect(atmIv(chain, 7420, "2026-08-21", "P", "SPXW")).toBeCloseTo(0.1452, 12);
    expect(atmIv(chain, 7420, "2026-08-21", "C", "SPXW")).toBeCloseTo(0.1103, 12);
  });

  it("scopes to the requested expiry — a nearer strike in another expiry is not a candidate", () => {
    expect(atmIv(chain, 7420, "2026-09-18", "P", "SPXW")).toBeCloseTo(0.1701, 12);
  });

  it("re-finds the ATM strike WITHIN the wing, not across the whole chain", () => {
    // Only the 7300 put exists for this wing+expiry pair; spot sits nearer 7400, but the
    // 7400 rows belong to other cohorts and must not drag the reference strike.
    const sparse = [
      { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.161 },
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "C", root: "SPXW", bsmIv: 0.1103 },
    ] as const;
    expect(atmIv(sparse, 7420, "2026-08-21", "P", "SPXW")).toBeCloseTo(0.161, 12);
  });

  it("is null when the ATM strike's own IV never solved — never a neighbour's IV", () => {
    const gapped = [
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: null },
      { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.161 },
    ] as const;
    expect(atmIv(gapped, 7420, "2026-08-21", "P", "SPXW")).toBeNull();
  });

  it("is null when no row matches the expiry/wing, or spot is unusable", () => {
    expect(atmIv(chain, 7420, "2026-12-18", "P", "SPXW")).toBeNull();
    expect(atmIv(chain, 7420, "2026-09-18", "C", "SPXW")).toBeNull();
    expect(atmIv([], 7420, "2026-08-21", "P", "SPXW")).toBeNull();
    expect(atmIv(chain, 0, "2026-08-21", "P", "SPXW")).toBeNull();
  });

  it("composes with vSkewVsAtm to give a wing-correct vertical skew", () => {
    const put7300 = 0.161;
    const skew = vSkewVsAtm(put7300, atmIv(chain, 7420, "2026-08-21", "P", "SPXW"));
    expect(skew).toBeCloseTo(0.161 - 0.1452, 12);
    // Crossing the wings would have produced 0.161 − 0.1103; prove we did not.
    expect(skew).not.toBeCloseTo(0.161 - 0.1103, 6);
  });

  // ── Root, the second collider ───────────────────────────────────────────────
  // SPX (AM-settled monthlies) and SPXW (PM-settled weeklies) quote the SAME strike on the
  // SAME date. The wire contract now carries `root`, but a cohort filtered on expiry + wing
  // alone still holds BOTH books, so `find(strike === k)` returns whichever arrived first.
  // Same failure class as the wing: every input present and finite, so nothing dashes.
  const bothRoots = [
    { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPX", bsmIv: 0.2511 },
    { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.1452 },
    { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", root: "SPX", bsmIv: 0.2610 },
    { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.1610 },
  ] as const;

  it("reads the requested ROOT's ATM IV, never its twin's", () => {
    expect(atmIv(bothRoots, 7420, "2026-08-21", "P", "SPX")).toBeCloseTo(0.2511, 12);
    expect(atmIv(bothRoots, 7420, "2026-08-21", "P", "SPXW")).toBeCloseTo(0.1452, 12);
  });

  it("is null when the requested root's ATM IV never solved, even though its twin's did", () => {
    // The exact production shape (handoff, strike 6675000): one root solved, the other not.
    // Order matters — SPXW first, so a root-blind `find` would hand SPX the SPXW IV.
    const oneSolved = [
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.2511 },
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPX", bsmIv: null },
    ] as const;
    expect(atmIv(oneSolved, 7420, "2026-08-21", "P", "SPX")).toBeNull();
    expect(atmIv(oneSolved, 7420, "2026-08-21", "P", "SPXW")).toBeCloseTo(0.2511, 12);
  });

  it("re-finds the ATM strike within the ROOT — the twin's strike ladder cannot drag it", () => {
    // SPX lists only 7300 here; spot sits nearer SPXW's 7400. A root-blind atmStrike would
    // pick 7400, find no SPX row at it, and dash a reference that does exist.
    const raggedLadders = [
      { strike: 7_300_000, expiration: "2026-08-21", contractType: "P", root: "SPX", bsmIv: 0.2610 },
      { strike: 7_400_000, expiration: "2026-08-21", contractType: "P", root: "SPXW", bsmIv: 0.1452 },
    ] as const;
    expect(atmIv(raggedLadders, 7420, "2026-08-21", "P", "SPX")).toBeCloseTo(0.2610, 12);
  });

  it("is null when the requested root has no rows at all in that cohort", () => {
    expect(atmIv(chain, 7420, "2026-08-21", "P", "SPX")).toBeNull();
  });
});

describe("legGreeks — one leg through the shared BSM kernel", () => {
  /**
   * REGRESSION. This priced legs at a whole-day `dte / 365.25`, while the server prices the
   * SAME contract at a settlement-aware T. Mixing those two conventions is what made theta read
   * wrong against ThinkOrSwim once already; it was fixed server-side and re-introduced here.
   *
   * The magnitude is modest — 0.22% to 0.61% on theta — but the DIRECTION FLIPS BY ROOT, because
   * PM settlement (16:00 ET) falls after the expiry day's UTC midnight while AM settlement
   * (09:30 ET) falls before it:
   *
   *     2026-08-11 SPXW  15 DTE   theta -2.8998 -> -2.8821   +0.61%
   *     2026-08-21 SPX   25 DTE   theta -2.1718 -> -2.1770   -0.24%
   *     2026-08-21 SPXW  25 DTE   theta -2.1718 -> -2.1635   +0.38%
   *
   * A bias that reverses sign across the exact axis the Analyzer puts side by side is worse than
   * a uniform one. So this now calls `yearsToSettlement` from @morai/core — the SAME function the
   * calendar engine uses, which is the point: one T, not a second opinion.
   */
  it("prices at the settlement-aware T from @morai/core, NOT a whole-day dte/365.25", () => {
    const expected = bsmGreeks(
      7420,
      7400,
      yearsToSettlement(NOW, FRONT.expiration, FRONT.root),
      0.2,
      CARRY.rate,
      CARRY.divYield,
      "P",
    );
    expect(legGreeks(FRONT, CARRY, NOW)).toEqual(expected);
    expect(STRIKE_SCALE).toBe(1000);
  });

  it("differs from the whole-day convention it replaced", () => {
    // Pins the change itself: if someone reverts to dte/365.25 this fails rather than drifting
    // back silently.
    const wholeDay = bsmGreeks(7420, 7400, 30 / DAYS_PER_YEAR, 0.2, CARRY.rate, CARRY.divYield, "P");
    const actual = legGreeks(FRONT, CARRY, NOW);
    expect(actual).not.toBeNull();
    if (actual === null) return;
    expect(actual.theta).not.toBeCloseTo(wholeDay.theta, 8);
  });

  it("gives AM-settled SPX a SHORTER T than its PM-settled SPXW twin on the same date", () => {
    // 2026-08-21 is a third Friday, so root alone decides the settlement clock. This is the
    // asymmetry a whole-day T erases entirely.
    const spx = legGreeks({ ...FRONT, expiration: "2026-08-21", root: "SPX" }, CARRY, NOW);
    const spxw = legGreeks({ ...FRONT, expiration: "2026-08-21", root: "SPXW" }, CARRY, NOW);
    expect(spx).not.toBeNull();
    expect(spxw).not.toBeNull();
    if (spx === null || spxw === null) return;
    // Less time to expiry means less extrinsic value, so a smaller vega.
    expect(spx.vega).toBeLessThan(spxw.vega);
  });

  it("is null for an unparseable expiration rather than pricing at T = 0", () => {
    expect(legGreeks({ ...FRONT, expiration: "2026-02-30" }, CARRY, NOW)).toBeNull();
  });

  it("is null once the leg has settled", () => {
    const afterSettlement = new Date("2026-08-27T00:00:00.000Z");
    expect(legGreeks(FRONT, CARRY, afterSettlement)).toBeNull();
  });

  it("is null when the IV never solved", () => {
    expect(legGreeks({ ...FRONT, bsmIv: null }, CARRY, NOW)).toBeNull();
  });

  it("is null at or past expiry, and at zero vol (both make BSM greeks undefined)", () => {
    // Expressed through the EXPIRATION, because that is what fixes T now. `dte` is display and
    // gating only — a stale `dte` can no longer make a live leg unpriceable or vice versa.
    expect(legGreeks({ ...FRONT, expiration: "2026-07-26" }, CARRY, NOW)).toBeNull(); // settled yesterday
    expect(legGreeks({ ...FRONT, expiration: "2026-07-01" }, CARRY, NOW)).toBeNull(); // long gone
    // And the boundary the whole-day convention could not express: a leg expiring TODAY is still
    // LIVE at NOW, because 16:00 ET is 20:00Z in July and NOW is 16:00Z — four hours of T left.
    // Under `dte / 365.25` this same leg priced at T = 0 and was silently dropped.
    expect(legGreeks({ ...FRONT, expiration: "2026-07-27" }, CARRY, NOW)).not.toBeNull();
    expect(legGreeks({ ...FRONT, bsmIv: 0 }, CARRY, NOW)).toBeNull();
  });

  it("is null when spot or strike is unusable", () => {
    expect(legGreeks({ ...FRONT, underlyingPrice: 0 }, CARRY, NOW)).toBeNull();
    expect(legGreeks({ ...FRONT, strike: 0 }, CARRY, NOW)).toBeNull();
  });
});

describe("netCalendarGreeks — long the back leg, short the front", () => {
  it("is back − front on every greek", () => {
    const f = legGreeks(FRONT, CARRY, NOW);
    const b = legGreeks(BACK, CARRY, NOW);
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
    const f = legGreeks(FRONT, CARRY, NOW);
    const b = legGreeks(BACK, CARRY, NOW);
    if (f === null || b === null) throw new Error("fixture legs must price");
    const net = netCalendarGreeks(f, b);
    if (net === null) throw new Error("fixture net must price");

    expect(net.vega).toBeGreaterThan(0);
    expect(net.gamma).toBeLessThan(0);
  });

  it("is null when either leg failed to price", () => {
    const f = legGreeks(FRONT, CARRY, NOW);
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
        // Days from NOW's date to the expiration. Negative and zero must both null out, so the
        // range straddles settlement rather than only sampling live legs.
        fc.integer({ min: -5, max: 120 }),
        maybeIv,
        fc.constantFrom("C", "P"),
        fc.constantFrom<"SPX" | "SPXW">("SPX", "SPXW"),
        (underlyingPrice, strike, offsetDays, bsmIv, contractType, root) => {
          const target = new Date(NOW.getTime() + offsetDays * 86_400_000);
          const expiration = target.toISOString().slice(0, 10);
          const out = legGreeks(
            { strike, dte: offsetDays, bsmIv, contractType, underlyingPrice, expiration, root },
            CARRY,
            NOW,
          );
          // A leg settling today is already past its 16:00 ET cutoff at NOW (16:00Z = 12:00 ET
          // in July, so 16:00 ET is still ahead) — so only strictly-negative offsets are certainly
          // dead. Let the function decide the boundary and assert the invariant that matters:
          // never NaN, and null-in means null-out.
          if (bsmIv === null || offsetDays < 0) {
            expect(out).toBeNull();
            return;
          }
          if (out === null) return; // settled boundary — legitimately unpriceable
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

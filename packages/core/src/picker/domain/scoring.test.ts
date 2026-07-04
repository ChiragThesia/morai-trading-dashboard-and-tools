/**
 * scoreCalendarCandidates tests (Phase 19, Plan 03) — example + fast-check property, per
 * tdd.md numerical rule.
 *
 * Covers:
 *   - Named weights 40/25/15/10/10, closed-enum breakdown (subset of the allowed 5 labels),
 *     score = rounded weighted sum, clamped [0,100].
 *   - An inverted candidate (fwdIvGuard "inverted") gets fwdEdge contribution 0, finite score.
 *   - beVsEm rawValue = the REAL breakeven-width/expectedMove ratio via findBreakevens (D-09),
 *     not the mockup's fixed-strike proxy.
 *   - fast-check: for arbitrary in-range inputs, score and every contribution stay in [0,100]
 *     and finite.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { bsmPrice } from "@morai/quant";
import {
  scoreCalendarCandidates,
  WEIGHT_SLOPE,
  WEIGHT_FWD_EDGE,
  WEIGHT_GEX_FIT,
  WEIGHT_EVENT,
  WEIGHT_BE_VS_EM,
  BE_VS_EM_TARGET_RATIO,
} from "./scoring.ts";
import { findBreakevens } from "./breakevens.ts";
import type { RawCandidate } from "./types.ts";
import type { GexContextForPicker } from "../application/ports.ts";

const R = 0.04;
const Q = 0.013;

/** A normal, non-inverted, near-ATM long put calendar (front IV < back IV, upward slope). */
function normalCandidate(): RawCandidate {
  return {
    id: "7500-2026-07-31-2026-08-26",
    name: "7500P Jul31 / Aug26",
    frontLeg: { strike: 7500, putCall: "P", expiration: "2026-07-31", dte: 30, iv: 0.14 },
    backLeg: { strike: 7500, putCall: "P", expiration: "2026-08-26", dte: 56, iv: 0.155 },
    deltaRung: "ATM",
    spot: 7500,
    theta: 38.32,
    vega: 309.52,
    delta: 0.96,
    // Real debit = (bsmPrice(back) - bsmPrice(front)) * 100 for these params (verified via a
    // probe script against @morai/quant) -- not an arbitrary number, so findBreakevens below
    // sees a realistic payoff-at-front-expiry curve with genuine straddling breakevens.
    debit: 5413.9478541970675,
    slope: ((0.155 - 0.14) / (56 - 30)) * 365,
    frontEvents: [],
    backEvents: [],
  };
}

/** An inverted-term-structure candidate: front IV rich relative to the forward path. */
function invertedCandidate(): RawCandidate {
  return {
    id: "7450-2026-07-31-2026-08-26",
    name: "7450P Jul31 / Aug26 (inverted)",
    frontLeg: { strike: 7450, putCall: "P", expiration: "2026-07-31", dte: 21, iv: 0.155 },
    backLeg: { strike: 7450, putCall: "P", expiration: "2026-08-26", dte: 45, iv: 0.105 },
    deltaRung: "20D",
    spot: 7500,
    theta: 200,
    vega: 150,
    delta: -30,
    debit: 3000,
    slope: ((0.105 - 0.155) / (45 - 21)) * 365,
    frontEvents: ["FOMC"],
    backEvents: [],
  };
}

const GEX_CONTEXT: GexContextForPicker = {
  flip: 7480,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -47,
  absGammaStrike: 7500,
  computedAt: new Date("2026-07-01T14:30:00.000Z"),
};

const ALLOWED_CRITERIA = new Set(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"]);

describe("scoreCalendarCandidates", () => {
  it("emits exactly the 5 closed-enum criteria with the named weights, score = rounded weighted sum", () => {
    const [scored] = scoreCalendarCandidates([normalCandidate()], GEX_CONTEXT, { r: R, q: Q });
    expect(scored).toBeDefined();
    if (scored === undefined) return;

    expect(scored.breakdown).toHaveLength(5);
    const criteria = scored.breakdown.map((b) => b.criterion);
    expect(new Set(criteria)).toEqual(ALLOWED_CRITERIA);

    const weightByCriterion = new Map(scored.breakdown.map((b) => [b.criterion, b.weight]));
    expect(weightByCriterion.get("slope")).toBe(WEIGHT_SLOPE);
    expect(weightByCriterion.get("fwdEdge")).toBe(WEIGHT_FWD_EDGE);
    expect(weightByCriterion.get("gexFit")).toBe(WEIGHT_GEX_FIT);
    expect(weightByCriterion.get("eventAdjustment")).toBe(WEIGHT_EVENT);
    expect(weightByCriterion.get("beVsEm")).toBe(WEIGHT_BE_VS_EM);

    for (const entry of scored.breakdown) {
      expect(entry.contribution).toBeGreaterThanOrEqual(0);
      expect(entry.contribution).toBeLessThanOrEqual(100);
    }

    const expectedScore = Math.round(
      scored.breakdown.reduce((sum, b) => sum + (b.weight * b.contribution) / 100, 0),
    );
    expect(scored.score).toBe(expectedScore);
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(100);
  });

  it("the breakdown criterion set is always a subset of the closed enum (REFUTED criteria structurally excluded)", () => {
    const [scored] = scoreCalendarCandidates([normalCandidate()], null, { r: R, q: Q });
    expect(scored).toBeDefined();
    if (scored === undefined) return;
    for (const entry of scored.breakdown) {
      expect(ALLOWED_CRITERIA.has(entry.criterion)).toBe(true);
    }
  });

  it("an inverted candidate gets fwdEdge contribution 0 and a finite score (never NaN)", () => {
    const [scored] = scoreCalendarCandidates([invertedCandidate()], GEX_CONTEXT, { r: R, q: Q });
    expect(scored).toBeDefined();
    if (scored === undefined) return;

    expect(scored.fwdIvGuard).toBe("inverted");
    expect(scored.fwdIv).toBeNull();
    expect(scored.fwdEdge).toBe(0);

    const fwdEdgeEntry = scored.breakdown.find((b) => b.criterion === "fwdEdge");
    expect(fwdEdgeEntry).toBeDefined();
    if (fwdEdgeEntry !== undefined) {
      expect(fwdEdgeEntry.contribution).toBe(0);
    }

    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(100);
  });

  it("beVsEm rawValue equals the REAL breakeven-width/expectedMove ratio via findBreakevens (D-09)", () => {
    const candidate = normalCandidate();
    const [scored] = scoreCalendarCandidates([candidate], GEX_CONTEXT, { r: R, q: Q });
    expect(scored).toBeDefined();
    if (scored === undefined) return;

    const breakevens = findBreakevens({
      spot: candidate.spot,
      frontStrike: candidate.frontLeg.strike,
      backStrike: candidate.backLeg.strike,
      frontDte: candidate.frontLeg.dte,
      backDte: candidate.backLeg.dte,
      frontIv: candidate.frontLeg.iv,
      backIv: candidate.backLeg.iv,
      r: R,
      q: Q,
      debit: candidate.debit,
    });
    expect(breakevens.length).toBe(2);
    const width = Math.max(...breakevens) - Math.min(...breakevens);
    const expectedRatio = width / scored.expectedMove;

    const beVsEmEntry = scored.breakdown.find((b) => b.criterion === "beVsEm");
    expect(beVsEmEntry).toBeDefined();
    if (beVsEmEntry !== undefined) {
      expect(beVsEmEntry.rawValue).toBeCloseTo(expectedRatio, 10);
      expect(beVsEmEntry.contribution).toBeCloseTo(
        Math.min(1, Math.max(0, expectedRatio / BE_VS_EM_TARGET_RATIO)) * 100,
        6,
      );
    }
    // Structural proof this is NOT the mockup's faked fixed-strike proxy: the ratio depends on
    // the candidate's actual debit/strikes/ivs via bsmPrice, not a K===someFixedStrike check.
    const perturbedDebit = { ...candidate, debit: candidate.debit * 1.5 };
    const [scoredPerturbed] = scoreCalendarCandidates([perturbedDebit], GEX_CONTEXT, { r: R, q: Q });
    expect(scoredPerturbed).toBeDefined();
    if (scoredPerturbed === undefined) return;
    const perturbedEntry = scoredPerturbed.breakdown.find((b) => b.criterion === "beVsEm");
    expect(perturbedEntry).toBeDefined();
    if (perturbedEntry !== undefined && beVsEmEntry !== undefined) {
      expect(perturbedEntry.rawValue).not.toBeCloseTo(beVsEmEntry.rawValue, 6);
    }
  });

  it("sets exitPlan.closeByExpiry to the front leg's expiration with fixed D-01b defaults", () => {
    const [scored] = scoreCalendarCandidates([normalCandidate()], GEX_CONTEXT, { r: R, q: Q });
    expect(scored).toBeDefined();
    if (scored === undefined) return;
    expect(scored.exitPlan.closeByExpiry).toBe("2026-07-31");
    expect(scored.exitPlan.profitTargetPct).toBe(0.25);
    expect(scored.exitPlan.stopPct).toBe(0.175);
    expect(scored.exitPlan.manageShortDte).toBe(21);
  });

  it("property: for arbitrary in-range candidates, score and every contribution stay finite and within [0,100]", () => {
    const strikeArb = fc.integer({ min: 7300, max: 7700 });
    const ivArb = fc.float({ min: Math.fround(0.08), max: Math.fround(0.5), noNaN: true });
    const frontDteArb = fc.integer({ min: 21, max: 36 });
    const gapArb = fc.integer({ min: 21, max: 50 });

    fc.assert(
      fc.property(strikeArb, ivArb, ivArb, frontDteArb, gapArb, (strike, ivF, ivB, frontDte, gap) => {
        const spot = 7500;
        const backDte = frontDte + gap;
        const frontPrice = bsmPrice(spot, strike, frontDte / 365, ivF, R, Q, "P");
        const backPrice = bsmPrice(spot, strike, backDte / 365, ivB, R, Q, "P");
        const debit = (backPrice - frontPrice) * 100;
        const candidate: RawCandidate = {
          id: `${strike}-f-b`,
          name: "prop",
          frontLeg: { strike, putCall: "P", expiration: "2026-07-31", dte: frontDte, iv: ivF },
          backLeg: { strike, putCall: "P", expiration: "2026-09-15", dte: backDte, iv: ivB },
          deltaRung: "ATM",
          spot,
          theta: 1, // sign/magnitude irrelevant to scoring -- selection already filtered theta<=0
          vega: 1,
          delta: -1,
          debit,
          slope: ((ivB - ivF) / (backDte - frontDte)) * 365,
          frontEvents: [],
          backEvents: [],
        };
        const [scored] = scoreCalendarCandidates([candidate], GEX_CONTEXT, { r: R, q: Q });
        expect(scored).toBeDefined();
        if (scored === undefined) return;
        expect(Number.isFinite(scored.score)).toBe(true);
        expect(scored.score).toBeGreaterThanOrEqual(0);
        expect(scored.score).toBeLessThanOrEqual(100);
        for (const entry of scored.breakdown) {
          expect(Number.isFinite(entry.contribution)).toBe(true);
          expect(entry.contribution).toBeGreaterThanOrEqual(0);
          expect(entry.contribution).toBeLessThanOrEqual(100);
        }
      }),
    );
  });
});

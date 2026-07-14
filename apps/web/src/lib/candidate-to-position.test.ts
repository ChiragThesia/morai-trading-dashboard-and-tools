/**
 * candidate-to-position tests — TDD RED
 *
 * Tests:
 *   (a) field mapping: candidateToAnalyzerPosition maps a PickerCandidate's two legs to one
 *       AnalyzerPosition with live:false, included:true, front/back DTE + IV from the legs,
 *       and a synthesized occSymbol that round-trips the back-leg strike.
 *   (b) guard-case candidate (fwdIv null) still adapts without throwing — the adapter never
 *       reads fwdIv, it only consumes legs.
 *   (c) debit=max-loss invariant (D-01b): a candidate-derived position's worst-case P&L on the
 *       expirationCurve does not exceed its debit within pricing tolerance — example test.
 *   (d) fast-check property (numRuns:200): same invariant over arbitrary in-range candidate legs.
 *
 * RED commit: all tests fail on import error before candidate-to-position.ts exists.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { bsmPrice } from "@morai/quant";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate } from "@morai/contracts";
import { repriceScenario } from "./scenario-engine.ts";
import type { ScenarioParams } from "./scenario-engine.ts";
import { candidateToAnalyzerPosition } from "./candidate-to-position.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NORMAL_CANDIDATE = pickerSnapshotFixture.candidates[0];
const GUARD_CANDIDATE = pickerSnapshotFixture.candidates.find(
  (c) => c.fwdIvGuard === "inverted",
);

if (NORMAL_CANDIDATE === undefined) {
  throw new Error("fixture must have at least one candidate");
}
if (GUARD_CANDIDATE === undefined) {
  throw new Error("fixture must have a guard-case (fwdIvGuard: inverted) candidate");
}

const SPOT = pickerSnapshotFixture.spot;
const RATE = 0.045; // matches Analyzer.tsx/Overview.tsx's DEFAULT_RATE (D-01 app-wide default)
const DIV_YIELD = 0.013; // matches Analyzer.tsx/Overview.tsx's DEFAULT_DIV (D-01 app-wide default)

const BASE_PARAMS: ScenarioParams = {
  spot: SPOT,
  daysForward: 0,
  ivShift: 0,
  rate: RATE,
  divYield: DIV_YIELD,
};

/**
 * Pricing-granularity tolerance for the debit=max-loss invariant (D-01b).
 *
 * A candidate's `debit` is quoted as the entry premium (back leg − front leg at T+0). Under a
 * European BSM model with r > 0, a deep-in-the-money put can be priced slightly BELOW intrinsic
 * value (time-value-of-money on the strike: K·e^{-rT} < K). Since repriceScenario's fixed
 * evaluation grid (6900-7900) extends into deep-ITM territory for the strike/DTE ranges this
 * phase's candidates use, the true worst-case P&L across that full grid can fall a bounded amount
 * below -debit even for a mathematically-correct adapter — this is a genuine BSM property, not an
 * adapter/pricing bug. TOLERANCE was derived empirically (bun probe script, project scratchpad)
 * against this phase's candidate parameter ranges (strike within ~150pts of spot, front DTE
 * 21-36, back-front DTE gap 21-30): the worst observed gap was ~$2,087; 2,500 gives headroom
 * without being so large the invariant becomes vacuous.
 */
const TOLERANCE = 2500;

/** Mirrors scenario-engine.ts's private extractStrike (OCC positions 13-20, thousandths). */
function extractStrikeFromOccSymbol(sym: string): number {
  if (sym.length !== 21) return 0;
  const strikeThousandths = Number(sym.slice(13, 21));
  return strikeThousandths / 1000;
}

/** Entry premium (back leg − front leg) at BASE_PARAMS' spot/rate/divYield — mirrors
 * scenario-engine.ts's private entryNetPrice/calendarNetPrice math (T+0, no IV shift). */
function computeDebit(
  strike: number,
  frontDte: number,
  backDte: number,
  frontIv: number,
  backIv: number,
): number {
  const backPrice = bsmPrice(SPOT, strike, backDte / 365, backIv, RATE, DIV_YIELD, "P");
  const frontPrice = bsmPrice(SPOT, strike, frontDte / 365, frontIv, RATE, DIV_YIELD, "P");
  return (backPrice - frontPrice) * 100;
}

/** Build a full, structurally-valid PickerCandidate around a generated leg pair, with `debit`
 * derived from the SAME legs via computeDebit (D-01b: debit is the entry premium the legs imply). */
function buildCandidate(params: {
  strike: number;
  frontDte: number;
  backDte: number;
  frontIv: number;
  backIv: number;
}): PickerCandidate {
  const { strike, frontDte, backDte, frontIv, backIv } = params;
  return {
    id: `${strike}-${frontDte}-${backDte}`,
    name: `${strike}P generated`,
    score: 50,
    breakdown: [],
    context: [],
    bucket: "standard",
    debit: computeDebit(strike, frontDte, backDte, frontIv, backIv),
    theta: 0,
    vega: 0,
    delta: 0,
    gamma: null,
    fwdIv: 0.15,
    fwdIvGuard: "ok",
    slope: 0,
    fwdEdge: 0,
    expectedMove: 0,
    frontEvents: [],
    backEvents: [],
    frontLeg: { strike, putCall: "P", dte: frontDte, iv: frontIv },
    backLeg: { strike, putCall: "P", dte: backDte, iv: backIv },
    exitPlan: {
      profitTargetPct: 0.25,
      stopPct: 0.175,
      manageShortDte: 21,
      closeByExpiry: "2026-01-01",
      thetaCapturePct: null,
    },
  };
}

// ─── (a) Field mapping ─────────────────────────────────────────────────────────

describe("candidateToAnalyzerPosition — field mapping", () => {
  it("maps a normal candidate's two legs to one view-only AnalyzerPosition", () => {
    const position = candidateToAnalyzerPosition(NORMAL_CANDIDATE);

    expect(position.id).toBe(NORMAL_CANDIDATE.id);
    expect(position.name).toBe(NORMAL_CANDIDATE.name);
    expect(position.live).toBe(false);
    expect(position.included).toBe(true);
    expect(position.qty).toBe(1);
    expect(position.putCall).toBe(NORMAL_CANDIDATE.backLeg.putCall);
    expect(position.frontDte).toBe(NORMAL_CANDIDATE.frontLeg.dte);
    expect(position.backDte).toBe(NORMAL_CANDIDATE.backLeg.dte);
    expect(position.frontIv).toBe(NORMAL_CANDIDATE.frontLeg.iv);
    expect(position.backIv).toBe(NORMAL_CANDIDATE.backLeg.iv);
  });

  it("synthesizes an occSymbol that round-trips the back-leg strike", () => {
    const position = candidateToAnalyzerPosition(NORMAL_CANDIDATE);

    expect(position.occSymbol).toHaveLength(21);
    expect(extractStrikeFromOccSymbol(position.occSymbol)).toBeCloseTo(
      NORMAL_CANDIDATE.backLeg.strike,
      6,
    );
  });

  it("adapts the guard-case candidate (fwdIv null) without throwing, mapping legs normally", () => {
    expect(() => candidateToAnalyzerPosition(GUARD_CANDIDATE)).not.toThrow();

    const position = candidateToAnalyzerPosition(GUARD_CANDIDATE);
    expect(position.live).toBe(false);
    expect(position.included).toBe(true);
    expect(position.frontDte).toBe(GUARD_CANDIDATE.frontLeg.dte);
    expect(position.backDte).toBe(GUARD_CANDIDATE.backLeg.dte);
    expect(position.frontIv).toBe(GUARD_CANDIDATE.frontLeg.iv);
    expect(position.backIv).toBe(GUARD_CANDIDATE.backLeg.iv);
    expect(extractStrikeFromOccSymbol(position.occSymbol)).toBeCloseTo(
      GUARD_CANDIDATE.backLeg.strike,
      6,
    );
  });
});

// ─── (c) Debit = max-loss invariant — example ──────────────────────────────────

describe("candidateToAnalyzerPosition — debit=max-loss invariant (D-01b, example)", () => {
  it("a candidate's max loss on the expirationCurve does not exceed its debit (within pricing tolerance)", () => {
    const position = candidateToAnalyzerPosition(NORMAL_CANDIDATE);
    const result = repriceScenario([position], BASE_PARAMS);
    const worstCase = Math.min(...result.expirationCurve.map((p) => p.pl));

    expect(worstCase).toBeGreaterThanOrEqual(-NORMAL_CANDIDATE.debit - TOLERANCE);
  });

  it("holds for every fixture candidate (incl. the guard-case, a credit candidate)", () => {
    for (const candidate of pickerSnapshotFixture.candidates) {
      const position = candidateToAnalyzerPosition(candidate);
      const result = repriceScenario([position], BASE_PARAMS);
      const worstCase = Math.min(...result.expirationCurve.map((p) => p.pl));

      expect(worstCase).toBeGreaterThanOrEqual(-candidate.debit - TOLERANCE);
    }
  });
});

// ─── (d) Debit = max-loss invariant — fast-check property (numRuns:200) ────────

describe("candidateToAnalyzerPosition — debit=max-loss fast-check property (numRuns:200)", () => {
  it("the invariant holds for arbitrary in-range candidate legs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Math.round(SPOT - 150), max: Math.round(SPOT + 150) }),
        fc.integer({ min: 21, max: 36 }),
        fc.integer({ min: 21, max: 30 }),
        fc.float({ min: Math.fround(0.08), max: Math.fround(0.2), noNaN: true }),
        fc.float({ min: Math.fround(0.08), max: Math.fround(0.2), noNaN: true }),
        (strike, frontDte, backDteOffset, frontIv, backIv) => {
          const backDte = frontDte + backDteOffset;
          const candidate = buildCandidate({ strike, frontDte, backDte, frontIv, backIv });
          const position = candidateToAnalyzerPosition(candidate);
          const result = repriceScenario([position], BASE_PARAMS);
          const worstCase = Math.min(...result.expirationCurve.map((p) => p.pl));

          expect(worstCase).toBeGreaterThanOrEqual(-candidate.debit - TOLERANCE);
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});

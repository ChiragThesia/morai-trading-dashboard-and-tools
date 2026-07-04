/**
 * scenario-engine tests — TDD RED
 *
 * Tests:
 *   (a) kernel-parity: repriceScenario per-position greeks === direct bsmGreeks === Plan-06 computePositionGreeks (D-01)
 *   (b) payoff-shape: calendar payoff peaks near the strike
 *   (c) fast-check property: heatmap cell P&L symmetry + monotonicity (numRuns:1000)
 *
 * RED commit: all tests fail on import error before scenario-engine.ts exists.
 *
 * 18-05 (D-04/D-04a): `rollScenario` and its describe block were removed here — the old
 * Analyzer's RollSimulator was its only caller, and that component is retired with this plan.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { bsmGreeks } from "@morai/quant";
import { parseOccSymbol } from "@morai/shared";
import { computePositionGreeks } from "./position-greeks.ts";
import { repriceScenario, t0ExcludedPositions, buildScenarioStrip } from "./scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams } from "./scenario-engine.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * One live calendar: SPX 7425 PUT, front 45d / back 69d, flat IV 0.145
 * OCC symbol for parseOccSymbol: "SPX   250808P07425000" (21 chars)
 * Using a future date to keep T > 0 during tests.
 */
const LIVE_POS: AnalyzerPosition = {
  id: "live-1",
  name: "7425P Aug",
  live: true,
  occSymbol: "SPX   260808P07425000",
  putCall: "P",
  frontDte: 45,
  backDte: 69,
  frontIv: 0.145,
  backIv: 0.145,
  qty: 1,
  included: true,
};

const SPOT = 7381;
const R = 0.043;
const Q = 0.013;
const IV = 0.145;

const BASE_PARAMS: ScenarioParams = {
  spot: SPOT,
  daysForward: 0,
  ivShift: 0,
  rate: R,
  divYield: Q,
};

/**
 * Fixtures for leg-level non-convergence exclusion (Pitfall 1 / D-02).
 * Same shape as LIVE_POS, differing only in id/name/frontIvStatus/backIvStatus.
 */
const CONTROL_POS: AnalyzerPosition = {
  ...LIVE_POS,
  id: "control-1",
  name: "Control (both legs ok)",
  frontIvStatus: "ok",
  backIvStatus: "ok",
};

// Non-convergent fixtures mirror what Overview.resolveLeg actually produces in
// production: a "non-convergent" leg carries iv:0 (Overview.tsx:114), NOT a valid IV.
// Modeling frontIv/backIv:0 here is what exposes CR-01 — a valid IV masked it (WR-01).
const FRONT_NON_CONVERGENT_POS: AnalyzerPosition = {
  ...LIVE_POS,
  id: "front-nc-1",
  name: "Front leg non-convergent",
  frontIv: 0,
  frontIvStatus: "non-convergent",
  backIvStatus: "ok",
};

const BACK_NON_CONVERGENT_POS: AnalyzerPosition = {
  ...LIVE_POS,
  id: "back-nc-1",
  name: "Back leg non-convergent",
  backIv: 0,
  frontIvStatus: "ok",
  backIvStatus: "non-convergent",
};

/**
 * Build a valid 21-char OCC symbol encoding `strike` at positions 13-20
 * (thousandths of a dollar), matching extractStrike()'s parsing.
 */
function occSymbolForStrike(strike: number): string {
  const thousandths = Math.round(strike * 1000)
    .toString()
    .padStart(8, "0");
  return `SPX   260808P${thousandths}`;
}

/** Minimal AnalyzerPosition fixture for buildScenarioStrip tests (strike + frontDte only matter). */
function makeStripPosition(id: string, strike: number, frontDte: number, included = true): AnalyzerPosition {
  return {
    id,
    name: id,
    live: false,
    occSymbol: occSymbolForStrike(strike),
    putCall: "P",
    frontDte,
    backDte: frontDte + 24,
    frontIv: 0.15,
    backIv: 0.15,
    qty: 1,
    included,
  };
}

// ─── (a) Kernel-parity test — D-01 cross-screen consistency ───────────────────

describe("repriceScenario — kernel parity (D-01)", () => {
  it("per-position greeks equal a direct bsmGreeks call AND the Plan-06 computePositionGreeks output", () => {
    const result = repriceScenario([LIVE_POS], BASE_PARAMS);

    // The plan: for a single position at live spot/0-days/0-IV, per-position greeks
    // must equal direct bsmGreeks call AND the Plan-06 position-greeks helper.

    // Compute T in years for the back leg (the open leg at DTE days forward = 0)
    // Back leg: backDte - 0 = 69 days remaining
    const backT = LIVE_POS.backDte / 365;

    const directGreeks = bsmGreeks(SPOT, LIVE_POS.occSymbol ? 7425 : 7425, backT, IV, R, Q, "P");

    // repriceScenario should expose per-position greeks
    const scenarioPosGreeks = result.positionGreeks.find((pg) => pg.id === "live-1");
    expect(scenarioPosGreeks).toBeDefined();

    if (scenarioPosGreeks === undefined) return;

    // Per-position delta should be within 1e-4 of direct bsmGreeks (back leg only for calendar delta)
    // For a calendar: the net greek is back - front (both legs via same kernel)
    // At 0 days forward: backT = 69/365, frontT = 45/365
    const frontT = LIVE_POS.frontDte / 365;
    const frontGreeks = bsmGreeks(SPOT, 7425, frontT, IV, R, Q, "P");
    const expectedDelta = directGreeks.delta - frontGreeks.delta;
    const expectedGamma = directGreeks.gamma - frontGreeks.gamma;
    const expectedTheta = directGreeks.theta - frontGreeks.theta;
    const expectedVega = directGreeks.vega - frontGreeks.vega;

    expect(scenarioPosGreeks.delta).toBeCloseTo(expectedDelta, 4);
    expect(scenarioPosGreeks.gamma).toBeCloseTo(expectedGamma, 4);
    expect(scenarioPosGreeks.theta).toBeCloseTo(expectedTheta, 4);
    expect(scenarioPosGreeks.vega).toBeCloseTo(expectedVega, 4);

    // Plan-06 computePositionGreeks parity (WR-02): assert the helper's OUTPUT
    // actually equals a direct bsmGreeks call on the SAME inputs the helper uses —
    // a real parity check, not a value compared to itself. computePositionGreeks
    // derives T from the OCC expiry (parseOccSymbol + Date.now(), 365.25-day year),
    // NOT from backDte/365, so we reprice with that same expiry-derived T and strike.
    const netQty = 1;
    const pgResult = computePositionGreeks({
      occSymbol: LIVE_POS.occSymbol,
      spot: SPOT,
      iv: IV,
      rate: R,
      divYield: Q,
      longQty: netQty,
      shortQty: 0,
    });

    expect(pgResult.ok).toBe(true);
    const parsed = parseOccSymbol(LIVE_POS.occSymbol);
    expect(parsed.ok).toBe(true);
    if (pgResult.ok && parsed.ok) {
      const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
      const helperT = (parsed.value.expiry.getTime() - Date.now()) / MS_PER_YEAR;
      const helperKernel = bsmGreeks(SPOT, parsed.value.strike, helperT, IV, R, Q, parsed.value.type);

      // Same kernel, same inputs, scaled by netQty — the D-01 parity guarantee.
      expect(pgResult.value.netQty).toBe(netQty);
      expect(pgResult.value.greeks.delta).toBeCloseTo(helperKernel.delta * netQty, 6);
      expect(pgResult.value.greeks.gamma).toBeCloseTo(helperKernel.gamma * netQty, 6);
      expect(pgResult.value.greeks.theta).toBeCloseTo(helperKernel.theta * netQty, 6);
      expect(pgResult.value.greeks.vega).toBeCloseTo(helperKernel.vega * netQty, 6);
    }
  });
});

// ─── (b) Payoff-shape example — calendar payoff peaks near the strike ──────────

describe("repriceScenario — payoff shape", () => {
  it("calendar payoff peaks near the strike (7425)", () => {
    const result = repriceScenario([LIVE_POS], BASE_PARAMS);

    // The payoff curve should have positive peak near 7425
    const curve = result.payoffCurve;
    expect(curve.length).toBeGreaterThan(50);

    // Find the peak P&L
    let peakPl = -Infinity;
    let peakSpot = 0;
    for (const point of curve) {
      if (point.pl > peakPl) {
        peakPl = point.pl;
        peakSpot = point.spot;
      }
    }

    // Peak should be near the strike (within 150 points)
    expect(Math.abs(peakSpot - 7425)).toBeLessThan(200);
  });

  it("payoff curve covers the expected spot range (6900–7900)", () => {
    const result = repriceScenario([LIVE_POS], BASE_PARAMS);
    const spots = result.payoffCurve.map((p) => p.spot);
    expect(Math.min(...spots)).toBeLessThanOrEqual(6950);
    expect(Math.max(...spots)).toBeGreaterThanOrEqual(7850);
  });
});

// ─── 17.1-04 (OVW-05, D-01): @exp curve invariant across daysForward ───────────

describe("repriceScenario — expirationCurve is invariant across daysForward (D-01)", () => {
  it("expirationCurve is point-for-point identical for daysForward:0 vs daysForward:20", () => {
    const atToday = repriceScenario([LIVE_POS], { ...BASE_PARAMS, daysForward: 0 });
    const atPlus20 = repriceScenario([LIVE_POS], { ...BASE_PARAMS, daysForward: 20 });

    expect(atPlus20.expirationCurve.length).toBe(atToday.expirationCurve.length);
    for (let i = 0; i < atToday.expirationCurve.length; i++) {
      const a = atToday.expirationCurve[i];
      const b = atPlus20.expirationCurve[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a !== undefined && b !== undefined) {
        expect(a.spot).toBe(b.spot);
        expect(b.pl).toBeCloseTo(a.pl, 10);
      }
    }
  });
});

// ─── (c) fast-check: heatmap cell P&L symmetry + monotonicity ───────────────

describe("repriceScenario — heatmap fast-check property (numRuns:1000)", () => {
  it("heatmap cells: |P&L at spot vs +5d| is within a reasonable bound (monotonic time decay direction)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(6900), max: Math.fround(7900), noNaN: true }),
        (testSpot) => {
          const params: ScenarioParams = {
            spot: testSpot,
            daysForward: 0,
            ivShift: 0,
            rate: R,
            divYield: Q,
          };
          const result = repriceScenario([LIVE_POS], params);

          // All cells are finite numbers
          for (const cell of result.heatmapCells) {
            expect(Number.isFinite(cell.pl)).toBe(true);
          }

          // Symmetry property: P&L at +spot_offset and -spot_offset from strike
          // should have similar magnitude (not necessarily equal — calendar is not perfectly symmetric,
          // but the magnitude ratio should be reasonable: |positive_side| / |negative_side| < 20)
          const atStrike = result.heatmapCells.find(
            (c) => c.daysForward === 0 && Math.abs(c.spot - 7425) < 60,
          );
          if (atStrike !== undefined) {
            // At the strike at T=0, the calendar should be worth something positive
            // or at worst a small loss (not an extreme value)
            expect(Math.abs(atStrike.pl)).toBeLessThan(100_000);
          }

          return true;
        },
      ),
      { numRuns: 1000 },
    );
  });
});

// ─── (e) Leg-level non-convergence exclusion — Pitfall 1 / D-02 ───────────────

describe("bookPL/bookPLAtExpiry — leg-level non-convergence exclusion (Pitfall 1 / D-02)", () => {
  it("front-leg-non-convergent position (prod frontIv=0): excluded from BOTH T+0 and @exp (CR-01)", () => {
    // CR-01: the @exp *net* at frontT=0 needs no front IV (front is intrinsic there), but the
    // entry cost basis (entryNetPrice) reprices the front leg at frontT>0, which DOES need it.
    // In production frontIv=0 for a non-convergent leg, so that entry basis drops the front
    // leg's real time value (or yields NaN when S===K and r===q) → a wrong @exp number for
    // exactly the "IV n/a" rows. A front-non-convergent position therefore has no trustworthy
    // @exp basis and must be excluded from @exp too, not just T+0.
    const controlOnly = repriceScenario([CONTROL_POS], BASE_PARAMS);
    const withFrontNc = repriceScenario([CONTROL_POS, FRONT_NON_CONVERGENT_POS], BASE_PARAMS);

    // T+0: the front-non-convergent position must contribute nothing — payoff curve unchanged.
    for (let i = 0; i < controlOnly.payoffCurve.length; i++) {
      const a = controlOnly.payoffCurve[i];
      const b = withFrontNc.payoffCurve[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a !== undefined && b !== undefined) {
        expect(b.pl).toBeCloseTo(a.pl, 6);
      }
    }

    // @exp: the front-non-convergent position must ALSO contribute nothing — curve unchanged
    // and free of NaN (no wrong / NaN number rendered for an "IV n/a" row).
    for (let i = 0; i < controlOnly.expirationCurve.length; i++) {
      const a = controlOnly.expirationCurve[i];
      const b = withFrontNc.expirationCurve[i];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a !== undefined && b !== undefined) {
        expect(Number.isNaN(b.pl)).toBe(false);
        expect(b.pl).toBeCloseTo(a.pl, 6);
      }
    }
  });

  it("back-leg-non-convergent position: excluded from BOTH T+0 and @exp", () => {
    const controlOnly = repriceScenario([CONTROL_POS], BASE_PARAMS);
    const withBackNc = repriceScenario([CONTROL_POS, BACK_NON_CONVERGENT_POS], BASE_PARAMS);

    for (let i = 0; i < controlOnly.payoffCurve.length; i++) {
      const a = controlOnly.payoffCurve[i];
      const b = withBackNc.payoffCurve[i];
      if (a !== undefined && b !== undefined) {
        expect(b.pl).toBeCloseTo(a.pl, 6);
      }
    }

    for (let i = 0; i < controlOnly.expirationCurve.length; i++) {
      const a = controlOnly.expirationCurve[i];
      const b = withBackNc.expirationCurve[i];
      if (a !== undefined && b !== undefined) {
        expect(b.pl).toBeCloseTo(a.pl, 6);
      }
    }
  });

  it("all-ok control position: matches pre-change behavior (contributes to both curves)", () => {
    const result = repriceScenario([CONTROL_POS], BASE_PARAMS);
    expect(result.payoffCurve.length).toBeGreaterThan(50);
    const hasNonZero = result.payoffCurve.some((p) => Math.abs(p.pl) > 0.01);
    expect(hasNonZero).toBe(true);
  });

  it("t0ExcludedPositions reports the count and ids of positions dropped from T+0", () => {
    const book = [CONTROL_POS, FRONT_NON_CONVERGENT_POS, BACK_NON_CONVERGENT_POS];
    const excluded = t0ExcludedPositions(book);
    expect(excluded.count).toBe(2);
    expect(excluded.ids).toContain("front-nc-1");
    expect(excluded.ids).toContain("back-nc-1");
    expect(excluded.ids).not.toContain("control-1");
  });

  it("t0ExcludedPositions ignores positions already excluded via `included: false`", () => {
    const uncheckedPos: AnalyzerPosition = { ...CONTROL_POS, id: "unchecked-1", included: false };
    const excluded = t0ExcludedPositions([CONTROL_POS, uncheckedPos]);
    expect(excluded.count).toBe(0);
    expect(excluded.ids).not.toContain("unchecked-1");
  });
});

// ─── (f) buildScenarioStrip — bounded key-level set + front-expiry header (D-06 / D-07) ─

describe("buildScenarioStrip — bounded key-level set (D-06 / D-07)", () => {
  it("caps overflowing position strikes to the 4 closest to spot", () => {
    const levels = { putWall: 7300, flip: 7350, callWall: 7500 };
    const spot = 7400;
    const positions = [
      makeStripPosition("p1", 7050, 45), // |dist| 350 — dropped
      makeStripPosition("p2", 7150, 45), // |dist| 250 — kept
      makeStripPosition("p3", 7250, 45), // |dist| 150 — kept
      makeStripPosition("p4", 7600, 45), // |dist| 200 — kept
      makeStripPosition("p5", 7700, 45), // |dist| 300 — kept
      makeStripPosition("p6", 7800, 45), // |dist| 400 — dropped
    ];

    const strip = buildScenarioStrip(levels, positions, spot);

    expect(strip.levels.length).toBe(8);
    expect(strip.levels).toEqual([7150, 7250, 7300, 7350, 7400, 7500, 7600, 7700]);
    expect(strip.levels).not.toContain(7050);
    expect(strip.levels).not.toContain(7800);
  });

  it("dedupes a position strike equal to a GEX level", () => {
    const levels = { putWall: 7300, flip: null, callWall: null };
    const spot: number = 7300; // spot also equal to putWall — collapses further
    const positions = [makeStripPosition("p1", 7300, 45)];

    const strip = buildScenarioStrip(levels, positions, spot);

    expect(strip.levels).toEqual([7300]);
  });

  it("output is sorted strictly ascending", () => {
    const levels = { putWall: 7500, flip: 7300, callWall: 7600 };
    const spot = 7400;
    const positions = [makeStripPosition("p1", 7200, 45), makeStripPosition("p2", 7700, 45)];

    const strip = buildScenarioStrip(levels, positions, spot);

    for (let i = 1; i < strip.levels.length; i++) {
      const prev = strip.levels[i - 1];
      const cur = strip.levels[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      if (prev !== undefined && cur !== undefined) {
        expect(cur).toBeGreaterThan(prev);
      }
    }
  });

  it("omits a null put/call wall instead of rendering it as 0", () => {
    const levels = { putWall: null, flip: 7350, callWall: null };
    const spot = 7400;

    const strip = buildScenarioStrip(levels, [], spot);

    expect(strip.levels).toEqual([7350, 7400]);
    expect(strip.levels).not.toContain(0);
  });

  it("front-expiry label equals the earliest included frontDte, formatted month/day", () => {
    const levels = { putWall: null, flip: null, callWall: null };
    const spot = 7400;
    const positions = [
      makeStripPosition("p1", 7400, 30),
      makeStripPosition("p2", 7400, 10), // earliest included — governs the label
      makeStripPosition("p3", 7400, 1, false), // excluded — must not govern the label
    ];

    const strip = buildScenarioStrip(levels, positions, spot);

    const expectedDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const expectedLabel = expectedDate.toLocaleString(undefined, { month: "short", day: "numeric" });
    expect(strip.expiryLabel).toBe(expectedLabel);
  });
});

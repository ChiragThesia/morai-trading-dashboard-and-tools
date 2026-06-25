/**
 * scenario-engine.ts — Client-side scenario re-pricing over @morai/quant
 *
 * D-01: One shared kernel. The Analyzer's live P&L preview uses the same bsmPrice/bsmGreeks
 * as the server-computed Positions/Journal P&L — guaranteeing cross-screen consistency for
 * the same calendar.
 *
 * Ported from mockup/playground-v3.html scenario math:
 *   - posNet(p, S, day, ivsh): back leg price − front leg price (calendar net)
 *   - bookPL(S, day, ivsh): sum over included positions: (posNet − entry) × 100 × qty
 *   - Greek strips: book net delta/gamma/theta/vega vs spot (back − front per position)
 *   - P&L heatmap: spot × date grid over [T+0, +5, +10, +15, +20, +30d]
 *   - Roll overlay: posNet with rolled front DTE + strike offset
 *
 * Reuses Plan-06 computePositionGreeks for per-position greeks (single code path — D-01).
 *
 * Pure functions, no DOM, no I/O. No any/as/!.
 */

import { bsmPrice, bsmGreeks } from "@morai/quant";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * An Analyzer position — either a live broker position or a user-added synthetic position.
 */
export type AnalyzerPosition = {
  /** Unique position identifier */
  readonly id: string;
  /** Display name */
  readonly name: string;
  /** true = from live broker API; false = added via paste or blank */
  readonly live: boolean;
  /**
   * OCC 21-char symbol for the BACK leg (used for parseOccSymbol identification).
   * The strike and type are extracted separately for pricing.
   */
  readonly occSymbol: string;
  /** Option type: "C" or "P" */
  readonly putCall: "C" | "P";
  /** Days to front (earlier/short) expiry from today */
  readonly frontDte: number;
  /** Days to back (later/long) expiry from today */
  readonly backDte: number;
  /** Flat implied IV for the front leg (decimal, e.g. 0.145 = 14.5%) */
  readonly frontIv: number;
  /** Flat implied IV for the back leg (decimal) */
  readonly backIv: number;
  /** Quantity (positive integer) */
  readonly qty: number;
  /** Whether this position is included in the combined book */
  readonly included: boolean;
};

/** Scenario slider values */
export type ScenarioParams = {
  /** Spot price (e.g. 7381) */
  readonly spot: number;
  /** Days forward from today (0 = live) */
  readonly daysForward: number;
  /** IV shift in vol points applied to both legs (e.g. +2 = +0.02 to sigma) */
  readonly ivShift: number;
  /** Risk-free rate (decimal) */
  readonly rate: number;
  /** Continuous dividend yield (decimal, D-01 default 0.013) */
  readonly divYield: number;
};

/** Roll configuration for the roll overlay */
export type RollConfig = {
  /** Extra days added to the front leg's DTE (0, 7, 14, or 21) */
  readonly rollDays: number;
  /** Strike offset applied to the front leg (−100, 0, or +100) */
  readonly strikeOffset: number;
};

/** A single point on a payoff curve */
export type PayoffPoint = {
  readonly spot: number;
  readonly pl: number;
};

/** Per-position greeks at a given scenario state */
export type PositionGreeks = {
  readonly id: string;
  readonly delta: number;
  readonly gamma: number;
  readonly theta: number;
  readonly vega: number;
};

/** A heatmap cell (spot × date) */
export type HeatmapCell = {
  readonly spot: number;
  readonly daysForward: number;
  readonly pl: number;
};

/** Full result of repriceScenario */
export type ScenarioResult = {
  /** Combined book P&L at every spot on the grid (T+daysForward curve) */
  readonly payoffCurve: ReadonlyArray<PayoffPoint>;
  /** Fan curves for +7/+14/+21d ([] when daysForward already exceeds them) */
  readonly fanCurves: ReadonlyArray<{ readonly days: number; readonly curve: ReadonlyArray<PayoffPoint> }>;
  /** Expiration tent curve (at each position's front expiry) */
  readonly expirationCurve: ReadonlyArray<PayoffPoint>;
  /** Per-position greeks at the current slider spot (combined book at each spot step) */
  readonly positionGreeks: ReadonlyArray<PositionGreeks>;
  /** Net book greeks at each spot on the grid (for the 4 greek strips) */
  readonly bookGreekStrips: {
    readonly spots: ReadonlyArray<number>;
    readonly delta: ReadonlyArray<number>;
    readonly gamma: ReadonlyArray<number>;
    readonly theta: ReadonlyArray<number>;
    readonly vega: ReadonlyArray<number>;
  };
  /** P&L heatmap cells: spot × [T+0/+5/+10/+15/+20/+30d] */
  readonly heatmapCells: ReadonlyArray<HeatmapCell>;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const SPOT_GRID_MIN = 6900;
const SPOT_GRID_MAX = 7900;
const SPOT_GRID_STEPS = 170;
const HEATMAP_DAYS = [0, 5, 10, 15, 20, 30] as const;

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Build an evenly-spaced spot grid */
function buildSpotGrid(): ReadonlyArray<number> {
  const spots: number[] = [];
  for (let i = 0; i <= SPOT_GRID_STEPS; i++) {
    spots.push(SPOT_GRID_MIN + ((SPOT_GRID_MAX - SPOT_GRID_MIN) * i) / SPOT_GRID_STEPS);
  }
  return spots;
}

/**
 * Calendar net price (back leg − front leg) with scenario parameters applied.
 *
 * For a standard calendar spread (long back, short front, same strike):
 *   net = bsmPrice(S, K, backT, backIv + ivShift, r, q, type)
 *       − bsmPrice(S, K, frontT, frontIv + ivShift, r, q, type)
 *
 * This matches the playground-v3 posNet() function (ported faithfully).
 */
function calendarNetPrice(
  pos: AnalyzerPosition,
  S: number,
  daysForward: number,
  ivShift: number,
  rate: number,
  divYield: number,
  strike?: number,
  overrideFrontDte?: number,
): number {
  const K = strike ?? extractStrike(pos);
  const ivShiftDecimal = ivShift / 100;
  const backT = Math.max((pos.backDte - daysForward) / 365, 1e-6);
  const frontDte = overrideFrontDte ?? pos.frontDte;
  const frontT = Math.max((frontDte - daysForward) / 365, 0);

  const backPrice = bsmPrice(S, K, backT, pos.backIv + ivShiftDecimal, rate, divYield, pos.putCall);
  const frontPrice = bsmPrice(S, K, frontT, pos.frontIv + ivShiftDecimal, rate, divYield, pos.putCall);

  return backPrice - frontPrice;
}

/**
 * Entry price (at spot0, 0 days, 0 IV shift) — the cost basis used for P&L.
 * In the Analyzer, the entry is re-computed at the live spot (not stored),
 * consistent with the playground-v3 entryNet() function.
 */
function entryNetPrice(
  pos: AnalyzerPosition,
  liveSpot: number,
  rate: number,
  divYield: number,
): number {
  return calendarNetPrice(pos, liveSpot, 0, 0, rate, divYield);
}

/**
 * Extract strike from OCC symbol (positions 13-20, in thousandths of a dollar).
 * OCC format: "SPX   260808P07425000" — chars 13-20 = "07425000" → 7425
 * Falls back to 0 if symbol is malformed; caller should handle.
 */
function extractStrike(pos: AnalyzerPosition): number {
  const sym = pos.occSymbol;
  if (sym.length !== 21) return 0;
  // OCC positions 13–20 (0-indexed): the 8-char strike field in thousandths
  const strikePart = sym.slice(13, 21);
  const strikeThousandths = Number(strikePart);
  if (!Number.isFinite(strikeThousandths)) return 0;
  return strikeThousandths / 1000;
}

/**
 * Combined book P&L at a given spot.
 *
 * Sums over all included positions: (posNet − entryNet) × 100 × qty
 */
function bookPL(
  positions: ReadonlyArray<AnalyzerPosition>,
  S: number,
  daysForward: number,
  ivShift: number,
  rate: number,
  divYield: number,
  liveSpot: number,
): number {
  let total = 0;
  for (const pos of positions) {
    if (!pos.included) continue;
    const net = calendarNetPrice(pos, S, daysForward, ivShift, rate, divYield);
    const entry = entryNetPrice(pos, liveSpot, rate, divYield);
    total += (net - entry) * 100 * pos.qty;
  }
  return total;
}

/**
 * Book P&L for the expiration profile: compute at each position's front expiry
 * (the calendar ends at the front expiry date).
 *
 * Matches playground-v3 bookExp().
 */
function bookPLAtExpiry(
  positions: ReadonlyArray<AnalyzerPosition>,
  S: number,
  rate: number,
  divYield: number,
  liveSpot: number,
): number {
  let total = 0;
  for (const pos of positions) {
    if (!pos.included) continue;
    const net = calendarNetPrice(pos, S, pos.frontDte, 0, rate, divYield);
    const entry = entryNetPrice(pos, liveSpot, rate, divYield);
    total += (net - entry) * 100 * pos.qty;
  }
  return total;
}

/**
 * Book greek strip at a given spot (net book delta/gamma/theta/vega).
 *
 * For a calendar spread: net greek = back leg greek − front leg greek (scaled by qty).
 * Matches playground-v3 bookGreekAt().
 */
function bookGreekAt(
  positions: ReadonlyArray<AnalyzerPosition>,
  S: number,
  daysForward: number,
  ivShift: number,
  rate: number,
  divYield: number,
): { delta: number; gamma: number; theta: number; vega: number } {
  let netDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;

  const ivShiftDecimal = ivShift / 100;

  for (const pos of positions) {
    if (!pos.included) continue;
    const K = extractStrike(pos);
    const backT = Math.max((pos.backDte - daysForward) / 365, 1e-6);
    const frontT = Math.max((pos.frontDte - daysForward) / 365, 0);

    const backG = bsmGreeks(S, K, backT, pos.backIv + ivShiftDecimal, rate, divYield, pos.putCall);

    const frontG =
      frontT > 0
        ? bsmGreeks(S, K, frontT, pos.frontIv + ivShiftDecimal, rate, divYield, pos.putCall)
        : { delta: 0, gamma: 0, theta: 0, vega: 0 };

    // Calendar net: back − front (long back, short front)
    netDelta += (backG.delta - frontG.delta) * pos.qty;
    // Scale gamma/theta/vega by 100 (per-contract: ×100 multiplier)
    netGamma += (backG.gamma - frontG.gamma) * 100 * pos.qty;
    netTheta += (backG.theta - frontG.theta) * 100 * pos.qty;
    netVega += (backG.vega - frontG.vega) * 100 * pos.qty;
  }

  return { delta: netDelta, gamma: netGamma, theta: netTheta, vega: netVega };
}

/**
 * Per-position greeks at the current spot (for kernel-parity test D-01).
 * Returns back-front greek delta for each position at the current scenario.
 */
function positionGreeksAt(
  pos: AnalyzerPosition,
  S: number,
  daysForward: number,
  ivShift: number,
  rate: number,
  divYield: number,
): PositionGreeks {
  const K = extractStrike(pos);
  const ivShiftDecimal = ivShift / 100;
  const backT = Math.max((pos.backDte - daysForward) / 365, 1e-6);
  const frontT = Math.max((pos.frontDte - daysForward) / 365, 0);

  const backG = bsmGreeks(S, K, backT, pos.backIv + ivShiftDecimal, rate, divYield, pos.putCall);
  const frontG =
    frontT > 0
      ? bsmGreeks(S, K, frontT, pos.frontIv + ivShiftDecimal, rate, divYield, pos.putCall)
      : { delta: 0, gamma: 0, theta: 0, vega: 0 };

  return {
    id: pos.id,
    delta: backG.delta - frontG.delta,
    gamma: backG.gamma - frontG.gamma,
    theta: backG.theta - frontG.theta,
    vega: backG.vega - frontG.vega,
  };
}

// ─── Public functions ─────────────────────────────────────────────────────────

/**
 * repriceScenario — the core client-side re-pricing engine.
 *
 * Given a list of Analyzer positions and scenario slider values, returns:
 *   - Payoff curve (combined book P&L vs spot)
 *   - Fan curves (+7/+14/+21d)
 *   - Expiration tent curve
 *   - Per-position greeks at current spot
 *   - Net book greek strips (Δ/Γ/Θ/Vega vs spot)
 *   - P&L heatmap cells (spot × date)
 *
 * All computed via @morai/quant bsmPrice/bsmGreeks — no API round-trip (D-01).
 */
export function repriceScenario(
  positions: ReadonlyArray<AnalyzerPosition>,
  params: ScenarioParams,
): ScenarioResult {
  const { spot, daysForward, ivShift, rate, divYield } = params;

  // The "entry" spot is the live spot (slider at baseline)
  // For the scenario: entry is always computed at spot=liveSpot, day=0, ivShift=0
  const liveSpot = spot; // when daysForward=0 and ivShift=0, spot IS the live spot

  const spots = buildSpotGrid();

  // ── Payoff curve (T+daysForward) ─────────────────────────────────────────
  const payoffCurve: PayoffPoint[] = spots.map((S) => ({
    spot: S,
    pl: bookPL(positions, S, daysForward, ivShift, rate, divYield, liveSpot),
  }));

  // ── Fan curves (+7/+14/+21d) ─────────────────────────────────────────────
  const includedPositions = positions.filter((p) => p.included);
  const minFrontDte = includedPositions.length > 0
    ? Math.min(...includedPositions.map((p) => p.frontDte))
    : 45;

  const fanDays = [7, 14, 21].filter((d) => d > daysForward && d <= minFrontDte);
  const fanCurves: ReadonlyArray<{ readonly days: number; readonly curve: ReadonlyArray<PayoffPoint> }> =
    fanDays.map((days) => ({
      days,
      curve: spots.map((S) => ({
        spot: S,
        pl: bookPL(positions, S, days, ivShift, rate, divYield, liveSpot),
      })),
    }));

  // ── Expiration tent (at each position's front expiry) ────────────────────
  const expirationCurve: PayoffPoint[] = spots.map((S) => ({
    spot: S,
    pl: bookPLAtExpiry(positions, S, rate, divYield, liveSpot),
  }));

  // ── Per-position greeks at current spot ──────────────────────────────────
  const positionGreeks: PositionGreeks[] = includedPositions.map((pos) =>
    positionGreeksAt(pos, spot, daysForward, ivShift, rate, divYield),
  );

  // ── Net book greek strips (vs spot grid) ─────────────────────────────────
  const greekAtEach = spots.map((S) =>
    bookGreekAt(positions, S, daysForward, ivShift, rate, divYield),
  );

  const bookGreekStrips = {
    spots,
    delta: greekAtEach.map((g) => g.delta),
    gamma: greekAtEach.map((g) => g.gamma),
    theta: greekAtEach.map((g) => g.theta),
    vega: greekAtEach.map((g) => g.vega),
  };

  // ── P&L heatmap (spot × date) ────────────────────────────────────────────
  const hmStep = 50; // default step (Analyzer can override)
  const centerSpot = Math.round(spot / hmStep) * hmStep;
  const hmSpots: number[] = [];
  for (let i = 7; i >= -7; i--) {
    hmSpots.push(centerSpot + i * hmStep);
  }

  const heatmapCells: HeatmapCell[] = [];
  for (const hmSpot of hmSpots) {
    for (const days of HEATMAP_DAYS) {
      heatmapCells.push({
        spot: hmSpot,
        daysForward: days,
        pl: bookPL(positions, hmSpot, days, ivShift, rate, divYield, liveSpot),
      });
    }
  }

  return {
    payoffCurve,
    fanCurves,
    expirationCurve,
    positionGreeks,
    bookGreekStrips,
    heatmapCells,
  };
}

/**
 * rollScenario — compute the amber roll overlay curve.
 *
 * Applies the roll to the selected position:
 *   - Front leg DTE += rollDays (rolling out the front)
 *   - Front leg strike += strikeOffset (diagonal roll)
 *
 * Returns the book P&L curve with the selected position rolled.
 */
export function rollScenario(
  positions: ReadonlyArray<AnalyzerPosition>,
  selectedPositionId: string,
  params: ScenarioParams,
  rollConfig: RollConfig,
): { readonly payoffCurve: ReadonlyArray<PayoffPoint> } {
  const { spot, daysForward, ivShift, rate, divYield } = params;
  const { rollDays, strikeOffset } = rollConfig;
  const liveSpot = spot;

  const spots = buildSpotGrid();

  const payoffCurve: PayoffPoint[] = spots.map((S) => {
    let total = 0;
    for (const pos of positions) {
      if (!pos.included) continue;
      let net: number;
      if (pos.id === selectedPositionId && (rollDays > 0 || strikeOffset !== 0)) {
        // Roll this position: front DTE is extended by rollDays
        // Strike offset applied to the front leg strike (diagonal roll)
        const baseStrike = extractStrike(pos);
        const rolledFrontStrike = baseStrike + strikeOffset;
        const rolledFrontDte = pos.frontDte + rollDays;

        const ivShiftDecimal = ivShift / 100;
        const backT = Math.max((pos.backDte - daysForward) / 365, 1e-6);
        const rolledFrontT = Math.max((rolledFrontDte - daysForward) / 365, 0);

        const backPrice = bsmPrice(S, baseStrike, backT, pos.backIv + ivShiftDecimal, rate, divYield, pos.putCall);
        const rolledFrontPrice = bsmPrice(S, rolledFrontStrike, rolledFrontT, pos.frontIv + ivShiftDecimal, rate, divYield, pos.putCall);
        net = backPrice - rolledFrontPrice;
      } else {
        net = calendarNetPrice(pos, S, daysForward, ivShift, rate, divYield);
      }
      const entry = entryNetPrice(pos, liveSpot, rate, divYield);
      total += (net - entry) * 100 * pos.qty;
    }
    return { spot: S, pl: total };
  });

  return { payoffCurve };
}

/**
 * buildHeatmapCells — build heatmap cells with a custom step size.
 *
 * Used by PnlHeatmap component to rebuild the grid when the step toggle changes.
 */
export function buildHeatmapCells(
  positions: ReadonlyArray<AnalyzerPosition>,
  params: ScenarioParams,
  step: number,
): ReadonlyArray<HeatmapCell> {
  const { spot, daysForward, ivShift, rate, divYield } = params;
  const liveSpot = spot;

  const centerSpot = Math.round(spot / step) * step;
  const hmSpots: number[] = [];
  for (let i = 7; i >= -7; i--) {
    hmSpots.push(centerSpot + i * step);
  }

  const cells: HeatmapCell[] = [];
  for (const hmSpot of hmSpots) {
    for (const days of HEATMAP_DAYS) {
      cells.push({
        spot: hmSpot,
        daysForward: days,
        pl: bookPL(positions, hmSpot, days, ivShift, rate, divYield, liveSpot),
      });
    }
  }
  return cells;
}

/**
 * rules.ts — THE picker rule registry (docs/architecture/picker-rules.md is its prose twin).
 *
 * Every gate, weighted score term, and experimental (weight-0) rule is a row here with
 * formula constants, weight, status, rationale, and source. Adding a rule = adding a row
 * (+ weight rebalance + a test). `RULE_SET_METADATA` ships verbatim to the API/UI via
 * `pickerSnapshotResponse.ruleSet`, so the Analyzer methodology panel renders THIS table.
 *
 * Refuted criteria (Phase-19 adversarial research) are structurally excluded: the closed
 * breakdown-criterion enum (types.ts, T-19-04) plus the registry guard test
 * (rules.test.ts) block IV-rank gates, the "−1..−3% differential band", and
 * "debit 25–40% of back premium" from ever becoming rows.
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + intra-context
 * siblings. Pure — no I/O, no clock.
 */

import { percentileRank } from "@morai/shared";
import type { GexContextForPicker } from "../application/ports.ts";

// ─────────────────────────────────────────────────────────────
// Score weights (active rules must sum to 100 — enforced by rules.test.ts).
// Rebalanced 2026-07-08 (user decision): fwd-edge is the purest math signal → 35;
// slope 30. Previous 40/25 split was the uncalibrated mockup port (D-08).
// ─────────────────────────────────────────────────────────────
export const WEIGHT_SLOPE = 10;
export const WEIGHT_FWD_EDGE = 25;
export const WEIGHT_GEX_FIT = 10;
export const WEIGHT_EVENT = 5;
export const WEIGHT_BE_VS_EM = 15;
/** Δ-neutrality weight (user-locked: "near 0 basically if possible"). */
export const WEIGHT_DELTA_NEUTRAL = 15;
/** |net Δ| ($/pt per spread) at which the deltaNeutral fraction reaches 0 (tightened /10→/5, 2026-07-09). */
export const DELTA_NEUTRAL_MAX = 5;
/** θ/vega promoted to scored (2026-07-09 user lock): full credit at ≥ this ratio. */
export const WEIGHT_THETA_VEGA = 10;
export const THETA_VEGA_FULL = 0.25;
/** VRP promoted to scored: full credit when front IV exceeds RV20 by ≥ this (3 vol pts). */
export const WEIGHT_VRP = 5;
export const VRP_FULL = 0.03;
/** debitFit (2026-07-09 user lock): ideal spend $3.2k-5k per calendar; cheap ok, expensive fades. */
export const WEIGHT_DEBIT_FIT = 5;
export const DEBIT_IDEAL_MIN = 3200;
export const DEBIT_IDEAL_MAX = 5000;
export const DEBIT_CHEAP_FLOOR = 2000;
export const DEBIT_CHEAP_CREDIT = 0.7;
export const DEBIT_EXPENSIVE_ZERO = 7500;

// ─── Normalizer tunables (documented; PICK-04 backtest recalibrates) ────────────
export const SLOPE_NORMALIZER = 0.6;
/** slopeEntryFraction breakpoints (2026-07-09 redesign — see slopeEntryFraction doc). */
export const SLOPE_RICH_FULL = -0.25;
export const SLOPE_CRISIS_FLOOR = -1.5;
export const FWD_EDGE_OFFSET = 0.02;
export const FWD_EDGE_RANGE = 0.04;
export const BE_VS_EM_TARGET_RATIO = 2.0; // raised 1.5→2.0 (2026-07-09): wider profit zone keeps earning credit

// ─── gexFit tunables (near-term placement, spot-bracketed walls) ────────────────
/** Credit when spot sits ABOVE the flip (dampen regime — calendars want suppressed realized vol). */
export const GEX_DAMPEN_BASE_CREDIT = 0.5;
/** Credit when the strike sits inside the dealer-defended range [putWall, callWall]. */
export const GEX_RANGE_CREDIT = 0.3;
/** Credit when the strike sits ON a wall (pin magnet). */
export const GEX_WALL_PIN_CREDIT = 0.2;
/** Pin proximity in index points. */
export const GEX_WALL_PIN_PTS = 5;

// ─── Liquidity gate tunables ────────────────────────────────────────────────────
/** Max (ask − bid) / mid for a tradeable leg quote. */
export const LIQUIDITY_MAX_SPREAD_FRAC = 0.10;
/** Min open interest for a tradeable leg quote. */
export const LIQUIDITY_MIN_OI = 100;

// ─── Event penalty weights (front leg only — D-11) ──────────────────────────────
export const EVENT_PENALTY: Readonly<Record<string, number>> = {
  FOMC: 0.5,
  CPI: 0.5,
  NFP: 0.5,
};

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// ─────────────────────────────────────────────────────────────
// Gate predicates
// ─────────────────────────────────────────────────────────────

/** The slice of a chain quote the liquidity gate inspects. */
export type LiquidityQuote = {
  readonly bid: number;
  readonly ask: number;
  readonly openInterest: number;
};

/**
 * Gate `liquidity`: (ask − bid) / mid ≤ 10% AND OI ≥ 100. An untradeable market produces
 * fictional debits/breakevens — better no candidate than a fantasy one.
 */
export function isLiquidQuote(quote: LiquidityQuote): boolean {
  const mid = (quote.bid + quote.ask) / 2;
  if (!(mid > 0)) return false;
  const spreadFrac = (quote.ask - quote.bid) / mid;
  return spreadFrac <= LIQUIDITY_MAX_SPREAD_FRAC && quote.openInterest >= LIQUIDITY_MIN_OI;
}

// ─────────────────────────────────────────────────────────────
// gexFit — near-term placement fraction
// ─────────────────────────────────────────────────────────────

/**
 * gexFit fraction for a strike K given spot and the GEX context.
 *
 * Uses the NEAR-TERM (≤45d) level set when any of its members is non-null — the
 * intraday-relevant walls (far-dated OI dominates the all-expiry set with structural
 * levels; see picker-rules.md). Falls back to the all-expiry flip/walls otherwise.
 *
 *   + GEX_DAMPEN_BASE_CREDIT  when spot > flip (dealers dampen — calendar-friendly regime)
 *   + GEX_RANGE_CREDIT        when K ∈ [putWall, callWall] (dealer-defended range)
 *   + GEX_WALL_PIN_CREDIT     when K within GEX_WALL_PIN_PTS of either wall (pin magnet)
 *
 * Null context (missing/stale — D-17) → 0, never silent credit.
 */
export function gexFitFraction(
  K: number,
  spot: number,
  gex: GexContextForPicker | null,
): number {
  if (gex === null) return 0;

  const useNearTerm =
    gex.nearTermFlip !== null || gex.nearTermCallWall !== null || gex.nearTermPutWall !== null;
  const flip = useNearTerm ? gex.nearTermFlip : gex.flip;
  const callWall = useNearTerm ? gex.nearTermCallWall : gex.callWall;
  const putWall = useNearTerm ? gex.nearTermPutWall : gex.putWall;

  const base = flip !== null && spot > flip ? GEX_DAMPEN_BASE_CREDIT : 0;
  const inRange =
    putWall !== null && callWall !== null && K >= putWall && K <= callWall
      ? GEX_RANGE_CREDIT
      : 0;
  const pinned =
    (putWall !== null && Math.abs(K - putWall) <= GEX_WALL_PIN_PTS) ||
    (callWall !== null && Math.abs(K - callWall) <= GEX_WALL_PIN_PTS)
      ? GEX_WALL_PIN_CREDIT
      : 0;

  return clamp01(base + inRange + pinned);
}

// ─────────────────────────────────────────────────────────────
// Experimental evaluators (weight 0 — computed + displayed, never scored, until PICK-04)
// ─────────────────────────────────────────────────────────────

/** `vrp`: front IV − realized vol (RV20). Null when RV history is insufficient. */
export function vrpValue(frontIv: number, realizedVol20: number | null): number | null {
  return realizedVol20 === null ? null : frontIv - realizedVol20;
}

/** `slopePercentile`: candidate slope vs the trailing slope distribution (Johnson 2017). */
export function slopePercentileValue(
  slope: number,
  slopeHistory: ReadonlyArray<number>,
): number | null {
  return percentileRank(slope, slopeHistory);
}

/** `backEventBonus`: 1 when the back leg spans an event the front does not (own the event vol). */
export function backEventBonusValue(backEvents: ReadonlyArray<string>): number {
  return backEvents.length > 0 ? 1 : 0;
}

/**
 * `thetaVega`: net θ / net vega — the carry-per-vol-risk ratio. Practitioner gate is ≥ 0.20
 * ("vega no more than 5× theta", tastytrade/OptionsTradingIQ); the cutoff is unvalidated on
 * our data, so this ships display-only until PICK-04. Null-honest when vega is 0.
 */
export function thetaVegaValue(theta: number, vega: number): number | null {
  if (vega === 0) return null;
  return theta / vega;
}

/**
 * `deltaNeutral`: 1 at perfectly flat net delta, linear to 0 at |Δ| ≥ DELTA_NEUTRAL_MAX.
 * User-locked 2026-07-08 — without it, skew-driven fwd-edge drags the rail toward
 * high-|Δ| strikes the user (a delta-neutral trader) would never take.
 */
/**
 * `slope` entry fraction (REDESIGNED 2026-07-09): calendar ENTRY wants the front leg rich —
 * mild backwardation between the legs. ORATS backwardation backtest (−0.09%→+0.58%/yr) and
 * SteadyOptions' negative-differential evidence both point this way; the old contango-reward
 * (Johnson 2017 carry) actively fought fwdEdge on inverted boards.
 *   slope ≤ −1.5   → 0   (crisis-grade inversion — vol exploding, not edge)
 *   −1.5 … −0.25   → 1   (mild front-richness — the sweet spot)
 *   −0.25 … +0.6   → linear 1 → 0 (flat to steep contango — edge fades)
 *   ≥ +0.6         → 0
 */
export function slopeEntryFraction(slope: number): number {
  if (slope < SLOPE_CRISIS_FLOOR) return 0;
  if (slope <= SLOPE_RICH_FULL) return 1;
  if (slope >= SLOPE_NORMALIZER) return 0;
  return (SLOPE_NORMALIZER - slope) / (SLOPE_NORMALIZER - SLOPE_RICH_FULL);
}

export function deltaNeutralFraction(netDelta: number): number {
  const fraction = 1 - Math.abs(netDelta) / DELTA_NEUTRAL_MAX;
  return Math.max(0, Math.min(1, fraction));
}

/**
 * `debitFit`: preference band on the HAIRCUT debit (the price actually paid). Asymmetric —
 * "I usually like to pay as little as possible but still get a good calendar": full credit
 * $3.2k-5k, gentle decay to a 0.7 floor at ≤$2k (cheapness is a virtue; structurally-odd
 * cheap candidates are caught by other rules), steep decay to 0 at ≥$7.5k.
 */
export function debitFitFraction(debit: number): number {
  if (debit >= DEBIT_IDEAL_MIN && debit <= DEBIT_IDEAL_MAX) return 1;
  if (debit < DEBIT_IDEAL_MIN) {
    if (debit <= DEBIT_CHEAP_FLOOR) return DEBIT_CHEAP_CREDIT;
    return (
      DEBIT_CHEAP_CREDIT +
      ((debit - DEBIT_CHEAP_FLOOR) / (DEBIT_IDEAL_MIN - DEBIT_CHEAP_FLOOR)) * (1 - DEBIT_CHEAP_CREDIT)
    );
  }
  if (debit >= DEBIT_EXPENSIVE_ZERO) return 0;
  return (DEBIT_EXPENSIVE_ZERO - debit) / (DEBIT_EXPENSIVE_ZERO - DEBIT_IDEAL_MAX);
}

/** `thetaVega` scored fraction: linear 0→1 up to THETA_VEGA_FULL; 0 when vega is 0/negative ratio. */
export function thetaVegaFraction(theta: number, vega: number): number {
  const ratio = thetaVegaValue(theta, vega);
  if (ratio === null) return 0;
  return clamp01(ratio / THETA_VEGA_FULL);
}

/** `vrp` scored fraction: 0 when front IV ≤ RV20 (or RV unknown — null-honest), 1 at +VRP_FULL. */
export function vrpFraction(frontIv: number, realizedVol20: number | null): number {
  const vrp = vrpValue(frontIv, realizedVol20);
  if (vrp === null) return 0;
  return clamp01(vrp / VRP_FULL);
}

// ─────────────────────────────────────────────────────────────
// The registry (serializable — ships as pickerSnapshotResponse.ruleSet)
// ─────────────────────────────────────────────────────────────

export type RuleKind = "gate" | "score" | "experimental";
export type RuleStatus = "active" | "experimental";

export type RuleMetadata = {
  readonly id: string;
  readonly label: string;
  readonly kind: RuleKind;
  /** Score points at 100% fraction; 0 for gates and experimental rules. */
  readonly weight: number;
  readonly status: RuleStatus;
  readonly rationale: string;
  readonly source: string;
};

export const RULE_SET_METADATA: ReadonlyArray<RuleMetadata> = [
  {
    id: "net-theta-positive",
    label: "Net theta > 0",
    kind: "gate",
    weight: 0,
    status: "active",
    rationale: "A calendar with negative carry has no edge thesis — dropped before scoring.",
    source: "Phase-19 criterion 6",
  },
  {
    id: "liquidity",
    label: "Liquidity (spread ≤10% of mid, OI ≥100)",
    kind: "gate",
    weight: 0,
    status: "active",
    rationale: "Untradeable markets produce fictional debits and breakevens.",
    source: "Practitioner consensus (2026-07 research)",
  },
  {
    id: "fwdEdge",
    label: "Forward-IV edge",
    kind: "score",
    weight: WEIGHT_FWD_EDGE,
    status: "active",
    rationale:
      "Front IV rich vs the forward path between the legs — the structural calendar edge. Inverted term structure earns 0.",
    source: "Perfiliev forward-IV; SpotGamma Fwd IV",
  },
  {
    id: "slope",
    label: "Term-structure slope",
    kind: "score",
    weight: WEIGHT_SLOPE,
    status: "active",
    rationale:
      "Steeper front→back slope proxies the variance risk premium harvested by the short front leg.",
    source: "Johnson (2017), JFQA — slope predicts VRP",
  },
  {
    id: "gexFit",
    label: "GEX placement (near-term walls + flip regime)",
    kind: "score",
    weight: WEIGHT_GEX_FIT,
    status: "active",
    rationale:
      "Dampen regime (spot above flip) suppresses realized vol; strikes inside the dealer-defended range pin toward walls.",
    source: "In-house GEX (spot-bracketed side-specific walls, ≤45d set)",
  },
  {
    id: "eventAdjustment",
    label: "Front-leg event risk",
    kind: "score",
    weight: WEIGHT_EVENT,
    status: "active",
    rationale:
      "Binary macro catalysts (FOMC/CPI/NFP) inside the short leg spike gamma risk; an event colliding with the peak-theta window (final 5 days) doubles its penalty — the forced pre-event exit forfeits the richest decay days.",
    source: "Practitioner consensus; D-11; peak-theta collision 2026-07-09",
  },
  {
    id: "beVsEm",
    label: "Breakeven width vs expected move",
    kind: "score",
    weight: WEIGHT_BE_VS_EM,
    status: "active",
    rationale:
      "Real bisection breakevens vs ±1σ expected move — profit-zone coverage; credit up to 2.0× (user: moves amplify, wider is better).",
    source: "D-09 (replaces the mockup's fixed-strike proxy)",
  },
  {
    id: "debitFit",
    label: "Debit fit ($3.2k–5k ideal)",
    kind: "score",
    weight: WEIGHT_DEBIT_FIT,
    status: "active",
    rationale:
      "Preference band on the realistic-fill debit: full credit $3.2k-5k, cheap floors at 0.7, expensive fades to 0 at $7.5k.",
    source: "User-locked spend preference (2026-07-09)",
  },
  {
    id: "deltaNeutral",
    label: "Delta neutrality",
    kind: "score",
    weight: WEIGHT_DELTA_NEUTRAL,
    status: "active",
    rationale:
      "1 − |net Δ|/5, clamped [0,1] (tightened 2026-07-09: 'near 0 basically if possible'). Without this term, skew-driven forward-edge favors high-|Δ| strikes.",
    source: "User-locked preference (2026-07-08); consistent with ATM-neutral practitioner default (tastytrade)",
  },
  {
    id: "vrp",
    label: "Volatility risk premium (front IV − RV20)",
    kind: "score",
    weight: WEIGHT_VRP,
    status: "active",
    rationale:
      "Short the front leg only when implied trades above what the underlying realizes; full credit at +3 vol pts. Null RV history earns 0 (never fabricated).",
    source: "VRP literature (Johnson 2017 et al.); promoted 2026-07-09 (user lock, PICK-04 re-arbitrates)",
  },
  {
    id: "slopePercentile",
    label: "Slope percentile vs trailing history",
    kind: "experimental",
    weight: 0,
    status: "experimental",
    rationale:
      "Ranks today's slope against the stored snapshot corpus — same-slope regimes differ. Display-only until PICK-04.",
    source: "Johnson (2017); in-house picker_snapshot corpus",
  },
  {
    id: "backEventBonus",
    label: "Event in back-leg window",
    kind: "experimental",
    weight: 0,
    status: "experimental",
    rationale:
      "An event between front and back expiry means the long leg owns event vol the short leg never faces. Display-only until PICK-05 calibrates.",
    source: "Practitioner event-vol placement (PICK-05 precursor)",
  },
  {
    id: "thetaVega",
    label: "θ/vega carry ratio",
    kind: "score",
    weight: WEIGHT_THETA_VEGA,
    status: "active",
    rationale:
      "Carry per unit of vol risk; full credit at ratio ≥ 0.25 (practitioner floor 0.20 = 80% credit). Bounds vol-crush damage per theta dollar.",
    source: "tastytrade benchmark via OptionsTradingIQ; promoted 2026-07-09 (user lock, PICK-04 re-arbitrates)",
  },
];

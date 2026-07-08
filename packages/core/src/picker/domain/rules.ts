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
export const WEIGHT_SLOPE = 30;
export const WEIGHT_FWD_EDGE = 35;
export const WEIGHT_GEX_FIT = 15;
export const WEIGHT_EVENT = 10;
export const WEIGHT_BE_VS_EM = 10;

// ─── Normalizer tunables (documented; PICK-04 backtest recalibrates) ────────────
export const SLOPE_NORMALIZER = 0.6;
export const FWD_EDGE_OFFSET = 0.02;
export const FWD_EDGE_RANGE = 0.04;
export const BE_VS_EM_TARGET_RATIO = 1.5;

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
    rationale: "Binary macro catalysts (FOMC/CPI/NFP) inside the short leg spike gamma risk.",
    source: "Practitioner consensus; D-11",
  },
  {
    id: "beVsEm",
    label: "Breakeven width vs expected move",
    kind: "score",
    weight: WEIGHT_BE_VS_EM,
    status: "active",
    rationale: "Real bisection breakevens vs ±1σ expected move — profit-zone coverage.",
    source: "D-09 (replaces the mockup's fixed-strike proxy)",
  },
  {
    id: "vrp",
    label: "Volatility risk premium (front IV − RV20)",
    kind: "experimental",
    weight: 0,
    status: "experimental",
    rationale:
      "Short the front leg only when implied trades above what the underlying realizes. Display-only until the PICK-04 backtest calibrates a threshold.",
    source: "VRP literature (Johnson 2017 et al.)",
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
];

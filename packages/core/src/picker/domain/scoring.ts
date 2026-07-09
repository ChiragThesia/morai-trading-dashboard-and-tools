/**
 * scoreCalendarCandidates — registry-driven scoring (rules.ts is the single rule table).
 *
 * Every weight, normalizer, and formula constant lives in `./rules.ts` (re-exported here for
 * compatibility with existing imports); this module ORCHESTRATES: it computes the shared
 * intermediates (forward IV, breakevens, expected move) once per candidate, asks each rule
 * for its fraction, assembles the closed-enum breakdown, and attaches the experimental
 * context entries (weight 0, display-only — PICK-04 promotes them).
 *
 * Never-silent guard-tagging (fwdIv precedent, 19-PATTERNS.md): an inverted term structure
 * zeroes fwdEdge outright; <2 breakevens zeroes beVsEm; a null/stale GEX context zeroes
 * gexFit; experimental values are null-honest. The score is always finite in [0,100].
 *
 * Hexagon law (architecture-boundaries §2): imports only `@morai/quant` (via breakevens),
 * this bounded context's own `application/ports.ts`, and sibling domain modules.
 */

import { computeFwdIv } from "./fwd-iv.ts";
import { findBreakevens } from "./breakevens.ts";
import {
  WEIGHT_SLOPE,
  WEIGHT_FWD_EDGE,
  WEIGHT_GEX_FIT,
  WEIGHT_EVENT,
  WEIGHT_BE_VS_EM,
  SLOPE_NORMALIZER,
  FWD_EDGE_OFFSET,
  FWD_EDGE_RANGE,
  BE_VS_EM_TARGET_RATIO,
  EVENT_PENALTY,
  gexFitFraction,
  vrpValue,
  slopePercentileValue,
  backEventBonusValue,
  thetaVegaValue,
  deltaNeutralFraction,
  slopeEntryFraction,
  WEIGHT_DELTA_NEUTRAL,
} from "./rules.ts";
import type { BreakdownEntry, ContextEntry, ExitPlan, RawCandidate, ScoredCandidate } from "./types.ts";
import type { GexContextForPicker } from "../application/ports.ts";

// ─── Compatibility re-exports (the registry owns these — see rules.ts) ─────────
export {
  WEIGHT_SLOPE,
  WEIGHT_FWD_EDGE,
  WEIGHT_GEX_FIT,
  WEIGHT_EVENT,
  WEIGHT_BE_VS_EM,
  SLOPE_NORMALIZER,
  FWD_EDGE_OFFSET,
  FWD_EDGE_RANGE,
  BE_VS_EM_TARGET_RATIO,
  EVENT_PENALTY,
} from "./rules.ts";

// ─────────────────────────────────────────────────────────────
// Exit-plan fixed defaults (D-01b) — universe/exit parameters, not score rules.
// ─────────────────────────────────────────────────────────────
export const EXIT_PROFIT_TARGET_PCT = 0.25;
export const EXIT_STOP_PCT = 0.175;
export const EXIT_MANAGE_SHORT_DTE = 21;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export type ScoringParams = {
  /** Risk-free rate (decimal), supplied by the use-case from config. */
  readonly r: number;
  /** Continuous dividend yield (decimal), supplied by the use-case from config. */
  readonly q: number;
  /** RV20 for the experimental `vrp` rule; omit/null when history is insufficient. */
  readonly realizedVol20?: number | null;
  /** Trailing candidate slopes for the experimental `slopePercentile` rule. */
  readonly slopeHistory?: ReadonlyArray<number>;
};

/**
 * Score a single candidate against the registry's active score rules, and attach the
 * experimental context entries. Never NaN — every degraded input zeroes (or nulls) its own
 * term rather than propagating an undefined value.
 */
function scoreOne(
  candidate: RawCandidate,
  gexContext: GexContextForPicker | null,
  params: ScoringParams,
): ScoredCandidate {
  const { r, q } = params;
  const K = candidate.frontLeg.strike;
  const tf = candidate.frontLeg.dte;
  const tb = candidate.backLeg.dte;
  const ivF = candidate.frontLeg.iv;
  const ivB = candidate.backLeg.iv;

  // ─── fwdEdge (never-NaN inverted-structure guard) ───
  const fwd = computeFwdIv(tf, ivF, tb, ivB);
  let fwdIv: number | null;
  let fwdEdge: number;
  let fwdEdgeFraction: number;
  if (fwd.guard === "ok") {
    fwdIv = fwd.fwdIv;
    fwdEdge = ivF - fwd.fwdIv;
    fwdEdgeFraction = clamp01((fwdEdge + FWD_EDGE_OFFSET) / FWD_EDGE_RANGE);
  } else {
    // Inverted term structure is never rewarded — 0 outright, not a neutral run through
    // the normalization window.
    fwdIv = null;
    fwdEdge = 0;
    fwdEdgeFraction = 0;
  }

  const expectedMove = candidate.spot * ivF * Math.sqrt(tf / 365);

  // ─── slope ───
  // 2026-07-09: front-richness is the entry edge (ORATS/SteadyOptions) — see rules.ts.
  const slopeFraction = slopeEntryFraction(candidate.slope);

  // ─── eventAdjustment (front-leg only, D-11) ───
  const evtPenalty = candidate.frontEvents.reduce((sum, name) => sum + (EVENT_PENALTY[name] ?? 0), 0);
  const eventFraction = Math.max(0, 1 - evtPenalty);

  // ─── gexFit (near-term placement — rules.ts owns the formula) ───
  const gexFit = gexFitFraction(K, candidate.spot, gexContext);

  // ─── beVsEm (real bisection breakevens, D-09) ───
  const breakevens = findBreakevens({
    spot: candidate.spot,
    frontStrike: K,
    backStrike: candidate.backLeg.strike,
    frontDte: tf,
    backDte: tb,
    frontIv: ivF,
    backIv: ivB,
    r,
    q,
    debit: candidate.debit,
  });
  const hasBreakevenPair = breakevens.length >= 2;
  const beVsEmRatio =
    hasBreakevenPair && expectedMove > 0
      ? (Math.max(...breakevens) - Math.min(...breakevens)) / expectedMove
      : 0;
  // Documented fallback (D-09/never-silent): fewer than 2 breakevens earns no beVsEm credit —
  // never a fabricated ratio, never NaN.
  const beVsEmFraction = hasBreakevenPair ? clamp01(beVsEmRatio / BE_VS_EM_TARGET_RATIO) : 0;

  // Δ-neutrality (user-locked): 1 at flat delta, 0 beyond ±10 $/pt.
  const deltaFraction = deltaNeutralFraction(candidate.delta);

  const breakdown: ReadonlyArray<BreakdownEntry> = [
    { criterion: "slope", weight: WEIGHT_SLOPE, rawValue: candidate.slope, contribution: slopeFraction * 100 },
    { criterion: "fwdEdge", weight: WEIGHT_FWD_EDGE, rawValue: fwdEdge, contribution: fwdEdgeFraction * 100 },
    { criterion: "gexFit", weight: WEIGHT_GEX_FIT, rawValue: gexFit, contribution: gexFit * 100 },
    { criterion: "eventAdjustment", weight: WEIGHT_EVENT, rawValue: evtPenalty, contribution: eventFraction * 100 },
    { criterion: "beVsEm", weight: WEIGHT_BE_VS_EM, rawValue: beVsEmRatio, contribution: beVsEmFraction * 100 },
    {
      criterion: "deltaNeutral",
      weight: WEIGHT_DELTA_NEUTRAL,
      rawValue: candidate.delta,
      contribution: deltaFraction * 100,
    },
  ];

  const rawScore =
    WEIGHT_SLOPE * slopeFraction +
    WEIGHT_FWD_EDGE * fwdEdgeFraction +
    WEIGHT_GEX_FIT * gexFit +
    WEIGHT_EVENT * eventFraction +
    WEIGHT_BE_VS_EM * beVsEmFraction +
    WEIGHT_DELTA_NEUTRAL * deltaFraction;
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // ─── Experimental context (weight 0, display-only — rules.ts registry) ───
  const context: ReadonlyArray<ContextEntry> = [
    {
      id: "vrp",
      label: "VRP (front IV − RV20)",
      value: vrpValue(ivF, params.realizedVol20 ?? null),
      note: "calibrating (PICK-04)",
    },
    {
      id: "slopePercentile",
      label: "Slope percentile",
      value: slopePercentileValue(candidate.slope, params.slopeHistory ?? []),
      note: "calibrating (PICK-04)",
    },
    {
      id: "backEventBonus",
      label: "Event in back window",
      value: backEventBonusValue(candidate.backEvents),
      note: "calibrating (PICK-05)",
    },
    {
      id: "thetaVega",
      label: "θ/vega carry ratio",
      value: thetaVegaValue(candidate.theta, candidate.vega),
      note: "calibrating (PICK-04)",
    },
  ];

  const exitPlan: ExitPlan = {
    profitTargetPct: EXIT_PROFIT_TARGET_PCT,
    stopPct: EXIT_STOP_PCT,
    manageShortDte: EXIT_MANAGE_SHORT_DTE,
    // EVT discipline: exit the day before a front-window tier-1 event when stamped.
    closeByExpiry: candidate.exitBeforeIso ?? candidate.frontLeg.expiration,
  };

  return {
    ...candidate,
    score,
    breakdown,
    fwdIv,
    fwdIvGuard: fwd.guard,
    fwdEdge,
    expectedMove,
    context,
    exitPlan,
  };
}

/**
 * Score every candidate against the registry's active weights (rules.ts), emitting the
 * closed-enum breakdown, the real beVsEm ratio (D-09), and the experimental context entries.
 * `gexContext` may be null (D-17: GEX snapshot missing/stale) — the gexFit term contributes
 * 0, never a silently-clean score.
 */
export function scoreCalendarCandidates(
  rawCandidates: ReadonlyArray<RawCandidate>,
  gexContext: GexContextForPicker | null,
  params: ScoringParams,
): ReadonlyArray<ScoredCandidate> {
  return rawCandidates.map((candidate) => scoreOne(candidate, gexContext, params));
}

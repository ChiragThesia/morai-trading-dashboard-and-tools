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

import { bsmPrice } from "@morai/quant";
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
  thetaVegaFraction,
  vrpFraction,
  debitFitFraction,
  WEIGHT_DEBIT_FIT,
  WEIGHT_THETA_VEGA,
  WEIGHT_VRP,
  deltaNeutralFraction,
  slopeEntryFraction,
  WEIGHT_DELTA_NEUTRAL,
} from "./rules.ts";
import type { BreakdownCriterion, BreakdownEntry, ContextEntry, ExitPlan, RawCandidate, ScoredCandidate } from "./types.ts";
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

/** Days between two ISO dates (to − from) via Date.UTC on parsed components (Pitfall 3). */
function isoDaysBetween(fromIso: string, toIso: string): number {
  const day = (iso: string): number => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
  };
  return day(toIso) - day(fromIso);
}

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
  /**
   * Ablation seam (PICK-04, T-27-03): override one or more active-rule weights. Absent/
   * undefined criteria fall back to the rules.ts constant — omitting this field entirely
   * (every live call site) reproduces today's live score/breakdown byte-identically.
   */
  readonly weights?: Partial<Record<BreakdownCriterion, number>>;
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
  // Ablation seam (PICK-04, T-27-03): per-criterion ?? fallback to the rules.ts constant —
  // no live call site passes `weights`, so this is a no-op for every existing caller.
  const wSlope = params.weights?.slope ?? WEIGHT_SLOPE;
  const wFwdEdge = params.weights?.fwdEdge ?? WEIGHT_FWD_EDGE;
  const wGexFit = params.weights?.gexFit ?? WEIGHT_GEX_FIT;
  const wEvent = params.weights?.eventAdjustment ?? WEIGHT_EVENT;
  const wBeVsEm = params.weights?.beVsEm ?? WEIGHT_BE_VS_EM;
  const wDeltaNeutral = params.weights?.deltaNeutral ?? WEIGHT_DELTA_NEUTRAL;
  const wThetaVega = params.weights?.thetaVega ?? WEIGHT_THETA_VEGA;
  const wVrp = params.weights?.vrp ?? WEIGHT_VRP;
  const wDebitFit = params.weights?.debitFit ?? WEIGHT_DEBIT_FIT;
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

  // ─── eventAdjustment (front-leg only, D-11; peak-theta collision doubles it 2026-07-09) ───
  const evtPenaltyBase = candidate.frontEvents.reduce((sum, name) => sum + (EVENT_PENALTY[name] ?? 0), 0);
  const evtPenalty = candidate.eventInPeakTheta ? evtPenaltyBase * 2 : evtPenaltyBase;
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

  // Δ-neutrality (user-locked, tightened 2026-07-09): 1 at flat delta, 0 beyond ±5 $/pt.
  const deltaFraction = deltaNeutralFraction(candidate.delta);

  // Promoted 2026-07-09 (user lock; PICK-04 re-arbitrates): θ/vega + VRP become scored terms.
  const thetaVegaFrac = thetaVegaFraction(candidate.theta, candidate.vega);
  const vrpFrac = vrpFraction(ivF, params.realizedVol20 ?? null);
  const debitFrac = debitFitFraction(candidate.debit);

  const breakdown: ReadonlyArray<BreakdownEntry> = [
    { criterion: "slope", weight: wSlope, rawValue: candidate.slope, contribution: slopeFraction * 100 },
    { criterion: "fwdEdge", weight: wFwdEdge, rawValue: fwdEdge, contribution: fwdEdgeFraction * 100 },
    { criterion: "gexFit", weight: wGexFit, rawValue: gexFit, contribution: gexFit * 100 },
    { criterion: "eventAdjustment", weight: wEvent, rawValue: evtPenalty, contribution: eventFraction * 100 },
    { criterion: "beVsEm", weight: wBeVsEm, rawValue: beVsEmRatio, contribution: beVsEmFraction * 100 },
    {
      criterion: "deltaNeutral",
      weight: wDeltaNeutral,
      rawValue: candidate.delta,
      contribution: deltaFraction * 100,
    },
    {
      criterion: "thetaVega",
      weight: wThetaVega,
      rawValue: thetaVegaValue(candidate.theta, candidate.vega) ?? 0,
      contribution: thetaVegaFrac * 100,
    },
    {
      criterion: "vrp",
      weight: wVrp,
      rawValue: vrpValue(ivF, params.realizedVol20 ?? null) ?? 0,
      contribution: vrpFrac * 100,
    },
    {
      criterion: "debitFit",
      weight: wDebitFit,
      rawValue: candidate.debit,
      contribution: debitFrac * 100,
    },
  ];

  const rawScore =
    wSlope * slopeFraction +
    wFwdEdge * fwdEdgeFraction +
    wGexFit * gexFit +
    wEvent * eventFraction +
    wBeVsEm * beVsEmFraction +
    wDeltaNeutral * deltaFraction +
    wThetaVega * thetaVegaFrac +
    wVrp * vrpFrac +
    wDebitFit * debitFrac;
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // ─── Experimental context (weight 0, display-only — rules.ts registry) ───
  const context: ReadonlyArray<ContextEntry> = [
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
  ];

  // Theta-capture at the hard-close date (2026-07-09): fraction of the calendar's total
  // decay runway (entry → front expiry, constant spot/IV) harvested by closing early.
  // 1 when the close IS the front expiry; null when the runway is unpriceable.
  const closeByExpiry = candidate.exitBeforeIso ?? candidate.frontLeg.expiration;
  let thetaCapturePct: number | null = null;
  if (candidate.exitBeforeIso === null) {
    thetaCapturePct = 1;
  } else {
    const daysHeld = tf - isoDaysBetween(candidate.exitBeforeIso, candidate.frontLeg.expiration);
    if (daysHeld > 0 && daysHeld < tf) {
      const value = (frontDte: number, backDte: number): number =>
        bsmPrice(candidate.spot, candidate.backLeg.strike, backDte / 365, ivB, r, q, "P") -
        bsmPrice(candidate.spot, K, frontDte / 365, ivF, r, q, "P");
      const v0 = value(tf, tb);
      const vClose = value(tf - daysHeld, tb - daysHeld);
      const vExpiry = value(0.0001, tb - tf);
      const runway = vExpiry - v0;
      thetaCapturePct = runway > 0 ? clamp01((vClose - v0) / runway) : null;
    }
  }

  const exitPlan: ExitPlan = {
    profitTargetPct: EXIT_PROFIT_TARGET_PCT,
    stopPct: EXIT_STOP_PCT,
    manageShortDte: EXIT_MANAGE_SHORT_DTE,
    // EVT discipline: exit the day before a front-window tier-1 event when stamped.
    closeByExpiry,
    thetaCapturePct,
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

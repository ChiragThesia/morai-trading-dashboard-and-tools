/**
 * scoreCalendarCandidates — the named-weight score + closed-enum breakdown (Phase 19, Plan 03).
 *
 * Port + generalize (D-07) of the mockup's score formula (playground-v4.html lines 267-271)
 * as documented tunable named constants (D-08: "not empirically calibrated — tune later
 * PICK-04/05"). The 5th term (the mockup's faked `K===7500?1:0.7` strike-equality proxy) is
 * replaced (D-09) with the REAL breakeven-width/expectedMove ratio via `findBreakevens`.
 *
 * Never-silent guard-tagging (mirrors the fwdIv guard precedent, 19-PATTERNS.md): an inverted
 * term structure zeroes the fwdEdge contribution outright (never rewarded) and a candidate
 * with fewer than 2 breakevens zeroes the beVsEm contribution (documented fallback) — the
 * score is always a finite number in [0,100], never NaN, never a fabricated clean value.
 *
 * Hexagon law (architecture-boundaries §2): imports only `@morai/quant`, this bounded
 * context's own `application/ports.ts` (intra-context read, gex.ts precedent), and this
 * module's own `./types.ts` / `./fwd-iv.ts` / `./breakevens.ts` siblings. No second BSM
 * (Pitfall 2) — pricing flows through `findBreakevens`, which itself calls `@morai/quant`.
 */

import { computeFwdIv } from "./fwd-iv.ts";
import { findBreakevens } from "./breakevens.ts";
import type { BreakdownEntry, EventPenaltyWeights, ExitPlan, RawCandidate, ScoredCandidate } from "./types.ts";
import type { GexContextForPicker } from "../application/ports.ts";

// ─────────────────────────────────────────────────────────────
// Named weight tunables (D-08) — ported verbatim from the approved mockup
// (playground-v4.html lines 267-271). NOT empirically calibrated; PICK-04/05 backlog items
// will validate/tune these against real outcomes.
// ─────────────────────────────────────────────────────────────
export const WEIGHT_SLOPE = 40;
export const WEIGHT_FWD_EDGE = 25;
export const WEIGHT_GEX_FIT = 15;
export const WEIGHT_EVENT = 10;
export const WEIGHT_BE_VS_EM = 10;

// ─────────────────────────────────────────────────────────────
// Per-criterion normalizer tunables (D-08/D-09) — documented, not empirically calibrated.
// ─────────────────────────────────────────────────────────────

/** Slope (annualized vol-pts/yr) treated as "full credit" for the slope criterion (mockup constant). */
export const SLOPE_NORMALIZER = 0.6;

/** fwdEdge normalization window: (fwdEdge + OFFSET) / RANGE, clamped to [0,1] (mockup constants). */
export const FWD_EDGE_OFFSET = 0.02;
export const FWD_EDGE_RANGE = 0.04;

/** GEX-fit tier credits (criterion 7, mockup constants): base long-gamma credit + proximity bonus. */
export const GEX_NET_GAMMA_BASE_CREDIT = 0.6;
export const GEX_PROXIMITY_ABS_GAMMA_CREDIT = 0.4;
export const GEX_PROXIMITY_PUT_WALL_CREDIT = 0.25;
export const GEX_ABS_GAMMA_PROXIMITY_PTS = 25;
export const GEX_PUT_WALL_PROXIMITY_PTS = 5;

/**
 * D-09 replacement for the mockup's faked `K===7500?1:0.7` term: a documented-tunable target
 * ratio of breakeven-width to expected-move above which beVsEm earns full credit. The metric
 * itself (real breakeven width / real expected move) is honest; only this threshold is
 * uncalibrated (RESEARCH.md flags the threshold, not the metric, as needing future tuning).
 */
export const BE_VS_EM_TARGET_RATIO = 1.5;

/**
 * Per-event penalty weights (D-11) — front-leg-only (back-leg events are informational/display
 * only, never penalized here). Default: all three FOMC/CPI/NFP at 0.5 (planner's discretion
 * per 19-CONTEXT.md: "default all-three-tunable").
 */
export const EVENT_PENALTY: EventPenaltyWeights = {
  FOMC: 0.5,
  CPI: 0.5,
  NFP: 0.5,
};

// ─────────────────────────────────────────────────────────────
// Exit-plan fixed defaults (D-01b) — not per-candidate tuned this phase.
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
};

/**
 * Score a single candidate: forward-edge (criterion 1), slope (criterion 2), GEX-fit
 * (criterion 7), front-leg event penalty (criterion 4 / D-11), and the real beVsEm ratio
 * (D-09). Never NaN — the fwdIv-inverted case and the <2-breakeven case both zero their
 * respective term rather than propagating an undefined value.
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

  // ─── Criterion 1: forward edge (never-NaN inverted-structure guard) ───
  const fwd = computeFwdIv(tf, ivF, tb, ivB);
  let fwdIv: number | null;
  let fwdEdge: number;
  let fwdEdgeFraction: number;
  if (fwd.guard === "ok") {
    fwdIv = fwd.fwdIv;
    fwdEdge = ivF - fwd.fwdIv;
    fwdEdgeFraction = clamp01((fwdEdge + FWD_EDGE_OFFSET) / FWD_EDGE_RANGE);
  } else {
    // Inverted term structure is never rewarded -- the fwdEdge term contributes 0 outright,
    // not merely a neutral fwdEdge=0 run through the normal normalization window.
    fwdIv = null;
    fwdEdge = 0;
    fwdEdgeFraction = 0;
  }

  const expectedMove = candidate.spot * ivF * Math.sqrt(tf / 365);

  // ─── Criterion 2: term-structure slope ───
  const slopeFraction = clamp01(candidate.slope / SLOPE_NORMALIZER);

  // ─── Criterion 4 (D-11): front-leg-only event penalty ───
  const evtPenalty = candidate.frontEvents.reduce((sum, name) => sum + (EVENT_PENALTY[name] ?? 0), 0);
  const eventFraction = Math.max(0, 1 - evtPenalty);

  // ─── Criterion 7: GEX-fit tiers (never-silent: missing/null GEX pieces contribute 0) ───
  const netGammaBase =
    gexContext !== null && gexContext.netGammaAtSpot > 0 ? GEX_NET_GAMMA_BASE_CREDIT : 0;
  let proximity = 0;
  if (gexContext !== null && gexContext.absGammaStrike !== null && Math.abs(K - gexContext.absGammaStrike) <= GEX_ABS_GAMMA_PROXIMITY_PTS) {
    proximity = GEX_PROXIMITY_ABS_GAMMA_CREDIT;
  } else if (gexContext !== null && gexContext.putWall !== null && Math.abs(K - gexContext.putWall) <= GEX_PUT_WALL_PROXIMITY_PTS) {
    proximity = GEX_PROXIMITY_PUT_WALL_CREDIT;
  }
  const gexFit = clamp01(netGammaBase + proximity);

  // ─── D-09: real beVsEm ratio via findBreakevens (never the fixed-strike proxy) ───
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
  // Documented fallback (D-09/never-silent): fewer than 2 breakevens earns no beVsEm credit --
  // never a fabricated ratio, never NaN.
  const beVsEmFraction = hasBreakevenPair ? clamp01(beVsEmRatio / BE_VS_EM_TARGET_RATIO) : 0;

  const breakdown: ReadonlyArray<BreakdownEntry> = [
    { criterion: "slope", weight: WEIGHT_SLOPE, rawValue: candidate.slope, contribution: slopeFraction * 100 },
    { criterion: "fwdEdge", weight: WEIGHT_FWD_EDGE, rawValue: fwdEdge, contribution: fwdEdgeFraction * 100 },
    { criterion: "gexFit", weight: WEIGHT_GEX_FIT, rawValue: gexFit, contribution: gexFit * 100 },
    { criterion: "eventAdjustment", weight: WEIGHT_EVENT, rawValue: evtPenalty, contribution: eventFraction * 100 },
    { criterion: "beVsEm", weight: WEIGHT_BE_VS_EM, rawValue: beVsEmRatio, contribution: beVsEmFraction * 100 },
  ];

  const rawScore =
    WEIGHT_SLOPE * slopeFraction +
    WEIGHT_FWD_EDGE * fwdEdgeFraction +
    WEIGHT_GEX_FIT * gexFit +
    WEIGHT_EVENT * eventFraction +
    WEIGHT_BE_VS_EM * beVsEmFraction;
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));

  const exitPlan: ExitPlan = {
    profitTargetPct: EXIT_PROFIT_TARGET_PCT,
    stopPct: EXIT_STOP_PCT,
    manageShortDte: EXIT_MANAGE_SHORT_DTE,
    closeByExpiry: candidate.frontLeg.expiration,
  };

  return {
    ...candidate,
    score,
    breakdown,
    fwdIv,
    fwdIvGuard: fwd.guard,
    fwdEdge,
    expectedMove,
    exitPlan,
  };
}

/**
 * Score every candidate in `rawCandidates` against the named 40/25/15/10/10 weights (D-08),
 * emitting the closed-enum breakdown and the real beVsEm ratio (D-09) for each. `gexContext`
 * may be null (D-17: GEX snapshot missing/stale) -- the gexFit term contributes 0, never a
 * silently-clean score.
 */
export function scoreCalendarCandidates(
  rawCandidates: ReadonlyArray<RawCandidate>,
  gexContext: GexContextForPicker | null,
  params: ScoringParams,
): ReadonlyArray<ScoredCandidate> {
  return rawCandidates.map((candidate) => scoreOne(candidate, gexContext, params));
}

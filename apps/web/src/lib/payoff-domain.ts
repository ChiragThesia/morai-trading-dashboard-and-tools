/**
 * payoff-domain.ts — computes the dynamic x-domain a payoff chart is drawn over (D-01).
 *
 * Fixes Defect 1: the Analyzer/Overview payoff chart used a hardcoded 6900-7900 x-window
 * that clips a pasted calendar's tent (tails + breakevens) whenever a strike or the real
 * spot sits near or outside that fixed range.
 *
 * Two-pass tent-fitting:
 *   1. Reprice the position set over a GENEROUS wide domain (bracketing likely real
 *      breakevens) and find those breakevens via the existing `findZeroCrossings`
 *      detector — don't hand-roll a second one.
 *   2. Final domain = [min(anchors) - pad, max(anchors) + pad], where anchors = every
 *      leg strike ∪ spot ∪ the wide-pass breakevens, and pad is an 8% fraction of the
 *      anchor span (CONTEXT.md sketch, A1).
 *
 * Pure function, no DOM, no I/O. No any/as/!.
 */

import { repriceScenario, findZeroCrossings, extractStrike, includedForT0 } from "./scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams, SpotDomain } from "./scenario-engine.ts";

/** TOS-parity minimum half-width (2026-07-16 user DITTO): TOS draws the risk profile
 *  over roughly ±$1000 from the current price (e.g. spot 7500 → ~6400-8600); the domain
 *  never goes NARROWER than this — anchors (strikes/breakevens) can only widen it. Also
 *  the empty-position fallback half-width (T-30-01: never a NaN/degenerate domain). */
const TOS_MIN_HALF_WIDTH = 1000;
/** Wide-pass half-width floor (dollars) — large enough to bracket real breakevens. */
const WIDE_PASS_MIN_HALF_WIDTH = 1500;
/** Wide-pass half-width as a fraction of the highest anchor (strikes/spot). */
const WIDE_PASS_SPAN_FRACTION = 0.15;
/** Final domain padding as a fraction of the anchor span (CONTEXT.md A1). */
const DOMAIN_PAD_FRACTION = 0.08;

/**
 * computePayoffDomain — the domain PayoffChart's x-scale AND scenario-engine's spot grid
 * must BOTH follow (one computed {min,max}, never two independent windows — Pitfall 1).
 */
export function computePayoffDomain(
  positions: ReadonlyArray<AnalyzerPosition>,
  spot: number,
  params: ScenarioParams,
): SpotDomain {
  if (positions.length === 0) {
    return { min: spot - TOS_MIN_HALF_WIDTH, max: spot + TOS_MIN_HALF_WIDTH };
  }

  // Only positions that actually contribute pl (same `includedForT0` predicate bookPL/
  // bookPLAtExpiry use) may anchor the domain — an excluded or non-convergent leg must
  // not widen the tent it never draws (CR-01 domain-fitting regression, Phase 30).
  const contributing = positions.filter(includedForT0);
  if (contributing.length === 0) {
    // Every position excluded/non-convergent (WR-01) — same fallback as the empty-book
    // case, never a zero-width {min: spot, max: spot} domain (that produces NaN in
    // PayoffChart's d3 xScale).
    return { min: spot - TOS_MIN_HALF_WIDTH, max: spot + TOS_MIN_HALF_WIDTH };
  }
  const strikes = contributing.map(extractStrike);
  const baseAnchors = [...strikes, spot];
  const baseLo = Math.min(...baseAnchors);
  const baseHi = Math.max(...baseAnchors);

  const wideHalfWidth = Math.max(WIDE_PASS_MIN_HALF_WIDTH, WIDE_PASS_SPAN_FRACTION * baseHi);
  const wideDomain: SpotDomain = { min: baseLo - wideHalfWidth, max: baseHi + wideHalfWidth };

  const wide = repriceScenario(positions, params, wideDomain);
  const breakevens = [
    ...findZeroCrossings(wide.payoffCurve),
    ...findZeroCrossings(wide.expirationCurve),
  ];

  const anchors = [...baseAnchors, ...breakevens];
  const lo = Math.min(...anchors);
  const hi = Math.max(...anchors);
  const pad = (hi - lo) * DOMAIN_PAD_FRACTION;

  // TOS-parity floor: at least spot ± 1000, anchors only ever widen beyond it.
  return {
    min: Math.min(lo - pad, spot - TOS_MIN_HALF_WIDTH),
    max: Math.max(hi + pad, spot + TOS_MIN_HALF_WIDTH),
  };
}

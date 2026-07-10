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

import { repriceScenario, findZeroCrossings, extractStrike } from "./scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams, SpotDomain } from "./scenario-engine.ts";

/** Empty-position fallback half-width (T-30-01: never produce a NaN/degenerate domain). */
const FALLBACK_HALF_WIDTH = 500;
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
    return { min: spot - FALLBACK_HALF_WIDTH, max: spot + FALLBACK_HALF_WIDTH };
  }

  const strikes = positions.map(extractStrike);
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

  return { min: lo - pad, max: hi + pad };
}

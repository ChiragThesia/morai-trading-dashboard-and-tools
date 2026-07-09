/**
 * directional-attribution — median-split sign test (BT-04, sign+n locked decision).
 *
 * Splits paired (metric, outcome) samples at the metric's median and asks: does the
 * high half's mean outcome beat the low half's? Returns "yes"/"no"/"insufficient" + n —
 * NEVER a correlation coefficient (27-CONTEXT.md's locked constraint; a Pearson r
 * overclaims precision this repo's n=13 footprint can't honestly support).
 *
 * Tie rule (deterministic): metric <= median => low half, metric > median => high half.
 * A constant metric array (no split possible) degenerates to "insufficient", same as n<4.
 * Pure — no I/O, no clock.
 */

import { assertDefined } from "@morai/shared";

export type AttributionSample = {
  readonly metric: number;
  readonly outcome: number;
};

export type AttributionVerdict = "yes" | "no" | "insufficient";

export type AttributionResult = {
  readonly verdict: AttributionVerdict;
  readonly n: number;
};

const MIN_N = 4;

function median(sorted: ReadonlyArray<number>): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const v = sorted[mid];
    assertDefined(v, "median: middle index out of bounds");
    return v;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  assertDefined(lo, "median: lower-middle index out of bounds");
  assertDefined(hi, "median: upper-middle index out of bounds");
  return (lo + hi) / 2;
}

export function directionalAttribution(
  samples: ReadonlyArray<AttributionSample>,
): AttributionResult {
  const n = samples.length;
  if (n < MIN_N) return { verdict: "insufficient", n };

  const sortedMetrics = [...samples.map((s) => s.metric)].sort((a, b) => a - b);
  const med = median(sortedMetrics);

  const lowOutcomes: number[] = [];
  const highOutcomes: number[] = [];
  for (const s of samples) {
    if (s.metric <= med) lowOutcomes.push(s.outcome);
    else highOutcomes.push(s.outcome);
  }

  // Constant (or degenerate) metric array — no split possible.
  if (lowOutcomes.length === 0 || highOutcomes.length === 0) {
    return { verdict: "insufficient", n };
  }

  const lowMean = lowOutcomes.reduce((sum, v) => sum + v, 0) / lowOutcomes.length;
  const highMean = highOutcomes.reduce((sum, v) => sum + v, 0) / highOutcomes.length;

  return { verdict: highMean > lowMean ? "yes" : "no", n };
}

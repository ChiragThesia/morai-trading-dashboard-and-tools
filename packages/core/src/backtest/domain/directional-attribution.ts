/**
 * directional-attribution — median-split sign test (BT-04, sign+n locked decision).
 * RED stub — see directional-attribution.test.ts for the behavior contract.
 */

export type AttributionSample = {
  readonly metric: number;
  readonly outcome: number;
};

export type AttributionVerdict = "yes" | "no" | "insufficient";

export type AttributionResult = {
  readonly verdict: AttributionVerdict;
  readonly n: number;
};

export function directionalAttribution(
  _samples: ReadonlyArray<AttributionSample>,
): AttributionResult {
  throw new Error("not implemented");
}

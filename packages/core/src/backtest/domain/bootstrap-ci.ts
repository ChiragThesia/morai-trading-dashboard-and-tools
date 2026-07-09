/**
 * bootstrap-ci — seeded bootstrap confidence interval (BT-04).
 *
 * n=13 is too small for a parametric interval to be honest — CONTEXT.md wants the CI's
 * enormous width at that sample size to BE the honesty signal. Resamples `samples` with
 * replacement using a SEEDED mulberry-style PRNG (not Math.random): re-running over
 * IDENTICAL replay data reproduces an IDENTICAL interval, so an append-only audit tool
 * never shows spurious "the numbers changed" churn between two runs of the same data.
 * Pure — no I/O, no clock.
 */

import { assertDefined } from "@morai/shared";

export type BootstrapCiResult = {
  readonly low: number;
  readonly high: number;
  readonly n: number;
};

/** quantile — linear-interpolated quantile of a pre-sorted array. percentileRank doesn't invert. */
export function quantile(sorted: ReadonlyArray<number>, p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const loVal = sorted[lo];
  assertDefined(loVal, "quantile: lo index out of bounds");
  if (lo === hi) return loVal;
  const hiVal = sorted[hi];
  assertDefined(hiVal, "quantile: hi index out of bounds");
  return loVal + (hiVal - loVal) * (idx - lo);
}

export function bootstrapCi(
  samples: ReadonlyArray<number>,
  seed: number,
  iterations = 2000,
  confidence = 0.9,
): BootstrapCiResult {
  if (samples.length === 0) return { low: NaN, high: NaN, n: 0 };

  let s = seed >>> 0;
  const rand = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0; // mulberry-style LCG, deterministic per seed
    return s / 4294967296;
  };

  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let j = 0; j < samples.length; j++) {
      const idx = Math.floor(rand() * samples.length);
      const sample = samples[idx];
      assertDefined(sample, "bootstrapCi: resample index out of bounds");
      sum += sample;
    }
    means.push(sum / samples.length);
  }
  means.sort((a, b) => a - b);

  const alpha = (1 - confidence) / 2;
  return { low: quantile(means, alpha), high: quantile(means, 1 - alpha), n: samples.length };
}

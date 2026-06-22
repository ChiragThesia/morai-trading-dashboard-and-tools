// Analytics domain — 25Δ risk-reversal via linear-in-delta interpolation.
// Hexagon law: imports only @morai/shared (here: only a type from the same context's ports).
// Pure: no I/O, no Date.now(). Never extrapolates, never fabricates — null when unbracketable.

import type { SmileQuote } from "../application/ports.ts";

/** A usable smile point: delta and iv are both finite numbers. */
type DeltaIvPoint = {
  readonly delta: number;
  readonly iv: number;
};

const PUT_TARGET_DELTA = -0.25;
const CALL_TARGET_DELTA = 0.25;

/** Keep only points with a finite delta and a finite iv (drop null/NaN-stamped points). */
function usablePoints(smile: ReadonlyArray<SmileQuote>): ReadonlyArray<DeltaIvPoint> {
  const out: DeltaIvPoint[] = [];
  for (const q of smile) {
    const { delta, iv } = q;
    if (delta === null) continue;
    if (!Number.isFinite(delta) || !Number.isFinite(iv)) continue;
    out.push({ delta, iv });
  }
  return out;
}

/**
 * Linearly interpolate IV at `target` across delta, using the tightest bracketing pair in `points`.
 * Returns null when `target` lies outside the points' delta span (cannot bracket → never extrapolate).
 */
function interpAtDelta(points: ReadonlyArray<DeltaIvPoint>, target: number): number | null {
  // Tightest lower bracket (delta ≤ target, largest such delta) and upper bracket (delta ≥ target,
  // smallest such delta). An exact hit (delta === target) satisfies both and yields that iv.
  let lower: DeltaIvPoint | null = null;
  let upper: DeltaIvPoint | null = null;
  for (const p of points) {
    if (p.delta <= target && (lower === null || p.delta > lower.delta)) {
      lower = p;
    }
    if (p.delta >= target && (upper === null || p.delta < upper.delta)) {
      upper = p;
    }
  }
  if (lower === null || upper === null) return null; // target not bracketed

  const span = upper.delta - lower.delta;
  if (span === 0) return lower.iv; // exact hit (lower === upper at target)

  const fraction = (target - lower.delta) / span;
  return lower.iv + fraction * (upper.iv - lower.iv);
}

/**
 * interpolateRiskReversal — risk_reversal = IV(25Δ put) − IV(25Δ call).
 *
 * Splits the usable smile into puts (delta < 0) and calls (delta > 0), interpolates IV linearly in
 * delta to the −0.25 (put) and +0.25 (call) targets, and subtracts. Returns null when either wing
 * cannot bracket its ±0.25 target (SPEC R2: never fabricate a value).
 */
export function interpolateRiskReversal(smile: ReadonlyArray<SmileQuote>): number | null {
  const points = usablePoints(smile);
  const puts = points.filter((p) => p.delta < 0);
  const calls = points.filter((p) => p.delta > 0);

  const putIv = interpAtDelta(puts, PUT_TARGET_DELTA);
  if (putIv === null) return null;

  const callIv = interpAtDelta(calls, CALL_TARGET_DELTA);
  if (callIv === null) return null;

  return putIv - callIv;
}

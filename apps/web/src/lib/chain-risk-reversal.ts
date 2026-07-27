/**
 * chain-risk-reversal — the 25-delta risk reversal for one expiry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION STUB (Unit 11 ← Unit 07). Unit 07 owns this path. It does not
 * exist in this worktree, so `riskReversalForExpiry` is implemented here against
 * the frozen signature (25Δ RR, nullable). Take Unit 07's file wholesale on
 * merge; `useChainModel` calls nothing else from this module.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * RR = IV(25Δ put) − IV(25Δ call). Positive is the normal index shape: puts bid
 * over calls. It is a REPORTED number — nothing here ranks or judges it.
 *
 * Null whenever the chain does not actually contain both wings near 25 delta.
 * A one-sided or too-sparse chain returns null, never a half-answer.
 *
 * No any/as/!.
 */
import { legGreeks } from "./chain-math.ts";
import type { ChainRow } from "./chain-contract.ts";

const RR_TARGET_DELTA = 0.25;

/**
 * How far from 25Δ a strike may sit and still count as the wing.
 *
 * ponytail: a flat tolerance, not an interpolated smile fit. A 0.10 window is
 * roughly one or two SPX strikes at typical vol; beyond that "the 25Δ wing" is
 * a fiction and null is the honest answer. Upgrade path: interpolate IV between
 * the two strikes bracketing 25Δ if the reported number ever needs to be exact.
 */
export const RR_DELTA_TOLERANCE = 0.1;

/** IV of the row whose |delta| sits closest to 25Δ, or null if none is close enough. */
function wingIv(rows: ReadonlyArray<ChainRow>, contractType: "C" | "P"): number | null {
  let bestIv: number | null = null;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.contractType !== contractType) continue;
    if (row.bsmIv === null) continue;
    const greeks = legGreeks(row);
    if (greeks === null) continue;
    const err = Math.abs(Math.abs(greeks.delta) - RR_TARGET_DELTA);
    if (err < bestErr) {
      bestErr = err;
      bestIv = row.bsmIv;
    }
  }
  return bestErr <= RR_DELTA_TOLERANCE ? bestIv : null;
}

/**
 * 25-delta risk reversal across the rows of ONE expiry.
 *
 * @param rows every contract of a single expiry — both calls and puts.
 * @returns put IV − call IV as a decimal, or null when either wing is absent.
 */
export function riskReversalForExpiry(rows: ReadonlyArray<ChainRow>): number | null {
  const putIv = wingIv(rows, "P");
  const callIv = wingIv(rows, "C");
  if (putIv === null || callIv === null) return null;
  return putIv - callIv;
}

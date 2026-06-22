// Analytics domain — inclusive trailing-window percentile rank.
// Hexagon law: imports nothing outside @morai/shared (here: no imports). Pure: no I/O, no Date.now.

/**
 * percentileRank — inclusive (weak) percentile of `value` against `history`, in [0, 100].
 *
 *   rank = 100 · (count of history values ≤ value) / history.length
 *
 * The caller (06-05) supplies the trailing window only (≤ 252 prior values for the same
 * underlying/expiration, all-available-if-shorter) and excludes null risk_reversal values; this
 * function is window-agnostic and ranks against whatever array it is given.
 *
 * Empty history (first observation ever, forward-only) → 100: a lone observation sits at the 100th
 * percentile of the inclusive single-element set {value} once it is added. (06-05 maps the result
 * to rr_rank, which is null when risk_reversal itself is null, regardless of this sentinel.)
 */
export function percentileRank(value: number, history: ReadonlyArray<number>): number {
  const n = history.length;
  if (n === 0) return 100;

  let atOrBelow = 0;
  for (const h of history) {
    if (h <= value) atOrBelow += 1;
  }
  return (100 * atOrBelow) / n;
}

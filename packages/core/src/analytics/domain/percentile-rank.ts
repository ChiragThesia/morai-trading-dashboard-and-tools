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
 * Empty history (first observation ever, forward-only) → null: there is no prior distribution to
 * rank against, so no defined rank exists. The caller persists rr_rank = null until at least one
 * prior value exists. (06-05 also maps a null result when risk_reversal itself is null.) Returning
 * a numeric sentinel here would make the first-ever observation read as a real percentile — a wrong
 * number (WR-01).
 */
export function percentileRank(value: number, history: ReadonlyArray<number>): number | null {
  const n = history.length;
  if (n === 0) return null;

  let atOrBelow = 0;
  for (const h of history) {
    if (h <= value) atOrBelow += 1;
  }
  return (100 * atOrBelow) / n;
}

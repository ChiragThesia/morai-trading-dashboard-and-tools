// Shared kernel — inclusive trailing-window percentile rank.
// Promoted from analytics/domain (verbatim) so other bounded contexts (picker
// slopePercentile) can use it without a cross-context domain import. Pure: no I/O, no clock.

/**
 * percentileRank — inclusive (weak) percentile of `value` against `history`, in [0, 100].
 *
 *   rank = 100 · (count of history values ≤ value) / history.length
 *
 * The caller supplies the trailing window only (e.g. ≤ 252 prior values,
 * all-available-if-shorter) and excludes null values; this function is window-agnostic and
 * ranks against whatever array it is given.
 *
 * Empty history (first observation ever, forward-only) → null: there is no prior distribution
 * to rank against, so no defined rank exists. Returning a numeric sentinel would make the
 * first-ever observation read as a real percentile — a wrong number (WR-01).
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

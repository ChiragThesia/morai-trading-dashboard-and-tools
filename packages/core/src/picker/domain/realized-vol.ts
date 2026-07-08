/**
 * realized-vol — annualized realized volatility from daily closes.
 *
 * RV = sample stdev (n−1) of daily log returns × √252. Feeds the experimental `vrp`
 * rule (frontIV − RV20: is there premium over what the underlying actually realizes?).
 *
 * Null (never NaN) when the series can't produce a sample stdev (<3 closes → <2 returns)
 * or contains a non-positive close (log return undefined). Pure — no I/O, no clock.
 */

const TRADING_DAYS_PER_YEAR = 252;

export function realizedVol(closes: ReadonlyArray<number>): number | null {
  if (closes.length < 3) return null;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const curr = closes[i];
    if (prev === undefined || curr === undefined) return null;
    if (!(prev > 0) || !(curr > 0) || !Number.isFinite(prev) || !Number.isFinite(curr)) {
      return null;
    }
    returns.push(Math.log(curr / prev));
  }

  const n = returns.length; // ≥ 2 by the length guard above
  const mean = returns.reduce((sum, r) => sum + r, 0) / n;
  const sampleVar = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (n - 1);

  return Math.sqrt(sampleVar) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

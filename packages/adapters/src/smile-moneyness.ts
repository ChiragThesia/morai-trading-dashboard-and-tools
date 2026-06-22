/**
 * computeMoneyness — K/S for a smile point (WR-03 / 06-08).
 *
 * Shared by BOTH leg-observations adapters (Postgres + memory twin) so the same (strike, spot)
 * yields the same moneyness — proven by the shared smile-source contract suite.
 *
 *   moneyness = (strike / 1000) / spot
 *
 * where `strike` is the ×1000 integer convention and `spot` = leg_observations.underlying_price
 * (points). Returns null when spot is not a finite positive number, so Infinity/NaN is never
 * persisted into the nullable skew_observations.moneyness column (T-06-28).
 */
export function computeMoneyness(strikeX1000: number, spot: number): number | null {
  if (!Number.isFinite(spot) || spot <= 0) return null;
  return strikeX1000 / 1000 / spot;
}

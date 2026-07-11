/**
 * implied-carry.ts — parity-implied dividend yield solver (Phase 34, Plan 34-03).
 *
 * Hexagon law (architecture-boundaries §2): pure, no I/O; no drizzle/vendor SDK.
 *
 * 34-RESEARCH.md Pattern 2: fix r from FRED (resolved by the caller), solve the single
 * remaining unknown q from put-call parity per expiry —
 *   C − P = S·e^{-qT} − K·e^{-rT}  ⟹  q = −ln[((C−P) + K·e^{-rT}) / S] / T
 * a well-conditioned one-unknown solve (vs. the underdetermined joint (r, q) fit).
 * (RESEARCH's quoted formula had a sign error in the parity rearrangement — verified by
 * hand-computed oracle: this form recovers a known q to ~1e-13 from bsmPrice-forward-priced
 * marks; RESEARCH's literal "S − (C−P) − K·e^{-rT}" form does not round-trip.)
 */

/**
 * impliedDivYield — solve for the continuous dividend yield q implied by put-call parity.
 *
 * Degrades to null (never NaN, per Pitfall 3 / threat T-34-03) when the input is
 * degenerate: T<=0, spot<=0, or a parity right-hand side that is non-positive or
 * non-finite (a stale/wide AH quote, or an already-corrupted mark, pushes the ln()
 * argument out of domain).
 *
 * @param callMark - raw call option mark
 * @param putMark  - raw put option mark
 * @param spot     - underlying spot price
 * @param strike   - option strike price
 * @param T        - time to expiry in years (fractional)
 * @param r        - risk-free rate (decimal), fixed by the caller
 * @returns implied continuous dividend yield (decimal), or null when unsolvable
 */
export function impliedDivYield(
  callMark: number,
  putMark: number,
  spot: number,
  strike: number,
  T: number,
  r: number,
): number | null {
  if (T <= 0 || spot <= 0) return null;
  const rhs = callMark - putMark + strike * Math.exp(-r * T);
  if (rhs <= 0 || !Number.isFinite(rhs)) return null;
  const q = -Math.log(rhs / spot) / T;
  return Number.isFinite(q) ? q : null;
}

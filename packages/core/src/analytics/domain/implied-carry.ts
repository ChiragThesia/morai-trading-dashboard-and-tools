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
 * Minimum horizon for a trustworthy parity solve, in years (7 calendar days).
 *
 * Parity divides the mark residual by T, so the solve's noise gain is 1/T. At 1 DTE
 * (T ≈ 0.0027) a five-cent error in either mark moves q by whole percentage points — the output
 * is an amplifier reading, not a measurement. Measured in production 2026-07-27, where the marks
 * themselves were fine: 0DTE solved to q = 0.2984 (29.8%), 1DTE 0.0823, 2DTE 0.0450, 3DTE 0.0291,
 * and only from 4DTE out did it settle to the ~0.009–0.012 SPX actually yields.
 *
 * The guard is on CONDITIONING, not on the answer: a short-dated solve is refused even when it
 * happens to come out clean, because at that horizon a clean answer is luck.
 */
const MIN_SOLVE_YEARS = 7 / 365.25;

/**
 * Plausible band for a continuous index dividend yield.
 *
 * SPX yields roughly 1.2–2.0%. Zero is admitted — paying no dividend is a physical state — but a
 * NEGATIVE continuous yield on an index is not a quantity that exists, and production produced
 * them (2026-08-23 → −0.1201, 2026-09-02 → −0.0857) off thin quotes on sparse expiries. The upper
 * bound is deliberately loose at 10%, roughly five times the historical high: its job is to catch
 * solver artifacts, not to second-guess a real dividend regime.
 */
const MIN_YIELD = 0;
const MAX_YIELD = 0.1;

/**
 * impliedDivYield — solve for the continuous dividend yield q implied by put-call parity.
 *
 * Degrades to null (never NaN, per Pitfall 3 / threat T-34-03) when the input is
 * degenerate: T<=0, spot<=0, or a parity right-hand side that is non-positive or
 * non-finite (a stale/wide AH quote, or an already-corrupted mark, pushes the ln()
 * argument out of domain).
 *
 * ALSO null when the solve cannot carry signal — too short a horizon to be conditioned, or an
 * answer outside the physical band. Null is the right degrade rather than a clamp: a clamped value
 * still looks like a measurement, whereas `computeImpliedCarry` reads null as "this expiry has no
 * implied carry", emits no entry, and every consumer falls back to its flat default. That is the
 * honest answer, and it keeps this project's rule that a degraded input never poses as data.
 *
 * @param callMark - raw call option mark
 * @param putMark  - raw put option mark
 * @param spot     - underlying spot price
 * @param strike   - option strike price
 * @param T        - time to expiry in years (fractional)
 * @param r        - risk-free rate (decimal), fixed by the caller
 * @returns implied continuous dividend yield (decimal), or null when unsolvable or untrustworthy
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
  // Refuse before solving: below this horizon the result is noise regardless of the marks.
  if (T < MIN_SOLVE_YEARS) return null;
  const rhs = callMark - putMark + strike * Math.exp(-r * T);
  if (rhs <= 0 || !Number.isFinite(rhs)) return null;
  const q = -Math.log(rhs / spot) / T;
  if (!Number.isFinite(q)) return null;
  return q >= MIN_YIELD && q <= MAX_YIELD ? q : null;
}

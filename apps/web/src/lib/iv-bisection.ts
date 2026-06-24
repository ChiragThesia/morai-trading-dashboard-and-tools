/**
 * Implied flat IV bisection over the @morai/quant BSM kernel.
 *
 * UI-SPEC TOS Parser Contract Rule 8:
 *   Bisect to find `iv` such that BSM(back, iv) − BSM(front, iv) ≈ debit at current spot.
 *   If no debit provided, default IV = 15%.
 *
 * Security (T-09-07 — DoS mitigation):
 *   - Fixed iteration cap (MAX_ITER = 64): no unbounded loop on crafted debit.
 *   - Bounded iv range [LO, HI]: never returns negative or astronomically large IV.
 *   - When debit is outside the bracketed range, returns the closest bound (not null).
 */

import { bsmPrice } from "@morai/quant";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

/** Minimum IV considered by the bisection (2%). */
const LO = 0.02;
/** Maximum IV considered by the bisection (200%). */
const HI = 2.0;
/** Maximum bisection iterations — terminates to ~log2(HI-LO / TOL) precision. */
const MAX_ITER = 64;
/** Default IV when no debit is provided (Rule 8 spec). */
const DEFAULT_IV = 0.15;

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type ImpliedFlatIvParams = {
  /** Current spot price of the underlying. */
  readonly S: number;
  /** Strike price of the calendar spread. */
  readonly K: number;
  /** Time to front expiry in years (must be > 0). */
  readonly frontT: number;
  /** Time to back expiry in years (must be > frontT). */
  readonly backT: number;
  /** Option type: 'C' for call, 'P' for put. */
  readonly type: "C" | "P";
  /** Risk-free rate (decimal). */
  readonly r: number;
  /** Continuous dividend yield (decimal). */
  readonly q: number;
  /**
   * Observed debit of the calendar spread.
   * When null or undefined, returns DEFAULT_IV (15%) per the contract.
   */
  readonly debit?: number | null;
};

// ─────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────

/**
 * Net calendar spread price at a given flat IV:
 *   BSM(back leg, iv) − BSM(front leg, iv)
 */
function spreadAtIv(
  S: number,
  K: number,
  frontT: number,
  backT: number,
  iv: number,
  r: number,
  q: number,
  type: "C" | "P",
): number {
  return bsmPrice(S, K, backT, iv, r, q, type) - bsmPrice(S, K, frontT, iv, r, q, type);
}

/**
 * Find a flat implied volatility such that the calendar spread re-prices to ≈ `debit`
 * at the given spot, using 64-iteration bisection over `bsmPrice` from `@morai/quant`.
 *
 * Returns DEFAULT_IV (15%) when no debit is provided.
 * Returns the closest bracketing bound when the debit is outside the bisection range.
 * Never returns null — always returns a finite, bounded IV.
 */
export function impliedFlatIv({
  S,
  K,
  frontT,
  backT,
  type,
  r,
  q,
  debit,
}: ImpliedFlatIvParams): number {
  // Rule 8 default: no debit → 15% flat IV
  if (debit === null || debit === undefined) {
    return DEFAULT_IV;
  }

  // Compute spread at the two bounds
  const netLo = spreadAtIv(S, K, frontT, backT, LO, r, q, type);
  const netHi = spreadAtIv(S, K, frontT, backT, HI, r, q, type);

  // If debit is outside the bracketed range, return the closest bound.
  // A calendar spread has positive theta (back>front DTE) so net(lo)≤net(hi) normally;
  // guard against both orderings.
  if (debit <= netLo) return LO;
  if (debit >= netHi) return HI;

  // Bisection: find iv such that spreadAtIv(iv) ≈ debit
  let lo = LO;
  let hi = HI;
  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const netMid = spreadAtIv(S, K, frontT, backT, mid, r, q, type);
    if (netMid < debit) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

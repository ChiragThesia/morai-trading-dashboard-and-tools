/**
 * Calendar breakeven solver (D-09 real BE-vs-EM replacement) — bounded bisection over a long
 * put-calendar's payoff-at-front-expiry function.
 *
 * Port of `mockups/playground-v4.html`'s `candPnl()` payoff shape (~lines 290-296), evaluated
 * specifically at front-leg expiry: the front leg is worth its intrinsic value (T=0), the back
 * leg is priced at its remaining time via `@morai/quant`'s `bsmPrice` — the ONLY pricing engine
 * used here (RESEARCH.md Open Question 1 / Pitfall 2: no second BSM implementation).
 *
 * Numeric-solve-with-guard convention mirrors `packages/core/src/journal/domain/iv-inversion.ts`:
 * a bounded spot grid (BISECT_STEPS subdivisions of [BISECT_LO, BISECT_HI] as multipliers of
 * spot) detects sign changes, then bisects each bracket up to a hard MAX_ITER cap. A calendar's
 * payoff-at-front-expiry is tent-shaped (single peak near the strike, decreasing on both wings),
 * so it crosses zero at most twice — never an ad-hoc closed form, and never NaN/throw: no
 * breakeven within bounds returns an honest empty array.
 *
 * Pure domain: no I/O, imports only `@morai/quant`.
 */

import { bsmPrice } from "@morai/quant";

// ─────────────────────────────────────────────────────────────
// Bisection constants (mirrors iv-inversion.ts's BISECT_LO/HI/STEPS discipline; here LO/HI are
// multipliers of spot, defining the spot search range, not sigma bounds).
// ─────────────────────────────────────────────────────────────
export const BISECT_LO = 0.5;
export const BISECT_HI = 1.5;
export const BISECT_STEPS = 200;
export const MAX_ITER = 50;
const TOL = 1e-6;

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

/** Input for findBreakevens — a long put calendar's pricing inputs. */
export type BreakevenInput = {
  /** Current spot price. */
  readonly spot: number;
  /** Front leg strike (points). */
  readonly frontStrike: number;
  /** Back leg strike (points). */
  readonly backStrike: number;
  /** Front leg DTE (days). */
  readonly frontDte: number;
  /** Back leg DTE (days), must be > frontDte. */
  readonly backDte: number;
  /** Front leg IV (decimal). */
  readonly frontIv: number;
  /** Back leg IV (decimal). */
  readonly backIv: number;
  /** Risk-free rate (decimal). */
  readonly r: number;
  /** Continuous dividend yield (decimal). */
  readonly q: number;
  /** Debit paid to enter the calendar (dollars, contract-multiplier-adjusted). */
  readonly debit: number;
};

/**
 * Payoff of the long put calendar at front-leg expiry, as a function of spot S.
 * Front leg is worth its intrinsic value (T=0); back leg is priced at its remaining time.
 */
function frontExpiryPayoff(input: BreakevenInput, S: number): number {
  const remainingBackT = Math.max((input.backDte - input.frontDte) / 365, 0.001);
  const backValue = bsmPrice(S, input.backStrike, remainingBackT, input.backIv, input.r, input.q, "P");
  const frontIntrinsic = Math.max(input.frontStrike - S, 0);
  return (backValue - frontIntrinsic) * 100 - input.debit;
}

/**
 * Find the spot level(s) where a long put-calendar's payoff-at-front-expiry crosses zero.
 *
 * Scans a bounded grid of BISECT_STEPS points across [spot*BISECT_LO, spot*BISECT_HI],
 * detects sign changes between adjacent grid points, and bisects each bracket (hard cap
 * MAX_ITER iterations) to locate the zero-crossing spot.
 *
 * @returns Spot levels where the payoff crosses zero (0, 1, or 2 for a typical calendar).
 *          Empty array when no breakeven exists within the search bounds — never NaN/throw.
 */
export function findBreakevens(input: BreakevenInput): ReadonlyArray<number> {
  const lo = input.spot * BISECT_LO;
  const hi = input.spot * BISECT_HI;
  const results: number[] = [];

  let prevS = lo;
  let prevP = frontExpiryPayoff(input, prevS);

  for (let i = 1; i <= BISECT_STEPS; i++) {
    const curS = lo + ((hi - lo) * i) / BISECT_STEPS;
    const curP = frontExpiryPayoff(input, curS);

    if (prevP * curP < 0) {
      let a = prevS;
      let b = curS;
      let fa = prevP;
      let mid = a;
      for (let iter = 0; iter < MAX_ITER; iter++) {
        mid = (a + b) / 2;
        const fm = frontExpiryPayoff(input, mid);
        if (Math.abs(fm) < TOL || b - a < TOL) {
          break;
        }
        if (fa * fm < 0) {
          b = mid;
        } else {
          a = mid;
          fa = fm;
        }
      }
      results.push(mid);
    }

    prevS = curS;
    prevP = curP;
  }

  return results;
}

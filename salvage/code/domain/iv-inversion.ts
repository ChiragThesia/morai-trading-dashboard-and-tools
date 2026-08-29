/**
 * IV inversion — Newton-Raphson with bisection fallback
 *
 * Recovers implied volatility from an option mark price.
 *
 * Algorithm (RESEARCH.md Pattern 4):
 *   1. Guard degenerate inputs → typed IvError
 *   2. Brenner-Subrahmanyam initial guess, clamped to [BISECT_LO, BISECT_HI]
 *   3. Newton-Raphson loop (MAX_ITER iterations):
 *      - Break to bisection when vega < VEGA_THRESHOLD or sigma leaves bounds
 *   4. 200-step guaranteed-convergence bisection fallback
 *
 * Returns Result<number, IvError> — never throws, never produces NaN in the ok path.
 * Threat T-02-06: hard iteration caps prevent infinite loops on pathological input.
 *
 * Pure domain: no I/O, imports only from ./bsm.ts and @morai/shared.
 * D-09: callers map err() to a NaN stamp; unsolvable marks never propagate as NaN.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { bsmPrice, bsmVega } from "./bsm.ts";

// ─────────────────────────────────────────────────────────────
// Constants (RESEARCH.md Pattern 4 verbatim)
// ─────────────────────────────────────────────────────────────
const VEGA_THRESHOLD = 1e-8;
const MAX_ITER = 50;
const NR_TOL = 1e-10;
const BISECT_LO = 0.001;
const BISECT_HI = 5.0;
const BISECT_STEPS = 200;

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

/**
 * Discriminated union of reasons invertIv cannot produce a result.
 * D-09: callers stamp these rows with NaN rather than propagating invalid numbers.
 */
export type IvError =
  | { readonly kind: "expired" }
  | { readonly kind: "below-intrinsic" }
  | { readonly kind: "above-bound" };

// ─────────────────────────────────────────────────────────────
// Public function
// ─────────────────────────────────────────────────────────────

/**
 * Recover implied volatility from an option mark price.
 *
 * @param mark - Observed option price (must be > intrinsic and < upper bound)
 * @param S    - Spot price
 * @param K    - Strike price
 * @param T    - Time to expiration in years (must be > 0)
 * @param r    - Risk-free rate (decimal)
 * @param q    - Continuous dividend yield (decimal)
 * @param type - 'C' for call, 'P' for put
 * @returns Result<number, IvError> — ok(sigma) or typed error
 */
export function invertIv(
  mark: number,
  S: number,
  K: number,
  T: number,
  r: number,
  q: number,
  type: "C" | "P",
): Result<number, IvError> {
  // Guard 1: expired
  if (T <= 0) {
    return err<IvError>({ kind: "expired" });
  }

  // Guard 2: below European no-arb lower bound
  // SPX/SPXW are European-exercise. The correct lower bound is the discounted no-arb bound,
  // not the American (undiscounted) intrinsic. Using American intrinsic (max(K-S,0)) would
  // reject valid deep-ITM European put marks that legitimately trade below raw intrinsic.
  // European bounds (CR-03):
  //   Call: max(S·e^(-qT) - K·e^(-rT), 0)
  //   Put:  max(K·e^(-rT) - S·e^(-qT), 0)
  const lowerBound =
    type === "C"
      ? Math.max(S * Math.exp(-q * T) - K * Math.exp(-r * T), 0)
      : Math.max(K * Math.exp(-r * T) - S * Math.exp(-q * T), 0);
  // Allow a small tolerance (0.5) for rounding/bid-ask but reject clearly below-bound
  if (mark < lowerBound - 0.5) {
    return err<IvError>({ kind: "below-intrinsic" });
  }

  // Guard 3: above upper bound
  // Call: price < S * e^(-qT). Put: price < K * e^(-rT).
  const upperBound =
    type === "C"
      ? S * Math.exp(-q * T)
      : K * Math.exp(-r * T);
  if (mark >= upperBound) {
    return err<IvError>({ kind: "above-bound" });
  }

  // Brenner-Subrahmanyam initial guess: sigma_0 = (mark/S) * sqrt(2*pi/T)
  const bs0 = (mark / S) * Math.sqrt(2 * Math.PI / T);
  let sigma =
    bs0 > 0 && isFinite(bs0) && bs0 >= BISECT_LO && bs0 <= BISECT_HI
      ? bs0
      : 0.2;

  // ── Newton-Raphson loop ──────────────────────────────────
  // Threat T-02-06: hard cap at MAX_ITER (50), break to bisection on
  // low vega or out-of-bounds sigma.
  let usedBisection = false;

  for (let i = 0; i < MAX_ITER; i++) {
    const price = bsmPrice(S, K, T, sigma, r, q, type);
    const vega = bsmVega(S, K, T, sigma, r, q);

    if (vega < VEGA_THRESHOLD) {
      // Vega too flat — Newton step is unreliable, fall back to bisection
      usedBisection = true;
      break;
    }

    const diff = price - mark;
    const step = diff / vega;
    const newSigma = sigma - step;

    if (newSigma < BISECT_LO || newSigma > BISECT_HI) {
      // Newton stepped outside valid range — fall back to bisection
      usedBisection = true;
      break;
    }

    sigma = newSigma;

    if (Math.abs(step) < NR_TOL) {
      // Converged
      break;
    }
  }

  // ── Bisection fallback ───────────────────────────────────
  // Engages when Newton diverges or vega is below VEGA_THRESHOLD (D-03).
  // Guaranteed convergence in BISECT_STEPS iterations.
  // Threat T-02-06: hard cap at BISECT_STEPS (200).
  if (usedBisection) {
    let lo = BISECT_LO;
    let hi = BISECT_HI;

    let currentPriceLo = bsmPrice(S, K, T, lo, r, q, type);
    const priceHi = bsmPrice(S, K, T, hi, r, q, type);

    // If lo already solves the equation (e.g., near-intrinsic marks where price
    // is flat in sigma and any low sigma fits), accept lo immediately.
    if (Math.abs(currentPriceLo - mark) < NR_TOL) {
      sigma = lo;
    } else if ((currentPriceLo - mark) * (priceHi - mark) > 0) {
      // Mark is outside [price(lo), price(hi)] — use closest endpoint
      if (Math.abs(currentPriceLo - mark) < Math.abs(priceHi - mark)) {
        sigma = lo;
      } else {
        sigma = hi;
      }
    } else {
      // Standard bisection: maintain currentPriceLo so sign tests stay correct
      // as lo advances.
      for (let i = 0; i < BISECT_STEPS; i++) {
        const mid = (lo + hi) / 2;
        const priceMid = bsmPrice(S, K, T, mid, r, q, type);
        const diff = priceMid - mark;

        if (Math.abs(diff) < NR_TOL || (hi - lo) < NR_TOL) {
          sigma = mid;
          break;
        }

        if ((currentPriceLo - mark) * diff < 0) {
          hi = mid;
          // currentPriceLo stays the same — lo end unchanged
        } else {
          lo = mid;
          currentPriceLo = priceMid; // update as lo advances
        }

        sigma = mid;
      }
    }
  }

  // Final guard: sigma must be finite and positive
  if (!isFinite(sigma) || sigma <= 0) {
    return err<IvError>({ kind: "below-intrinsic" });
  }

  // WR-01: post-solve residual check — ensure the recovered sigma actually reprices to
  // the mark within tolerance. This collapses the bisection endpoint-clamp path
  // (where the mark falls outside [price(BISECT_LO), price(BISECT_HI)] and the
  // solver returns ok(BISECT_LO) or ok(BISECT_HI) — a fabricated IV) and the
  // non-converged Newton path into typed err rather than silently propagating junk IV.
  // Tolerance: 1e-4 absolute (stricter than the 1e-6 round-trip property —
  // the round-trip property has its own guard; 1e-4 here catches endpoint-clamped sigmas).
  const residualPrice = bsmPrice(S, K, T, sigma, r, q, type);
  if (Math.abs(residualPrice - mark) > 1e-4) {
    return err<IvError>({ kind: "below-intrinsic" });
  }

  return ok(sigma);
}

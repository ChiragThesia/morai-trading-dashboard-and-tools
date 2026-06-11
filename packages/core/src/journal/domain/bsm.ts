/**
 * Black-Scholes-Merton pricing + greeks engine
 *
 * Pure domain functions — no I/O, no imports outside packages/shared (and none needed).
 * European calls/puts with continuous dividend yield q.
 *
 * Display conventions (D-12):
 *   - theta: per calendar day (365.25-day year basis, D-04), negative = decay
 *   - vega:  per 1 vol point (i.e. dV/d(sigma×100) = analytic vega / 100)
 *   - delta: raw per-share (no ×100 — applied at read/display only)
 *   - gamma: raw per-share
 *
 * Written fresh per D-05. ncdf coefficients sourced from A&S 7.1.26 (5-term polynomial).
 */

// ─────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────

/**
 * Normal CDF via A&S 7.1.26 five-term polynomial approximation.
 * Max absolute error ~1.5e-7 per CDF evaluation.
 */
function ncdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1 - poly * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

/** Standard normal PDF. */
function npdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

/** Greeks in TOS display units (D-12). */
export type BsmGreeks = {
  /** e^(-qT)·N(d1) for call; e^(-qT)·(N(d1)−1) for put */
  readonly delta: number;
  /** e^(-qT)·n(d1) / (S·sigma·sqrt(T)) */
  readonly gamma: number;
  /**
   * Per calendar day (negative = time decay).
   * Annual theta / 365.25 per D-04 basis.
   */
  readonly theta: number;
  /**
   * Per 1 vol point.
   * dV/d(sigma×100) = S·e^(-qT)·n(d1)·sqrt(T) / 100
   */
  readonly vega: number;
};

// ─────────────────────────────────────────────────────────────
// Public functions
// ─────────────────────────────────────────────────────────────

/**
 * European BSM price with continuous dividend yield.
 *
 * @param S     - Spot price
 * @param K     - Strike price
 * @param T     - Time to expiration in years
 * @param sigma - Implied volatility (decimal, e.g. 0.20 = 20%)
 * @param r     - Risk-free rate (decimal)
 * @param q     - Continuous dividend yield (decimal, D-01 default 0.013)
 * @param type  - 'C' for call, 'P' for put
 * @returns Option price
 */
export function bsmPrice(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  q: number,
  type: "C" | "P",
): number {
  if (T <= 0) {
    return type === "C" ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  if (type === "C") {
    return S * Math.exp(-q * T) * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2);
  }
  return K * Math.exp(-r * T) * ncdf(-d2) - S * Math.exp(-q * T) * ncdf(-d1);
}

/**
 * European BSM greeks with continuous dividend yield, in TOS display units (D-12).
 *
 * @param S     - Spot price
 * @param K     - Strike price
 * @param T     - Time to expiration in years (must be > 0)
 * @param sigma - Implied volatility (decimal)
 * @param r     - Risk-free rate (decimal)
 * @param q     - Continuous dividend yield (decimal)
 * @param type  - 'C' for call, 'P' for put
 * @returns BsmGreeks in TOS display conventions
 */
export function bsmGreeks(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  q: number,
  type: "C" | "P",
): BsmGreeks {
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqT);
  const d2 = d1 - sigma * sqT;
  const eqT = Math.exp(-q * T);
  const erT = Math.exp(-r * T);
  const nd1 = npdf(d1);

  const delta = type === "C" ? eqT * ncdf(d1) : eqT * (ncdf(d1) - 1);
  const gamma = (eqT * nd1) / (S * sigma * sqT);

  // Theta: annual rate converted to per-calendar-day via 365.25-day basis (D-04).
  const thetaAnnual =
    type === "C"
      ? -(S * eqT * nd1 * sigma) / (2 * sqT) - r * K * erT * ncdf(d2) + q * S * eqT * ncdf(d1)
      : -(S * eqT * nd1 * sigma) / (2 * sqT) + r * K * erT * ncdf(-d2) - q * S * eqT * ncdf(-d1);
  const theta = thetaAnnual / 365.25;

  // Vega: per 1 vol point (divide analytic vega by 100, D-12).
  const vega = (S * eqT * nd1 * sqT) / 100;

  return { delta, gamma, theta, vega };
}

/**
 * Analytic vega WITHOUT the /100 scaling factor.
 *
 * This is the raw dV/d(sigma) used as the Newton-Raphson denominator in IV inversion.
 * For display vega (per vol point), use bsmGreeks().vega instead.
 *
 * @param S     - Spot price
 * @param K     - Strike price
 * @param T     - Time to expiration in years
 * @param sigma - Implied volatility (decimal)
 * @param r     - Risk-free rate (decimal)
 * @param q     - Continuous dividend yield (decimal)
 * @returns Analytic vega (unscaled)
 */
export function bsmVega(
  S: number,
  K: number,
  T: number,
  sigma: number,
  r: number,
  q: number,
): number {
  const sqT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / (sigma * sqT);
  return S * Math.exp(-q * T) * npdf(d1) * sqT;
}

/**
 * position-greeks.ts — Client-side per-position greeks via @morai/quant
 *
 * POSITIONS-01 resolution (D-03, D-01):
 *   GET /api/positions returns brokerPosition[] with NO computed greeks.
 *   Per D-03 (live-only, fix at source — never fake/cache in the frontend):
 *   we compute per-position greeks CLIENT-SIDE using the shared @morai/quant kernel.
 *   This is the one shared kernel guaranteeing the numbers match the server (D-01).
 *
 * OCC parsing: delegates entirely to parseOccSymbol from @morai/shared — no hand-rolled
 * OCC parsing in this file. No `as`/`any`/`!`.
 */

import { bsmGreeks, type BsmGreeks } from "@morai/quant";
import { parseOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { ok, err } from "@morai/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Inputs for client-side greek computation of one broker position. */
export type PositionGreeksInput = {
  /** 21-char OCC symbol from brokerPosition. */
  readonly occSymbol: string;
  /** Current spot price of the underlying. */
  readonly spot: number;
  /** Implied volatility as a decimal (e.g. 0.18 = 18%). */
  readonly iv: number;
  /** Risk-free rate as a decimal (e.g. 0.045 = 4.5%). */
  readonly rate: number;
  /** Continuous dividend yield as a decimal (default 0.013 per D-01). */
  readonly divYield: number;
  /** Long quantity from brokerPosition.longQty. */
  readonly longQty: number;
  /** Short quantity from brokerPosition.shortQty. */
  readonly shortQty: number;
};

/** Successful result: position greeks scaled by net quantity. */
export type PositionGreeksResult = {
  /** Net quantity (longQty − shortQty). Positive = net long, negative = net short. */
  readonly netQty: number;
  /**
   * Per-position greeks scaled by netQty.
   * Conventions match bsmGreeks (D-12): theta per calendar day, vega per 1 vol point,
   * delta raw per-share, gamma raw per-share.
   */
  readonly greeks: BsmGreeks;
};

/** OCC parse error wrapper. */
type GreeksError =
  | { readonly kind: "OCC_PARSE_ERROR"; readonly detail: string }
  | { readonly kind: "EXPIRED"; readonly detail: string };

// ─── Implementation ───────────────────────────────────────────────────────────

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * computePositionGreeks — compute per-position BSM greeks using the shared @morai/quant kernel.
 *
 * Steps:
 *   1. Parse the OCC symbol via parseOccSymbol (@morai/shared) — no hand-rolled parsing.
 *   2. Derive T (years to expiry) from the parsed expiry date.
 *   3. Call bsmGreeks(S, K, T, sigma, r, q, type) from @morai/quant.
 *   4. Scale each greek by net qty (longQty − shortQty).
 *
 * Returns err for invalid OCC symbols (delegates error to OccError).
 * Returns ok with zero greeks when netQty = 0.
 * Returns ok with greeks = 0 when T <= 0 (position expired).
 */
export function computePositionGreeks(
  input: PositionGreeksInput,
): Result<PositionGreeksResult, GreeksError> {
  const parseResult = parseOccSymbol(input.occSymbol);

  if (!parseResult.ok) {
    return err({
      kind: "OCC_PARSE_ERROR",
      detail: `parseOccSymbol failed for "${input.occSymbol}": ${parseResult.error.kind}`,
    });
  }

  const { expiry, type, strike } = parseResult.value;
  const netQty = input.longQty - input.shortQty;

  // T in years from now to expiry
  const T = (expiry.getTime() - Date.now()) / MS_PER_YEAR;

  // Zero greeks when net qty is zero
  if (netQty === 0) {
    return ok({
      netQty: 0,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
    });
  }

  // Zero greeks when expired (T <= 0); bsmGreeks is undefined at T=0
  if (T <= 0) {
    return ok({
      netQty,
      greeks: { delta: 0, gamma: 0, theta: 0, vega: 0 },
    });
  }

  // Call the shared kernel — same math the server uses (D-01)
  const kernelGreeks = bsmGreeks(
    input.spot,
    strike,
    T,
    input.iv,
    input.rate,
    input.divYield,
    type,
  );

  // Scale by net position quantity
  return ok({
    netQty,
    greeks: {
      delta: kernelGreeks.delta * netQty,
      gamma: kernelGreeks.gamma * netQty,
      theta: kernelGreeks.theta * netQty,
      vega: kernelGreeks.vega * netQty,
    },
  });
}

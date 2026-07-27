/**
 * chain-risk-reversal.ts — 25Δ risk-reversal for one expiration of the live chain.
 *
 * The proper vertical-skew headline is the 25-delta risk reversal, `IV(25Δ put) −
 * IV(25Δ call)`. That formula already ships, property-tested, in the hexagon:
 * `interpolateRiskReversal` (packages/core/src/analytics/domain/risk-reversal.ts). This
 * file does NOT reimplement it — it is the ADAPTER that makes chain rows edible by it.
 *
 * Chain rows carry `bsmIv` but no delta, and the core interpolator interpolates linearly
 * in DELTA. So per row we solve delta through the shared BSM kernel (`@morai/quant`, the
 * same engine every other web greeks caller uses) and hand the resulting smile over
 * untouched. Every "should this be null?" decision stays in the core function.
 *
 * Units, both easy to get wrong and both pinned by the test oracle:
 *   - `strike` is the ×1000 integer convention (6000000 = 6000 index points).
 *   - `dte` is calendar days; T uses the 365.25-day year (D-04), as elsewhere in web.
 *
 * Returns null — never a number — whenever either wing cannot bracket its ±0.25 target.
 * That is the production reality while the chain read is still puts-only: no call wing,
 * no risk-reversal. A missing `bsmIv` is dropped, never defaulted (T-17-01).
 */

import { interpolateRiskReversal } from "@morai/core";
import type { SmileQuote } from "@morai/core";
import { bsmGreeks } from "@morai/quant";

/** D-04 year basis — same divisor as every other web-side BSM caller. */
const DAYS_PER_YEAR = 365.25;

/**
 * The fields this adapter reads off a chain row. A structural subset of the published
 * chain-row contract, so a full contract row is assignable without a cast.
 */
export type ChainSmileRow = {
  /** ×1000 integer (6000000 = 6000 index points). */
  readonly strike: number;
  /** YYYY-MM-DD. */
  readonly expiration: string;
  readonly contractType: "C" | "P";
  /** OCC root — SPX (AM-settled monthlies) and SPXW (PM-settled weeklies) are separate books. */
  readonly root: "SPX" | "SPXW";
  /** Calendar days to expiry. */
  readonly dte: number;
  /** Decimal, 0.1249 = 12.49%. Null when the BSM solve has not landed. */
  readonly bsmIv: number | null;
  readonly underlyingPrice: number;
};

/**
 * riskReversalForExpiry — `IV(25Δ put) − IV(25Δ call)` for one expiration AND one OCC root, in
 * decimal vol units (0.032 = 3.2 vol points). Positive = puts bid over calls, the usual equity
 * put skew.
 *
 * ROOT IS A PARAMETER, not a caller convention, for the same reason `chain-math.atmIv` takes the
 * wing: SPX and SPXW quote the SAME strikes on the SAME dates out of different books. An
 * expiration-only filter builds ONE smile from TWO, handing the interpolator two IVs per delta.
 * Nothing nulls — every input is present and finite — so it returns a clean, plausible, wrong
 * number off a jagged mixture. That is the one failure mode this module cannot report, so the
 * signature refuses to let it happen.
 *
 * @param rows        - chain rows for any set of expirations and roots; others are ignored
 * @param expiration  - the YYYY-MM-DD expiration to price
 * @param r           - risk-free rate (decimal)
 * @param q           - continuous dividend yield (decimal)
 * @param root        - the OCC root whose book to read
 * @returns the risk-reversal, or null when either wing is missing or too sparse to bracket
 */
export function riskReversalForExpiry(
  rows: ReadonlyArray<ChainSmileRow>,
  expiration: string,
  r: number,
  q: number,
  root: "SPX" | "SPXW",
): number | null {
  const smile: SmileQuote[] = [];

  for (const row of rows) {
    if (row.expiration !== expiration) continue;
    if (row.root !== root) continue;

    // A missing or non-physical IV is dropped, never defaulted — a fabricated vol would
    // land a fabricated delta in a wing and silently move the headline.
    const iv = row.bsmIv;
    if (iv === null || !Number.isFinite(iv) || iv <= 0) continue;

    // At or past expiry delta is a step function, not something to interpolate across;
    // BSM's d1 is undefined at T=0. Same for a non-positive spot or strike.
    if (!Number.isFinite(row.dte) || row.dte <= 0) continue;
    if (!(row.underlyingPrice > 0) || !(row.strike > 0)) continue;

    const { delta } = bsmGreeks(
      row.underlyingPrice,
      row.strike / 1000,
      row.dte / DAYS_PER_YEAR,
      iv,
      r,
      q,
      row.contractType,
    );

    smile.push({
      underlying: "", // inert: interpolateRiskReversal reads only `delta` and `iv`
      expiration: row.expiration,
      strike: row.strike,
      iv,
      delta,
      moneyness: null, // inert, see above
    });
  }

  return interpolateRiskReversal(smile);
}

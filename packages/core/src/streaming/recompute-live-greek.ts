/**
 * recomputeLiveGreek — BSM live greek recompute from a raw sidecar tick
 *
 * D-02: Live greeks are recomputed via the @morai/quant BSM engine from the streamed
 * mark + underlying_price, NOT taken from Schwab's raw LEVELONE greeks. This ensures
 * the live view displays the same numbers as the journal (same BSM math, streaming cadence).
 *
 * STRM-04: Pure compute — no I/O, no Postgres access, no leg_observations writes.
 *
 * Pitfall 4 guards (mark absent / T <= 0):
 *   - price = mark ?? (bid+ask)/2; returns err skip when price unavailable or <= 0
 *   - T = time to expiry; returns err skip when T <= 0 (expired option)
 *   - Returns err skip on invertIv failure (below-intrinsic, above-bound, or non-convergence)
 *   - Never throws, never produces NaN on the ok path
 *
 * Hexagon purity: imports only @morai/quant + @morai/shared + relative core files.
 * No hono, no fastapi types, no SSE primitives, no process.env.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { parseOccSymbol } from "@morai/shared";
import { bsmGreeks } from "@morai/quant";
import { invertIv } from "../journal/domain/iv-inversion.ts";
import type { RawOptionTick, LiveGreekTick } from "./ports.ts";

/** Reason codes for a skip (non-event) result. */
export type LiveGreekSkip =
  | { readonly kind: "no-price" }
  | { readonly kind: "bad-symbol" }
  | { readonly kind: "expired" }
  | { readonly kind: "iv-failed" };

/**
 * Recompute BSM live greeks from a raw sidecar option tick.
 *
 * @param tick   - Raw tick from the sidecar LEVELONE_OPTIONS stream
 * @param rate   - Risk-free rate (decimal; caller should cache from rate_observations)
 * @param q      - Continuous dividend yield (decimal; typical: BSM_DIVIDEND_YIELD = 0.013)
 * @param now    - Reference time for computing T (time to expiry in years)
 * @returns ok(LiveGreekTick) on success, err(LiveGreekSkip) on any guard failure
 */
export function recomputeLiveGreek(
  tick: RawOptionTick,
  rate: number,
  q: number,
  now: Date,
): Result<LiveGreekTick, LiveGreekSkip> {
  // Guard 1: resolve mark price — mark ?? midpoint, skip when unavailable
  let price: number;
  if (tick.mark !== null && tick.mark > 0) {
    price = tick.mark;
  } else if (tick.bid !== null && tick.ask !== null) {
    const midpoint = (tick.bid + tick.ask) / 2;
    if (midpoint <= 0) {
      return err<LiveGreekSkip>({ kind: "no-price" });
    }
    price = midpoint;
  } else {
    return err<LiveGreekSkip>({ kind: "no-price" });
  }

  // Guard 2: underlying price must be positive
  const S = tick.underlyingPrice;
  if (S === null || S <= 0) {
    return err<LiveGreekSkip>({ kind: "no-price" });
  }

  // Guard 3: parse OCC symbol to get strike, expiry, type
  const parsed = parseOccSymbol(tick.occSymbol);
  if (!parsed.ok) {
    return err<LiveGreekSkip>({ kind: "bad-symbol" });
  }
  const { expiry, type, strike: K } = parsed.value;

  // Guard 4: T must be positive (not expired)
  const T = (expiry.getTime() - now.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (T <= 0) {
    return err<LiveGreekSkip>({ kind: "expired" });
  }

  // IV inversion (Newton-Raphson + bisection fallback from invertIv)
  const ivResult = invertIv(price, S, K, T, rate, q, type);
  if (!ivResult.ok) {
    return err<LiveGreekSkip>({ kind: "iv-failed" });
  }
  const iv = ivResult.value;

  // BSM greeks from the recovered IV (D-02 — never raw Schwab greeks)
  const greeks = bsmGreeks(S, K, T, iv, rate, q, type);

  const liveGreekTick: LiveGreekTick = {
    occSymbol: tick.occSymbol,
    mark: price,
    bid: tick.bid,
    ask: tick.ask,
    bsmIv: iv,
    bsmDelta: greeks.delta,
    bsmGamma: greeks.gamma,
    bsmTheta: greeks.theta,
    bsmVega: greeks.vega,
    ts: tick.ts,
  };

  return ok(liveGreekTick);
}

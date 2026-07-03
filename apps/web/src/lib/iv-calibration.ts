/**
 * iv-calibration.ts — client-side price→IV calibration wrapper (OVW-02, D-01)
 *
 * Thin caller around the already-shipped, production-hardened `invertIv` solver
 * (packages/core/src/journal/domain/iv-inversion.ts). This file does NOT implement a
 * solver — it resolves a per-leg price (live tick or REST fallback) and either trusts
 * an already-converged live tick's IV or calls `invertIv` for the REST/cold-start path,
 * surfacing `invertIv`'s typed err verbatim.
 *
 * D-01: calibrate against the live mark, never raw bid/ask; return a tagged
 * "did-not-converge" result on failure — never DEFAULT_IV, never the last iterate
 * (T-17-01).
 *
 * Pitfall 2: when a live SSE tick is present, trust `tick.bsmIv` directly (the server
 * only emits on `invertIv` ok) — keeps exactly one non-convergence code path (the
 * REST/cold-start branch).
 * Pitfall 3: REST-fallback price derivation guards `netQty === 0` / `marketValue ===
 * null` — never divides by zero, never yields NaN/Infinity (T-17-02).
 */

import { parseOccSymbol, ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { invertIv } from "@morai/core";
import type { IvError } from "@morai/core";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal live-tick shape `resolveLegIv` needs: an already server-calibrated IV.
 * `mark` is kept for shape parity with `StreamLiveGreekEvent` even though the
 * trust-shortcut only reads `bsmIv`.
 */
export type LiveTick = {
  readonly mark: number;
  readonly bsmIv: number;
};

/** Tagged calibration error: `invertIv`'s own `IvError`, plus a distinct "no-price" state. */
export type CalibrationError = IvError | { readonly kind: "no-price" };

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * BSM cross-engine parity tolerance (Task 2 / Open Question 1) — absolute price
 * tolerance for comparing an `invertIv`-recovered sigma re-priced through
 * `@morai/quant`'s `bsmPrice` against the original mark.
 *
 * OQ1 resolved: `packages/core/src/journal/domain/bsm.ts` (the module `invertIv`
 * calls internally) is a re-export shim of `@morai/quant`'s `bsmPrice` — the two
 * "engines" are the same function. This tolerance only needs to absorb floating-point
 * noise from the REST-fallback price round-trip (`mark * 100` then `/ 100`), not any
 * genuine cross-engine divergence.
 */
export const BSM_PARITY_TOLERANCE = 1e-6;

// ─── resolveLegIv ─────────────────────────────────────────────────────────────

/**
 * resolveLegIv — turn a live tick or REST-derived price into a calibrated IV.
 *
 * Order: parse OCC → guard expiry → trust live tick (if present, Pitfall 2) → else
 * derive the guarded REST-fallback price (Pitfall 3) → invertIv → surface its err tag
 * verbatim. NEVER substitutes DEFAULT_IV on any branch (T-17-01).
 */
export function resolveLegIv(
  occSymbol: string,
  spot: number,
  rate: number,
  divYield: number,
  liveTick: LiveTick | null,
  restMarketValue: number | null,
  netQty: number,
  now: Date,
): Result<number, CalibrationError> {
  const parsed = parseOccSymbol(occSymbol);
  if (!parsed.ok) {
    return err({ kind: "no-price" });
  }
  const { expiry, type, strike } = parsed.value;

  const T = (expiry.getTime() - now.getTime()) / MS_PER_YEAR;
  if (T <= 0) {
    return err<CalibrationError>({ kind: "expired" });
  }

  // Pitfall 2: a live tick's IV is already-converged (server emits only on invertIv
  // ok) — trust it directly. This keeps exactly one non-convergence code path.
  if (liveTick !== null) {
    return ok(liveTick.bsmIv);
  }

  // REST fallback (Pitfall 3): guard division — never 0/0, never NaN/Infinity.
  if (restMarketValue === null || netQty === 0) {
    return err({ kind: "no-price" });
  }
  const price = Math.abs(restMarketValue) / (Math.abs(netQty) * 100);

  return invertIv(price, spot, strike, T, rate, divYield, type);
}

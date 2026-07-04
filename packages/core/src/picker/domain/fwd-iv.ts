/**
 * Forward-variance identity (picker criterion 1) — never-NaN inverted-structure guard.
 *
 * Port of `mockups/playground-v4.html`'s `fwdIV()` (lines 238-241). Given two term-structure
 * points (front/back DTE + IV), computes the forward IV implied between them — the volatility
 * the market prices for the period strictly between the two expiries.
 *
 * Guard (19-CONTEXT.md: "FwdIV radicand<0 -> tagged guard, never NaN"; must_haves truths):
 * the radicand is negative only when the term structure is inverted (front IV rich relative to
 * back IV for their respective DTEs). A radicand of exactly zero is a valid degenerate "ok"
 * result (fwdIv = 0), not an inverted one — the guard only rejects radicand < 0.
 *
 * Pure domain: no I/O, no imports (T is in DTE/days, matching the mockup).
 */

/** Result of computeFwdIv — literal-tagged union matching pickerCandidate.fwdIv/fwdIvGuard. */
export type FwdIvResult =
  | { readonly fwdIv: number; readonly guard: "ok" }
  | { readonly fwdIv: null; readonly guard: "inverted" };

/**
 * Compute the forward IV between a front and back term-structure point.
 *
 * @param tf  - Front leg DTE (days)
 * @param ivf - Front leg IV (decimal)
 * @param tb  - Back leg DTE (days), must be > tf
 * @param ivb - Back leg IV (decimal)
 * @returns { fwdIv, guard: "ok" } when the radicand is >= 0, else { fwdIv: null, guard: "inverted" }
 */
export function computeFwdIv(tf: number, ivf: number, tb: number, ivb: number): FwdIvResult {
  const rad = (tb * ivb * ivb - tf * ivf * ivf) / (tb - tf);
  if (rad < 0) {
    return { fwdIv: null, guard: "inverted" };
  }
  return { fwdIv: Math.sqrt(rad), guard: "ok" };
}

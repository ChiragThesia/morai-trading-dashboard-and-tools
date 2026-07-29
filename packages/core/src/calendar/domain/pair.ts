/**
 * pair.ts — the calendar arithmetic for TWO legs the reader picked, with no gates.
 *
 * Hexagon law (architecture-boundaries §2): pure. No clock — both legs arrive with their own
 * `t`, measured once in `cohort.ts` against the injected observation instant.
 *
 * WHY THIS IS NOT `enumerateCandidates`. The ranker's pair math lives inside a loop that has
 * already refused everything odd: both legs tradeable, front ≥ 15 DTE, gap ≥ 15 days, one root,
 * one strike, term structure not inverted. The chain's Pair surface is the opposite contract —
 * the reader picks any two legs and the screen must MEASURE what they picked, including a
 * diagonal, an inverted pair, a cross-root pair, or a leg the chain never managed to price.
 * Reusing the ranker would mean returning nothing for exactly the pairs a reader clicks two rows
 * to interrogate.
 *
 * So the arithmetic here MIRRORS `candidate.ts`'s (hSkew, net, debit, and `computeFwdIv` on the
 * two legs' own IVs) rather than extending it. Extracting one shared helper is deliberately
 * deferred: `candidate.ts` is the shipped ranking path, and refactoring it is not a change that
 * belongs in the same breath as repointing a screen.
 *
 * NULL HONESTY, and it is enforced on the INPUT as well as the output: `PairLegQuote` lets `iv`
 * and the greeks be null, so a degraded leg nulls its own fields and nothing else. That is not
 * decoration — arithmetic reads a null as zero, so a required-number input would have turned an
 * unpriced front into a clean, plausible, wrong hSkew and a "net" that is really the back leg's
 * raw greeks. Nothing here returns a fabricated 0 for a quantity that has no value.
 */

import { computeFwdIv } from "../../picker/domain/fwd-iv.ts";
import { haircutFill } from "../../picker/domain/candidate-selection.ts";
import type { NetGreeks } from "./candidate.ts";

/**
 * The fields the arithmetic below actually reads, and every priced one is NULLABLE.
 *
 * A `CohortLeg` satisfies this, and so does one row of the chain surface — which is the point.
 * The reader picks off a ladder where a Front/Back button sits on every strike, including the
 * ones the inversion never solved (24.4% of the live put wing on 2026-07-28). Requiring a solved
 * leg would either refuse those pairs outright or force the caller to fabricate an IV; a nullable
 * input lets the null travel to exactly the fields it kills and no further.
 *
 * Greeks are nullable AS A GROUP with `iv`, mirroring the surface one layer down: a leg either
 * priced or it did not.
 */
export type PairLegQuote = {
  /** Decimal, or null when the inversion never solved. Never 0 — a zero IV is a real value. */
  readonly iv: number | null;
  readonly bid: number;
  readonly ask: number;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
};

/** One picked leg: a quoted strike plus the cohort clock it was priced on. */
export type PairLeg = {
  /**
   * Years to the SETTLEMENT instant, from `Cohort.t` — never whole DTE days.
   *
   * The distinction is not cosmetic here. `computeFwdIv` is scale-invariant in `t`, so days and
   * years give the same forward vol when both legs are rescaled by the same factor — but the
   * settlement clock is not a uniform rescale of `dte`: AM (09:30 ET) settlement lands before
   * the expiry day's UTC midnight and PM (16:00 ET) after it, so `t_f / t_b ≠ dte_f / dte_b`
   * and the forward vol genuinely moves, by an amount whose SIGN FLIPS BY ROOT.
   */
  readonly t: number;
  readonly leg: PairLegQuote;
};

export type PairMetrics = {
  /** `frontIv − backIv`. Positive = the front is the rich one, the calendar seller's setup. */
  readonly hSkew: number | null;
  /** Forward vol between the two expiries. Null on an inverted structure or a non-later back. */
  readonly fwdIv: number | null;
  /** `frontIv − fwdIv`. Null exactly when `fwdIv` is — an inverted structure prices no edge. */
  readonly edge: number | null;
  /**
   * Back minus front, per contract, UNSCALED — index points, never ×100 dollars.
   *
   * ALL-OR-NOTHING: null when either leg is unpriced, never an object with four nulls in it. A
   * `net.delta` on its own reads as a real hedge ratio.
   */
  readonly net: NetGreeks | null;
  /** Entry debit at the ORATS fill haircut. Null when either leg has no fill to quote. */
  readonly debit: number | null;
};

export function pairMetrics(front: PairLeg, back: PairLeg): PairMetrics {
  const fwdIv = forwardIv(front, back);
  const ivF = front.leg.iv;

  return {
    hSkew: ivF === null || back.leg.iv === null ? null : ivF - back.leg.iv,
    fwdIv,
    edge: fwdIv === null || ivF === null ? null : ivF - fwdIv,
    net: netGreeks(front.leg, back.leg),
    debit:
      isQuotable(front.leg) && isQuotable(back.leg)
        ? haircutFill(back.leg, "buy") - haircutFill(front.leg, "sell")
        : null,
  };
}

/**
 * Back minus front on all four greeks, or null.
 *
 * Written as one guarded block rather than four subtractions because arithmetic reads a null as
 * zero: an unpriced front once handed back the BACK leg's raw greeks under a "net" label, every
 * number finite and nothing to dash.
 */
function netGreeks(front: PairLegQuote, back: PairLegQuote): NetGreeks | null {
  if (
    front.delta === null ||
    front.gamma === null ||
    front.theta === null ||
    front.vega === null ||
    back.delta === null ||
    back.gamma === null ||
    back.theta === null ||
    back.vega === null
  ) {
    return null;
  }
  return {
    delta: back.delta - front.delta,
    gamma: back.gamma - front.gamma,
    theta: back.theta - front.theta,
    vega: back.vega - front.vega,
  };
}

/**
 * The forward-variance identity, guarded twice.
 *
 * `tb <= tf` is rejected HERE rather than left to `computeFwdIv`: that function divides by
 * `tb − tf` and only rejects a negative radicand, so an equal or inverted pair reaches it as a
 * division by zero and comes back as `sqrt(NaN)` with `guard: "ok"` — a clean-looking NaN.
 */
function forwardIv(front: PairLeg, back: PairLeg): number | null {
  const ivF = front.leg.iv;
  const ivB = back.leg.iv;
  // An unpriced leg is guarded HERE too, for the same reason `tb <= tf` is: `computeFwdIv` takes
  // numbers, and a null arrives as a 0 variance that solves cleanly to a plausible forward vol.
  if (ivF === null || ivB === null) return null;
  if (!Number.isFinite(front.t) || !Number.isFinite(back.t) || back.t <= front.t) return null;
  const fwd = computeFwdIv(front.t, ivF, back.t, ivB);
  return fwd.guard === "inverted" ? null : fwd.fwdIv;
}

/** A fill exists only against a real offer: you cannot buy what is not offered, or cross a
 *  market that is already crossed. Same gate as the browser's `calendarDebit`. */
function isQuotable(leg: PairLegQuote): boolean {
  return (
    Number.isFinite(leg.bid) &&
    Number.isFinite(leg.ask) &&
    leg.ask > 0 &&
    leg.bid >= 0 &&
    leg.ask >= leg.bid
  );
}

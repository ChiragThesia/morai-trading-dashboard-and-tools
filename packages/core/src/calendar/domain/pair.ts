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
 * diagonal, an inverted pair or a cross-root pair. Reusing the ranker would mean returning
 * nothing for exactly the pairs a reader clicks two rows to interrogate.
 *
 * So the arithmetic here MIRRORS `candidate.ts`'s (hSkew, net, debit, and `computeFwdIv` on the
 * two legs' own IVs) rather than extending it. Extracting one shared helper is deliberately
 * deferred: `candidate.ts` is the shipped ranking path, and refactoring it is not a change that
 * belongs in the same breath as adding a read surface. When the switch lands, that is the
 * refactor to make.
 *
 * NULL HONESTY, the same rule the browser copy states: a degraded input nulls its OWN field and
 * nothing else. Nothing here returns a fabricated 0 for a quantity that has no value.
 */

import { computeFwdIv } from "../../picker/domain/fwd-iv.ts";
import { haircutFill } from "../../picker/domain/candidate-selection.ts";
import type { NetGreeks } from "./candidate.ts";
import type { CohortLeg } from "./types.ts";

/** One picked leg: a priced strike plus the cohort clock it was priced on. */
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
  readonly leg: CohortLeg;
};

export type PairMetrics = {
  /** `frontIv − backIv`. Positive = the front is the rich one, the calendar seller's setup. */
  readonly hSkew: number;
  /** Forward vol between the two expiries. Null on an inverted structure or a non-later back. */
  readonly fwdIv: number | null;
  /** `frontIv − fwdIv`. Null exactly when `fwdIv` is — an inverted structure prices no edge. */
  readonly edge: number | null;
  /** Back minus front, per contract, UNSCALED — index points, never ×100 dollars. */
  readonly net: NetGreeks;
  /** Entry debit at the ORATS fill haircut. Null when either leg has no fill to quote. */
  readonly debit: number | null;
};

export function pairMetrics(front: PairLeg, back: PairLeg): PairMetrics {
  const fwdIv = forwardIv(front, back);

  return {
    hSkew: front.leg.iv - back.leg.iv,
    fwdIv,
    edge: fwdIv === null ? null : front.leg.iv - fwdIv,
    net: {
      delta: back.leg.delta - front.leg.delta,
      gamma: back.leg.gamma - front.leg.gamma,
      theta: back.leg.theta - front.leg.theta,
      vega: back.leg.vega - front.leg.vega,
    },
    debit:
      isQuotable(front.leg) && isQuotable(back.leg)
        ? haircutFill(back.leg, "buy") - haircutFill(front.leg, "sell")
        : null,
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
  if (!Number.isFinite(front.t) || !Number.isFinite(back.t) || back.t <= front.t) return null;
  const fwd = computeFwdIv(front.t, front.leg.iv, back.t, back.leg.iv);
  return fwd.guard === "inverted" ? null : fwd.fwdIv;
}

/** A fill exists only against a real offer: you cannot buy what is not offered, or cross a
 *  market that is already crossed. Same gate as the browser's `calendarDebit`. */
function isQuotable(leg: CohortLeg): boolean {
  return (
    Number.isFinite(leg.bid) &&
    Number.isFinite(leg.ask) &&
    leg.ask > 0 &&
    leg.bid >= 0 &&
    leg.ask >= leg.bid
  );
}

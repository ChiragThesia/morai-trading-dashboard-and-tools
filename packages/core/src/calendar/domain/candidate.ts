/**
 * candidate.ts — enumerate every calendar worth considering, and measure it.
 *
 * Hexagon law (architecture-boundaries §2): pure. No clock — the cohorts already carry their
 * own `dte` and `t`, measured once in `cohort.ts` against the injected observation instant.
 *
 * Stage 2 of the engine. The candidate space is small enough to enumerate exhaustively:
 * measured on the live chain, front 15–60 DTE with a gap of at least 15 and a back leg inside
 * 90 gives 124 expiry pairs and 2,454 full calendars. One pass, no sampling, no heuristic
 * pruning.
 *
 * THE ONE MEASUREMENT DECISION THAT MATTERS: the term-structure quantities — forward vol, the
 * cushion, the forward factor, the slope — are computed from each cohort's 50-DELTA IVs, never
 * from the traded strike's own two IVs. Reading them off the traded strike measures skew, not
 * term structure. Measured on the live chain, ranking by per-strike forward factor put the top
 * four candidates 302, 277, 252 and 102 points from spot, at up to 14.4%, while the best
 * near-the-money candidate read 7.7% — SPX's front smile is steeper than its back smile, so a
 * deep strike shows local backwardation that is not a term-structure signal at all. The
 * per-strike reading is still computed and reported as `ffStrike`; it is simply never scored.
 */

import { computeFwdIv } from "../../picker/domain/fwd-iv.ts";
import { haircutFill } from "../../picker/domain/candidate-selection.ts";
import type { CandidateDropReason, Cohort, CohortLeg, Root } from "./types.ts";

/**
 * The trader's rule, as hard constants. Not knobs.
 *
 * "Minimum 15 DTE for my short, minimum 15 days between short and long." There is no option
 * to configure below these, deliberately: a floor that can be lowered by a caller is not a
 * rule, it is a default. The ceilings ARE knobs, because the trader works several windows
 * (15/30, 21/45, 30/60, 21/60).
 */
export const FRONT_DTE_FLOOR = 15;
export const GAP_DAYS_FLOOR = 15;

/**
 * Back-leg ceiling. This is a DATA bound, not a preference: ingest fetches to 90 DTE
 * (`BSM_MAX_DTE`), so nothing past it exists to rank.
 */
export const BACK_DTE_CEILING = 90;

export type EnumerateOptions = {
  /** Front-leg ceiling. Cannot lower the floor; a value under it simply yields nothing. */
  readonly frontDteMax: number;
};

export type NetGreeks = {
  readonly delta: number;
  readonly gamma: number;
  readonly theta: number;
  readonly vega: number;
};

/** One fully-measured calendar: a strike, a front expiry, a back expiry. */
export type Candidate = {
  readonly root: Root;
  readonly strike: number;
  readonly frontExpiration: string;
  readonly backExpiration: string;
  readonly frontDte: number;
  readonly backDte: number;
  readonly gapDays: number;

  // ── Term structure, from the 50-delta references. Strike-invariant within a pair. ──
  /** Forward vol between the two expiries: the price you actually pay on a calendar. */
  readonly fwdIv: number;
  /** `IV_back − fwdIv`, in decimal vol. The loss condition: the back leg falling to forward vol. */
  readonly cushion: number;
  /** `IV_front / fwdIv − 1`. The scored signal. */
  readonly ffAtm: number;
  /** `(IV_back − IV_front) / (t_b − t_f)`. Reported, not scored — same two IVs as `ffAtm`. */
  readonly slope: number;
  /**
   * The two 50-delta IVs the term-structure math above was computed from, carried explicitly.
   * The variance-risk-premium term needs the front one, and a reader checking `ffAtm` by hand
   * needs both — recovering them by inverting `ffAtm` would be a second way to be wrong.
   */
  readonly frontRefIv: number;
  readonly backRefIv: number;

  // ── At the traded strike. Reported, not scored. ──
  /** The per-strike forward factor. Skew-contaminated by construction; see the header. */
  readonly ffStrike: number | null;
  /** `iv_front(K) − iv_back(K)`: horizontal skew at this strike. */
  readonly hSkew: number;
  /** `iv_front(K) − atmIv_front`: how far up this strike sits on the front smile. */
  readonly vSkewFront: number | null;
  /** `iv_back(K) − atmIv_back`. */
  readonly vSkewBack: number | null;
  readonly frontIv: number;
  readonly backIv: number;

  // ── Risk and cost ──
  /** Back minus front, per contract, unscaled. A calendar is short gamma and long vega. */
  readonly net: NetGreeks;
  /**
   * Normalised carry: the front's daily decay as a fraction of its own extrinsic, minus the
   * back's. Positive and large means the front burns much faster than the back — which is the
   * calendar seller's case. Null when either leg has no extrinsic left to decay.
   */
  readonly thetaCarry: number | null;
  /** Entry debit in index points, at the fill haircut. Never at mid. */
  readonly debit: number;
  /** One-way cost of crossing both legs' spreads, in index points. */
  readonly spreadCost: number;

  readonly frontLeg: CohortLeg;
  readonly backLeg: CohortLeg;
};

export type EnumerateResult = {
  readonly candidates: ReadonlyArray<Candidate>;
  /**
   * Why would-be candidates never became one, so an empty result is explainable.
   *
   * The reasons THIS STAGE can produce, which is not all of them: a leg with no usable IV is
   * gone before enumeration ever sees it (`cohort.ts` `parseIv`), so `"no-iv-legs"` is not a key
   * here. It used to be — initialised to 0 and never incremented, which made the API's drops
   * record assert something false. The use-case holds both stages and assembles the full count.
   */
  readonly drops: Readonly<Record<CandidateDropReason, number>>;
};

export function enumerateCandidates(
  cohorts: ReadonlyArray<Cohort>,
  opts: EnumerateOptions,
): EnumerateResult {
  const drops: Record<CandidateDropReason, number> = {
    "front-dte-floor": 0,
    "front-dte-ceiling": 0,
    "back-dte-ceiling": 0,
    "gap-floor": 0,
    "root-mismatch": 0,
    "not-tradeable": 0,
    "term-inverted": 0,
    "no-atm-reference": 0,
  };
  const candidates: Candidate[] = [];

  // Sorted so the output order is a property of the data, not of the input array.
  const ordered = [...cohorts].sort(
    (a, b) => a.root.localeCompare(b.root) || a.dte - b.dte || a.expiration.localeCompare(b.expiration),
  );

  for (const front of ordered) {
    if (front.dte < FRONT_DTE_FLOOR) {
      drops["front-dte-floor"] += 1;
      continue;
    }
    if (front.dte > opts.frontDteMax) {
      drops["front-dte-ceiling"] += 1;
      continue;
    }

    for (const back of ordered) {
      if (back.root !== front.root) {
        // Mixing AM- and PM-settled legs changes the front leg's expiry-day risk, and nothing
        // in the doctrine covers it. Blocked in v1.
        drops["root-mismatch"] += 1;
        continue;
      }
      if (back.dte - front.dte < GAP_DAYS_FLOOR) {
        drops["gap-floor"] += 1;
        continue;
      }
      if (back.dte > BACK_DTE_CEILING) {
        drops["back-dte-ceiling"] += 1;
        continue;
      }

      const frontRef = front.atm50Iv;
      const backRef = back.atm50Iv;
      if (frontRef === null || backRef === null) {
        drops["no-atm-reference"] += 1;
        continue;
      }

      // The forward-variance identity on the 50-delta references, in years. An `"inverted"`
      // guard means the radicand went negative: the term structure prices NO forward vol, so
      // there is no edge to quote. Dropped with a reason — never substituted with a zero,
      // which is what the incumbent scorer does (scoring.ts:139).
      const fwd = computeFwdIv(front.t, frontRef, back.t, backRef);
      if (fwd.guard === "inverted") {
        drops["term-inverted"] += 1;
        continue;
      }
      if (fwd.fwdIv <= 0) {
        drops["term-inverted"] += 1;
        continue;
      }

      const ffAtm = frontRef / fwd.fwdIv - 1;
      const cushion = backRef - fwd.fwdIv;
      const slope = (backRef - frontRef) / (back.t - front.t);

      const backByStrike = new Map(back.legs.map((l) => [l.strike, l]));
      for (const frontLeg of front.legs) {
        const backLeg = backByStrike.get(frontLeg.strike);
        if (backLeg === undefined) continue;
        if (!frontLeg.tradeable || !backLeg.tradeable) {
          drops["not-tradeable"] += 1;
          continue;
        }

        const strikeFwd = computeFwdIv(front.t, frontLeg.iv, back.t, backLeg.iv);

        candidates.push({
          root: front.root,
          strike: frontLeg.strike,
          frontExpiration: front.expiration,
          backExpiration: back.expiration,
          frontDte: front.dte,
          backDte: back.dte,
          gapDays: back.dte - front.dte,

          fwdIv: fwd.fwdIv,
          cushion,
          ffAtm,
          slope,
          frontRefIv: frontRef,
          backRefIv: backRef,

          ffStrike:
            strikeFwd.guard === "inverted" || strikeFwd.fwdIv <= 0
              ? null
              : frontLeg.iv / strikeFwd.fwdIv - 1,
          hSkew: frontLeg.iv - backLeg.iv,
          vSkewFront: front.atmIv === null ? null : frontLeg.iv - front.atmIv,
          vSkewBack: back.atmIv === null ? null : backLeg.iv - back.atmIv,
          frontIv: frontLeg.iv,
          backIv: backLeg.iv,

          net: {
            delta: backLeg.delta - frontLeg.delta,
            gamma: backLeg.gamma - frontLeg.gamma,
            theta: backLeg.theta - frontLeg.theta,
            vega: backLeg.vega - frontLeg.vega,
          },
          thetaCarry: normalisedCarry(frontLeg, backLeg),
          // Buy the back up toward its ask, sell the front down toward its bid: both cross
          // 0.66 of the width off the natural side. Ranking on mid overstates every edge.
          debit: haircutFill(backLeg, "buy") - haircutFill(frontLeg, "sell"),
          spreadCost: backLeg.ask - backLeg.bid + (frontLeg.ask - frontLeg.bid),

          frontLeg,
          backLeg,
        });
      }
    }
  }

  return { candidates, drops };
}

/**
 * normalisedCarry — the front's fractional daily decay minus the back's.
 *
 * Raw net theta must not be ranked: theta is bought with short gamma in exact proportion, so a
 * high-theta ranking is a most-dangerous-front-expiry ranking. The doctrine's own measure is
 * theta as a share of remaining extrinsic — roughly 3% a day at 30 DTE, 10% at 10 DTE, 100% on
 * the last day.
 *
 * `bsmGreeks` returns theta negative for a long option, so each leg's decay RATE is `−θ/e`,
 * a positive number. The difference is oriented so that larger is better for a calendar
 * seller: the front burning faster than the back is the whole trade.
 *
 * Null when either leg has no extrinsic value left — there is no rate to quote, and dividing
 * by zero would produce an infinity that looks like a very good score.
 */
function normalisedCarry(front: CohortLeg, back: CohortLeg): number | null {
  if (front.extrinsic <= 0 || back.extrinsic <= 0) return null;
  const frontRate = -front.theta / front.extrinsic;
  const backRate = -back.theta / back.extrinsic;
  const carry = frontRate - backRate;
  return Number.isFinite(carry) ? carry : null;
}

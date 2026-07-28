/**
 * types.ts — the calendar engine's domain shapes.
 *
 * Hexagon law (architecture-boundaries §2): types only, no I/O, no clock.
 *
 * `CalendarChainQuote` is declared HERE rather than imported from the picker context on
 * purpose. It is structurally identical to `ChainQuoteForPicker`, so the existing
 * `picker-chain.ts` repo satisfies both without an adapter change — but the picker is being
 * deleted, and this context must not hold a reference into a module that is going away.
 * Structural typing means that costs nothing at the wiring seam.
 */

/** OCC root. SPX = AM-settled third-Friday monthlies, SPXW = PM-settled weeklies. */
export type Root = "SPX" | "SPXW";

/**
 * One leg quote as it arrives from the chain read.
 *
 * `strike` is the ×1000 integer convention (7_400_000 = index level 7400); the conversion
 * to points happens ONCE, in `buildCohorts`, and no domain code downstream sees ×1000.
 *
 * `bsmIv` is `string | null` because that is what the column is, and because it has THREE
 * states, not two: `null` means never processed, the literal string `'NaN'` means the
 * inversion permanently failed, and anything else parses to a number. A read that forgets
 * the middle state fabricates numbers.
 */
export type CalendarChainQuote = {
  readonly time: Date;
  readonly strike: number;
  readonly expiration: string;
  readonly contractType: "C" | "P";
  readonly underlyingPrice: number;
  readonly bsmIv: string | null;
  /** Absent → PM-settled. Only SPX third-Friday contracts settle AM. */
  readonly root?: Root;
  readonly bid: number;
  readonly ask: number;
  readonly openInterest: number;
  readonly source: "schwab" | "cboe";
};

/**
 * The snapshot's carry. ONE pair of values for every cohort, and it must be the carry the
 * stored `bsm_iv` was inverted at — see `cohort.ts`'s scar 4 for what per-expiry carry cost.
 */
export type Carry = {
  readonly rate: number;
  readonly divYield: number;
};

/** One strike inside one cohort, priced. */
export type CohortLeg = {
  /** Index points, not ×1000. */
  readonly strike: number;
  /** Decimal, solved, strictly positive. */
  readonly iv: number;
  readonly bid: number;
  readonly ask: number;
  readonly mid: number;
  readonly openInterest: number;
  /**
   * Extrinsic value at the mid — the denominator for normalised theta. For a put:
   * `mid − max(K − S, 0)`. Floored at zero: a mid below intrinsic is a quote artifact, not
   * negative time value.
   */
  readonly extrinsic: number;
  readonly delta: number;
  readonly gamma: number;
  readonly theta: number;
  readonly vega: number;
  /**
   * Whether this leg can actually be traded: two-sided quote, ask at or above bid, and a
   * spread inside the width bound. Legs that fail STAY IN THE COHORT — they still inform the
   * ATM reference — but they can never become half of a candidate.
   */
  readonly tradeable: boolean;
};

/**
 * One strike the cohort QUOTES but could not price — no usable `bsm_iv`, so no greeks.
 *
 * Kept because a per-strike view must show it. The ranker never sees this: a candidate needs
 * two priced legs, and `enumerateCandidates` reads `Cohort.legs` only.
 */
export type UnpricedStrike = {
  /** Index points, not ×1000 — same convention as `CohortLeg.strike`. */
  readonly strike: number;
  readonly bid: number;
  readonly ask: number;
  readonly openInterest: number;
};

/**
 * One `(root, expiration)` group, priced.
 *
 * Root is part of the key and not an afterthought: SPX and SPXW quote the SAME strike on the
 * SAME date with different books, and a root-blind cohort once measured a back IV of 68.89%
 * against a front of 24.69% at one strike.
 */
export type Cohort = {
  readonly root: Root;
  readonly expiration: string;
  /** The trader's DTE, in whole calendar days. What the gates count. */
  readonly dte: number;
  /** Years to the settlement instant. What the pricing uses. */
  readonly t: number;
  /** The snapshot's one carry, carried per cohort so a reader never has to go looking for it. */
  readonly carry: Carry;
  /** Strike nearest spot, ties to the lower. Null on an empty cohort. */
  readonly atmStrike: number | null;
  /** IV at `atmStrike`. Null when that strike's own IV never solved — never a neighbour's. */
  readonly atmIv: number | null;
  /**
   * IV INTERPOLATED to exactly |delta| = 0.50 — the doctrine's ATM, and the IV that feeds the
   * term-structure score.
   *
   * Two reasons it is this and not the traded strike's own IV. First, reading forward vol off a
   * traded strike measures skew rather than term structure: on the live chain the top candidates
   * by per-strike forward factor all sat 250–300 points from spot at roughly double the
   * near-the-money reading. Second, interpolating rather than picking the nearest strike stops
   * the front and back references sitting at different deltas, which skew turns into a
   * systematic bias — measured at 10.4 forward-factor points on one live SPX pair.
   *
   * Null when 50 delta is not bracketed by this cohort's legs, or the bracket is too wide to
   * trust. Never extrapolated.
   */
  readonly atm50Iv: number | null;
  /**
   * Delta-space width the reference was interpolated across; 0 on an exact hit. Reported so a
   * reader can see how much of `atm50Iv` is measurement and how much is interpolation. Null
   * exactly when `atm50Iv` is null.
   */
  readonly atm50BracketWidth: number | null;
  readonly legs: ReadonlyArray<CohortLeg>;
  /**
   * Strikes this cohort quotes that no leg covers, ascending. The gap, named.
   *
   * Added for the per-strike chain surface, which renders one row per strike and cannot silently
   * drop 24.4% of the live put wing (the null + 'NaN' share measured 2026-07-28). Ranking is
   * untouched — nothing in `enumerateCandidates` or `scoreCandidates` reads this field.
   */
  readonly unpricedStrikes: ReadonlyArray<UnpricedStrike>;
};

/**
 * Why a would-be candidate never became one. Counted, so an empty result is explainable.
 *
 * THE UNITS ARE NOT ALL THE SAME, and the names say which is which. `"no-iv-legs"` counts LEGS
 * — single chain rows thrown away before any pair existed. Every other reason is counted at the
 * granularity the gate itself runs at: the two `front-dte-*` reasons per front COHORT, the four
 * middle reasons per expiry PAIR, `"not-tradeable"` per strike inside a pair. Only the leg
 * counter carries its unit in its name because it is the only one whose unit a reader would
 * otherwise guess wrong — the rest are all "a candidate that did not happen".
 */
export type DropReason =
  | "front-dte-floor"
  | "front-dte-ceiling"
  | "back-dte-ceiling"
  | "gap-floor"
  | "root-mismatch"
  | "not-tradeable"
  | "no-iv-legs"
  | "term-inverted"
  | "no-atm-reference";

/**
 * The reasons `enumerateCandidates` can actually produce.
 *
 * `"no-iv-legs"` is excluded rather than initialised to zero, and that exclusion is the fix for
 * a real defect: the reason was declared in the drops record, shipped in the Zod contract and
 * returned by the API, and NOTHING ever incremented it. The leg is discarded in `buildCohorts`,
 * one layer above enumeration, so enumeration cannot see it — and a counter the producing code
 * cannot reach is a counter that reads 0 forever. Only the use-case, which holds both stages,
 * can assemble a complete `DropCounts`.
 */
export type CandidateDropReason = Exclude<DropReason, "no-iv-legs">;

export type DropCounts = Readonly<Record<DropReason, number>>;

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

/** Per-expiry carry. Both legs of a candidate take their own expiry's values, never a blend. */
export type Carry = {
  readonly rate: number;
  readonly divYield: number;
};

/**
 * Where a cohort's carry came from. `"default"` means no solved per-expiry entry existed and
 * the flat fallback was used — surfaced rather than silently substituted, because a cohort
 * priced on a flat 4.5%/1.3% is not the same measurement as one priced on solved parity
 * carry, and today's browser hides exactly that difference.
 */
export type CarrySource = "implied" | "default";

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
  readonly carry: Carry;
  readonly carrySource: CarrySource;
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
};

/** Why a would-be candidate never became one. Counted, so an empty result is explainable. */
export type DropReason =
  | "front-dte-floor"
  | "front-dte-ceiling"
  | "back-dte-ceiling"
  | "gap-floor"
  | "root-mismatch"
  | "not-tradeable"
  | "no-iv"
  | "term-inverted"
  | "no-atm-reference";

export type DropCounts = Readonly<Record<DropReason, number>>;

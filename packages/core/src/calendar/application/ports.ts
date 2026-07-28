/**
 * ports.ts — the calendar engine's driven and driver ports.
 *
 * Hexagon law (architecture-boundaries §5): fine-grained function types named
 * `ForVerbingNoun`. The use-case is a factory `makeXxx(deps)` returning the driver port.
 *
 * Every driven port here is STRUCTURALLY satisfied by a repo that already exists, so this
 * context ships with no new adapter and no new test fake:
 *   - `ForReadingCalendarChain` ← `picker-chain.ts` (the only root-correct, OI-repaired read)
 *   - `ForReadingDailyCloses`   ← `picker-history.ts`
 *
 * There was a third, `ForReadingExpiryCarry`, reading the solved `implied_carry` array off the
 * latest GEX snapshot. It is DELETED, and deliberately not replaced: it priced the two legs of
 * one calendar on different (r, q), and that array is not the carry the stored `bsm_iv` was
 * inverted at. `domain/cohort.ts` scar 4 carries the measurements. Carry now arrives as one
 * injected constant, not a read.
 *
 * They are DECLARED here rather than imported from the picker context on purpose: the picker is
 * being deleted, and this context must not hold a reference into a module that is going away.
 * Structural typing makes that free at the wiring seam.
 */

import type { Result } from "@morai/shared";
import type { CalendarChainQuote, Carry, Root } from "../domain/types.ts";
import type { ScoredCalendar } from "../domain/score.ts";
import type { DropCounts } from "../domain/types.ts";

/** Driven-port failure for a storage read. */
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

/**
 * Read the latest full chain cohort — every strike, both wings, root-carrying.
 *
 * The read this consumes must keep two measured behaviours: a 10-minute union rather than a
 * strict `max(time)` (a strict equality once collapsed the two-vendor cohort to one source),
 * and `MAX(open_interest) OVER (PARTITION BY contract)` (Schwab returns 0 open interest
 * outside RTH and writes a minute after CBOE, so newest-row-wins zeroed ~2,971 contracts a
 * day).
 */
export type ForReadingCalendarChain = () => Promise<
  Result<ReadonlyArray<CalendarChainQuote>, StorageError>
>;

/**
 * Trailing daily closes, oldest first, for the realized-volatility comparable.
 *
 * Known bias, inherited and not fixable here: the "daily close" is a `DISTINCT ON (time::date)`
 * pick over a 24/7 half-hourly feed, so it is the ~23:30Z sample in UTC buckets rather than the
 * 16:00 ET print. That flows into the VRP term. It is recorded rather than hidden.
 */
export type ForReadingDailyCloses = (
  days: number,
) => Promise<Result<ReadonlyArray<number>, StorageError>>;

/** What the engine returns. */
export type CalendarRanking = {
  /** Observation instant of the chain cohort this ranking was computed from. */
  readonly asOf: Date;
  /** One spot for the whole snapshot; null when no quote carried a usable underlying price. */
  readonly spot: number | null;
  /** Ranked best-first. Length capped by the request's `limit`. */
  readonly candidates: ReadonlyArray<ScoredCalendar>;
  /** How many candidates survived every gate, before the limit was applied. */
  readonly totalCandidates: number;
  /** Distinct `(root, front, back)` expiry pairs that produced at least one candidate. */
  readonly expiryPairs: number;
  /** Why would-be candidates never became one, so an empty ranking is explainable. */
  readonly drops: DropCounts;
  /** Realized vol used by the VRP term, or null when it could not be computed. */
  readonly realizedVol: number | null;
  /** Front-leg DTE ceiling actually applied. The floors are constants and not reported. */
  readonly frontDteMax: number;
};

export type RankCalendarsRequest = {
  /** Front-leg DTE ceiling. Cannot lower the 15-day floor. */
  readonly frontDteMax?: number;
  /** How many ranked rows to return. */
  readonly limit?: number;
  /** Wing. Puts unless told otherwise. */
  readonly contractType?: "C" | "P";
};

/** Driver port: rank every calendar in the latest chain snapshot. */
export type ForRankingCalendars = (
  request: RankCalendarsRequest,
) => Promise<Result<CalendarRanking, StorageError>>;

// ─── The per-strike chain surface ──────────────────────────────────────────────
//
// SAME engine, DIFFERENT shape. `ForRankingCalendars` answers "which calendar should I put on",
// and collapses to one row per expiry pair to answer it. The Analyzer's chain table asks the
// opposite question — "show me everything, decide nothing" — so it needs one row per STRIKE
// inside every cohort. That shape mismatch, and nothing else, is why the same eight formulas are
// still written a second time in `apps/web/src/lib/chain-math.ts`.
//
// It ranks nothing, scores nothing and filters nothing for quality. The only rows missing from a
// cohort's ladder are the ones the chain never quoted.

/** One strike of one cohort, priced as a single LEG — never as half a calendar. */
export type ChainStrikeRow = {
  /** Index points, not ×1000. */
  readonly strike: number;
  /** Decimal, or null when the inversion never solved. Never 0 — a zero IV is a real value. */
  readonly iv: number | null;
  readonly bid: number;
  readonly ask: number;
  readonly openInterest: number;
  /**
   * Greeks are ALL-OR-NOTHING: a strike with no usable IV has no delta, gamma, theta or vega,
   * and a half-priced row would be worse than a blank one. The row still appears with its
   * bid/ask/OI — a gap is not a deletion.
   */
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  /**
   * This strike's IV against the cohort's ATM reference — same expiry, same wing, same root.
   * Null when either IV is missing, including when the ATM strike itself never solved.
   */
  readonly vSkew: number | null;
};

/** One `(root, expiration)` cohort and every strike it quotes on the requested wing. */
export type ChainCohortView = {
  readonly root: Root;
  readonly expiration: string;
  /** Whole calendar days to expiry. Display and gating only — never the pricing clock. */
  readonly dte: number;
  /**
   * Years to the SETTLEMENT instant — the clock every greek on this cohort was priced at, and
   * the one a consumer must feed `pairMetrics` rather than re-deriving from `dte`.
   */
  readonly t: number;
  /** Strike nearest spot across every strike quoted, priced or not. Ties to the lower. */
  readonly atmStrike: number | null;
  /** That strike's OWN IV, or null when it never solved. Never a neighbour's. */
  readonly atmIv: number | null;
  /** Ascending by strike. Includes the strikes that could not be priced. */
  readonly strikes: ReadonlyArray<ChainStrikeRow>;
};

export type ChainSurface = {
  /** Observation instant of the chain cohort this surface was computed from, not the clock. */
  readonly asOf: Date;
  /** One spot for the whole snapshot; null when no quote carried a usable underlying price. */
  readonly spot: number | null;
  /** The wing actually priced. Echoed because the request's default lives in the use-case. */
  readonly contractType: "C" | "P";
  /** Nearest expiry first, root breaking the tie so the order is stable across polls. */
  readonly cohorts: ReadonlyArray<ChainCohortView>;
};

export type PriceChainRequest = {
  /** Wing. Puts unless told otherwise, matching the ranking engine's default. */
  readonly contractType?: "C" | "P";
};

/** Driver port: price every strike of every cohort in the latest chain snapshot. */
export type ForPricingChain = (
  request: PriceChainRequest,
) => Promise<Result<ChainSurface, StorageError>>;

// ─── The ranking's own history ─────────────────────────────────────────────────
//
// `SCORE_WEIGHTS` is fwdEdge 70 / deltaBalance 30, and `score.ts` says outright that those
// numbers "should be re-derived against a backtest, never adjusted by feel". A backtest needs
// history and the engine has none: `rankCalendars` computes on read and returns. This port is
// the only thing that changes that, and it deliberately does NOT change `rankCalendars` — the
// ranking use-case still never persists.
//
// WHAT ONE ROW IS: one ranked EXPIRY PAIR at the instant it was ranked. The engine already
// collapses to one row per `(root, front, back)` because "the pair is the decision the trader is
// making; the strike is a detail of it" — the history stores exactly what the engine offered,
// not the pre-collapse candidate space.
//
// WHAT IS NOT HERE, and why. Every field a later backtest can rebuild from `leg_observations`
// as of `asOf` is left out: both legs' quotes, both legs' greeks, `cushion`, `slope`, `ffStrike`,
// the skews, `spreadCost`, and the DTEs. Storing the full `ScoredCalendar` measured ~1.3 KB of
// JSON per row against ~150 B for these columns — 2.2 GB a year against 250 MB — for numbers a
// chain read already carries. The four kinds of field that ARE here are the ones a replay can
// never recover:
//   1. WHAT THE ENGINE SAID  — `rank`, `score` and each term's raw + percentile. A percentile is
//      a property of the snapshot's whole cross-section; re-deriving it later means re-running
//      today's code, which is the very thing the backtest is trying to falsify.
//   2. WHAT IT WOULD HAVE COST — `debit`, at the fill haircut, never at mid.
//   3. WHAT THE REFERENCES WERE — the two 50-delta IVs and the forward vol between them. Both
//      are interpolated against a settlement clock and an injected carry; carry is a config
//      constant that can change and is stored nowhere.
//   4. HOW SOUND THE COHORT WAS — `spot` and `noIvLegs`. See `noIvLegs` below.
export type CalendarRankingRow = {
  /**
   * The cohort's own observation instant — `CalendarRanking.asOf`, never the clock. It is the
   * cycle identity, so re-running for the same instant must be a no-op.
   */
  readonly asOf: Date;
  readonly root: Root;
  /**
   * The wing. A single literal per ranking call, which is exactly why it has to be carried
   * explicitly and be part of the conflict key: migration 0030 left `contract_type` out of the
   * skew key on the same reasoning that it "never varies", and 49.6% of every smile was silently
   * discarded for the table's whole life. A constant column cannot discriminate — so the moment
   * a second call ranks the other wing at the same instant, the key must already carry it.
   */
  readonly contractType: "C" | "P";
  readonly frontExpiration: string;
  readonly backExpiration: string;
  /** Index points, NOT the ×1000 chain convention. `buildCohorts` already converted. */
  readonly strike: number;
  /** 1-based position within `(asOf, contractType)`. Stored because the tie-break is not score. */
  readonly rank: number;
  readonly score: number;
  /** `ffAtm`, the scored forward-vol edge. Null when it could not be measured. */
  readonly fwdEdgeRaw: number | null;
  readonly fwdEdgePercentile: number | null;
  /** SIGNED net delta — the number the trader recognises, not the negated ranking value. */
  readonly deltaBalanceRaw: number | null;
  readonly deltaBalancePercentile: number | null;
  readonly fwdIv: number;
  readonly frontRefIv: number;
  readonly backRefIv: number;
  /** Entry debit in index points, at the fill haircut. */
  readonly debit: number;
  /**
   * Net theta and vega at entry. The only two reported-not-scored greeks kept, because a
   * calendar's P&L decomposition IS theta against vega and both were priced on an injected
   * carry that is a config constant — a replay cannot reproduce them once it changes.
   */
  readonly netTheta: number;
  readonly netVega: number;
  /** One value for the whole cycle. Null is impossible alongside candidates, never fabricated 0. */
  readonly spot: number | null;
  /**
   * How many legs of this wing the cohort carried with no usable IV, at the moment it was ranked.
   *
   * This is the cycle's soundness tell and it is UNRECOVERABLE. `readChainForPicker` anchors its
   * window on `max(time) WHERE bsm_iv IS NOT NULL`, so `asOf` advances as soon as the FIRST leg
   * of a new cohort solves — while `compute-bsm-greeks` is still draining the rest. Measured
   * 2026-07-28: the 18:00:22Z cohort read 853 unsolved put legs at 18:05Z and 0 by 18:14Z, on top
   * of ~830 permanently-unsolvable wing legs that every settled cohort carries. A write that
   * lands inside that window ranks a starved cohort, and first-write-wins makes it permanent.
   * Storing the count is what lets a later reader tell a starved cycle from a healthy one; after
   * the drain finishes, no replay can.
   */
  readonly noIvLegs: number;
};

/**
 * Driven port: append one cycle's ranked pairs.
 *
 * Idempotent on `(asOf, root, contractType, frontExpiration, backExpiration, strike)` —
 * re-running for the same instant writes nothing.
 */
export type ForPersistingCalendarRanking = (
  rows: ReadonlyArray<CalendarRankingRow>,
) => Promise<Result<void, StorageError>>;

/** What one recorded cycle reports back, so a caller can see a truncation it must not ignore. */
export type RecordedRanking = {
  /**
   * Rows HANDED TO THE PORT, which is not the same as rows inserted: the write is
   * first-write-wins, so re-recording a cycle whose `asOf` has not advanced reports the same
   * count and stores nothing. The port returns no count and this type does not invent one.
   */
  readonly rowsWritten: number;
  /** Distinct pairs the engine found. Greater than `rowsWritten` means the write was truncated. */
  readonly expiryPairs: number;
};

/** Driver port: rank the latest cohort and append it to the ranking history. */
export type ForRecordingCalendarRanking = () => Promise<Result<RecordedRanking, StorageError>>;

/** Re-exported so an adapter can name these without reaching into `domain/`. */
export type { Carry, Root };

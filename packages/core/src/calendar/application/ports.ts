/**
 * ports.ts — the calendar engine's driven and driver ports.
 *
 * Hexagon law (architecture-boundaries §5): fine-grained function types named
 * `ForVerbingNoun`. The use-case is a factory `makeXxx(deps)` returning the driver port.
 *
 * Every driven port here is STRUCTURALLY satisfied by a repo that already exists, so this
 * context ships with no new adapter and no new test fake:
 *   - `ForReadingCalendarChain` ← `picker-chain.ts` (the only root-correct, OI-repaired read)
 *   - `ForReadingExpiryCarry`   ← the `implied_carry` array on the latest GEX snapshot
 *   - `ForReadingDailyCloses`   ← `picker-history.ts`
 *
 * They are DECLARED here rather than imported from the picker context on purpose: the picker is
 * being deleted, and this context must not hold a reference into a module that is going away.
 * Structural typing makes that free at the wiring seam.
 */

import type { Result } from "@morai/shared";
import type { CalendarChainQuote, Root } from "../domain/types.ts";
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
 * Per-expiry carry, solved from put-call parity.
 *
 * Keyed by expiration only, with no root — because `r` and `q` are properties of the DATE, not
 * of the settlement style. An SPX and an SPXW cohort on the same date share carry, and that is
 * correct.
 *
 * Never re-solve this. It comes from the same computation that produced the stored `bsm_iv`,
 * and the guards on it are scar tissue: a 0DTE parity solve once returned a 29.8% dividend
 * yield, so the solver now refuses a horizon under seven days and clamps to [0, 0.10].
 */
export type ExpiryCarry = {
  readonly expiration: string;
  readonly rate: number;
  readonly divYield: number;
};

export type ForReadingExpiryCarry = () => Promise<
  Result<ReadonlyArray<ExpiryCarry>, StorageError>
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
  /** One spot for the whole snapshot. */
  readonly spot: number;
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
  /** Expiries priced on the flat fallback carry rather than a solved per-expiry one. */
  readonly defaultCarryExpiries: ReadonlyArray<string>;
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

/** Re-exported so an adapter can name the root type without reaching into `domain/`. */
export type { Root };

/**
 * rankCalendars.ts — the calendar engine's only use-case.
 *
 * Hexagon law (architecture-boundaries §5): a factory returning the driver port. It reads,
 * delegates every formula to `domain/`, and returns a `Result`. It never throws and never
 * persists.
 *
 * FOUR dependencies. The incumbent reached fifteen, plus a persisted snapshot, a three-system
 * VIX entry gate, a sizing ladder and two brake evaluators — and its ranked output has no live
 * web consumer. What this engine needs is one chain read; the closes are the only other input
 * the domain cannot derive from a chain alone. A port-hygiene test pins the count, so a fifth
 * dependency has to be argued rather than absorbed.
 *
 * It was five. `readExpiryCarry` — the solved per-expiry `implied_carry` array off the latest
 * GEX snapshot — is gone, and its removal is a CORRECTNESS fix, not tidying: it priced the two
 * legs of one calendar on different (r, q), and it was never the carry the stored `bsm_iv` was
 * inverted at in the first place. `domain/cohort.ts` scar 4 carries the measurements.
 *
 * Degradation, in two tiers, and the tiers are deliberate:
 *   - The CHAIN read is critical. A ranking without a chain is not a degraded ranking, it is
 *     not a ranking, so a failure propagates.
 *   - REALIZED VOL degrades to null. It is reported as snapshot context and no longer scores
 *     anything, so a missing value costs a comparable, never a ranking.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { buildCohorts, countLegsWithoutIv, snapshotSpot } from "../domain/cohort.ts";
import { enumerateCandidates } from "../domain/candidate.ts";
import { scoreCandidates } from "../domain/score.ts";
import type { ScoredCalendar } from "../domain/score.ts";
import { realizedVol } from "../../picker/domain/realized-vol.ts";
import type { Carry, DropCounts } from "../domain/types.ts";
import type {
  CalendarRanking,
  ForRankingCalendars,
  ForReadingCalendarChain,
  ForReadingDailyCloses,
  RankCalendarsRequest,
  StorageError,
} from "./ports.ts";

/** Front-leg ceiling when the caller does not ask. Covers 15/30, 21/45, 30/60 and 21/60. */
const DEFAULT_FRONT_DTE_MAX = 60;

/** Ranked rows returned when the caller does not ask. */
const DEFAULT_LIMIT = 25;

/**
 * Closes requested for the realized-vol comparable. 21 trading days is the conventional
 * one-month window and matches what the repo already computes elsewhere.
 */
const RV_CLOSES_DAYS = 21;

export type RankCalendarsDeps = {
  /** Critical: a failure fails the call. */
  readonly readChain: ForReadingCalendarChain;
  /** Non-critical: a failure drops the realized-vol comparable for the whole snapshot. */
  readonly readDailyCloses: ForReadingDailyCloses;
  /** Injected clock — the domain never reads one. */
  readonly now: () => Date;
  /**
   * The ONE carry every leg is priced on. Wire it to the same (r, q) the `bsm_iv` inversion
   * used — never to a per-expiry solve. See `domain/cohort.ts` scar 4.
   */
  readonly carry: Carry;
};

export function makeRankCalendarsUseCase(deps: RankCalendarsDeps): ForRankingCalendars {
  return async (
    request: RankCalendarsRequest,
  ): Promise<Result<CalendarRanking, StorageError>> => {
    try {
      const chainResult = await deps.readChain();
      if (!chainResult.ok) return err(chainResult.error);
      const quotes = chainResult.value;

      const closesResult = await deps.readDailyCloses(RV_CLOSES_DAYS);
      const rv = closesResult.ok ? realizedVol(closesResult.value) : null;

      const now = deps.now();
      const contractType = request.contractType ?? "P";
      const frontDteMax = request.frontDteMax ?? DEFAULT_FRONT_DTE_MAX;
      const limit = request.limit ?? DEFAULT_LIMIT;

      const cohorts = buildCohorts(quotes, { now, contractType, carry: deps.carry });

      const { candidates, drops } = enumerateCandidates(cohorts, { frontDteMax });
      const scored = scoreCandidates(candidates);

      // The full drops record is assembled HERE because it takes both stages to write it, and
      // only this function holds both. `buildCohorts` discards a leg whose `bsm_iv` is null or
      // the literal 'NaN' and cannot report it (it returns cohorts, not a tally); enumeration
      // never sees that leg. The reason used to be declared in the record with a hard-wired 0 —
      // 1,408 of 5,768 live put legs discarded (24.4%, 2026-07-28) while the API reported none.
      const allDrops: DropCounts = {
        ...drops,
        "no-iv-legs": countLegsWithoutIv(quotes, contractType),
      };

      // ONE ROW PER EXPIRY PAIR. `fwdEdge` is a property of the pair and constant across every
      // strike inside it, so within a pair only `deltaBalance` varies — and it is minimised at
      // the money. Ranked without this collapse, the list is the winning pair's strike ladder
      // walking outward from delta-neutral: measured live, the top ten was ten strikes of one
      // SPXW 2026-08-14 / 2026-08-31 calendar, 7365 through 7410. Twenty-five rows, one trade.
      //
      // The pair is the decision the trader is making; the strike is a detail of it. `scored` is
      // already sorted descending, so keeping the first occurrence keeps the best strike in each
      // pair. `totalCandidates` still reports the whole space, so nothing is hidden.
      const bestPerPair: ScoredCalendar[] = [];
      const seenPairs = new Set<string>();
      for (const c of scored) {
        const pair = `${c.root}|${c.frontExpiration}|${c.backExpiration}`;
        if (seenPairs.has(pair)) continue;
        seenPairs.add(pair);
        bestPerPair.push(c);
      }

      // `asOf` is the newest observation the cohort actually carries, not the clock: the result
      // must say which snapshot it describes, and the clock is not that.
      const asOf = quotes.reduce<Date>(
        (latest, q) => (q.time.getTime() > latest.getTime() ? q.time : latest),
        new Date(0),
      );

      return ok({
        asOf,
        // NULL, never 0. A price is never given a `?? fallback` — a fabricated 0 renders as a
        // real quote and a reader acts on it. `buildCohorts` refuses the same input (it returns
        // [] when `snapshotSpot` is null), so a null here always ships with an empty candidate
        // list; what the null buys is a response that says it could not measure spot rather than
        // one that asserts the index traded at zero.
        spot: snapshotSpot(quotes),
        candidates: bestPerPair.slice(0, Math.max(0, limit)),
        totalCandidates: scored.length,
        expiryPairs: seenPairs.size,
        drops: allDrops,
        realizedVol: rv,
        frontDteMax,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };
}

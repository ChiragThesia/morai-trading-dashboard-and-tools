/**
 * rankCalendars.ts — the calendar engine's only use-case.
 *
 * Hexagon law (architecture-boundaries §5): a factory returning the driver port. It reads,
 * delegates every formula to `domain/`, and returns a `Result`. It never throws and never
 * persists.
 *
 * FIVE dependencies. The incumbent reached fifteen, plus a persisted snapshot, a three-system
 * VIX entry gate, a sizing ladder and two brake evaluators — and its ranked output has no live
 * web consumer. What this engine needs is one chain read; the carry and the closes are the two
 * inputs the domain cannot derive from a chain alone. A port-hygiene test pins the count, so a
 * sixth dependency has to be argued rather than absorbed.
 *
 * Degradation, in three tiers, and the tiers are deliberate:
 *   - The CHAIN read is critical. A ranking without a chain is not a degraded ranking, it is
 *     not a ranking, so a failure propagates.
 *   - CARRY degrades to the flat fallback, and the affected expiries are NAMED in the result.
 *     Silently substituting flat carry is what the browser does today.
 *   - REALIZED VOL degrades to null, which drops the VRP term for the whole snapshot and
 *     renormalises the other three so scores stay comparable.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { buildCohorts, snapshotSpot } from "../domain/cohort.ts";
import { enumerateCandidates } from "../domain/candidate.ts";
import { scoreCandidates } from "../domain/score.ts";
import { realizedVol } from "../../picker/domain/realized-vol.ts";
import type { Carry, Root } from "../domain/types.ts";
import type {
  CalendarRanking,
  ForRankingCalendars,
  ForReadingCalendarChain,
  ForReadingDailyCloses,
  ForReadingExpiryCarry,
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
  /** Non-critical: a failure degrades every expiry to the flat fallback, and says so. */
  readonly readExpiryCarry: ForReadingExpiryCarry;
  /** Non-critical: a failure drops the VRP term for the whole snapshot. */
  readonly readDailyCloses: ForReadingDailyCloses;
  /** Injected clock — the domain never reads one. */
  readonly now: () => Date;
  /** Used only where no solved per-expiry carry exists. */
  readonly defaultCarry: Carry;
};

export function makeRankCalendarsUseCase(deps: RankCalendarsDeps): ForRankingCalendars {
  return async (
    request: RankCalendarsRequest,
  ): Promise<Result<CalendarRanking, StorageError>> => {
    try {
      const chainResult = await deps.readChain();
      if (!chainResult.ok) return err(chainResult.error);
      const quotes = chainResult.value;

      // Carry: keyed by expiration only, because r and q are properties of the DATE, not of the
      // settlement style. Never re-solved here — it comes from the same computation that
      // produced the stored bsm_iv, and re-deriving it would drift from the server.
      const carryResult = await deps.readExpiryCarry();
      const carryByExpiration = new Map<string, Carry>();
      if (carryResult.ok) {
        for (const row of carryResult.value) {
          if (Number.isFinite(row.rate) && Number.isFinite(row.divYield)) {
            carryByExpiration.set(row.expiration, { rate: row.rate, divYield: row.divYield });
          }
        }
      }

      const defaulted = new Set<string>();
      const carryOf = (expiration: string, _root: Root): Carry | null => {
        const solved = carryByExpiration.get(expiration);
        if (solved === undefined) {
          defaulted.add(expiration);
          return null;
        }
        return solved;
      };

      const closesResult = await deps.readDailyCloses(RV_CLOSES_DAYS);
      const rv = closesResult.ok ? realizedVol(closesResult.value) : null;

      const now = deps.now();
      const contractType = request.contractType ?? "P";
      const frontDteMax = request.frontDteMax ?? DEFAULT_FRONT_DTE_MAX;
      const limit = request.limit ?? DEFAULT_LIMIT;

      const cohorts = buildCohorts(quotes, {
        now,
        contractType,
        carryOf,
        defaultCarry: deps.defaultCarry,
      });

      const { candidates, drops } = enumerateCandidates(cohorts, { frontDteMax });
      const scored = scoreCandidates(candidates, { realizedVol: rv });

      const pairs = new Set(
        scored.map((c) => `${c.root}|${c.frontExpiration}|${c.backExpiration}`),
      );

      // `asOf` is the newest observation the cohort actually carries, not the clock: the result
      // must say which snapshot it describes, and the clock is not that.
      const asOf = quotes.reduce<Date>(
        (latest, q) => (q.time.getTime() > latest.getTime() ? q.time : latest),
        new Date(0),
      );

      return ok({
        asOf,
        spot: snapshotSpot(quotes) ?? 0,
        candidates: scored.slice(0, Math.max(0, limit)),
        totalCandidates: scored.length,
        expiryPairs: pairs.size,
        drops,
        realizedVol: rv,
        frontDteMax,
        // Sorted so the result is deterministic; a Set's iteration order is insertion order,
        // which would leak the cohort loop's sequence into the response.
        defaultCarryExpiries: [...defaulted].sort(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };
}

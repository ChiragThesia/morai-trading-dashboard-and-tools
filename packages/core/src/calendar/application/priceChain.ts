/**
 * priceChain.ts — the calendar engine's second use-case: the chain, priced per strike.
 *
 * Hexagon law (architecture-boundaries §5): a factory returning the driver port. It reads,
 * delegates every formula to `domain/`, and returns a `Result`. It never throws and never
 * persists.
 *
 * THREE dependencies, and they are a SUBSET of `rankCalendars`'s four: the same chain read, the
 * same clock, the same one carry. There is no realized-vol read here because nothing on this
 * surface is scored — the chain is data, and the reader decides.
 *
 * Everything this returns already existed as a number the engine computes; what did not exist is
 * the SHAPE. `rankCalendars` collapses to one row per expiry pair, because the pair is the
 * decision a trader makes. The Analyzer's chain table asks the opposite question and needs one
 * row per strike per cohort. That mismatch was the only reason the browser held a second copy of
 * atmStrike, atmIv, per-leg greeks and vertical skew; `useChainModel` reads this surface now and
 * that copy is deleted.
 *
 * CARRY IS ONE VALUE FOR THE SNAPSHOT, and it must be the carry the stored `bsm_iv` was inverted
 * at — see `domain/cohort.ts` scar 4 for what a per-expiry carry cost the ranker. The browser copy
 * resolved carry PER EXPIRY off the GEX snapshot's solved `implied_carry` array, which is the
 * defect this engine fixed; it was the largest visible change the switch shipped, and it was
 * deliberate. One reader of that array survives on purpose — the 25Δ risk reversal, which has no
 * server twin (architecture-boundaries §7 forbids `calendar/domain → analytics/domain`).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { buildCohorts, quotedAtm, snapshotSpot } from "../domain/cohort.ts";
import type { Carry, Cohort } from "../domain/types.ts";
import type {
  ChainCohortView,
  ChainStrikeRow,
  ChainSurface,
  ForPricingChain,
  ForReadingCalendarChain,
  PriceChainRequest,
  StorageError,
} from "./ports.ts";

export type PriceChainDeps = {
  /** Critical: a failure fails the call. The SAME read the ranking engine consumes. */
  readonly readChain: ForReadingCalendarChain;
  /** Injected clock — the domain never reads one. */
  readonly now: () => Date;
  /**
   * The ONE carry every leg is priced on. Wire it to the same (r, q) the `bsm_iv` inversion
   * used — never to a per-expiry solve. See `domain/cohort.ts` scar 4.
   */
  readonly carry: Carry;
};

export function makePriceChainUseCase(deps: PriceChainDeps): ForPricingChain {
  return async (request: PriceChainRequest): Promise<Result<ChainSurface, StorageError>> => {
    try {
      const chainResult = await deps.readChain();
      if (!chainResult.ok) return err(chainResult.error);
      const quotes = chainResult.value;

      const contractType = request.contractType ?? "P";
      const spot = snapshotSpot(quotes);
      const cohorts = buildCohorts(quotes, { now: deps.now(), contractType, carry: deps.carry });

      // `asOf` is the newest observation the chain actually carries, not the clock: the result
      // must say which snapshot it describes, and the clock is not that.
      const asOf = quotes.reduce<Date>(
        (latest, q) => (q.time.getTime() > latest.getTime() ? q.time : latest),
        new Date(0),
      );

      return ok({
        asOf,
        spot,
        contractType,
        cohorts: spot === null ? [] : cohorts.map((c) => toView(c, spot)),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };
}

/**
 * One cohort, flattened into a strike ladder.
 *
 * The ladder is `legs ∪ unpricedStrikes`, and the union is the point: a strike the chain quotes
 * but could not price still gets a row carrying its bid, ask and open interest. Dropping it would
 * be a hidden filter on a screen whose whole purpose is to hide nothing — the same defect that
 * killed the old inner-joined chain table, and it would be silent on 24.4% of the live put wing
 * (the null + 'NaN' share measured 2026-07-28).
 */
function toView(cohort: Cohort, spot: number): ChainCohortView {
  const atm = quotedAtm(cohort, spot);

  const priced: ChainStrikeRow[] = cohort.legs.map((l) => ({
    strike: l.strike,
    iv: l.iv,
    bid: l.bid,
    ask: l.ask,
    openInterest: l.openInterest,
    delta: l.delta,
    gamma: l.gamma,
    theta: l.theta,
    vega: l.vega,
    vSkew: atm.iv === null ? null : l.iv - atm.iv,
  }));

  const gaps: ChainStrikeRow[] = cohort.unpricedStrikes.map((s) => ({
    strike: s.strike,
    iv: null,
    bid: s.bid,
    ask: s.ask,
    openInterest: s.openInterest,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    vSkew: null,
  }));

  return {
    root: cohort.root,
    expiration: cohort.expiration,
    dte: cohort.dte,
    t: cohort.t,
    atmStrike: atm.strike,
    atmIv: atm.iv,
    strikes: [...priced, ...gaps].sort((a, b) => a.strike - b.strike),
  };
}

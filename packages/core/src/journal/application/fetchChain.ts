import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForFetchingChain,
  ForPersistingObservations,
  ForUpsertingContracts,
  ForGettingOpenCalendarLegs,
  RawChain,
  RawQuote,
  ObservationRow,
  ContractRow,
  FetchError,
  StorageError,
} from "./ports.ts";

export type FetchChainDeps = {
  readonly fetchChain: ForFetchingChain;
  readonly persistObservations: ForPersistingObservations;
  readonly upsertContracts: ForUpsertingContracts;
  /** Clock injection — never use Date.now() in core (D-13, architecture-boundaries.md §2) */
  readonly now: () => Date;
  /** Maximum calendar-day DTE to include (D-13 default: 90) */
  readonly maxDte: number;
  /** Strike band: |strike - spot| ≤ strikeBandPct × spot (D-13 default: 0.10) */
  readonly strikeBandPct: number;
  /**
   * D-04: OCC symbols for every open calendar's two legs (front + back).
   * Quotes matching these symbols bypass the DTE/band filter so out-of-band
   * back legs are always observed. Error → treat as empty set (no hard fail).
   */
  readonly getOpenCalendarLegs: ForGettingOpenCalendarLegs;
};

export type ForRunningFetchChain = () => Promise<
  Result<void, FetchError | StorageError>
>;

/**
 * calendarDte — calendar-day DTE from `now` to `expiry`.
 *
 * Uses calendar days (floor of difference), not minutes/year basis.
 * The DTE filter is coarse (entry gate only); precise T is computed per BSM at compute time.
 * `now` is injected — never reads Date.now() (architecture-boundaries.md §2).
 */
function calendarDte(now: Date, expiry: Date): number {
  const nowMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const expiryMs = Date.UTC(
    expiry.getUTCFullYear(),
    expiry.getUTCMonth(),
    expiry.getUTCDate(),
  );
  return Math.max(0, Math.floor((expiryMs - nowMs) / (1000 * 60 * 60 * 24)));
}

/**
 * isInFilter — true if the contract passes both the DTE and strike-band gates.
 *
 * DTE gate: calendarDte(now, expiry) ≤ maxDte
 * Strike band: |strike - spot| ≤ strikeBandPct × spot
 */
function isInFilter(
  quote: RawQuote,
  now: Date,
  spot: number,
  maxDte: number,
  strikeBandPct: number,
): boolean {
  const dte = calendarDte(now, quote.expiry);
  if (dte > maxDte) return false;

  const lowerBound = spot * (1 - strikeBandPct);
  const upperBound = spot * (1 + strikeBandPct);
  return quote.strike >= lowerBound && quote.strike <= upperBound;
}

/**
 * quoteToObservationRow — maps an in-filter RawQuote to an ObservationRow.
 *
 * bid/ask must both be present to produce a valid mark; rows missing either
 * are skipped (returned as null) at this layer rather than forced.
 */
function quoteToObservationRow(
  quote: RawQuote,
  observedAt: Date,
  underlyingPrice: number,
): ObservationRow | null {
  // bid and ask must be present for a meaningful mark
  if (quote.bid === null || quote.ask === null) return null;

  const mark =
    quote.mark !== null ? quote.mark : (quote.bid + quote.ask) / 2;

  return {
    time: observedAt,
    contract: quote.occSymbol,
    bid: quote.bid,
    ask: quote.ask,
    mark,
    underlyingPrice,
    iv: quote.iv,
    delta: quote.delta,
    gamma: quote.gamma,
    theta: quote.theta,
    vega: quote.vega,
    openInterest: quote.openInterest,
    volume: quote.volume,
    source: "cboe",
  };
}

/**
 * quoteToContractRow — maps an in-filter RawQuote to a first-seen ContractRow.
 *
 * exerciseStyle is always 'european' for SPX/SPXW (D-04).
 * strike is stored ×1000 int convention.
 * expiration is ISO date string YYYY-MM-DD.
 */
function quoteToContractRow(
  quote: RawQuote,
  chain: RawChain,
): ContractRow {
  const strikeInt = Math.round(quote.strike * 1000);

  const expiry = quote.expiry;
  const year = expiry.getFullYear();
  const month = String(expiry.getMonth() + 1).padStart(2, "0");
  const day = String(expiry.getDate()).padStart(2, "0");
  const expiration = `${year}-${month}-${day}`;

  return {
    occSymbol: quote.occSymbol,
    underlying: "SPX", // Both SPX and SPXW are on the SPX index
    root: chain.root,
    contractType: quote.contractType,
    exerciseStyle: "european",
    strike: strikeInt,
    expiration,
    multiplier: 100,
  };
}

/**
 * processChain — filter and map one RawChain to (observations, contracts).
 *
 * D-04: mustInclude set contains OCC symbols for open calendar legs.
 * A quote that fails the DTE/band filter BUT is in mustInclude is still persisted.
 */
function processChain(
  chain: RawChain,
  now: Date,
  maxDte: number,
  strikeBandPct: number,
  mustInclude: ReadonlySet<string>,
): {
  observations: ReadonlyArray<ObservationRow>;
  contracts: ReadonlyArray<ContractRow>;
} {
  const observations: ObservationRow[] = [];
  const contracts: ContractRow[] = [];

  for (const quote of chain.quotes) {
    if (
      !isInFilter(quote, now, chain.spot, maxDte, strikeBandPct) &&
      !mustInclude.has(quote.occSymbol)
    ) continue;

    const obs = quoteToObservationRow(quote, chain.observedAt, chain.spot);
    if (obs !== null) {
      observations.push(obs);
      contracts.push(quoteToContractRow(quote, chain));
    }
  }

  return { observations, contracts };
}

/**
 * makeFetchChainUseCase — fetch SPX + SPXW chains, filter, persist.
 *
 * Fetches both roots concurrently. Filters each quote by calendar-day DTE
 * and strike band (config-injected, never hardcoded). Maps in-filter quotes
 * to ObservationRow (source='cboe', bsm_* omitted) and first-seen ContractRow
 * (exerciseStyle='european'). Persists append-only.
 *
 * If both fetches fail, returns the first error. If one succeeds, persists
 * that chain's data and returns ok.
 *
 * T-02-08: Filter bounds write volume before persistence (DoS mitigation).
 */
export function makeFetchChainUseCase(deps: FetchChainDeps): ForRunningFetchChain {
  return async (): Promise<Result<void, FetchError | StorageError>> => {
    const now = deps.now();

    // D-04: build mustInclude set from open calendar legs BEFORE processing chains.
    // On error: degrade to empty set (fetch continues without targeted-fetch legs).
    const legsResult = await deps.getOpenCalendarLegs();
    const mustInclude: ReadonlySet<string> = legsResult.ok
      ? new Set(legsResult.value)
      : new Set();

    // Fetch both roots concurrently
    const [spxResult, spxwResult] = await Promise.all([
      deps.fetchChain("SPX"),
      deps.fetchChain("SPXW"),
    ]);

    // Collect chains that succeeded
    const successfulChains: RawChain[] = [];
    let firstError: FetchError | null = null;

    if (spxResult.ok) {
      successfulChains.push(spxResult.value);
    } else {
      firstError = spxResult.error;
    }

    if (spxwResult.ok) {
      successfulChains.push(spxwResult.value);
    } else {
      if (firstError === null) firstError = spxwResult.error;
    }

    // If no chains succeeded, return the first error
    if (successfulChains.length === 0) {
      const error = firstError ?? { kind: "fetch-error" as const, message: "both chains failed" };
      return err(error);
    }

    // Process all successful chains
    const allObservations: ObservationRow[] = [];
    const allContracts: ContractRow[] = [];

    for (const chain of successfulChains) {
      const { observations, contracts } = processChain(
        chain,
        now,
        deps.maxDte,
        deps.strikeBandPct,
        mustInclude,
      );
      allObservations.push(...observations);
      allContracts.push(...contracts);
    }

    // Upsert contracts before observations: a crash now leaves harmless contracts
    // without observations rather than orphan observations with no contract row.
    if (allContracts.length > 0) {
      const contractResult = await deps.upsertContracts(allContracts);
      if (!contractResult.ok) return err(contractResult.error);
    }

    // Persist observations (contracts must already exist — see ordering above)
    if (allObservations.length > 0) {
      const persResult = await deps.persistObservations(allObservations);
      if (!persResult.ok) return err(persResult.error);
    }

    return ok(undefined);
  };
}

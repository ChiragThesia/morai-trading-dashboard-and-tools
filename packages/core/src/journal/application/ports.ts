import type { OccSymbol, Result } from "@morai/shared";

// Domain error for storage operations (used by driven ports)
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

// Domain error for external fetch operations (HTTP adapters)
export type FetchError = {
  readonly kind: "fetch-error";
  readonly message: string;
};

// Domain type: an open calendar tracked in the journal context
export type Calendar = {
  readonly id: string;
  readonly underlying: string;
  readonly openedAt: Date;
};

// Domain type: a single raw contract quote from the CBOE chain
export type RawQuote = {
  readonly occSymbol: OccSymbol;
  readonly contractType: "C" | "P";
  readonly strike: number; // in points (e.g. 7275)
  readonly expiry: Date;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mark: number | null;
  readonly iv: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly openInterest: number;
  readonly volume: number;
};

// Domain type: a raw option chain returned by ForFetchingChain
export type RawChain = {
  readonly root: "SPX" | "SPXW";
  readonly observedAt: Date; // UTC timestamp from CBOE payload (ET→UTC)
  readonly spot: number; // underlying price at observation time
  readonly quotes: ReadonlyArray<RawQuote>;
};

// Domain type: a row ready to persist to leg_observations
export type ObservationRow = {
  readonly time: Date;
  readonly contract: OccSymbol;
  readonly bid: number;
  readonly ask: number;
  readonly mark: number;
  readonly underlyingPrice: number;
  readonly iv: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  readonly openInterest: number;
  readonly volume: number;
  readonly source: "cboe";
};

// Domain type: a first-seen contract metadata row (contracts table)
export type ContractRow = {
  readonly occSymbol: OccSymbol;
  readonly underlying: string;
  readonly root: "SPX" | "SPXW";
  readonly contractType: "C" | "P";
  readonly exerciseStyle: "european";
  readonly strike: number; // ×1000 int (e.g. 7275000 for strike 7275)
  readonly expiration: string; // YYYY-MM-DD
  readonly multiplier: 100;
};

// Driven ports — what the use-cases need from the outside world.
// Each is a fine-grained function type: ForVerbingNoun convention (hexagonal-ddd.md).

/**
 * ForGettingOpenCalendars — the ONE calendars repository port (DATA-03).
 * To be implemented by both the Postgres adapter (plan 04) and the
 * in-memory adapter (plan 04), and contract-tested against both.
 */
export type ForGettingOpenCalendars = () => Promise<
  Result<ReadonlyArray<Calendar>, StorageError>
>;

/**
 * ForPingingDb — lightweight DB health check.
 * Resolves ok(undefined) if the DB is reachable; err(StorageError) otherwise.
 */
export type ForPingingDb = () => Promise<Result<void, StorageError>>;

/**
 * ForFetchingChain — fetch a delayed option chain for a root symbol (MKT-01).
 * Implemented by CBOE HTTP adapter and in-memory twin.
 */
export type ForFetchingChain = (
  root: "SPX" | "SPXW",
) => Promise<Result<RawChain, FetchError>>;

/**
 * ForPersistingObservations — bulk append leg_observations rows (MKT-03).
 * Implemented by Postgres repo; uses onConflictDoNothing for idempotency.
 */
export type ForPersistingObservations = (
  rows: ReadonlyArray<ObservationRow>,
) => Promise<Result<void, StorageError>>;

/**
 * ForUpsertingContracts — first-seen contract metadata upsert (MKT-03).
 * Implemented by Postgres repo; onConflictDoNothing on occ_symbol PK.
 */
export type ForUpsertingContracts = (
  rows: ReadonlyArray<ContractRow>,
) => Promise<Result<void, StorageError>>;

// Domain type: a single FRED DGS3MO daily rate observation (MKT-02)
export type RateObservation = {
  readonly date: string; // YYYY-MM-DD
  readonly rate: number; // decimal (e.g. 0.045 for 4.5%)
};

/**
 * ForFetchingRate — fetch the current DGS3MO 3-month risk-free rate (MKT-02).
 * Implemented by FRED HTTP adapter and in-memory twin.
 * Always returns ok — network errors / missing key use 4.5% fallback (D-02/D-13).
 */
export type ForFetchingRate = () => Promise<Result<RateObservation, FetchError>>;

/**
 * ForPersistingRate — upsert rate_observations by date PK (MKT-02).
 * Implemented by Postgres repo; idempotent on date PK.
 */
export type ForPersistingRate = (
  obs: RateObservation,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingRate — get most-recent rate on or before a given date (MKT-02).
 * Returns the rate as a Drizzle-numeric string, or null when no row ≤ the date.
 * Plan 06 (computeBsmGreeks) uses this to supply `r` to BSM.
 */
export type ForReadingRate = (
  onOrBefore: string,
) => Promise<Result<string | null, StorageError>>;

// Domain type: a pending observation row from the leg_obs_pending_bsm_idx partial index
// (bsm_iv IS NULL AND mark IS NOT NULL). Read by ForReadingPendingObs (BSM-03).
export type PendingObs = {
  readonly time: Date;
  readonly contract: OccSymbol;
  readonly mark: number; // already converted from DB numeric string
  readonly underlyingPrice: number; // spot at observation time
  readonly strike: number; // in points (e.g. 7275)
  readonly expiry: Date;
  readonly root: "SPX" | "SPXW";
  readonly type: "C" | "P";
};

/**
 * ForReadingPendingObs — scan leg_observations partial index (BSM-03).
 * Returns rows where bsm_iv IS NULL AND mark IS NOT NULL.
 * Uses the partial index leg_obs_pending_bsm_idx for efficiency.
 */
export type ForReadingPendingObs = () => Promise<
  Result<ReadonlyArray<PendingObs>, StorageError>
>;

/**
 * ForWritingBsmResults — write the five bsm_* columns for a batch of rows (BSM-03).
 * Values are Drizzle-numeric strings. 'NaN' is a valid value per D-09.
 * Only touches bsm_iv/bsm_delta/bsm_gamma/bsm_theta/bsm_vega columns.
 * Vendor columns (bid/ask/mark/iv/delta) are never modified (T-02-17).
 */
export type ForWritingBsmResults = (
  writes: ReadonlyArray<{
    readonly time: Date;
    readonly contract: OccSymbol;
    readonly bsmIv: string;
    readonly bsmDelta: string;
    readonly bsmGamma: string;
    readonly bsmTheta: string;
    readonly bsmVega: string;
  }>,
) => Promise<Result<void, StorageError>>;

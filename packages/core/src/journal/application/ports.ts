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

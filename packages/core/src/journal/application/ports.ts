import type { Result } from "@morai/shared";

// Domain error for storage operations (used by driven ports)
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

// Domain type: an open calendar tracked in the journal context
export type Calendar = {
  readonly id: string;
  readonly underlying: string;
  readonly openedAt: Date;
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

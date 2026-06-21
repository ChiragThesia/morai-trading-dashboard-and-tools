import type { OccSymbol, Result } from "@morai/shared";
import type { CalendarEvent, RawFill } from "../domain/calendar-event.ts";

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

// Domain error variants for calendar state transitions
export type CalendarNotFound = { readonly kind: "not-found" };
export type CalendarAlreadyClosed = { readonly kind: "already-closed" };

// Domain type: a calendar spread tracked in the journal context.
// strike is a ×1000 integer (e.g. 7100000 for SPX 7100), matching ContractRow.strike at line 73.
// Both legs share the same strike and optionType (true calendar; D-02 same-strike-only).
export type Calendar = {
  readonly id: string;
  readonly underlying: string;
  readonly strike: number; // ×1000 int (e.g. 7100000); same-strike as ContractRow.strike
  readonly optionType: "C" | "P"; // D-01: one option type shared by both legs
  readonly frontExpiry: string; // YYYY-MM-DD — the near-term leg
  readonly backExpiry: string; // YYYY-MM-DD — the far-term leg
  readonly qty: number;
  readonly openNetDebit: number; // parsed to number at repo boundary; stored as numeric string in DB
  readonly status: "open" | "closed";
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly notes: string | null;
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
  /** Which vendor produced this chain — propagated to ObservationRow.source and SnapshotRow.source */
  readonly source: "cboe" | "schwab_chain";
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
  readonly source: "cboe" | "schwab_chain";
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
 * ForRegisteringCalendar — persist a new calendar spread (CAL-01).
 * Implemented by Postgres adapter and in-memory twin.
 */
export type ForRegisteringCalendar = (input: {
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string; // YYYY-MM-DD
  readonly backExpiry: string; // YYYY-MM-DD
  readonly qty: number;
  readonly openNetDebit: number;
  readonly openedAt: Date;
  readonly notes?: string;
}) => Promise<Result<Calendar, StorageError>>;

/**
 * ForListingCalendars — list all calendars, optionally filtered by status (CAL-02).
 * Returns empty array (not null) when no rows match.
 */
export type ForListingCalendars = (
  filter?: "open" | "closed",
) => Promise<Result<ReadonlyArray<Calendar>, StorageError>>;

/**
 * ForGettingCalendarById — single-calendar read by PK (CAL-02).
 * Returns null when the id is unknown (drives 404 at the route layer).
 * Backs get_live_greeks leg resolution and any single-calendar read.
 */
export type ForGettingCalendarById = (
  id: string,
) => Promise<Result<Calendar | null, StorageError>>;

/**
 * ForClosingCalendar — mark a calendar closed (CAL-04).
 * Returns CalendarNotFound when id is unknown; CalendarAlreadyClosed when already closed.
 */
export type ForClosingCalendar = (
  id: string,
  closeNetCredit: number,
) => Promise<Result<Calendar, StorageError | CalendarNotFound | CalendarAlreadyClosed>>;

/**
 * ForGettingOpenCalendarLegs — D-04 targeted-fetch port.
 * Returns OCC symbols for every open calendar's two legs (front + back),
 * so the fetch-cboe-chain job always captures those contracts regardless of band/DTE filter.
 */
export type ForGettingOpenCalendarLegs = () => Promise<
  Result<ReadonlyArray<OccSymbol>, StorageError>
>;

// Domain type: a single leg's latest snapshot data from leg_observations.
// bsm fields are Drizzle-numeric strings, or the literal 'NaN' per D-06 NaN convention.
// underlyingPrice is needed for the spot column in SnapshotRow.
export type LegSnapshot = {
  readonly occSymbol: OccSymbol;
  readonly mark: number;
  readonly underlyingPrice: number;
  readonly ivRaw: number | null;
  readonly bsmIv: string | null; // 'NaN' | numeric string | null
  readonly bsmDelta: string | null;
  readonly bsmGamma: string | null;
  readonly bsmTheta: string | null;
  readonly bsmVega: string | null;
  /** Source of the underlying leg_observation row — propagated to SnapshotRow.source */
  readonly source: "cboe" | "schwab_chain" | "computed_only";
};

/**
 * ForResolvingLegSnapshot — look up the latest leg_observation for a given calendar leg.
 * Resolves by (underlying, strike, optionType, expiry) → occSymbol → latest leg_observation.
 * Returns null when no matching contract or no observation exists for the slot.
 */
export type ForResolvingLegSnapshot = (query: {
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly expiry: string; // YYYY-MM-DD
}) => Promise<Result<LegSnapshot | null, StorageError>>;

// Domain type: the full 18-column journal row for calendar_snapshots.
// All Drizzle-numeric columns are typed string ('NaN' is a valid value per D-06).
// dteFront/dteBack are integer calendar days (not the year-fraction computeT returns).
export type SnapshotRow = {
  readonly time: Date;
  readonly calendarId: string;
  readonly spot: string;
  readonly netMark: string;
  readonly frontMark: string;
  readonly backMark: string;
  readonly frontIv: string; // numeric string or 'NaN'
  readonly backIv: string;
  readonly frontIvRaw: string;
  readonly backIvRaw: string;
  readonly netDelta: string;
  readonly netGamma: string;
  readonly netTheta: string;
  readonly netVega: string;
  readonly termSlope: string;
  readonly dteFront: number; // integer calendar days
  readonly dteBack: number; // integer calendar days
  readonly pnlOpen: string;
  readonly source: "cboe" | "schwab_chain";
};

/**
 * ForPersistingSnapshot — write one calendar_snapshots row (CAL-03).
 * Idempotent: onConflictDoNothing on composite PK (time, calendar_id).
 */
export type ForPersistingSnapshot = (
  row: SnapshotRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingJournal — ordered snapshot series for a calendar (CAL-02).
 * Returns null when the calendarId is unknown (drives 404 at route layer).
 * Returns empty array when known but zero snapshots exist.
 */
export type ForReadingJournal = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<SnapshotRow> | null, StorageError>>;

/**
 * ForReadingLatestLegObs — latest leg_observation for an OCC symbol (CAL-06).
 * Backs get_live_greeks MCP tool. Returns null when no observation exists.
 */
export type ForReadingLatestLegObs = (
  occSymbol: OccSymbol,
) => Promise<Result<LegSnapshot | null, StorageError>>;

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

// Domain type: per-job last-run status map (D-10).
// Keys are pg-boss job names; values carry the last success/error timestamps and error message.
// All fields nullable — a job may have succeeded but never failed, or vice versa.
export type JobRunRecord = {
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastError: string | null;
};

export type JobRunMap = Readonly<Record<string, JobRunRecord>>;

/**
 * ForReadingJobRuns — query pgboss.job for the most recent success/error per job (D-10).
 * Returns an empty map (not an error) when pgboss.job has no matching rows — graceful
 * first-deploy behavior (Pitfall 6). MUST return ok({}) on empty/absent pgboss schema.
 */
export type ForReadingJobRuns = () => Promise<Result<JobRunMap, StorageError>>;

// ─── Phase 5: calendar_events + orphan_fills ports (JOB-01 / JRNL-01) ────────

// Re-export domain types so adapters and use-cases import from this application boundary
export type { CalendarEvent, RawFill } from "../domain/calendar-event.ts";
import type { AggregatedFill } from "../domain/calendar-event.ts";
export type { AggregatedFill } from "../domain/calendar-event.ts";

// Domain type for a calendar leg entry returned by ForReadingCalendarLegs.
// Adapters translate from the DB schema at the boundary.
export type CalendarLegEntry = {
  readonly calendarId: string;
  readonly legOccSymbol: string;
  readonly positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
};

// Domain type for an orphan fill row (D-05: unmatched fills parked, never dropped)
export type OrphanFillInput = {
  readonly fillId: string;
  readonly occSymbol: string;
  readonly side: "buy" | "sell";
  readonly qty: number;
  readonly price: number;
  readonly filledAt: Date;
  readonly reason: string;
};

/**
 * ForStoringCalendarEvent — write one calendar_events row (JRNL-01).
 * Idempotent: onConflictDoNothing on fillIdsHash UNIQUE constraint.
 * Implemented by Postgres repo and in-memory twin.
 */
export type ForStoringCalendarEvent = (
  event: CalendarEvent,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingCalendarEvents — read all calendar_events for a calendarId (JRNL-01).
 * Returns rows ordered by eventedAt ASC. Returns empty array when none exist.
 */
export type ForReadingCalendarEvents = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<CalendarEvent>, StorageError>>;

/**
 * ForDeletingCalendarEvents — delete all calendar_events for a calendarId (rebuild-journal D-10).
 * Used by makeRebuildJournalUseCase to clear events before re-inserting from fills.
 */
export type ForDeletingCalendarEvents = (
  calendarId: string,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingUnprocessedFills — read fills not yet reflected in calendar_events (JRNL-01).
 * Adapters filter by fill IDs not present in calendar_events.fill_ids_hash or orphan_fills.
 * Returns all RawFill rows (adapters translate from DB schema at boundary).
 */
export type ForReadingUnprocessedFills = () => Promise<
  Result<ReadonlyArray<RawFill>, StorageError>
>;

/**
 * ForReadingCalendarLegs — find calendar legs matching a given OCC symbol (JRNL-01, D-01).
 * Returns all (calendarId, legOccSymbol, positionEffect) entries whose leg matches the symbol.
 * Returns empty array when no calendar has this symbol as a leg.
 */
export type ForReadingCalendarLegs = (
  occSymbol: string,
) => Promise<Result<ReadonlyArray<CalendarLegEntry>, StorageError>>;

/**
 * ForStoringOrphanFill — write one orphan_fills row (D-05).
 * Idempotent: onConflictDoNothing on fillId PK.
 * Unmatched fills are parked here; never silently dropped.
 */
export type ForStoringOrphanFill = (
  orphan: OrphanFillInput,
) => Promise<Result<void, StorageError>>;

/**
 * ForResettingCalendarAmounts — set openNetDebit and closeNetCredit to NULL for a calendar.
 * Used by makeRebuildJournalUseCase before re-running sync-fills (D-10).
 */
export type ForResettingCalendarAmounts = (
  calendarId: string,
) => Promise<Result<void, StorageError>>;

/**
 * ForEnqueueingJob — enqueue a pg-boss job by name with an optional payload (JOB-01).
 * Returns ok(jobId) on success; ok(null) when deduplication key already active (no-op).
 * The singletonKey is computed by the use-case (makeEnqueueJobUseCase) and passed here.
 * Implemented by the pg-boss adapter (adapters layer); in-memory twin for tests.
 *
 * dedupeKey: pass null to skip deduplication (every enqueue is distinct).
 */
export type ForEnqueueingJob = (
  name: string,
  payload: Readonly<Record<string, unknown>>,
  dedupeKey: string | null,
) => Promise<Result<string | null, StorageError>>;

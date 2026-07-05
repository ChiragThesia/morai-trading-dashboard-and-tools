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
  /**
   * Provenance marker (SNAP-01, D-12) — 'scheduled' (default, worker cron cadence) vs
   * 'event-move' (server-side large-move detector). Optional/additive: existing callers
   * that don't set it are unaffected; the use-case layer resolves the default.
   */
  readonly trigger?: "scheduled" | "event-move";
};

/**
 * ForPersistingSnapshot — write one calendar_snapshots row (CAL-03).
 * Idempotent: onConflictDoNothing on composite PK (time, calendar_id).
 */
export type ForPersistingSnapshot = (
  row: SnapshotRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingLatestSnapshotTime — read the latest calendar_snapshots time (SNAP-01, Pattern 2).
 * MAX(time) across all snapshot rows; null on cold start (no snapshots yet), never throws.
 * This is the ground-truth read the SNAP-01 cooldown check (isWithinCooldown) needs to
 * reconcile state written by two separate OS processes (apps/worker cron chain vs the
 * apps/server event-move detector) — see Pitfall 2. Internal driven port feeding an
 * existing job trigger, not a user-facing driver port — no HTTP/MCP surface.
 */
export type ForReadingLatestSnapshotTime = () => Promise<Result<Date | null, StorageError>>;

/**
 * ForReadingJournal — ordered snapshot series for a calendar (CAL-02).
 * Returns null when the calendarId is unknown (drives 404 at route layer).
 * Returns empty array when known but zero snapshots exist.
 */
export type ForReadingJournal = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<SnapshotRow> | null, StorageError>>;

/**
 * ForRecomputingSnapshotPnl — re-derive AND write pnl_open on every stored calendar_snapshots
 * row for a calendar, given the CURRENT openNetDebit + qty (D-05: pnl_open = (net_mark -
 * openNetDebit) * qty * 100). One-time data-correction step (JRNL-01): if openNetDebit is
 * corrected after the fact (e.g. a unit-mismatch bug — dollars stored where points were
 * expected — fixed via rebuild-journal), every historical snapshot row still carries the
 * pnl_open computed from the STALE value. Re-derives purely from each row's already-stored
 * net_mark — no online fetch, no broker call. rowsUpdated = 0 (not an error) when the
 * calendar has no snapshot rows.
 */
export type ForRecomputingSnapshotPnl = (
  calendarId: string,
  openNetDebit: number,
  qty: number,
) => Promise<Result<{ readonly rowsUpdated: number }, StorageError>>;

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
 * ForReadingCalendarEventByHash — look up a single calendar_events row by its globally
 * unique fillIdsHash (RULE-01, plan 20-10). fill_ids_hash is the DB UNIQUE idempotency key
 * (see calendar_events schema), so an event can be addressed by hash alone, with no
 * calendarId — matching how ForReadingAnnotations/ForWritingAnnotations already address
 * annotations by fillIdsHash alone (D-09: no FK, hash is the only key). Returns null when
 * no event has that hash. Feeds setRuleTags, whose HTTP route
 * (PUT /api/journal/events/:hash/rules) never receives a calendarId.
 */
export type ForReadingCalendarEventByHash = (
  fillIdsHash: string,
) => Promise<Result<CalendarEvent | null, StorageError>>;

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

// ─── Gap-round data-path port contracts (interface anchor, plan 05-09) ────────
// These types are the stable contract consumed by plans 05-11/05-12/05-13.
// No implementations live in 05-09 — only the surface.

/**
 * ForWritingFills — write broker fills into the fills table (A4 — fills source).
 * Idempotent on the fill id PK at the adapter (onConflictDoNothing). Populated by the
 * sync-transactions source job (plan 05-12) so sync-fills has real input to pair.
 */
export type ForWritingFills = (
  fills: ReadonlyArray<RawFill>,
) => Promise<Result<void, StorageError>>;

/**
 * ForRecomputingCalendarAmounts — recompute AND write openNetDebit/closeNetCredit on the
 * calendars row from the rebuilt calendar_events (A3 — fixes WR-08). Distinct from
 * ForResettingCalendarAmounts, which only clears the amounts. Called as the final
 * reconciliation step of rebuild-journal so SC5 (P&L reconciles after rebuild) holds.
 */
export type ForRecomputingCalendarAmounts = (
  calendarId: string,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingUnprocessedFillsForCalendar — calendar-scoped variant of
 * ForReadingUnprocessedFills (A2 — fixes CR-04). Returns only the unprocessed fills whose
 * legs belong to the target calendar, so rebuild-journal re-pairs ONLY that calendar and
 * the delete scope and sync scope agree.
 */
export type ForReadingUnprocessedFillsForCalendar = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<RawFill>, StorageError>>;

/**
 * ForMarkingFillsProcessed — mark a set of fills processed (WR-A2 — fixes the
 * re-pair-forever / partial-fill double-count). A fill is "processed" once it has been
 * incorporated into exactly ONE calendar_event (paired) OR parked as an orphan. syncFills
 * calls this with a bucket's composing fill ids after the event is stored, and with parked
 * fill ids after orphan parking, so readUnprocessedFills (WHERE processed_at IS NULL AND id
 * NOT IN orphan_fills) never re-reads them. Later fills for the same order/leg arrive
 * unprocessed and form a NEW event covering only the new fills — no fill is double-counted.
 * Idempotent: marking an already-processed id is a no-op; an empty array is a no-op.
 */
export type ForMarkingFillsProcessed = (
  fillIds: ReadonlyArray<string>,
) => Promise<Result<void, StorageError>>;

/**
 * ForResettingFillsProcessedForCalendar — clear processed_at for a calendar's fills (WR-A2,
 * rebuild support). rebuild-journal deletes a calendar's events and re-pairs its fills; with
 * processed_at tracking those fills are already marked processed, so the scoped re-sync would
 * read zero fills and the rebuild would produce no events. This resets processed_at = NULL for
 * the fills whose OCC symbol matches the calendar's legs (delete scope == sync scope), so the
 * scoped re-pair sees them again. Orphan-parked fills stay excluded by the orphan filter.
 */
export type ForResettingFillsProcessedForCalendar = (
  calendarId: string,
) => Promise<Result<void, StorageError>>;

/**
 * ForWipingDerivedFills — account-wide DELETE of every row in the three derived
 * trade-ledger tables (fills, calendar_events, orphan_fills) inside a SINGLE transaction
 * (all-or-nothing — money-path atomicity, mirrors ForRecomputingSnapshotPnl's transaction
 * wrap). Used to correct already-ingested data end-to-end: writeFills is idempotent
 * (onConflictDoNothing on the fill id PK), so re-running backfill-transactions over
 * EXISTING wrong-side fills is a no-op — the stale rows must be deleted first so the
 * re-ingest actually writes fresh, correctly-signed fills.
 *
 * Does NOT touch `calendars` or `calendar_snapshots` — those are not caches rebuildable
 * from the fills feed the same way (calendars.openNetDebit is corrected by rebuild-journal;
 * calendar_snapshots.pnl_open by recompute-snapshot-pnl). occSymbols are shared across
 * calendars, so there is no clean per-calendar fill scope — the correction is account-wide.
 */
export type ForWipingDerivedFills = () => Promise<
  Result<
    {
      readonly fillsDeleted: number;
      readonly eventsDeleted: number;
      readonly orphansDeleted: number;
    },
    StorageError
  >
>;

/**
 * NewId — injected unique-id minter (C1 — fixes CR-01). Core stays pure: the adapter
 * supplies `() => randomUUID()` from node:crypto (plan 05-13). The use-case calls
 * `deps.newId()` instead of importing crypto.
 */
export type NewId = () => string;

/**
 * HashFillIds — injected fill-ids hasher (C1 — fixes CR-01). The adapter supplies the
 * sha256-hex implementation from node:crypto (plan 05-13); the pure-domain reference
 * algorithm (sorted ids, ':'-join, sha256 hex, 64 chars) lives in fill-pairing.ts. The
 * use-case calls `deps.hashFillIds(...)` so the hexagon imports no crypto builtin.
 */
export type HashFillIds = (ids: ReadonlyArray<string>) => string;

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

// ─── Phase 13: COT (Commitments of Traders) ports ────────────────────────────
// Mirrors the ForFetchingRate / ForPersistingRate / ForReadingRate trio (MKT-02).
// CotReport: raw TFF long+short legs per class — NET is derived at the API layer (D-04).
// CotObservationRow: the persisted row with publishedAt (fetch clock, D-07).

/**
 * CotReport — the raw CFTC TFF positioning data for one report week.
 * All long/short values are raw position counts (integer contracts).
 * `asOf` is the Tuesday report date from report_date_as_yyyy_mm_dd (D-08).
 * NET values are derived at the use-case layer, not stored here (D-04).
 */
export type CotReport = {
  readonly contractCode: string; // '13874A' for E-mini S&P 500
  readonly asOf: string; // YYYY-MM-DD — Tuesday report date (from report's own field, D-08)
  readonly openInterest: number;
  readonly dealerLong: number;
  readonly dealerShort: number;
  readonly assetMgrLong: number;
  readonly assetMgrShort: number;
  readonly levMoneyLong: number;
  readonly levMoneyShort: number;
  readonly otherReptLong: number;
  readonly otherReptShort: number;
  readonly nonreptLong: number;
  readonly nonreptShort: number;
};

/**
 * CotObservationRow — the persisted row in cot_observations.
 * Extends CotReport with publishedAt (the fetch timestamp, Friday, D-07).
 * publishedAt is a Date stamped by the use-case at fetch time, not by the adapter.
 */
export type CotObservationRow = CotReport & {
  readonly publishedAt: Date;
};

/**
 * ForFetchingCotReport — fetch the latest TFF row for a CFTC contract code (COT-01).
 * Implemented by the CFTC Socrata HTTP adapter and in-memory twin.
 * No fabricated fallback: a missing/errored COT week returns err(FetchError) (landmine 4).
 */
export type ForFetchingCotReport = (
  contractCode: string,
) => Promise<Result<CotReport, FetchError>>;

/**
 * ForPersistingCotObservation — upsert one cot_observations row (COT-01).
 * Idempotent: ON CONFLICT (contract_code, as_of) DO NOTHING (D-09).
 * Implemented by the Postgres repo and in-memory twin.
 */
export type ForPersistingCotObservation = (
  row: CotObservationRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingCotObservations — list cot_observations ordered by as_of DESC (COT-02).
 * `limit` defaults to all rows when omitted. Returns empty array when no rows exist.
 * Implemented by the Postgres repo and in-memory twin.
 */
export type ForReadingCotObservations = (
  limit?: number,
) => Promise<Result<ReadonlyArray<CotObservationRow>, StorageError>>;

// ─── Phase 14: FRED macro expansion ports (MAC-01, MAC-02) ───────────────────
// New macro_observations table (D-01) — does NOT touch ForFetchingRate/ForPersistingRate/
// ForReadingRate/RateObservation above, which stay pinned to the DGS3MO→BSM path (D-02).
// MacroObservationRow: one (seriesId, date) row. `value` is stored RAW as reported by the
// source — NO /100 division (D-14); DFF is a percent (~4.33), VIXCLS/VVIX are index levels
// (~18.9, ~89.0). VVIX is sourced via CBOE (D-03), the other seven via FRED.

/**
 * MacroObservationRow — one macro_observations row (MAC-01).
 * `value` is the raw source value — no unit normalization (D-14).
 */
export type MacroObservationRow = {
  readonly seriesId: string;
  readonly date: string; // YYYY-MM-DD
  readonly value: number;
  readonly source: "fred" | "cboe";
};

/**
 * ForFetchingFredSeries — fetch one FRED series by id (MAC-01).
 * Parameterized, no-fallback: any failure (missing key, network, non-2xx, parse fail, all
 * '.'-sentinel rows) returns err(FetchError) — never a fabricated value (D-09). Implemented
 * by the FRED HTTP adapter (distinct from the existing DGS3MO-only ForFetchingRate, which
 * keeps its lenient fallback per D-02).
 */
export type ForFetchingFredSeries = (
  seriesId: string,
) => Promise<Result<MacroObservationRow, FetchError>>;

/**
 * ForFetchingVvixQuote — fetch the current VVIX quote via CBOE (MAC-01, D-03).
 * Returns a MacroObservationRow with seriesId 'VVIX' and source 'cboe'. No fallback — any
 * failure returns err(FetchError).
 */
export type ForFetchingVvixQuote = () => Promise<Result<MacroObservationRow, FetchError>>;

/**
 * ForPersistingMacroObservation — upsert one macro_observations row (MAC-01, D-05).
 * Idempotent on (date, series_id) — a second same-day run for an unchanged value is a no-op;
 * a revised value updates in place (FRED sometimes revises preliminary data).
 * Implemented by the Postgres repo and in-memory twin.
 */
export type ForPersistingMacroObservation = (
  row: MacroObservationRow,
) => Promise<Result<void, StorageError>>;

/**
 * ForReadingMacroObservations — bulk, unfiltered read of all macro_observations rows
 * (MAC-02). Grouping by seriesId and windowing (days/series params, D-11) happens in
 * getMacro.ts (plan 14-04), not here. Returns empty array when no rows exist.
 */
export type ForReadingMacroObservations = () => Promise<
  Result<ReadonlyArray<MacroObservationRow>, StorageError>
>;

// ─── Phase 20: RULE-01 annotation ports (calendar_event_annotations) ──────────
// Canonical core ports for the calendar_event_annotations storage layer shipped in plan
// 20-08. The Postgres repo and in-memory twin (packages/adapters) already implement
// function shapes matching these exactly (method names included) — 20-08's local,
// pre-core port types were a placeholder pending this plan; wiring is a type-only swap,
// no adapter logic change (see 20-08-SUMMARY.md "Next Phase Readiness").

/**
 * CalendarEventAnnotation — a recorded rule-tag annotation, keyed by fillIdsHash.
 * D-09/D24: NO foreign key to calendar_events — a rebuild that deletes/reinserts events
 * must never cascade-wipe or block on an annotation row (calendar-event-annotations.ts).
 */
export type CalendarEventAnnotation = {
  readonly fillIdsHash: string;
  readonly ruleTags: ReadonlyArray<string>;
  readonly otherNote: string | null;
  readonly updatedAt: Date;
};

// Input to an upsert — the caller supplies the tags/note; updatedAt is stamped by the adapter.
export type UpsertAnnotationInput = {
  readonly fillIdsHash: string;
  readonly ruleTags: ReadonlyArray<string>;
  readonly otherNote: string | null;
};

/**
 * ForWritingAnnotations — upsert one calendar_event_annotations row by fillIdsHash
 * (RULE-01, D-10). Annotations are editable anytime — onConflictDoUpdate at the adapter,
 * never onConflictDoNothing.
 */
export type ForWritingAnnotations = (
  input: UpsertAnnotationInput,
) => Promise<Result<CalendarEventAnnotation, StorageError>>;

/**
 * ForReadingAnnotations — read one annotation by hash, or the subset matching a hash set
 * (RULE-01). readAnnotation returns null on miss; readAnnotationsByHashes returns only the
 * matching rows (empty array when none match) — feeds getCalendarEventsWithRules' in-memory
 * join against calendar_events (no FK, so the join happens in the use-case, not SQL).
 */
export type ForReadingAnnotations = {
  readonly readAnnotation: (
    fillIdsHash: string,
  ) => Promise<Result<CalendarEventAnnotation | null, StorageError>>;
  readonly readAnnotationsByHashes: (
    hashes: ReadonlyArray<string>,
  ) => Promise<Result<ReadonlyArray<CalendarEventAnnotation>, StorageError>>;
};

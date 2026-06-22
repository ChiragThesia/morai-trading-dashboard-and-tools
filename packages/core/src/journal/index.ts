// Journal bounded context — public surface.
// Exports ports (driven) and use-case factories (driver ports) for the journal context.

export type {
  ForGettingOpenCalendars,
  ForPingingDb,
  StorageError,
  Calendar,
  FetchError,
  RawChain,
  RawQuote,
  ForFetchingChain,
  ObservationRow,
  ContractRow,
  ForPersistingObservations,
  ForUpsertingContracts,
  RateObservation,
  ForFetchingRate,
  ForPersistingRate,
  ForReadingRate,
  PendingObs,
  ForReadingPendingObs,
  ForWritingBsmResults,
  JobRunRecord,
  JobRunMap,
  ForReadingJobRuns,
  // Phase 3 calendar domain types and ports
  CalendarNotFound,
  CalendarAlreadyClosed,
  ForRegisteringCalendar,
  ForListingCalendars,
  ForGettingCalendarById,
  ForClosingCalendar,
  ForGettingOpenCalendarLegs,
  LegSnapshot,
  ForResolvingLegSnapshot,
  SnapshotRow,
  ForPersistingSnapshot,
  ForReadingJournal,
  ForReadingLatestLegObs,
} from "./application/ports.ts";
export type { ForGettingStatus, StatusPayload, StatusError } from "./application/getStatus.ts";
export { makeGetStatusUseCase } from "./application/getStatus.ts";
export { makeFetchChainUseCase } from "./application/fetchChain.ts";
export type { ForRunningFetchChain, FetchChainDeps } from "./application/fetchChain.ts";
export { makeFetchRateUseCase } from "./application/fetchRate.ts";
export { makeComputeBsmGreeksUseCase } from "./application/computeBsmGreeks.ts";
// Snapshot use-case (Phase 3, plan 05)
export { makeSnapshotCalendarsUseCase } from "./application/snapshotCalendars.ts";
export type { ForRunningSnapshotCalendars, SnapshotCalendarsDeps } from "./application/snapshotCalendars.ts";
// Journal read + live-greeks use-cases (Phase 3, plan 06)
export { makeGetJournalUseCase } from "./application/getJournal.ts";
export type { ForRunningGetJournal, GetJournalDeps } from "./application/getJournal.ts";
export { makeGetLiveGreeksUseCase } from "./application/getLiveGreeks.ts";
export type { ForRunningGetLiveGreeks, GetLiveGreeksDeps, LiveGreeks, LegGreeks } from "./application/getLiveGreeks.ts";
// Calendar CRUD use-case factories (Phase 3, plan 03)
export { makeRegisterCalendarUseCase } from "./application/registerCalendar.ts";
export type {
  ForRunningRegisterCalendar,
  RegisterCalendarDeps,
  ValidationError,
} from "./application/registerCalendar.ts";
export { makeListCalendarsUseCase } from "./application/listCalendars.ts";
export type { ListCalendarsDeps } from "./application/listCalendars.ts";
export { makeCloseCalendarUseCase } from "./application/closeCalendar.ts";
export type { CloseCalendarDeps } from "./application/closeCalendar.ts";
// Phase 5: calendar_events + orphan_fills ports + fill-pairing types (JOB-01/JRNL-01)
export type {
  CalendarEvent,
  RawFill,
  AggregatedFill,
  CalendarLegEntry,
  OrphanFillInput,
  ForStoringCalendarEvent,
  ForReadingCalendarEvents,
  ForDeletingCalendarEvents,
  ForReadingUnprocessedFills,
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  ForMarkingFillsProcessed,
  ForResettingFillsProcessedForCalendar,
  ForWritingFills,
  ForEnqueueingJob,
} from "./application/ports.ts";
// Phase 5: syncFills use-case factories + driver ports
export {
  makeSyncFillsUseCase,
  makeSyncFillsForCalendarUseCase,
} from "./application/syncFills.ts";
export type {
  ForRunningSyncFills,
  ForRunningSyncFillsForCalendar,
  SyncFillsDeps,
  SyncFillsForCalendarDeps,
} from "./application/syncFills.ts";
// Phase 5 (gap round 05-12): A4 sync-transactions fills source use-case
export { makeSyncTransactionsUseCase } from "./application/syncTransactions.ts";
export type {
  ForRunningSyncTransactions,
  SyncTransactionsDeps,
} from "./application/syncTransactions.ts";
// Phase 5: fill-pairing reference hasher — composition roots wire it with an injected sha256 (C1)
export { hashFillIds } from "./domain/fill-pairing.ts";
// Phase 5: rebuildJournal use-case factory + driver port
export { makeRebuildJournalUseCase } from "./application/rebuildJournal.ts";
export type { ForRebuildingJournal, RebuildJournalDeps } from "./application/rebuildJournal.ts";
// Phase 5: enqueueJob use-case factory (JOB-01 — dedup + port delegation)
export { makeEnqueueJobUseCase } from "./application/enqueueJob.ts";
export type { EnqueueJobDeps } from "./application/enqueueJob.ts";

// Domain re-exports (Plan 02/03/06) — BSM engine and IV inversion
export { bsmPrice, bsmGreeks, bsmVega } from "./domain/bsm.ts";
export type { BsmGreeks } from "./domain/bsm.ts";
export { invertIv } from "./domain/iv-inversion.ts";
export type { IvError } from "./domain/iv-inversion.ts";
export { computeT, isThirdFriday, calendarDte } from "./domain/dte.ts";
export { isWithinRth } from "./domain/rth-window.ts";
export { isNyseHoliday } from "./domain/nyse-holidays.ts";

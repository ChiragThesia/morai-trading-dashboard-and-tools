// Core hexagon — domain + application layer.
// Hexagon law: core imports @morai/shared only — no frameworks, no adapters, no contracts.

// Journal bounded context
export type { ForGettingOpenCalendars, ForPingingDb, StorageError, Calendar } from "./journal/index.ts";
export type { ForGettingStatus, StatusPayload, StatusError } from "./journal/index.ts";
export { makeGetStatusUseCase } from "./journal/index.ts";
export type {
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
} from "./journal/index.ts";
export { makeFetchChainUseCase } from "./journal/index.ts";
export type { ForRunningFetchChain, FetchChainDeps } from "./journal/index.ts";
export { makeFetchRateUseCase } from "./journal/index.ts";
export { makeComputeBsmGreeksUseCase } from "./journal/index.ts";
export { bsmPrice, bsmGreeks, bsmVega, invertIv, computeT, isThirdFriday, isWithinRth, isNyseHoliday, calendarDte } from "./journal/index.ts";
export type { BsmGreeks, IvError } from "./journal/index.ts";
// Phase 3 calendar domain types and ports
export type {
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
} from "./journal/index.ts";
// Phase 3 calendar use-case factories
export {
  makeRegisterCalendarUseCase,
  makeListCalendarsUseCase,
  makeCloseCalendarUseCase,
  makeSnapshotCalendarsUseCase,
  makeGetJournalUseCase,
  makeGetLiveGreeksUseCase,
} from "./journal/index.ts";
export type {
  ForRunningRegisterCalendar,
  RegisterCalendarDeps,
  ValidationError,
  ListCalendarsDeps,
  CloseCalendarDeps,
  ForRunningSnapshotCalendars,
  SnapshotCalendarsDeps,
  ForRunningGetJournal,
  GetJournalDeps,
  ForRunningGetLiveGreeks,
  GetLiveGreeksDeps,
  LiveGreeks,
  LegGreeks,
} from "./journal/index.ts";

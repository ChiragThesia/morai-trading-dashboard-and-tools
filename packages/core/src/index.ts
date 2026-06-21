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

// Brokerage bounded context — ports + pure freshness domain (Phase 4)
export type {
  AppId,
  SchwabTokenRow,
  AppTokenStatus,
  TokenFreshnessMap,
  AuthExpiredError,
  BrokerPosition,
  BrokerTransaction,
  BrokerOrder,
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  ForFetchingPositions,
  ForFetchingTransactions,
  ForFetchingOrders,
  ForResolvingAccountHash,
} from "./brokerage/index.ts";
export {
  isTokenExpired,
  isTokenStale,
  toAppTokenStatus,
  isNearExpiry,
} from "./brokerage/index.ts";
// AUTH-01: on-demand refresh use-case + types
export { makeRefreshTokenUseCase } from "./brokerage/index.ts";
export type {
  SchwabTokens,
  OAuthError,
  ForRefreshingToken,
} from "./brokerage/index.ts";
// BRK-01: source selector (Schwab primary / CBOE fallback)
export { selectChainSource } from "./brokerage/index.ts";
// Phase 5: journal ports for fill-pairing + calendar events + orphan fills (JOB-01/JRNL-01)
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
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  ForEnqueueingJob,
} from "./journal/index.ts";
export { makeSyncFillsUseCase } from "./journal/index.ts";
export type { ForRunningSyncFills, SyncFillsDeps } from "./journal/index.ts";
export { makeRebuildJournalUseCase } from "./journal/index.ts";
export type { ForRebuildingJournal, RebuildJournalDeps } from "./journal/index.ts";
// Phase 5: refreshTokens use-case + result type (JOB-02, D-13/D-14)
export { makeRefreshTokensUseCase } from "./brokerage/index.ts";
export type { RefreshTokensResult, AppRefreshOutcome, RefreshTokensDeps } from "./brokerage/index.ts";
// D-14 (05-05): per-app refresh outcome recording port
export type { ForRecordingRefreshOutcome } from "./brokerage/index.ts";
// BRK-02: trader data use-cases (positions, transactions, orders)
export { makeGetPositionsUseCase } from "./brokerage/index.ts";
export type { ForGettingPositions, GetPositionsDeps } from "./brokerage/index.ts";
export { makeGetTransactionsUseCase } from "./brokerage/index.ts";
export type { ForGettingTransactions, GetTransactionsDeps } from "./brokerage/index.ts";
export { makeGetOrdersUseCase } from "./brokerage/index.ts";
export type { ForGettingOrders, GetOrdersDeps } from "./brokerage/index.ts";

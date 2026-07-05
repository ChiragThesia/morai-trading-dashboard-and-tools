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
// SNAP-01 (20-04/20-06): cooldown predicate — composed in apps/server's onSpotObserved wiring.
export { isWithinCooldown, SNAPSHOT_COOLDOWN_MS } from "./journal/index.ts";
export type { BsmGreeks, IvError } from "./journal/index.ts";
// RULE-01 (20-07): strategy-rule recording enums + resolver (D-07/D-08) — single-sourced
// for packages/contracts (journal-rules.ts).
export {
  enterRuleTag,
  exitRuleTag,
  rollRuleTag,
  ruleTagEnumForEventType,
} from "./journal/index.ts";
export type { EnterRuleTag, ExitRuleTag, RollRuleTag } from "./journal/index.ts";
// RULE-01 (20-09): annotation ports + read/write use-cases (D-09/D-10/D-21).
export type {
  CalendarEventAnnotation,
  UpsertAnnotationInput,
  ForWritingAnnotations,
  ForReadingAnnotations,
} from "./journal/index.ts";
export { makeGetCalendarEventsWithRulesUseCase } from "./journal/index.ts";
export type {
  CalendarEventWithRules,
  GetCalendarEventsWithRulesDeps,
  ForRunningGetCalendarEventsWithRules,
} from "./journal/index.ts";
export { makeSetRuleTagsUseCase } from "./journal/index.ts";
export type {
  SetRuleTagsInput,
  SetRuleTagsDeps,
  ForRunningSetRuleTags,
} from "./journal/index.ts";
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
  ForReadingLatestSnapshotTime,
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
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  ForMarkingFillsProcessed,
  ForResettingFillsProcessedForCalendar,
  ForWritingFills,
  ForEnqueueingJob,
} from "./journal/index.ts";
export { makeSyncFillsUseCase, makeSyncFillsForCalendarUseCase } from "./journal/index.ts";
export type {
  ForRunningSyncFills,
  ForRunningSyncFillsForCalendar,
  SyncFillsDeps,
  SyncFillsForCalendarDeps,
} from "./journal/index.ts";
// Phase 5 (gap round 05-12): A4 sync-transactions fills source use-case
export { makeSyncTransactionsUseCase } from "./journal/index.ts";
export type {
  ForRunningSyncTransactions,
  SyncTransactionsDeps,
} from "./journal/index.ts";
// Phase 7 (BRK-04): pure date-window chunker. RangeError is aliased to ChunkRangeError on the
// public surface to avoid shadowing the global RangeError at consumers.
export {
  chunkDateRange,
  inclusiveDays,
  SCHWAB_TX_LOOKBACK_MAX_DAYS,
  SCHWAB_TX_MAX_RANGE_DAYS,
} from "./journal/index.ts";
export type {
  DateWindow,
  RangeError as ChunkRangeError,
} from "./journal/index.ts";
export { hashFillIds } from "./journal/index.ts";
export { makeRebuildJournalUseCase } from "./journal/index.ts";
export type { ForRebuildingJournal, RebuildJournalDeps } from "./journal/index.ts";
// Phase 5: enqueueJob use-case factory (JOB-01 — MCP-02 trigger surface)
export { makeEnqueueJobUseCase } from "./journal/index.ts";
export type { EnqueueJobDeps } from "./journal/index.ts";
// D-14 (05-05): per-app refresh outcome recording port
export type { ForRecordingRefreshOutcome } from "./brokerage/index.ts";
// BRK-02: trader data use-cases (positions, transactions, orders)
export { makeGetPositionsUseCase } from "./brokerage/index.ts";
export type { ForGettingPositions, GetPositionsDeps } from "./brokerage/index.ts";
export { makeGetTransactionsUseCase } from "./brokerage/index.ts";
export type { ForGettingTransactions, GetTransactionsDeps } from "./brokerage/index.ts";
export { makeGetOrdersUseCase } from "./brokerage/index.ts";
export type { ForGettingOrders, GetOrdersDeps } from "./brokerage/index.ts";

// ─── Analytics bounded context (Phase 6) ──────────────────────────────────────
// StorageError is already exported above (journal); analytics shares the same shape, so it is
// NOT re-exported here to avoid a duplicate-export. Analytics row types + ports follow.
// Analytics domain functions (06-03)
export { interpolateRiskReversal, percentileRank } from "./analytics/index.ts";
// Analytics use-cases (06-04: term-structure half + read forwarder)
export {
  makeComputeAnalyticsUseCase,
  makeGetTermStructureUseCase,
  makeGetSkewUseCase,
} from "./analytics/index.ts";
export type {
  ComputeAnalyticsDeps,
  ForRunningComputeAnalytics,
  GetTermStructureDeps,
  ForRunningGetTermStructure,
  GetSkewDeps,
  ForRunningGetSkew,
} from "./analytics/index.ts";
export type {
  SmileQuote,
  SmileReadResult,
  CalendarSnapshotForCycle,
  SkewObservationRow,
  RiskReversalObservationRow,
  TermStructureObservationRow,
  ForReadingSmileSource,
  ForReadingCalendarSnapshotsForCycle,
  ForWritingSkewObservations,
  ForWritingRiskReversalObservations,
  ForWritingTermStructureObservations,
  ForReadingRiskReversalHistory,
  ForReadingSkewSeries,
  ForReadingSkewSmileDetail,
  ForReadingTermStructureSeries,
  // GEX ports + row types (Phase 8, Plan 08-05)
  LegObsForGex,
  GexSnapshotRow,
  ForReadingLegObsForGex,
  ForReadingGexSnapshot,
  ForPersistingGexSnapshot,
  ForRunningComputeGexSnapshot,
  ForRunningGetGex,
} from "./analytics/index.ts";
// GEX use-cases (08-05)
export {
  makeComputeGexSnapshotUseCase,
  makeGetGexUseCase,
} from "./analytics/index.ts";
export type {
  ComputeGexSnapshotDeps,
  GetGexDeps,
} from "./analytics/index.ts";

// ─── Streaming bounded context (Phase 12) ─────────────────────────────────────
// SSE fan-out pipeline domain types and BSM live-greek recompute (D-02, STRM-01)
export type {
  RawOptionTick,
  LiveGreekTick,
  ReconciledPosition,
  StreamReconcileError,
  ForReconcilingPositions,
} from "./streaming/index.ts";
export { recomputeLiveGreek } from "./streaming/index.ts";
export type { LiveGreekSkip } from "./streaming/index.ts";
// SNAP-01 (20-04/20-06): rolling-window % move detector — composed in apps/server's
// onSpotObserved wiring (Pattern 2).
export { detectLargeMove, MOVE_WINDOW_MS, MOVE_THRESHOLD_PCT } from "./streaming/index.ts";
export type { SpotSample } from "./streaming/index.ts";

// ─── COT bounded context (Phase 13) ───────────────────────────────────────────
// CFTC COT positioning domain types + driven ports (COT-01, COT-02)
export type {
  CotReport,
  CotObservationRow,
  ForFetchingCotReport,
  ForPersistingCotObservation,
  ForReadingCotObservations,
} from "./journal/index.ts";
// COT use-case factories + driver ports (13-04)
export { makeFetchCot } from "./journal/index.ts";
export type { ForRunningFetchCot } from "./journal/index.ts";
export { makeGetCotUseCase } from "./journal/index.ts";
export type { ForRunningGetCot, CotEntry } from "./journal/index.ts";

// ─── Phase 14: FRED macro expansion ports + domain type (MAC-01, MAC-02) ──────
// New macro_observations table (D-01); rate/BSM ports above stay untouched (D-02).
export type {
  MacroObservationRow,
  ForFetchingFredSeries,
  ForFetchingVvixQuote,
  ForPersistingMacroObservation,
  ForReadingMacroObservations,
} from "./journal/index.ts";
// Phase 14: fetchMacroSeries use-case (14-04, Task 1)
export { makeFetchMacroSeries, DEFAULT_FRED_SERIES_IDS } from "./journal/index.ts";
export type { ForRunningFetchMacroSeries } from "./journal/index.ts";
// Phase 14: getMacro use-case (14-04, Task 2)
export { makeGetMacroUseCase } from "./journal/index.ts";
export type {
  ForRunningGetMacro,
  MacroSeriesQuery,
  MacroSeriesPointOut,
} from "./journal/index.ts";

// ─── Picker bounded context (Phase 19) ────────────────────────────────────────
// Economic-events + picker-snapshot + chain-read driven ports and row domain types
// (PICK-02/PICK-03). StorageError/FetchError already exported above (journal) share the
// same shape and are intentionally not re-exported here.
export type {
  EconomicEvent,
  ForFetchingEconomicEvents,
  ForReadingEconomicEvents,
  ForPersistingEconomicEvents,
  ChainQuoteForPicker,
  ForReadingChainForPicker,
  GexContextForPicker,
  ForReadingGexContext,
  PickerSnapshot,
  PickerSnapshotRow,
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  ForRunningComputePicker,
  ForRunningGetPicker,
} from "./picker/index.ts";
// PICK-02 (19-07): get-picker read use-case — shared by GET /api/picker/candidates +
// get_picker_candidates MCP tool over the ONE pickerSnapshotResponse contract (MCP-02).
export { makeGetPickerUseCase } from "./picker/index.ts";
// PICK-01/PICK-03 (19-08): compute-picker use-case — chain-triggered by compute-gex-snapshot (D-04).
export { makeComputePickerSnapshotUseCase } from "./picker/index.ts";

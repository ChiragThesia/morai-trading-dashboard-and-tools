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
  ForTransitioningCalendarClosed,
  ForGettingOpenCalendarLegs,
  LegSnapshot,
  ForResolvingLegSnapshot,
  SnapshotRow,
  ForPersistingSnapshot,
  ForReadingLatestSnapshotTime,
  ForReadingJournal,
  ForRecomputingSnapshotPnl,
  ForReadingLatestLegObs,
  LatestSnapshotForOpenCalendar,
  ForReadingLatestSnapshotPerOpenCalendar,
} from "./application/ports.ts";
export type { ForGettingStatus, StatusPayload, StatusError } from "./application/getStatus.ts";
export { makeGetStatusUseCase } from "./application/getStatus.ts";
export { makeFetchChainUseCase } from "./application/fetchChain.ts";
export type { ForRunningFetchChain, FetchChainDeps } from "./application/fetchChain.ts";
export { makeFetchRateUseCase } from "./application/fetchRate.ts";
export {
  makeComputeBsmGreeksUseCase,
  COMMIT_BATCH_SIZE,
  BSM_TIME_BUDGET_MS,
} from "./application/computeBsmGreeks.ts";
// Snapshot use-case (Phase 3, plan 05)
export { makeSnapshotCalendarsUseCase, computeSnapshotPnl } from "./application/snapshotCalendars.ts";
export type { ForRunningSnapshotCalendars, SnapshotCalendarsDeps } from "./application/snapshotCalendars.ts";
// PICK-04 (27-02): computeLegPairMetrics — pure leg-pair metrics extracted from
// buildSnapshotRow, so the backtest harness can price a hypothetical candidate without a
// Calendar row (RESEARCH Pattern 5). Additive; buildSnapshotRow's live output is unchanged.
export { computeLegPairMetrics } from "./application/snapshotCalendars.ts";
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
  ForReadingCalendarEventByHash,
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
  ForWipingDerivedFills,
  ForReadingFillsByOccSymbols,
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
// Phase 7 (BRK-04): pure date-window chunker for the historical trade-history backfill
export {
  chunkDateRange,
  inclusiveDays,
  SCHWAB_TX_LOOKBACK_MAX_DAYS,
  SCHWAB_TX_MAX_RANGE_DAYS,
} from "./application/chunkDateRange.ts";
export type { DateWindow, RangeError } from "./application/chunkDateRange.ts";
// Phase 13: COT ports + domain types (COT-01, COT-02)
export type {
  CotReport,
  CotObservationRow,
  ForFetchingCotReport,
  ForPersistingCotObservation,
  ForReadingCotObservations,
} from "./application/ports.ts";
// Phase 13: COT use-cases (13-04)
export { makeFetchCot } from "./application/fetchCot.ts";
export type { ForRunningFetchCot } from "./application/fetchCot.ts";
export { makeGetCotUseCase } from "./application/getCot.ts";
export type { ForRunningGetCot, CotEntry } from "./application/getCot.ts";
// Phase 14: FRED macro expansion ports + domain type (MAC-01, MAC-02)
export type {
  MacroObservationRow,
  ForFetchingFredSeries,
  ForFetchingVvixQuote,
  ForFetchingVix9dQuote,
  ForPersistingMacroObservation,
  ForReadingMacroObservations,
} from "./application/ports.ts";
// Phase 14: fetchMacroSeries use-case (14-04, Task 1)
export { makeFetchMacroSeries, DEFAULT_FRED_SERIES_IDS } from "./application/fetchMacroSeries.ts";
export type { ForRunningFetchMacroSeries } from "./application/fetchMacroSeries.ts";
// Phase 14: getMacro use-case (14-04, Task 2)
export { makeGetMacroUseCase } from "./application/getMacro.ts";
export type {
  ForRunningGetMacro,
  MacroSeriesQuery,
  MacroSeriesPointOut,
} from "./application/getMacro.ts";
// Phase 5: fill-pairing reference hasher — composition roots wire it with an injected sha256 (C1)
export { hashFillIds } from "./domain/fill-pairing.ts";
// journal-pnl-opennetdebit-units round 5: fill→calendar order-anchored disambiguation (bug 1)
// + fully-closed detection from a calendar's event history (bug 2) — both pure domain fns.
export { resolveFillMatches, isCalendarFullyClosed } from "./domain/fill-pairing.ts";
export type {
  FillMatchCandidate,
  FillMatchInput,
  ResolvedFillMatch,
} from "./domain/fill-pairing.ts";
// Phase 5: rebuildJournal use-case factory + driver port
export { makeRebuildJournalUseCase } from "./application/rebuildJournal.ts";
export type { ForRebuildingJournal, RebuildJournalDeps } from "./application/rebuildJournal.ts";
// JRNL-01 (pnl-unit-mismatch fix): recomputeSnapshotPnl use-case — re-derive frozen historical
// pnl_open from a corrected openNetDebit (data-correction path, see recomputeSnapshotPnl.ts).
export { makeRecomputeSnapshotPnlUseCase } from "./application/recomputeSnapshotPnl.ts";
export type {
  ForRunningRecomputeSnapshotPnl,
  RecomputeSnapshotPnlDeps,
} from "./application/recomputeSnapshotPnl.ts";
// Phase 5: enqueueJob use-case factory (JOB-01 — dedup + port delegation)
export { makeEnqueueJobUseCase } from "./application/enqueueJob.ts";
export type { EnqueueJobDeps } from "./application/enqueueJob.ts";
// journal-pnl-opennetdebit-units (round 3): wipeDerivedFills use-case — account-wide
// DELETE of fills/calendar_events/orphan_fills, the missing piece for correcting
// already-backfilled calendars' fills.side data end-to-end (see wipeDerivedFills.ts).
export { makeWipeDerivedFillsUseCase } from "./application/wipeDerivedFills.ts";
export type {
  ForRunningWipeDerivedFills,
  WipeDerivedFillsDeps,
} from "./application/wipeDerivedFills.ts";

// Domain re-exports (Plan 02/03/06) — BSM engine and IV inversion
export { bsmPrice, bsmGreeks, bsmVega } from "./domain/bsm.ts";
export type { BsmGreeks } from "./domain/bsm.ts";
export { invertIv } from "./domain/iv-inversion.ts";
export type { IvError } from "./domain/iv-inversion.ts";
export { computeT, isThirdFriday, calendarDte } from "./domain/dte.ts";
export { isWithinRth } from "./domain/rth-window.ts";
export { isNyseHoliday } from "./domain/nyse-holidays.ts";
// SNAP-01 (20-04/20-06): cross-process cooldown predicate — composed in apps/server's
// onSpotObserved wiring (Pattern 2, Pitfall 2).
export { isWithinCooldown, SNAPSHOT_COOLDOWN_MS } from "./domain/snapshot-cooldown.ts";
// RULE-01 (20-07): event-keyed strategy-rule recording enums + resolver (D-07/D-08).
// packages/contracts derives its request/response schemas from these so the DB-boundary
// and HTTP/MCP vocabularies can never diverge.
export {
  enterRuleTag,
  exitRuleTag,
  rollRuleTag,
  ruleTagEnumForEventType,
} from "./domain/rule-tags.ts";
export type { EnterRuleTag, ExitRuleTag, RollRuleTag } from "./domain/rule-tags.ts";
// RULE-01 (20-09): annotation ports + read/write use-cases (D-09/D-10/D-21).
export type {
  CalendarEventAnnotation,
  UpsertAnnotationInput,
  ForWritingAnnotations,
  ForReadingAnnotations,
} from "./application/ports.ts";
// Phase 28 (28-02, PLAY-02): anti-criteria loss-cooldown brake read port
export type {
  RecentClosedCalendar,
  ForReadingRecentClosedCalendars,
} from "./application/ports.ts";
export { makeGetCalendarEventsWithRulesUseCase } from "./application/getCalendarEventsWithRules.ts";
export type {
  CalendarEventWithRules,
  GetCalendarEventsWithRulesDeps,
  ForRunningGetCalendarEventsWithRules,
} from "./application/getCalendarEventsWithRules.ts";
export { makeSetRuleTagsUseCase } from "./application/setRuleTags.ts";
export type {
  SetRuleTagsInput,
  SetRuleTagsDeps,
  ForRunningSetRuleTags,
} from "./application/setRuleTags.ts";
// SNAP-01 (REVIEW CR-01/WR-04): event-move observe→detect→cooldown→enqueue orchestration,
// extracted from apps/server/src/main.ts into a testable unit.
export { makeSpotObserver } from "./application/observeSpot.ts";
export type { SpotObserverDeps, ForObservingSpot } from "./application/observeSpot.ts";
// JRNL-01 (22-01): forward-vol domain fn — the distinct-edge series (D-02/D-07), never NaN.
export { computeForwardVol } from "./domain/fwd-vol.ts";
export type { ForwardVolResult } from "./domain/fwd-vol.ts";
// JRNL-01 (22-02): per-interval P&L attribution — hero decomposition + exact residual plug
// (D-01/D-05/D-06), honest gap handling (isGap + null cumulatives, never bridged).
export { computeAttributionSeries, isGapRow } from "./domain/attribution.ts";
export type { AttributionPoint } from "./domain/attribution.ts";
// JRNL-01 (22-03): getCalendarLifecycle use-case — thin forwarder over ForReadingJournal,
// mapping each row through computeForwardVol + computeAttributionSeries (22-01/22-02).
export { makeGetCalendarLifecycleUseCase } from "./application/getCalendarLifecycle.ts";
export type {
  LifecycleSnapshot,
  GetCalendarLifecycleDeps,
  ForRunningGetCalendarLifecycle,
} from "./application/getCalendarLifecycle.ts";
// JRNL-02: position-pairing pure domain fn — ports the web Positions pairing algorithm
// into core so registerOpenCalendars can consume the real position book (see
// domain/position-pairing.ts doc comment for the underlyingSymbol-keyed rationale).
export { pairPositionsIntoCalendarCandidates } from "./domain/position-pairing.ts";
export type { PositionLeg, CalendarCandidate } from "./domain/position-pairing.ts";
// JRNL-02: registerOpenCalendars use-case — auto-register calendars from the open position
// book so they appear in the Journal without a manual registration step.
export { makeRegisterOpenCalendarsUseCase } from "./application/registerOpenCalendars.ts";
export type {
  ForFetchingOpenPositionLegs,
  RegisterOpenCalendarsDeps,
  RegisterOpenCalendarsResult,
  RegisteredCalendarSummary,
  SkippedCalendarSummary,
  ForRunningRegisterOpenCalendars,
} from "./application/registerOpenCalendars.ts";

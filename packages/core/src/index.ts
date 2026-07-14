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
export { makeComputeBsmGreeksUseCase, COMMIT_BATCH_SIZE, BSM_TIME_BUDGET_MS } from "./journal/index.ts";
export { bsmPrice, bsmGreeks, bsmVega, invertIv, computeT, isThirdFriday, isWithinRth, isNyseHoliday, calendarDte } from "./journal/index.ts";
// Phase 40 (HIST-01): root-candidate resolution — reused by packages/adapters and
// packages/core journal call sites (plans 02/04).
export { resolveRootCandidates } from "./journal/index.ts";
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
// Phase 28 (28-02, PLAY-02): anti-criteria loss-cooldown brake read port
export type {
  RecentClosedCalendar,
  ForReadingRecentClosedCalendars,
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
// SNAP-01 (REVIEW CR-01/WR-04): testable event-move orchestration — wired in main.ts.
export { makeSpotObserver } from "./journal/index.ts";
export type { SpotObserverDeps, ForObservingSpot } from "./journal/index.ts";
// Phase 3 calendar domain types and ports
export type {
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
  // 26-03: journal's OWN latest-snapshot-per-open-calendar port (SnapshotRow-shaped).
  // Aliased — the exits context (26-01) already exports a structurally-different,
  // exits-owned re-declaration under the SAME bare name (its own `LatestSnapshotForCalendar`
  // shape, not journal's `SnapshotRow`); see the "Exits bounded context" block below.
  LatestSnapshotForOpenCalendar,
  ForReadingLatestSnapshotPerOpenCalendar as ForReadingLatestSnapshotPerOpenCalendarForJournal,
} from "./journal/index.ts";
// Phase 3 calendar use-case factories
export {
  makeRegisterCalendarUseCase,
  makeListCalendarsUseCase,
  makeCloseCalendarUseCase,
  makeSnapshotCalendarsUseCase,
  computeSnapshotPnl,
  makeGetJournalUseCase,
  makeGetLiveGreeksUseCase,
  // PICK-04 (27-02): pure leg-pair metrics extracted from buildSnapshotRow (RESEARCH
  // Pattern 5) — reused by the backtest harness for hypothetical-candidate pricing.
  computeLegPairMetrics,
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
// BRK-01: source selector (dual-source: Schwab freshness + CBOE breadth)
export { selectChainSources } from "./brokerage/index.ts";
// Phase 5: journal ports for fill-pairing + calendar events + orphan fills (JOB-01/JRNL-01)
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
export { resolveFillMatches, isCalendarFullyClosed } from "./journal/index.ts";
export type {
  FillMatchCandidate,
  FillMatchInput,
  ResolvedFillMatch,
} from "./journal/index.ts";
export { makeRebuildJournalUseCase } from "./journal/index.ts";
export type { ForRebuildingJournal, RebuildJournalDeps } from "./journal/index.ts";
// JRNL-01 (pnl-unit-mismatch fix): recomputeSnapshotPnl use-case (data-correction path)
export { makeRecomputeSnapshotPnlUseCase } from "./journal/index.ts";
export type {
  ForRunningRecomputeSnapshotPnl,
  RecomputeSnapshotPnlDeps,
} from "./journal/index.ts";
// Phase 5: enqueueJob use-case factory (JOB-01 — MCP-02 trigger surface)
export { makeEnqueueJobUseCase } from "./journal/index.ts";
export type { EnqueueJobDeps } from "./journal/index.ts";
// journal-pnl-opennetdebit-units (round 3): wipeDerivedFills use-case (account-wide
// fills-side-correction follow-up)
export { makeWipeDerivedFillsUseCase } from "./journal/index.ts";
export type {
  ForRunningWipeDerivedFills,
  WipeDerivedFillsDeps,
} from "./journal/index.ts";
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
// Parity-implied carry solver (Phase 34, Plan 34-03 — TOSP-02)
export { impliedDivYield } from "./analytics/index.ts";
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

// Regime board use-case (Phase 24, 24-04) — BOARD-01/02/03, MACRO-03
export { makeGetRegimeBoardUseCase } from "./analytics/index.ts";
export type {
  GetRegimeBoardDeps,
  ForRunningGetRegimeBoard,
  RegimeIndicatorOut,
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
  ForFetchingVix9dQuote,
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
  PickerGate,
  PickerGateBrakes,
  PickerSnapshot,
  PickerSnapshotRow,
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  ForReadingDailySpotCloses,
  ForReadingPickerSlopeHistory,
  ForRunningComputePicker,
  ForRunningGetPicker,
  AdHocCalendarInput,
  AdHocCalendarAnalysis,
  ForAnalyzingAdHocCalendar,
  ForPreviewingPickerRuleOverrides,
  PickerPreviewDeps,
  PickerPreviewResult,
} from "./picker/index.ts";
// PICK-02 (19-07): get-picker read use-case — shared by GET /api/picker/candidates +
// get_picker_candidates MCP tool over the ONE pickerSnapshotResponse contract (MCP-02).
export { makeGetPickerUseCase } from "./picker/index.ts";
// PICK-01/PICK-03 (19-08): compute-picker use-case — chain-triggered by compute-gex-snapshot (D-04).
export { makeComputePickerSnapshotUseCase } from "./picker/index.ts";
// D-02 (30-04): ad-hoc analyze use-case — scores ONE user-pasted PUT calendar with byte-parity
// to the engine (T-30-10); the 30-05 HTTP route + MCP tool import this from @morai/core.
export { makeAnalyzeAdHocCalendarUseCase } from "./picker/index.ts";
// B1 (32-02): picker branch of the staged-change dry-run preview — 32-04's server composition
// root wires this into the combined settings-context preview use-case.
export { makePreviewPickerRuleOverridesUseCase } from "./picker/index.ts";
// PICK-04 (27-02): additive reuse exports — the backtest harness reuses these SAME pure
// picker domain functions (BT-01's "zero reimplementation" lock), not a second copy. No
// live call site changes; every existing picker test stays green.
export {
  selectCandidates,
  haircutFill,
  scoreCalendarCandidates,
  RULE_SET_METADATA,
  realizedVol,
  rankAndCapCandidates,
  PICKER_TOP_N,
} from "./picker/index.ts";
export type {
  SelectCandidatesParams,
  SelectCandidatesResult,
  GateDrops,
  ScoringParams,
  RuleMetadata,
  RawCandidate,
  ScoredCandidate,
  BreakdownEntry,
  BreakdownCriterion,
  ContextEntry,
  ExitPlan,
} from "./picker/index.ts";

// ─── Phase 22: Journal calendar-lifecycle graph (JRNL-01) ─────────────────────
// getCalendarLifecycle use-case — thin forwarder over ForReadingJournal, mapping each row
// through computeForwardVol + computeAttributionSeries (22-01/22-02/22-03).
export { makeGetCalendarLifecycleUseCase } from "./journal/index.ts";
export type {
  LifecycleSnapshot,
  GetCalendarLifecycleDeps,
  ForRunningGetCalendarLifecycle,
} from "./journal/index.ts";

// ─── Exits bounded context (Phase 26, Plan 01) ────────────────────────────────
// Domain types + driven port TYPE declarations only — no use-cases yet (26-02 evaluator,
// 26-04 use-case). ForReadingEconomicEvents is aliased on this barrel: it is an exits-owned
// re-declaration (Tier1Event, no `source` field), a structurally different type from picker's
// own ForReadingEconomicEvents (EconomicEvent, has `source`) — both are real, distinct ports,
// so both must be reachable under distinct names from this top-level barrel (unlike the
// structurally-IDENTICAL StorageError/FetchError collisions elsewhere in this file, which are
// intentionally not re-exported twice).
export type {
  HeldPosition,
  Tier1EventName,
  Tier1Event,
  RollCandidateQuote,
  RollChainContext,
  MarketContext,
  ExitMetric,
  ExitVerdictKind,
  ExitRollSuggestion,
  ExitVerdict,
  PreviousVerdict,
  ExitVerdictRow,
  LatestSnapshotForCalendar,
  ChainQuoteForRoll,
  ForReadingHeldPositions,
  ForReadingLatestSnapshotPerOpenCalendar,
  ForReadingEconomicEvents as ForReadingEconomicEventsForExits,
  ForReadingChainForRoll,
  ForReadingLatestVerdictsPerCalendar,
  ForPersistingExitVerdict,
  ForRunningComputeExitAdvice,
  HeldPositionVerdict,
  ExitRuleSetEntry,
  ExitAdviceSnapshot,
  ForRunningGetExitAdvice,
  ExitPreviewEntry,
  ExitPreviewResult,
  ExitPreviewDeps,
  ForPreviewingExitRuleOverrides,
} from "./exits/index.ts";
// 26-04: computeExitAdvice (terminal-job use-case, chain-triggered by compute-picker) +
// getExitAdvice (read use-case — 26-05's HTTP route + MCP tool will share this over the
// exitsResponse contract, MCP-02).
export { makeComputeExitAdviceUseCase, makeGetExitAdviceUseCase } from "./exits/index.ts";
export type { ComputeExitAdviceDeps, GetExitAdviceDeps } from "./exits/index.ts";
// B2 (32-03): exits branch of the staged-change dry-run preview — 32-04's server composition
// root wires this into the combined settings-context preview use-case.
export { makePreviewExitRuleOverridesUseCase } from "./exits/index.ts";
// PICK-04 (27-02): additive reuse exports — the backtest harness reuses the SAME pure exit
// evaluator + rule registry (BT-01's lock), not a second copy. exits/index.ts already
// barrels these; this thread was the only missing hop up to @morai/core.
export { evaluateExit } from "./exits/index.ts";
export {
  EXIT_RULE_METADATA,
  EXIT_PRECEDENCE,
  TAKE_RUNGS,
  STOP_RUNGS,
  TERM_INVERSION_MIN,
  TERM_INVERSION_DISARM,
  GAMMA_OFF_STRIKE,
  GAMMA_OFF_STRIKE_DISARM,
  GAMMA_FRONT_DTE_MAX,
  EVT_BLACKOUT_DAYS,
  ROLL_FRONT_DTE_MAX,
  ROLL_SPOT_BAND,
  ROLL_PROFIT_MAX,
  ROLL_REPLACEMENT_DTE_MIN,
  ROLL_REPLACEMENT_DTE_MAX,
} from "./exits/index.ts";
export type { ExitRuleId, ExitRuleKind, ExitRuleMetadata, ExitRung } from "./exits/index.ts";

// ─── JRNL-02: register-open-calendars (auto-register calendars from the open position book) ──
export {
  pairPositionsIntoCalendarCandidates,
  makeRegisterOpenCalendarsUseCase,
} from "./journal/index.ts";
export type {
  PositionLeg,
  CalendarCandidate,
  ForFetchingOpenPositionLegs,
  RegisterOpenCalendarsDeps,
  RegisterOpenCalendarsResult,
  RegisteredCalendarSummary,
  SkippedCalendarSummary,
  ForRunningRegisterOpenCalendars,
} from "./journal/index.ts";

// ─── Backtest bounded context (Phase 27, Plans 01-06) ──────────────────────────
// Domain types + driven port TYPE declarations + the runBacktest orchestrator (06). Only
// runBacktest is threaded as a value — the replay use-cases/kernel fns are consumed
// internally by runBacktest via plain relative imports (same bounded context), never by the
// CLI directly. StorageError is NOT re-exported a second time under that name (see
// ./backtest/index.ts header comment, mirrors exits' convention).
export { makeRunBacktestUseCase } from "./backtest/index.ts";
export type {
  ReplayMismatchKind,
  CohortMismatch,
  ReplayMismatch,
  DirectionalAttributionRow,
  AblationRow,
  CoverageDay,
  TradeReproduction,
  BacktestReport,
  BootstrapCiRow,
  BacktestRunRow,
  ForPersistingBacktestRun,
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  StoredPickerSnapshotRow,
  ForReadingPickerSnapshotsInRange,
  FullHistorySnapshotRow,
  ForReadingFullSnapshotHistoryForCalendar,
  RunBacktestDeps,
  RunBacktestParams,
} from "./backtest/index.ts";

// ─── Settings bounded context (Phase 29, Plan 09) ──────────────────────────────
// Thin cross-cutting settings context: storage-facing ports + the pure merge helpers backing
// the GET/PUT rule-settings surface (29-13). StorageError is NOT re-exported a second time
// under that name — structurally identical to journal's (already exported above), same
// convention as exits/backtest (see their own header comments).
export type { RuleConfig, StoredRuleOverrides, RuleOverridesPatch } from "./settings/domain/merge.ts";
export { computeEffective, mergeStoredOverrides } from "./settings/domain/merge.ts";
export type { ForReadingRuleOverrides, ForWritingRuleOverrides } from "./settings/application/ports.ts";
export { makeGetRuleSettingsUseCase } from "./settings/application/getRuleSettings.ts";
export type {
  GetRuleSettingsResult,
  GetRuleSettingsDeps,
  ForRunningGetRuleSettings,
} from "./settings/application/getRuleSettings.ts";
export { makeSetRuleOverridesUseCase } from "./settings/application/setRuleOverrides.ts";
export type {
  SetRuleOverridesResult,
  SetRuleOverridesDeps,
  ForRunningSetRuleOverrides,
} from "./settings/application/setRuleOverrides.ts";
// B4 (32-04): combined picker/exits staged-change preview use-case — the ONE seam both
// POST /api/settings/rules/preview and its MCP twin call (no duplicated orchestration).
export { makePreviewRuleOverridesUseCase } from "./settings/application/previewRuleOverrides.ts";
export type {
  PreviewRuleOverridesDeps,
  RulePreviewInput,
  RulePreviewResult,
  ForRunningPreviewRuleOverrides,
} from "./settings/application/previewRuleOverrides.ts";

// 29-13: the three engines' own resolve functions — the ONE wiring point (apps → core) the
// server composition root calls with no overrides to compute the settings surface's
// injected `defaults`, so the displayed defaults never drift from the compile-time constants.
export { resolvePickerRuleConfig } from "./picker/index.ts";
export type { PickerRuleConfig, PickerRuleOverrides } from "./picker/index.ts";
export { resolveExitRuleConfig } from "./exits/index.ts";
export type { ExitRuleConfig, ExitRuleOverrides } from "./exits/index.ts";
export { resolveRegimeRuleConfig } from "./analytics/index.ts";
export type { RegimeRuleConfig, RegimeRuleOverrides } from "./analytics/index.ts";

// 32-06: regime band classifiers, re-exported so the web modal's client-side preview re-band
// imports the ACTUAL core functions (no hand-copy) — parity by construction (T-32-12).
export {
  bandVixTermStructure,
  bandVvix,
  bandVix9dRatio,
  bandHyOas,
} from "./analytics/index.ts";
export type { RegimeBand, RegimeThresholds } from "./analytics/index.ts";

// ─── Reauth bounded context (Phase 37, Plan 02 — REAUTH-05) ───────────────────
// Ports + thin passthrough use-cases for the two sidecar admin re-auth operations. The sidecar
// HTTP adapter (packages/adapters) implements ForStartingReauth/ForExchangingReauth.
export type { ReauthApp, ReauthError, ForStartingReauth, ForExchangingReauth } from "./reauth/index.ts";
export { makeStartReauth, makeExchangeReauth } from "./reauth/index.ts";
export type { StartReauthDeps, ExchangeReauthDeps } from "./reauth/index.ts";

// API contracts — Zod schemas for request/response.
// Single source of truth for both HTTP routes and MCP tools (MCP-02 pattern).

export { jobRunRecord, statusResponse } from "./status.ts";
export type { JobRunRecord, StatusResponse } from "./status.ts";

// Calendar CRUD contracts (MCP-02: reused by list_calendars MCP tool in plan 07)
export {
  registerCalendarRequest,
  calendarResponse,
  listCalendarsResponse,
  closeCalendarRequest,
} from "./calendar.ts";
export type {
  RegisterCalendarRequest,
  CalendarResponse,
  ListCalendarsResponse,
  CloseCalendarRequest,
} from "./calendar.ts";

// Journal read contracts (MCP-02: reused by get_journal MCP tool in plan 07)
// Trade Ledger contracts (MCP-02: reused by get_trade_history MCP tool)
export {
  tradeHistoryGreeks,
  tradeHistoryRoundTrip,
  tradeHistoryExecution,
  tradeHistoryResponse,
  tradeDetailLegDay,
  tradeDetailDay,
  tradeDetailResponse,
} from "./trade-history.ts";
export type {
  TradeHistoryGreeksResponse,
  TradeHistoryRoundTripResponse,
  TradeHistoryExecutionResponse,
  TradeHistoryResponse,
  TradeDetailLegDayResponse,
  TradeDetailDayResponse,
  TradeDetailResponse,
} from "./trade-history.ts";

export { snapshotResponse, journalResponse } from "./journal.ts";
export type { SnapshotResponse, JournalResponse } from "./journal.ts";
// JRNL-01 (22-01/22-03): lifecycle contract — additive .extend() over snapshotResponse,
// reused by GET /api/journal/:calendarId/lifecycle + get_journal_lifecycle MCP tool (MCP-02).
export { lifecycleSnapshotResponse, lifecycleResponse } from "./journal.ts";
export type { LifecycleSnapshotResponse, LifecycleResponse } from "./journal.ts";

// Strategy-rule recording contracts (RULE-01, 20-07: single-sourced from @morai/core D-07)
export {
  setRuleTagsRequest,
  setRuleTagsResponse,
  getEventsWithRulesResponse,
} from "./journal-rules.ts";
export type {
  SetRuleTagsRequest,
  SetRuleTagsResponse,
  EventWithRulesEntry,
  GetEventsWithRulesResponse,
} from "./journal-rules.ts";

// Live greeks contracts (MCP-02: reused by get_live_greeks MCP tool in plan 07)
export { liveGreeksResponse } from "./live-greeks.ts";
export type { LegGreeks, LiveGreeksResponse } from "./live-greeks.ts";

// Analytics contracts (MCP-02: ONE schema source for HTTP routes + MCP get_skew/get_term_structure)
export {
  skewEntry,
  skewResponse,
  skewSmileEntry,
  skewSmileResponse,
  termStructureEntry,
  termStructureResponse,
} from "./analytics.ts";
export type {
  SkewEntry,
  SkewResponse,
  SkewSmileEntry,
  SkewSmileResponse,
  TermStructureEntry,
  TermStructureResponse,
} from "./analytics.ts";

// Brokerage contracts (MCP-02: shared by HTTP routes and MCP tools for positions/transactions/orders)
export {
  positionsResponse,
  transactionsResponse,
  ordersResponse,
  brokerageAuthExpiredPayload,
} from "./brokerage.ts";
export type {
  PositionsResponse,
  TransactionsResponse,
  OrdersResponse,
  BrokerageAuthExpiredPayload,
  BrokerPositionResponse,
  BrokerTransactionResponse,
  BrokerOrderResponse,
} from "./brokerage.ts";

// Jobs contracts (MCP-02: shared by POST /api/jobs/:name/trigger and trigger_job MCP tool)
export { TRIGGERABLE_JOBS, triggerJobPayload, triggerJobBodyFor, triggerJobResponse } from "./jobs.ts";
export type { TriggerableJob, TriggerJobPayload, TriggerJobResponse } from "./jobs.ts";

// GEX contracts (MCP-02: ONE schema source for GET /api/analytics/gex + get_gex MCP tool)
export { gexWallEntry, gexSnapshotEntry, gexSnapshotResponse } from "./gex.ts";
export type { GexWallEntry, GexSnapshotEntry, GexSnapshotResponse } from "./gex.ts";

// Stream-events contracts (Phase 12 — MCP-02: sidecar→server→browser SSE payload schemas)
export {
  streamTicketResponse,
  streamLiveGreekEvent,
  streamReconcileEvent,
  streamFillEvent,
  streamSpotEvent,
  streamIndicesEvent,
  streamPingEvent,
} from "./stream-events.ts";
export type {
  StreamTicketResponse,
  StreamLiveGreekEvent,
  StreamReconcilePosition,
  StreamReconcileEvent,
  StreamFillEvent,
  StreamSpotEvent,
  StreamIndicesEvent,
  StreamPingEvent,
} from "./stream-events.ts";

// COT contracts (Phase 13 — MCP-02: ONE schema source for GET /api/analytics/cot + get_cot MCP tool)
export { cotSeriesEntry, cotResponse } from "./cot.ts";
export type { CotSeriesEntry, CotResponse } from "./cot.ts";

// Macro contracts (Phase 14 — MCP-02: ONE schema source for GET /api/analytics/macro + get_macro MCP tool)
export { macroSeriesPoint, macroResponse, macroQuery, MACRO_SERIES_IDS, macroSeriesId } from "./macro.ts";
export type { MacroSeriesPoint, MacroResponse, MacroQuery, MacroSeriesId } from "./macro.ts";

// Regime contracts (Phase 24 — MCP-02: ONE schema source for the future GET /api/analytics/regime
// route + get_regime MCP tool, BOARD-01/02)
export { regimeBand, regimeIndicator, regimeResponse } from "./regime.ts";
export type { RegimeBand, RegimeIndicator, RegimeResponse } from "./regime.ts";

// Picker contracts (Phase 18 — D-01; MCP-02: ONE schema source for the Phase-19
// /api/picker/candidates + get_picker_candidates MCP tool)
export {
  pickerCandidateLeg,
  breakdownEntry,
  exitPlan,
  pickerCandidate,
  termStructurePoint,
  pickerGexContext,
  pickerEvent,
  pickerSnapshotResponse,
  analyzeAdHocCalendarRequest,
  analyzeAdHocCalendarResponse,
} from "./picker.ts";
export type {
  PickerCandidateLeg,
  BreakdownEntry,
  ExitPlan,
  PickerCandidate,
  TermStructurePoint,
  PickerGexContext,
  PickerEvent,
  RuleSetEntry,
  PickerGate,
  PickerGateBrakes,
  PickerSizing,
  PickerSnapshotResponse,
  AnalyzeAdHocCalendarRequest,
  AnalyzeAdHocCalendarResponse,
} from "./picker.ts";
export { pickerSnapshotFixture } from "./__fixtures__/picker-candidates.fixture.ts";

// Exits contracts (Phase 26, Plan 01 — MCP-02: ONE schema source for the future
// GET /api/exits response + get_exit_advice MCP tool)
export {
  exitMetric,
  exitVerdictEnum,
  exitRollDetail,
  exitVerdict,
  heldPositionVerdict,
  exitRuleSetEntry,
  exitsResponse,
} from "./exits.ts";
export type {
  ExitMetric,
  ExitVerdictEnum,
  ExitRollDetail,
  ExitVerdictBlob,
  HeldPositionVerdict,
  ExitRuleSetEntry,
  ExitsResponse,
} from "./exits.ts";

// Rule-settings contracts (Phase 29, Plan 29-02 — MCP-02: ONE schema source for the future
// GET/PUT /api/settings/rules routes + get_rule_settings/set_rule_overrides MCP tools)
export {
  ruleOverrides,
  ruleConfig,
  getRuleSettingsResponse,
  setRuleOverridesRequest,
  setRuleOverridesResponse,
} from "./rule-settings.ts";
export type {
  RuleOverrides,
  RuleConfig,
  GetRuleSettingsResponse,
  SetRuleOverridesRequest,
  SetRuleOverridesResponse,
} from "./rule-settings.ts";

// Per-knob explainer registry (Phase 32, Plan 01 — B6: single typed source of trader-facing
// knob copy, keyed by the same dotted paths ruleConfig.shape walks to).
export { RULE_EXPLAINERS } from "./rule-explainers.ts";
export type { RuleExplainer, RuleAffectedSurface } from "./rule-explainers.ts";

// Staged-change preview contracts (Phase 32, Plan 01 — B4/B5/B7: ONE schema shared by the
// future preview HTTP route and its MCP twin).
export { previewRuleOverridesRequest, previewRuleOverridesResponse } from "./rule-preview.ts";
export type {
  PreviewRuleOverridesRequest,
  PreviewPickerCandidate,
  PreviewRuleOverridesResponse,
} from "./rule-preview.ts";

// Re-auth wizard contracts (Phase 37, Plan 02 — REAUTH-05: ONE schema source for the future
// server proxy routes; the exchange response is a bare `{ app, ok }`, no code/state echo).
export {
  reauthStartRequest,
  reauthStartSidecarResponse,
  reauthStartResponse,
  reauthExchangeRequest,
  reauthExchangeResponse,
} from "./reauth.ts";
export type {
  ReauthStartRequest,
  ReauthStartSidecarResponse,
  ReauthStartResponse,
  ReauthExchangeRequest,
  ReauthExchangeResponse,
} from "./reauth.ts";

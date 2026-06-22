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
export { snapshotResponse, journalResponse } from "./journal.ts";
export type { SnapshotResponse, JournalResponse } from "./journal.ts";

// Live greeks contracts (MCP-02: reused by get_live_greeks MCP tool in plan 07)
export { liveGreeksResponse } from "./live-greeks.ts";
export type { LegGreeks, LiveGreeksResponse } from "./live-greeks.ts";

// Analytics typed-empty contracts (MCP-02: reused by term_structure/skew MCP tools in plan 07)
export { termStructureResponse, skewResponse } from "./analytics.ts";
export type { TermStructureResponse, SkewResponse } from "./analytics.ts";

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

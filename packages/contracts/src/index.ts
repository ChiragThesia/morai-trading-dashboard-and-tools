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

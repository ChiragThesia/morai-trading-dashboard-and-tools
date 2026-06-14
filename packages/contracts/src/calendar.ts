import { z } from "zod";

// MCP-02: ONE schema source for both HTTP route and MCP tool (list_calendars, plan 07).
// Both adapters import from here; a one-sided change fails typecheck.

export const registerCalendarRequest = z.object({
  underlying: z.string().min(1).max(16),
  strike: z.number().int().positive(), // ×1000 int (e.g. 7100000 for SPX 7100)
  optionType: z.enum(["C", "P"]),
  frontExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  backExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  qty: z.number().int().positive(),
  openNetDebit: z.number(),
  openedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
});
export type RegisterCalendarRequest = z.infer<typeof registerCalendarRequest>;

export const calendarResponse = z.object({
  id: z.string().uuid(),
  underlying: z.string(),
  strike: z.number(),
  optionType: z.enum(["C", "P"]),
  frontExpiry: z.string(),
  backExpiry: z.string(),
  qty: z.number(),
  openNetDebit: z.number(),
  status: z.enum(["open", "closed"]),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  notes: z.string().nullable(),
});
export type CalendarResponse = z.infer<typeof calendarResponse>;

export const listCalendarsResponse = z.object({
  calendars: z.array(calendarResponse),
});
export type ListCalendarsResponse = z.infer<typeof listCalendarsResponse>;

export const closeCalendarRequest = z.object({
  closeNetCredit: z.number(),
});
export type CloseCalendarRequest = z.infer<typeof closeCalendarRequest>;

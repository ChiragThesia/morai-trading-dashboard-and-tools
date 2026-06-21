/**
 * CalendarEvent domain types — L1 trade ledger (Phase 5, D-06).
 *
 * These are pure domain types; no framework imports.
 * The CalendarEventType union mirrors calendarEventTypeEnum in schema.ts (adapter concern).
 */

// ─── CalendarEventType ────────────────────────────────────────────────────────

/**
 * CalendarEventType — the three first-class event types for a calendar spread.
 *   OPEN  — establishes or increases a position leg
 *   CLOSE — reduces or unwinds a position leg
 *   ROLL  — closes one expiry leg and opens a new expiry leg in a single trade (D-03)
 */
export type CalendarEventType = "OPEN" | "CLOSE" | "ROLL";

// ─── CalendarEvent ────────────────────────────────────────────────────────────

/**
 * CalendarEvent — domain representation of one OPEN, CLOSE, or ROLL event.
 *
 * - fillIdsHash: SHA-256 hex (64 chars) of sorted fill UUIDs that compose this event.
 *   Used as the unique idempotency key on calendar_events.fill_ids_hash.
 * - rolledFromOccSymbol: NULL for OPEN and CLOSE; set for ROLL (D-03 first-class roll chain).
 * - netAmount: OPEN debit = positive; CLOSE credit = negative (D-08).
 * - realizedPnl: populated on CLOSE and ROLL only (D-09). NULL on OPEN events.
 * - legBreakdown: JSON string with per-leg amounts for L3 attribution (D-09 hard requirement).
 */
export type CalendarEvent = {
  readonly id: string; // uuid
  readonly calendarId: string; // FK → calendars.id
  readonly eventType: CalendarEventType;
  readonly eventedAt: Date; // timestamp of the first fill in this event
  readonly fillIdsHash: string; // SHA-256 hex string, exactly 64 chars
  readonly legOccSymbol: string; // OCC symbol of the primary leg
  readonly rolledFromOccSymbol: string | null; // OLD leg's OCC symbol; NULL except on ROLL
  readonly qty: number; // aggregated quantity (D-04)
  readonly avgPrice: number; // qty-weighted average fill price (D-04)
  readonly netAmount: number; // D-08: OPEN debit positive; CLOSE credit negative
  readonly realizedPnl: number | null; // D-09: NULL on OPEN; populated on CLOSE/ROLL
  readonly legBreakdown: string | null; // JSON: { front: { qty, avgPrice, netAmount }, back: ... }
  readonly entryThesis: string | null; // D-07: free-text hook, set at OPEN time
};

// ─── RawFill ──────────────────────────────────────────────────────────────────

/**
 * RawFill — domain representation of a single broker fill from the fills table.
 *
 * This is the input type for the fill→event pairing domain functions.
 * Matches the fills table schema; adapters translate at the boundary.
 */
export type RawFill = {
  readonly id: string; // fill UUID
  readonly orderId: string; // broker order identifier (used for ROLL detection, D-03)
  readonly occSymbol: string; // OCC 21-char symbol (Schwab format or canonical)
  readonly side: "buy" | "sell";
  readonly qty: number;
  readonly price: number;
  readonly filledAt: Date;
  readonly commission: number | null;
  readonly fees: number | null;
};

// ─── AggregatedFill ───────────────────────────────────────────────────────────

/**
 * AggregatedFill — result of grouping and aggregating partial fills (D-04).
 *
 * Partial fills with the same (calendarId, legOccSymbol, orderId) are collapsed into one:
 *   sumQty = sum of individual qtys
 *   avgPrice = qty-weighted average price
 *   totalCommission = sum of commissions
 *   totalFees = sum of fees
 *
 * positionEffect drives OPEN/CLOSE/ROLL classification (classifyFill uses this + side).
 */
export type AggregatedFill = {
  readonly calendarId: string;
  readonly legOccSymbol: string; // canonical OCC symbol matched to calendar leg
  readonly orderId: string;
  readonly sumQty: number;
  readonly avgPrice: number;
  readonly totalCommission: number;
  readonly totalFees: number;
  readonly positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
  readonly fillIds: ReadonlyArray<string>; // fill UUIDs composing this group (for hashFillIds)
};

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
 * - rollOpenDebit / rollCloseCredit: WR-A1 structured ROLL split components. A ROLL stores a
 *   combined netAmount (openDebit − closeCredit); recompute needs the two legs separately so a
 *   roll's open-leg debit lands in openNetDebit and its close-leg credit in closeNetCredit.
 *   These are the explicit components recompute reads (NOT re-parsed from legBreakdown JSON).
 *   NULL for OPEN/CLOSE; set for ROLL.
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
  // WR-A1: structured ROLL split. NULL on OPEN/CLOSE; set on ROLL.
  readonly rollOpenDebit: number | null; // ROLL new-leg debit → openNetDebit on recompute
  readonly rollCloseCredit: number | null; // ROLL old-leg credit → closeNetCredit on recompute
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
  // journal-pnl-opennetdebit-units (round 4): the fill's OWN broker-reported OPENING/CLOSING
  // role (BrokerTransaction.legs[].positionEffect), carried through from the source instead of
  // re-derived from the calendar's current (mutable) status column at pairing time. A
  // calendar's `status` reflects its LATEST known state, not what a historical fill's role
  // was at trade time — deriving classification from status folded a calendar's real CLOSE
  // fills into OPEN events (or vice versa) whenever status hadn't kept pace with reality.
  readonly positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
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
 * positionEffect drives OPEN/CLOSE/ROLL classification (classifyFill uses this, not side).
 * side (journal-pnl-opennetdebit-units #2) drives netAmount's sign — the bucket's fills
 * share one order/leg, so they share one direction (buy or sell); carried through from the
 * first fill so syncFills can sign OPEN/CLOSE netAmount by ACTUAL direction, not by
 * classification alone (a calendar's OPEN legs include both a bought and a sold leg).
 *
 * positionEffect (journal-pnl-opennetdebit-units round 4) is likewise carried through from
 * the bucket's first fill's OWN broker-reported role — a bucket is one (calendarId,
 * legOccSymbol, orderId), so every fill in it shares one order on one leg, hence one real
 * positionEffect, exactly like orderId/legOccSymbol/side. It is NO LONGER supplied
 * externally by the caller from the calendar's current status column (that was the round-4
 * root cause: status reflects the calendar's LATEST state, not a historical fill's role).
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
  readonly side: "buy" | "sell";
  readonly fillIds: ReadonlyArray<string>; // fill UUIDs composing this group (for hashFillIds)
};

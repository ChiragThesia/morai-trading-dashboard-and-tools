/**
 * fill-pairing — pure domain functions for fill→event pairing (Phase 5, JRNL-01).
 *
 * Pure functions; no I/O. Only imports from intra-domain types and node:crypto.
 * No framework, no Drizzle, no adapters.
 *
 * Signatures are exported; function bodies throw "not implemented" so the type surface
 * compiles but all tests fail RED. Plan 05-03 provides the implementations.
 *
 * Decision references:
 *   D-02: classify OPEN/CLOSE using positionEffect + side
 *   D-03: ROLL is first-class (same orderId + different expiry)
 *   D-04: aggregate partial fills (sum qty, qty-weighted avg price)
 *   D-08/D-09: computePnl = closeCredit − openDebit − totalFees
 */

import { createHash } from "node:crypto";
import type { RawFill, AggregatedFill } from "./calendar-event.ts";

// Re-export types used by fill-pairing consumers
export type { RawFill, AggregatedFill };

/**
 * classifyFill — maps (side, positionEffect) to OPEN, CLOSE, or UNKNOWN (D-02).
 *
 * Classification logic:
 *   buy  + OPENING → OPEN  (bought to open long)
 *   sell + OPENING → OPEN  (sold to open short/spread)
 *   buy  + CLOSING → CLOSE (bought to close short)
 *   sell + CLOSING → CLOSE (sold to close long)
 *   any  + UNKNOWN → UNKNOWN (cross-check against calendar dates required)
 */
export function classifyFill(
  side: "buy" | "sell",
  positionEffect: "OPENING" | "CLOSING" | "UNKNOWN",
): "OPEN" | "CLOSE" | "UNKNOWN" {
  throw new Error("not implemented");
}

/**
 * aggregatePartialFills — group fills by (calendarId, legOccSymbol, orderId) and
 * compute sumQty, qty-weighted avgPrice, totalCommission, totalFees (D-04).
 *
 * The calendarId is NOT available on RawFill (it comes from the leg-matching step).
 * Grouping here is by (legOccSymbol, orderId) within the assumption that each RawFill
 * in the input array belongs to the same calendarId context. The full syncFills use-case
 * handles the per-calendar partitioning before calling this function.
 */
export function aggregatePartialFills(
  fills: ReadonlyArray<RawFill>,
): ReadonlyArray<AggregatedFill> {
  throw new Error("not implemented");
}

/**
 * computePnl — compute realized P&L from open debit, close credit, and total fees (D-08/D-09).
 *
 * realizedPnl = |closeCredit| - openDebit - totalFees
 *
 * Signs follow D-08 convention:
 *   openDebit   = positive (premium paid to open the calendar)
 *   closeCredit = positive (absolute value of the credit received on close)
 *   totalFees   = positive (commissions + exchange fees)
 */
export function computePnl(
  openDebit: number,
  closeCredit: number,
  totalFees: number,
): number {
  throw new Error("not implemented");
}

/**
 * detectRoll — determine whether a closing fill and an opening fill constitute a ROLL (D-03).
 *
 * A ROLL is detected when (for the same calendarId and orderId):
 *   - One fill closes the current front expiry leg (CLOSING)
 *   - Another fill opens a new back expiry leg (OPENING)
 *   - Same underlying + strike + option type, different expiry date
 *
 * OCC symbol comparison: legOccSymbol strings encode {root}{expiry}{type}{strike}.
 * Two OCC symbols with the same root/strike/type but different expiry = roll.
 *
 * Phase 5 implementation: orderId-only matching per RESEARCH Open Question 3 resolution.
 */
export function detectRoll(
  closing: AggregatedFill,
  opening: AggregatedFill,
): boolean {
  throw new Error("not implemented");
}

/**
 * hashFillIds — compute a deterministic SHA-256 hex string from a set of fill UUIDs (D-11).
 *
 * Algorithm: sort ids, join with ':', createHash("sha256"), digest("hex").
 * Result: exactly 64 hex characters (256 bits).
 *
 * This is the fillIdsHash idempotency key for calendar_events.fill_ids_hash UNIQUE constraint.
 * Re-running sync-fills against the same fill set produces the same hash → no-op insert.
 *
 * Uses node:crypto createHash (sync, available in both Bun and Node runtimes).
 * RESEARCH Open Question 1 resolution: createHash("sha256") preferred over crypto.subtle (async).
 */
export function hashFillIds(ids: ReadonlyArray<string>): string {
  throw new Error("not implemented");
}

// Suppress unused import warning — createHash is used in the implementation placeholder
// (the throw above prevents it from executing, but the import is intentional)
void createHash;

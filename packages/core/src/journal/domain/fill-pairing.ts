/**
 * fill-pairing — pure domain functions for fill→event pairing (Phase 5, JRNL-01).
 *
 * Pure functions; no I/O. Only imports from intra-domain types and node:crypto.
 * No framework, no Drizzle, no adapters.
 *
 * Decision references:
 *   D-02: classify OPEN/CLOSE using positionEffect + side
 *   D-03: ROLL is first-class (same orderId + different expiry)
 *   D-04: aggregate partial fills (sum qty, qty-weighted avg price)
 *   D-08/D-09: computePnl = closeCredit − openDebit − totalFees
 */

import { createHash } from "crypto";
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
  switch (positionEffect) {
    case "OPENING":
      return "OPEN";
    case "CLOSING":
      return "CLOSE";
    case "UNKNOWN":
      return "UNKNOWN";
  }
}

/**
 * aggregatePartialFills — group fills by (legOccSymbol, orderId) and
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
  type Accumulator = {
    legOccSymbol: string;
    orderId: string;
    sumQty: number;
    weightedPriceSum: number;
    totalCommission: number;
    totalFees: number;
    positionEffect: "OPENING" | "CLOSING" | "UNKNOWN";
    fillIds: string[];
  };

  const groups = new Map<string, Accumulator>();

  for (const fill of fills) {
    const key = `${fill.occSymbol}|${fill.orderId}`;
    const existing = groups.get(key);

    if (existing === undefined) {
      groups.set(key, {
        legOccSymbol: fill.occSymbol,
        orderId: fill.orderId,
        sumQty: fill.qty,
        weightedPriceSum: fill.qty * fill.price,
        totalCommission: fill.commission ?? 0,
        totalFees: fill.fees ?? 0,
        // Use side to determine positionEffect (not available on RawFill; default to UNKNOWN)
        // The syncFills use-case enriches fills with positionEffect before aggregation.
        // For partial fills arriving here, we set UNKNOWN as the safe default.
        positionEffect: "UNKNOWN",
        fillIds: [fill.id],
      });
    } else {
      existing.sumQty += fill.qty;
      existing.weightedPriceSum += fill.qty * fill.price;
      existing.totalCommission += fill.commission ?? 0;
      existing.totalFees += fill.fees ?? 0;
      existing.fillIds.push(fill.id);
    }
  }

  return Array.from(groups.values()).map((acc) => ({
    calendarId: "", // populated by the syncFills use-case which knows the calendarId
    legOccSymbol: acc.legOccSymbol,
    orderId: acc.orderId,
    sumQty: acc.sumQty,
    avgPrice: acc.sumQty > 0 ? acc.weightedPriceSum / acc.sumQty : 0,
    totalCommission: acc.totalCommission,
    totalFees: acc.totalFees,
    positionEffect: acc.positionEffect,
    fillIds: acc.fillIds,
  }));
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
  return Math.abs(closeCredit) - openDebit - totalFees;
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
 * ROLL_WINDOW_MS time-based fallback: reserved for future implementation when orderId
 * is absent (e.g. manual fills). Not implemented here as no test demands it yet.
 */
export function detectRoll(
  closing: AggregatedFill,
  opening: AggregatedFill,
): boolean {
  // Must be the same calendar and same order
  if (closing.calendarId !== opening.calendarId) return false;
  if (closing.orderId !== opening.orderId) return false;

  // Same OCC symbol = same expiry → not a roll (just a re-open of same leg)
  if (closing.legOccSymbol === opening.legOccSymbol) return false;

  // Different OCC symbol in same calendar + same order = roll
  // (underlying/strike/type match is implied by them being legs of the same calendar;
  //  the different expiry is encoded in the differing OCC symbol strings)
  return true;
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
  const sorted = [...ids].sort();
  const joined = sorted.join(":");
  return createHash("sha256").update(joined).digest("hex");
}

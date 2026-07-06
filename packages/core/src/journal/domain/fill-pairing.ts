/**
 * fill-pairing — pure domain functions for fill→event pairing (Phase 5, JRNL-01).
 *
 * Pure functions; no I/O, no framework, no Drizzle, no node builtins. Imports ONLY
 * @morai/shared and intra-domain types (architecture-boundaries.md §2; CLAUDE.md #1).
 *
 * Decision references:
 *   D-02: classify OPEN/CLOSE/UNKNOWN from positionEffect
 *   D-03: ROLL is first-class — same root+strike+type, DIFFERENT expiry, same orderId
 *   D-04: aggregate partial fills (sum qty, qty-weighted avg price)
 *   D-08/D-09: realizedPnl = closeCredit − originalOpenDebit − feesOnClose
 */

import { ok, err, parseOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { RawFill, AggregatedFill, CalendarEvent } from "./calendar-event.ts";

// Re-export types used by fill-pairing consumers
export type { RawFill, AggregatedFill };

// Error sentinel for a malformed aggregation (e.g. empty group, non-positive sumQty).
export type FillAggregationError = {
  readonly kind: "fill-aggregation-error";
  readonly message: string;
};

/**
 * classifyFill — map a positionEffect to OPEN, CLOSE, or UNKNOWN (D-02).
 *
 * positionEffect is the authoritative classification signal: OPENING→OPEN,
 * CLOSING→CLOSE, UNKNOWN→UNKNOWN. The raw fill `side` is not used here — it carries no
 * classification information beyond positionEffect, so a dead `side` param is omitted
 * (REVIEW WR-06: do not fabricate a side and feed it to a branch that ignores it).
 *
 * Note (journal-pnl-opennetdebit-units #2): `side` IS used elsewhere — it drives netAmount's
 * SIGN in syncFills.ts (via AggregatedFill.side, propagated by aggregatePartialFills below).
 * WR-06 only ruled out feeding it into THIS classification function; it is not a dead field.
 */
export function classifyFill(
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
 * aggregatePartialFills — collapse one pre-bucketed group of partial fills into a single
 * AggregatedFill (D-04). The caller (syncFills use-case) buckets by
 * (calendarId, legOccSymbol, orderId) and supplies the calendarId (the leg-match result);
 * everything else the bucket needs is read off its own fills.
 *
 * - sumQty = sum of individual qtys
 * - avgPrice = qty-weighted average price
 * - totalCommission/totalFees = summed (null treated as 0)
 * - side = the first fill's side (journal-pnl-opennetdebit-units #2): a bucket is one
 *   (calendarId, legOccSymbol, orderId) — one order on one leg — so every fill in it shares
 *   one broker-reported direction, exactly like orderId/legOccSymbol below.
 * - positionEffect = the first fill's OWN broker-reported role (journal-pnl-opennetdebit-units
 *   round 4) — NOT an externally-supplied value derived from the calendar's current status
 *   column (that was the round-4 root cause: a calendar's `status` reflects its LATEST known
 *   state, not what a historical fill's role was at trade time, so deriving classification
 *   from it folded real CLOSE fills into OPEN events, or vice versa, whenever status hadn't
 *   kept pace with reality). Same bucket-uniformity guarantee as side.
 *
 * Returns err(FillAggregationError) for an empty group or a non-positive sumQty — never
 * an avgPrice of 0 (REVIEW WR-03). The orderId/legOccSymbol/side/positionEffect are taken
 * from the first fill; the bucket key guarantees they are uniform within the group.
 */
export function aggregatePartialFills(
  fills: ReadonlyArray<RawFill>,
  calendarId: string,
): Result<AggregatedFill, FillAggregationError> {
  if (fills.length === 0) {
    return err({
      kind: "fill-aggregation-error",
      message: "cannot aggregate an empty fill group",
    });
  }

  let sumQty = 0;
  let weightedPriceSum = 0;
  let totalCommission = 0;
  let totalFees = 0;
  const fillIds: string[] = [];

  for (const fill of fills) {
    sumQty += fill.qty;
    weightedPriceSum += fill.qty * fill.price;
    totalCommission += fill.commission ?? 0;
    totalFees += fill.fees ?? 0;
    fillIds.push(fill.id);
  }

  if (sumQty <= 0) {
    return err({
      kind: "fill-aggregation-error",
      message: `non-positive aggregate quantity (sumQty=${sumQty})`,
    });
  }

  const first = fills[0];
  if (first === undefined) {
    return err({
      kind: "fill-aggregation-error",
      message: "fill group lost its first element",
    });
  }

  return ok({
    calendarId,
    legOccSymbol: first.occSymbol,
    orderId: first.orderId,
    sumQty,
    avgPrice: weightedPriceSum / sumQty,
    totalCommission,
    totalFees,
    positionEffect: first.positionEffect,
    side: first.side,
    fillIds,
  });
}

/**
 * computeRealizedPnl — realized P&L of the leg being closed (D-08/D-09).
 *
 *   realizedPnl = closeCredit − originalOpenDebit − feesOnClose
 *
 * Signs:
 *   closeCredit      = positive credit received on the close
 *   originalOpenDebit = positive debit recorded on the prior OPEN event for the leg
 *   feesOnClose      = positive commissions + fees paid on the closing fills only
 *
 * On a ROLL the new leg's premium is cost basis (netAmount), never passed here — the
 * roll's realized P&L reflects only the closed (old) leg (locked decision 2 / WR-01).
 */
export function computeRealizedPnl(
  closeCredit: number,
  originalOpenDebit: number,
  feesOnClose: number,
): number {
  return closeCredit - originalOpenDebit - feesOnClose;
}

/**
 * detectRoll — true when a closing and an opening aggregate are a ROLL (D-03).
 *
 * Requires: same calendarId, same orderId, and same root + strike + option type with a
 * DIFFERENT expiry (REVIEW WR-02 — the old "different OCC implies roll" assumption was
 * unsafe). A same-expiry pair, a different strike/type/root, or an unparseable symbol all
 * return false (a non-roll is safely emitted as separate events).
 *
 * legOccSymbol is the canonical OSI 21-char form (root space-padded to 6, YYMMDD, C/P,
 * 8-digit strike×1000) — the same form parseOccSymbol consumes and formatOccSymbol emits.
 */
export function detectRoll(
  closing: AggregatedFill,
  opening: AggregatedFill,
): boolean {
  if (closing.calendarId !== opening.calendarId) return false;
  if (closing.orderId !== opening.orderId) return false;

  const c = parseOccSymbol(closing.legOccSymbol);
  const o = parseOccSymbol(opening.legOccSymbol);
  if (!c.ok || !o.ok) return false;

  // Same instrument family: root, strike, and option type must all match.
  if (c.value.root !== o.value.root) return false;
  if (c.value.strike !== o.value.strike) return false;
  if (c.value.type !== o.value.type) return false;

  // A roll moves to a DIFFERENT expiry. Same expiry is not a roll.
  return c.value.expiry.getTime() !== o.value.expiry.getTime();
}

/**
 * hashFillIds — deterministic idempotency key from a set of fill ids (D-11).
 *
 * Pure reference algorithm: sort ids, join with ':', delegate the hashing to an INJECTED
 * hasher (C1 — fixes CR-01). The hasher (an `HashFillIds`-compatible string→string
 * function) is supplied by the adapter as a sha256-hex implementation (plan 05-13); the
 * pure domain stays free of any node:crypto import.
 *
 * The adapter's hasher MUST produce a 64-char sha256 hex string for the
 * calendar_events.fill_ids_hash UNIQUE constraint. Re-running sync against the same fill
 * set yields the same canonical string and therefore the same hash → no-op insert.
 */
export function hashFillIds(
  ids: ReadonlyArray<string>,
  hasher: (input: string) => string,
): string {
  const sorted = [...ids].sort();
  const joined = sorted.join(":");
  return hasher(joined);
}

/**
 * resolveFillMatches — disambiguate fills whose OCC symbol matches more than one calendar's
 * leg (journal-pnl-opennetdebit-units round 5, bug 1).
 *
 * A leg symbol can be shared by two DIFFERENT calendars (e.g. the same front-month contract
 * reused by two calendar spreads opened at different times) — readCalendarLegs then returns
 * 2+ candidates for every fill on that symbol, for EITHER calendar. Naively orphan-parking
 * every such fill (the old behavior) silently drops one calendar's real economics (it keeps
 * only its unique leg — see the debug session's back-leg-only symptom).
 *
 * The disambiguating signal: a calendar's OPENING (and CLOSING) broker order contains BOTH
 * its legs together. Within one order, a leg matching EXACTLY ONE calendar (an "anchor")
 * tells us which calendar every OTHER fill in that SAME order belongs to. An ambiguous fill
 * is resolved to its order's anchor ONLY IF that calendarId is one of its own candidates AND
 * the order has exactly one anchor calendarId; otherwise it stays ambiguous — never guessed
 * (D-05/WR-01).
 */
export type FillMatchCandidate = {
  readonly calendarId: string;
  readonly legOccSymbol: string;
};

export type FillMatchInput = {
  readonly fill: RawFill;
  readonly candidates: ReadonlyArray<FillMatchCandidate>;
};

export type ResolvedFillMatch =
  | { readonly kind: "matched"; readonly fill: RawFill; readonly leg: FillMatchCandidate }
  | { readonly kind: "no-match"; readonly fill: RawFill }
  | {
      readonly kind: "ambiguous";
      readonly fill: RawFill;
      readonly candidates: ReadonlyArray<FillMatchCandidate>;
    };

export function resolveFillMatches(
  entries: ReadonlyArray<FillMatchInput>,
): ReadonlyArray<ResolvedFillMatch> {
  // Find each order's anchor calendarId(s): calendarIds that are the SOLE candidate for
  // some fill in that order.
  const anchorsByOrder = new Map<string, Set<string>>();
  for (const { fill, candidates } of entries) {
    if (candidates.length !== 1) continue;
    const only = candidates[0];
    if (only === undefined) continue;
    const set = anchorsByOrder.get(fill.orderId) ?? new Set<string>();
    set.add(only.calendarId);
    anchorsByOrder.set(fill.orderId, set);
  }

  return entries.map(({ fill, candidates }): ResolvedFillMatch => {
    if (candidates.length === 0) return { kind: "no-match", fill };
    if (candidates.length === 1) {
      const only = candidates[0];
      if (only === undefined) return { kind: "no-match", fill };
      return { kind: "matched", fill, leg: only };
    }
    // Ambiguous: try to resolve via this fill's order anchor.
    const anchors = anchorsByOrder.get(fill.orderId);
    if (anchors !== undefined && anchors.size === 1) {
      const [anchorCalendarId] = anchors;
      const resolvedLeg = candidates.find((c) => c.calendarId === anchorCalendarId);
      if (resolvedLeg !== undefined) return { kind: "matched", fill, leg: resolvedLeg };
    }
    return { kind: "ambiguous", fill, candidates };
  });
}

/**
 * isCalendarFullyClosed — true when a calendar's full event history nets to a flat (zero)
 * position on every leg it has touched (journal-pnl-opennetdebit-units round 5, bug 2).
 *
 * OPEN increases a leg's net qty; CLOSE decreases it; ROLL decreases the rolled-from leg and
 * increases the new leg. A calendar with events but zero net qty on every touched leg is
 * fully closed — regardless of its stored `status` column (the exact bug: `status` can go
 * stale and never reflect events proving the position was unwound, e.g. 65aac62e).
 */
export function isCalendarFullyClosed(events: ReadonlyArray<CalendarEvent>): boolean {
  if (events.length === 0) return false;

  const netQtyByLeg = new Map<string, number>();
  const bump = (legOccSymbol: string, delta: number): void => {
    netQtyByLeg.set(legOccSymbol, (netQtyByLeg.get(legOccSymbol) ?? 0) + delta);
  };

  let hasOpen = false;
  for (const e of events) {
    switch (e.eventType) {
      case "OPEN":
        bump(e.legOccSymbol, e.qty);
        hasOpen = true;
        break;
      case "CLOSE":
        bump(e.legOccSymbol, -e.qty);
        break;
      case "ROLL":
        if (e.rolledFromOccSymbol !== null) bump(e.rolledFromOccSymbol, -e.qty);
        bump(e.legOccSymbol, e.qty);
        hasOpen = true;
        break;
    }
  }

  if (!hasOpen) return false;
  return [...netQtyByLeg.values()].every((qty) => qty === 0);
}

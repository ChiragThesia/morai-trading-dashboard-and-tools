/**
 * syncFills.ts — pair broker fills into calendar OPEN/CLOSE/ROLL events (JRNL-01).
 *
 * Orchestration (RESEARCH §Fill→Event Pairing Logic):
 *   1. readUnprocessedFills
 *   2. Per fill: match to calendar leg via readCalendarLegs(fill.occSymbol)
 *      - 0 matches → park as orphan, reason "no matching calendar" (D-05)
 *      - 2+ matches → park as orphan, reason "ambiguous calendar" (Pitfall 6)
 *      - 1 match → proceed
 *   3. Group fills by (calendarId, legOccSymbol, orderId) — partial fill buckets (D-04)
 *   4. aggregatePartialFills per bucket; enrich calendarId + positionEffect from leg
 *   5. classifyFill (OPENING→OPEN, CLOSING→CLOSE, UNKNOWN→orphan) per aggregated fill
 *   6. detectRoll: same calendarId + same orderId + different legOccSymbol → ONE ROLL event (D-03)
 *   7. computeRealizedPnl on CLOSE/ROLL using the prior OPEN event's debit (B1); build
 *      legBreakdown JSON
 *   8. deps.hashFillIds → fillIdsHash; storeCalendarEvent (idempotent via UNIQUE constraint)
 *   9. WR-A2: deps.markFillsProcessed for the event's composing fills (and for parked orphans)
 *      so they are never re-read. Each fill is incorporated into exactly ONE event; later fills
 *      for the same order/leg arrive unprocessed and form a NEW event covering only the new
 *      fills — no fill is double-counted, and the lifetime fills table is never re-paired.
 *
 * Ids and fill-id hashes are injected (deps.newId / deps.hashFillIds, C1) so this core file
 * imports no node:crypto — the adapter supplies the real uuid/sha256 (plan 05-13).
 *
 * Architecture (architecture-boundaries.md):
 *   - Pure core: no I/O, no framework, no Drizzle.
 *   - OCC symbol validation is an adapter concern; the fills port receives pre-matched strings.
 *   - Per-item failures → orphan parking only (D-05); no use-case abort on individual misses.
 *   - Only StorageError from store ports propagates to the caller.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  classifyFill,
  aggregatePartialFills,
  detectRoll,
  computeRealizedPnl,
} from "../domain/fill-pairing.ts";
import type {
  ForStoringCalendarEvent,
  ForReadingUnprocessedFills,
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  ForReadingCalendarEvents,
  ForMarkingFillsProcessed,
  NewId,
  HashFillIds,
  StorageError,
  CalendarLegEntry,
} from "./ports.ts";
import type { RawFill, AggregatedFill, CalendarEvent } from "../domain/calendar-event.ts";

// ─── Deps types ───────────────────────────────────────────────────────────────

// Shared pairing dependencies — everything the pairing pipeline needs except the
// fills source. Both the full-sweep and the calendar-scoped factories supply these.
type PairingDeps = {
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly storeOrphanFill: ForStoringOrphanFill;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  // B1: read prior OPEN events for a calendar to find originalOpenDebit on CLOSE/ROLL.
  readonly readCalendarEvents: ForReadingCalendarEvents;
  // WR-A2: stamp a bucket's fills processed once its event is stored (and parked orphans
  // processed too) so the next sync never re-reads them. Each fill lands in exactly ONE event;
  // later fills for the same order/leg form a NEW event over only the new fills (no double-count).
  readonly markFillsProcessed: ForMarkingFillsProcessed;
  // C1: injected id minter + fill-ids hasher — core imports no node builtin hasher.
  readonly newId: NewId;
  readonly hashFillIds: HashFillIds;
  readonly now: () => Date;
};

// Full-sweep deps: read ALL unprocessed fills across every calendar.
export type SyncFillsDeps = PairingDeps & {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
};

// A2/CR-04 — calendar-scoped deps: read ONLY the target calendar's unprocessed fills,
// so rebuild-journal re-pairs exactly one calendar (delete scope == sync scope).
export type SyncFillsForCalendarDeps = PairingDeps & {
  readonly readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar;
};

// Driver port type for the full-sweep use-case
export type ForRunningSyncFills = () => Promise<Result<void, StorageError>>;

// A2/CR-04 — scoped driver type exported for 05-13 wiring as `syncFillsForCalendar`.
export type ForRunningSyncFillsForCalendar = (
  calendarId: string,
) => Promise<Result<void, StorageError>>;

// ─── Internal types ───────────────────────────────────────────────────────────

type MatchedFill = {
  readonly fill: RawFill;
  readonly leg: CalendarLegEntry;
};

// Aggregated fill enriched with calendar context, classification, and the underlying
// raw fills (carried so the UNKNOWN branch can park each fill individually — B5).
type ClassifiedFill = AggregatedFill & {
  readonly classification: "OPEN" | "CLOSE" | "UNKNOWN";
  readonly rawFills: ReadonlyArray<RawFill>;
};

// ─── Pairing pipeline (shared by full-sweep + calendar-scoped use-cases) ───────

async function pairFills(
  deps: PairingDeps,
  fills: ReadonlyArray<RawFill>,
): Promise<Result<void, StorageError>> {
  if (fills.length === 0) return ok(undefined);

  // Steps 2: Match each fill to a calendar leg
  const matched: MatchedFill[] = [];

  for (const fill of fills) {
    const legsResult = await deps.readCalendarLegs(fill.occSymbol);
    if (!legsResult.ok) return err(legsResult.error);

    const legs = legsResult.value;

    if (legs.length === 0) {
      const orphanResult = await deps.storeOrphanFill({
        fillId: fill.id,
        occSymbol: fill.occSymbol,
        side: fill.side,
        qty: fill.qty,
        price: fill.price,
        filledAt: fill.filledAt,
        reason: "no matching calendar",
      });
      if (!orphanResult.ok) return err(orphanResult.error);
      // WR-A2: parked → processed, so it is not re-read next sync.
      const markedResult = await deps.markFillsProcessed([fill.id]);
      if (!markedResult.ok) return err(markedResult.error);
      continue;
    }

    if (legs.length > 1) {
      // Pitfall 6: ambiguous calendar — never auto-assign
      const calIds = legs.map((l) => l.calendarId).join(", ");
      const orphanResult = await deps.storeOrphanFill({
        fillId: fill.id,
        occSymbol: fill.occSymbol,
        side: fill.side,
        qty: fill.qty,
        price: fill.price,
        filledAt: fill.filledAt,
        reason: `ambiguous calendar: [${calIds}]`,
      });
      if (!orphanResult.ok) return err(orphanResult.error);
      // WR-A2: parked → processed.
      const markedResult = await deps.markFillsProcessed([fill.id]);
      if (!markedResult.ok) return err(markedResult.error);
      continue;
    }

    const leg = legs[0];
    if (leg === undefined) continue;
    matched.push({ fill, leg });
  }

  if (matched.length === 0) return ok(undefined);

  // Step 3: Group by (calendarId, legOccSymbol, orderId) for partial fill aggregation (D-04)
  type BucketEntry = { fills: RawFill[]; leg: CalendarLegEntry };
  const buckets = new Map<string, BucketEntry>();

  for (const { fill, leg } of matched) {
    const key = `${leg.calendarId}|${leg.legOccSymbol}|${fill.orderId}`;
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, { fills: [fill], leg });
    } else {
      existing.fills.push(fill);
    }
  }

  // Step 4-5: Aggregate and classify fills
  const classified: ClassifiedFill[] = [];

  for (const { fills: bucketFills, leg } of buckets.values()) {
    const aggResult = aggregatePartialFills(
      bucketFills,
      leg.calendarId,
      leg.positionEffect,
    );
    if (!aggResult.ok) {
      // Malformed bucket (empty / non-positive qty) — park its fills as orphans (D-05),
      // never silently drop. Full per-fill parking with real fields lands in 05-11 (B5).
      for (const fill of bucketFills) {
        const orphanResult = await deps.storeOrphanFill({
          fillId: fill.id,
          occSymbol: fill.occSymbol,
          side: fill.side,
          qty: fill.qty,
          price: fill.price,
          filledAt: fill.filledAt,
          reason: `aggregation error: ${aggResult.error.message}`,
        });
        if (!orphanResult.ok) return err(orphanResult.error);
      }
      // WR-A2: all parked bucket fills → processed.
      const markedResult = await deps.markFillsProcessed(
        bucketFills.map((f) => f.id),
      );
      if (!markedResult.ok) return err(markedResult.error);
      continue;
    }
    const enriched: AggregatedFill = {
      ...aggResult.value,
      legOccSymbol: leg.legOccSymbol,
    };
    const classification = classifyFill(enriched.positionEffect);
    classified.push({ ...enriched, classification, rawFills: bucketFills });
  }

  // B1: prior-OPEN-debit lookup. Cache calendar_events per calendarId so we read each
  // calendar's events at most once, then find the OPEN event for the closed leg to pin
  // originalOpenDebit. Returns null when no prior OPEN exists → realizedPnl stays null
  // (locked decision 2 / WR-01: never report a wrong number).
  const priorEventsCache = new Map<string, ReadonlyArray<CalendarEvent>>();
  async function originalOpenDebitFor(
    calendarId: string,
    legOccSymbol: string,
  ): Promise<Result<number | null, StorageError>> {
    let events = priorEventsCache.get(calendarId);
    if (events === undefined) {
      const eventsResult = await deps.readCalendarEvents(calendarId);
      if (!eventsResult.ok) return err(eventsResult.error);
      events = eventsResult.value;
      priorEventsCache.set(calendarId, events);
    }
    const open = events.find(
      (e) => e.eventType === "OPEN" && e.legOccSymbol === legOccSymbol,
    );
    // OPEN netAmount is the original open debit (positive, D-08).
    return ok(open === undefined ? null : open.netAmount);
  }

  // Step 6: ROLL detection
  // Group by (calendarId|orderId) to find CLOSE+OPEN pairs with different legOccSymbol
  type OrderGroup = { closes: ClassifiedFill[]; opens: ClassifiedFill[] };
  const orderGroups = new Map<string, OrderGroup>();

  for (const cf of classified) {
    const key = `${cf.calendarId}|${cf.orderId}`;
    const group = orderGroups.get(key) ?? { closes: [], opens: [] };
    if (cf.classification === "CLOSE") {
      group.closes.push(cf);
    } else if (cf.classification === "OPEN") {
      group.opens.push(cf);
    }
    orderGroups.set(key, group);
  }

  // Pre-pair ROLLs BEFORE emitting (input-order independence). A CLOSE and an OPEN in the
  // same (calendarId, orderId) on different legs form ONE ROLL (D-03). This must be decided up
  // front: classified is iterated in bucket-insertion order, so an OPEN that will be consumed
  // by a later CLOSE would otherwise be emitted eagerly as a standalone OPEN AND folded into
  // the ROLL — double-counting that OPEN's fills (caught by the P1 no-double-count property).
  // Matching is deterministic: within each order group, pair closes to not-yet-consumed opens
  // in classified order.
  const rollPairing = new Map<ClassifiedFill, ClassifiedFill>(); // close → its paired open
  const consumedOpens = new Set<ClassifiedFill>();
  for (const cf of classified) {
    if (cf.classification !== "CLOSE") continue;
    const group = orderGroups.get(`${cf.calendarId}|${cf.orderId}`);
    const paired = group?.opens.find(
      (o) => !consumedOpens.has(o) && detectRoll(cf, o),
    );
    if (paired !== undefined) {
      rollPairing.set(cf, paired);
      consumedOpens.add(paired);
    }
  }

  // Steps 7-8: Emit events
  for (const cf of classified) {
    // UNKNOWN positionEffect → orphan (D-02: cross-check with calendar dates is adapter concern).
    // B5/WR-07: park EACH underlying raw fill individually with its real side + filledAt and
    // its real UUID — never a synthesized `agg-unknown-${orderId}` PK, and never drop siblings.
    if (cf.classification === "UNKNOWN") {
      if (cf.rawFills.length === 0) {
        // A malformed aggregate with no underlying fills cannot be parked without
        // fabricating a PK — surface an error rather than synthesize one (WR-07).
        return err({
          kind: "storage-error",
          message: `UNKNOWN aggregate for order ${cf.orderId} has no underlying fills to park`,
        });
      }
      for (const fill of cf.rawFills) {
        const orphanResult = await deps.storeOrphanFill({
          fillId: fill.id,
          occSymbol: fill.occSymbol,
          side: fill.side,
          qty: fill.qty,
          price: fill.price,
          filledAt: fill.filledAt,
          reason: "unknown positionEffect — cannot classify without calendar context",
        });
        if (!orphanResult.ok) return err(orphanResult.error);
      }
      // WR-A2: all parked raw fills → processed.
      const markedResult = await deps.markFillsProcessed(
        cf.rawFills.map((f) => f.id),
      );
      if (!markedResult.ok) return err(markedResult.error);
      continue;
    }

    // If this OPEN was already consumed by a ROLL, skip it
    if (cf.classification === "OPEN" && consumedOpens.has(cf)) {
      continue;
    }

    // Check for ROLL: CLOSE fill pre-paired with an OPEN in the same (calendarId, orderId).
    if (cf.classification === "CLOSE") {
      const paired = rollPairing.get(cf);

      if (paired !== undefined) {
        {
          // ONE ROLL event referencing both legs (D-03)
          const allFillIds = [...cf.fillIds, ...paired.fillIds];
          const fillIdsHash = deps.hashFillIds(allFillIds);

          // P&L: close leg provides credit; open leg provides new debit (D-08/D-09).
          // realizedPnl reflects ONLY the closed (old) leg:
          //   closeCredit − originalOpenDebit − feesOnClose.
          // The new leg's debit is cost basis / netAmount, NOT subtracted (locked decision 2).
          //
          // D-08 (fix, journal-pnl-opennetdebit-units #2 ROLL follow-up): both legs signed by
          // their ACTUAL fill direction (cf.side / paired.side), mirroring the OPEN/CLOSE
          // convention below — NOT an unconditional Math.abs/positive assumption. A roll's
          // closed leg can be bought-to-close (a DEBIT paid, e.g. buying back a previously
          // sold-to-open short) — closeCredit must go NEGATIVE, not stay a positive "credit".
          // Likewise the new leg can be sold-to-open (a CREDIT received) — openDebit must go
          // NEGATIVE, not stay a positive "debit". recomputeCalendarAmounts sums
          // rollCloseCredit/rollOpenDebit directly (no re-negation), so they must already carry
          // the same positive=credit/negative=debit (closeCredit) and
          // positive=debit/negative=credit (openDebit) conventions as CLOSE/OPEN netAmount.
          const closeCredit =
            cf.side === "sell"
              ? cf.avgPrice * cf.sumQty // credit received (sold-to-close)
              : -(cf.avgPrice * cf.sumQty); // debit paid (bought-to-close)
          const openDebit =
            paired.side === "sell"
              ? -(paired.avgPrice * paired.sumQty) // credit received (sold-to-open)
              : paired.avgPrice * paired.sumQty; // debit paid (bought-to-open)
          const feesOnClose = cf.totalCommission + cf.totalFees;

          // B1/WR-01: originalOpenDebit comes from the prior OPEN event for the CLOSED leg.
          const debitResult = await originalOpenDebitFor(cf.calendarId, cf.legOccSymbol);
          if (!debitResult.ok) return err(debitResult.error);
          const originalOpenDebit = debitResult.value;
          const realizedPnl: number | null =
            originalOpenDebit === null
              ? null // no prior OPEN → never a wrong number
              : computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose);

          // legBreakdown's per-leg netAmount mirrors the debit-positive/credit-negative
          // convention used everywhere else (OPEN/CLOSE netAmount): closing.netAmount is
          // the negation of the (now correctly-signed) closeCredit; opening.netAmount is
          // openDebit directly — same values already computed above, same sign fix.
          const legBreakdown = JSON.stringify({
            closing: {
              legOccSymbol: cf.legOccSymbol,
              qty: cf.sumQty,
              avgPrice: cf.avgPrice,
              netAmount: -closeCredit,
              totalFees: cf.totalCommission + cf.totalFees,
            },
            opening: {
              legOccSymbol: paired.legOccSymbol,
              qty: paired.sumQty,
              avgPrice: paired.avgPrice,
              netAmount: openDebit,
              totalFees: paired.totalCommission + paired.totalFees,
            },
          });

          const rollEvent: CalendarEvent = {
            id: deps.newId(),
            calendarId: cf.calendarId,
            eventType: "ROLL",
            eventedAt: deps.now(),
            fillIdsHash,
            // legOccSymbol = new leg (the OPEN leg); rolledFromOccSymbol = old leg (D-03)
            legOccSymbol: paired.legOccSymbol,
            rolledFromOccSymbol: cf.legOccSymbol,
            qty: paired.sumQty,
            avgPrice: paired.avgPrice,
            // Net ROLL amount: net debit/credit of both legs combined
            netAmount: openDebit - closeCredit,
            realizedPnl,
            legBreakdown,
            entryThesis: null,
            // WR-A1: structured split — recompute reads these (open-leg debit → openNetDebit,
            // close-leg credit → closeNetCredit), not the combined sign-bucketed netAmount.
            rollOpenDebit: openDebit,
            rollCloseCredit: closeCredit,
          };

          const storeResult = await deps.storeCalendarEvent(rollEvent);
          if (!storeResult.ok) return err(storeResult.error);
          // WR-A2: both legs' composing fills are now in exactly ONE event → processed.
          const markedResult = await deps.markFillsProcessed(allFillIds);
          if (!markedResult.ok) return err(markedResult.error);
          continue;
        }
      }
    }

    // Emit OPEN or CLOSE event
    const fillIdsHash = deps.hashFillIds(cf.fillIds);
    const isClose = cf.classification === "CLOSE";

    // D-08 (fix, journal-pnl-opennetdebit-units #2): netAmount signed by the ACTUAL fill
    // direction (cf.side) — NOT by OPEN/CLOSE classification alone. A calendar's OPEN legs
    // include both a bought leg (debit) and a sold leg (credit); signing purely by
    // classification made every OPEN leg a positive debit regardless of direction, so
    // recomputeCalendarAmounts summed two debits instead of netting a debit against a
    // credit (e.g. bought +159.41, sold +127.06 -> wrongly summed 286.47 instead of the
    // true net debit 32.35).
    const netAmount =
      cf.side === "sell"
        ? -(cf.avgPrice * cf.sumQty) // credit received = negative
        : cf.avgPrice * cf.sumQty;   // debit paid = positive

    // D-09 (B1/WR-01): realizedPnl = closeCredit − originalOpenDebit − feesOnClose on CLOSE.
    // originalOpenDebit is read from the prior OPEN event for the leg; when no prior OPEN
    // exists realizedPnl is null (locked decision 2: never report a wrong number). OPEN
    // events carry null realizedPnl by definition.
    let realizedPnl: number | null = null;
    if (isClose) {
      // closeCredit is the negation of the (now correctly-signed) CLOSE netAmount: positive
      // when the close was a sell (credit received), negative when it was a buy (a debit
      // paid to close a previously sold-to-open leg) — mirrors originalOpenDebit's sign
      // convention so a short leg's realizedPnl nets correctly too (journal-pnl-opennetdebit-units #2).
      const closeCredit = -netAmount;
      const feesOnClose = cf.totalCommission + cf.totalFees;
      const debitResult = await originalOpenDebitFor(cf.calendarId, cf.legOccSymbol);
      if (!debitResult.ok) return err(debitResult.error);
      const originalOpenDebit = debitResult.value;
      realizedPnl =
        originalOpenDebit === null
          ? null
          : computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose);
    }

    // D-09 hard requirement: legBreakdown on CLOSE/ROLL
    const legBreakdown = isClose
      ? JSON.stringify({
          leg: {
            legOccSymbol: cf.legOccSymbol,
            qty: cf.sumQty,
            avgPrice: cf.avgPrice,
            netAmount,
            totalFees: cf.totalCommission + cf.totalFees,
          },
        })
      : null;

    const event: CalendarEvent = {
      id: deps.newId(),
      calendarId: cf.calendarId,
      eventType: cf.classification,
      eventedAt: deps.now(),
      fillIdsHash,
      legOccSymbol: cf.legOccSymbol,
      rolledFromOccSymbol: null,
      qty: cf.sumQty,
      avgPrice: cf.avgPrice,
      netAmount,
      realizedPnl,
      legBreakdown,
      entryThesis: null,
      // WR-A1: OPEN/CLOSE carry no roll split.
      rollOpenDebit: null,
      rollCloseCredit: null,
    };

    const storeResult = await deps.storeCalendarEvent(event);
    if (!storeResult.ok) return err(storeResult.error);
    // WR-A2: the bucket's fills are now in exactly ONE event → processed.
    const markedResult = await deps.markFillsProcessed(cf.fillIds);
    if (!markedResult.ok) return err(markedResult.error);
  }

  return ok(undefined);
}

// ─── Use-case factories ────────────────────────────────────────────────────────

/**
 * makeSyncFillsUseCase — full-sweep sync: reads ALL unprocessed fills across every
 * calendar and pairs them into OPEN/CLOSE/ROLL events.
 */
export function makeSyncFillsUseCase(deps: SyncFillsDeps): ForRunningSyncFills {
  return async (): Promise<Result<void, StorageError>> => {
    const fillsResult = await deps.readUnprocessedFills();
    if (!fillsResult.ok) return err(fillsResult.error);
    return pairFills(deps, fillsResult.value);
  };
}

/**
 * makeSyncFillsForCalendarUseCase — A2/CR-04 calendar-scoped sync: reads ONLY the target
 * calendar's unprocessed fills and pairs them, so rebuild-journal re-pairs exactly one
 * calendar. The delete scope and the sync scope agree (no cross-calendar event bleed).
 */
export function makeSyncFillsForCalendarUseCase(
  deps: SyncFillsForCalendarDeps,
): ForRunningSyncFillsForCalendar {
  return async (calendarId: string): Promise<Result<void, StorageError>> => {
    const fillsResult = await deps.readUnprocessedFillsForCalendar(calendarId);
    if (!fillsResult.ok) return err(fillsResult.error);
    return pairFills(deps, fillsResult.value);
  };
}

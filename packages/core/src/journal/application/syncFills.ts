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
 *   7. computePnl on CLOSE/ROLL (D-08/D-09); build legBreakdown JSON
 *   8. hashFillIds → fillIdsHash; storeCalendarEvent (idempotent via UNIQUE constraint)
 *
 * Architecture (architecture-boundaries.md):
 *   - Pure core: no I/O, no framework, no Drizzle.
 *   - OCC symbol validation is an adapter concern; the fills port receives pre-matched strings.
 *   - Per-item failures → orphan parking only (D-05); no use-case abort on individual misses.
 *   - Only StorageError from store ports propagates to the caller.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { createHash, randomUUID } from "crypto";
import {
  classifyFill,
  aggregatePartialFills,
  detectRoll,
  hashFillIds,
} from "../domain/fill-pairing.ts";
import type {
  ForStoringCalendarEvent,
  ForReadingUnprocessedFills,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  StorageError,
  CalendarLegEntry,
} from "./ports.ts";
import type { RawFill, AggregatedFill, CalendarEvent } from "../domain/calendar-event.ts";

// ─── Deps type ────────────────────────────────────────────────────────────────

export type SyncFillsDeps = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly storeCalendarEvent: ForStoringCalendarEvent;
  readonly storeOrphanFill: ForStoringOrphanFill;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly now: () => Date;
};

// Driver port type for this use-case
export type ForRunningSyncFills = () => Promise<Result<void, StorageError>>;

// ─── Internal types ───────────────────────────────────────────────────────────

type MatchedFill = {
  readonly fill: RawFill;
  readonly leg: CalendarLegEntry;
};

// Aggregated fill enriched with calendar context and classification
type ClassifiedFill = AggregatedFill & {
  readonly classification: "OPEN" | "CLOSE" | "UNKNOWN";
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Interim sha256 hasher passed to the pure-domain hashFillIds. Plan 05-11 replaces this
// with an injected `deps.hashFillIds` port so this use-case imports no crypto builtin (C1).
function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ─── Use-case factory ─────────────────────────────────────────────────────────

export function makeSyncFillsUseCase(deps: SyncFillsDeps): ForRunningSyncFills {
  return async (): Promise<Result<void, StorageError>> => {
    const now = deps.now();

    // Step 1: Read unprocessed fills
    const fillsResult = await deps.readUnprocessedFills();
    if (!fillsResult.ok) return err(fillsResult.error);

    const fills = fillsResult.value;
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
        continue;
      }
      const enriched: AggregatedFill = {
        ...aggResult.value,
        legOccSymbol: leg.legOccSymbol,
      };
      const classification = classifyFill(enriched.positionEffect);
      classified.push({ ...enriched, classification });
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

    // Track which opens were consumed by a ROLL so we don't emit them separately
    const consumedOpens = new Set<ClassifiedFill>();

    // Steps 7-8: Emit events
    for (const cf of classified) {
      // UNKNOWN positionEffect → orphan (D-02: cross-check with calendar dates is adapter concern)
      if (cf.classification === "UNKNOWN") {
        const firstFillId = cf.fillIds[0] ?? `agg-unknown-${cf.orderId}`;
        const orphanResult = await deps.storeOrphanFill({
          fillId: firstFillId,
          occSymbol: cf.legOccSymbol,
          side: "buy",
          qty: cf.sumQty,
          price: cf.avgPrice,
          filledAt: now,
          reason: "unknown positionEffect — cannot classify without calendar context",
        });
        if (!orphanResult.ok) return err(orphanResult.error);
        continue;
      }

      // If this OPEN was already consumed by a ROLL, skip it
      if (cf.classification === "OPEN" && consumedOpens.has(cf)) {
        continue;
      }

      // Check for ROLL: CLOSE fill paired with an OPEN in the same (calendarId, orderId)
      if (cf.classification === "CLOSE") {
        const groupKey = `${cf.calendarId}|${cf.orderId}`;
        const group = orderGroups.get(groupKey);
        const paired = group?.opens.find((o) => !consumedOpens.has(o));

        if (paired !== undefined) {
          // detectRoll verifies: same calendarId + same orderId + different legOccSymbol
          const isRoll = detectRoll(cf, paired);
          if (isRoll) {
            consumedOpens.add(paired);

            // ONE ROLL event referencing both legs (D-03)
            const allFillIds = [...cf.fillIds, ...paired.fillIds];
            const fillIdsHash = hashFillIds(allFillIds, sha256Hex);

            // P&L: close leg provides credit; open leg provides new debit (D-08/D-09).
            // realizedPnl reflects ONLY the closed leg:
            //   closeCredit − originalOpenDebit − feesOnClose.
            // The prior-OPEN lookup that supplies originalOpenDebit is wired in 05-11; until
            // then realizedPnl is null (locked decision 2: never report a wrong number).
            const closeCredit = Math.abs(cf.avgPrice * cf.sumQty);
            const openDebit = paired.avgPrice * paired.sumQty;
            const realizedPnl: number | null = null;

            const legBreakdown = JSON.stringify({
              closing: {
                legOccSymbol: cf.legOccSymbol,
                qty: cf.sumQty,
                avgPrice: cf.avgPrice,
                netAmount: -(cf.avgPrice * cf.sumQty),
                totalFees: cf.totalCommission + cf.totalFees,
              },
              opening: {
                legOccSymbol: paired.legOccSymbol,
                qty: paired.sumQty,
                avgPrice: paired.avgPrice,
                netAmount: paired.avgPrice * paired.sumQty,
                totalFees: paired.totalCommission + paired.totalFees,
              },
            });

            const rollEvent: CalendarEvent = {
              id: randomUUID(),
              calendarId: cf.calendarId,
              eventType: "ROLL",
              eventedAt: now,
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
            };

            const storeResult = await deps.storeCalendarEvent(rollEvent);
            if (!storeResult.ok) return err(storeResult.error);
            continue;
          }
        }
      }

      // Emit OPEN or CLOSE event
      const fillIdsHash = hashFillIds(cf.fillIds, sha256Hex);
      const isClose = cf.classification === "CLOSE";

      // D-08: OPEN debit = positive; CLOSE credit = negative
      const netAmount = isClose
        ? -(cf.avgPrice * cf.sumQty) // credit received = negative
        : cf.avgPrice * cf.sumQty;   // debit paid = positive

      // D-09: realizedPnl = closeCredit − originalOpenDebit − feesOnClose on CLOSE.
      // The prior-OPEN lookup that supplies originalOpenDebit is wired in 05-11 (via the
      // ForReadingCalendarEvents + computeRealizedPnl path); until then realizedPnl is null
      // (locked decision 2: never report a wrong number when originalOpenDebit is unknown).
      const realizedPnl: number | null = null;

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
        id: randomUUID(),
        calendarId: cf.calendarId,
        eventType: cf.classification,
        eventedAt: now,
        fillIdsHash,
        legOccSymbol: cf.legOccSymbol,
        rolledFromOccSymbol: null,
        qty: cf.sumQty,
        avgPrice: cf.avgPrice,
        netAmount,
        realizedPnl,
        legBreakdown,
        entryThesis: null,
      };

      const storeResult = await deps.storeCalendarEvent(event);
      if (!storeResult.ok) return err(storeResult.error);
    }

    return ok(undefined);
  };
}

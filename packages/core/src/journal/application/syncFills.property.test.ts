/**
 * syncFills.property.test.ts — fast-check property suite over the REAL pairing pipeline.
 *
 * These properties harden the round-1 + round-2 fixes (WR-A1/WR-A2/WR-A3) across the whole
 * input space — randomized fill / partial-fill / roll sequences feeding makeSyncFillsUseCase
 * and the in-memory fills twin's recompute. Where the round-2 example tests cover specific
 * cases, these prove the invariants hold for arbitrary inputs.
 *
 * Locked properties (05-GAPS-2.md "Property tests"):
 *   P1  no double-count   — sum over events of (#fills composing it) == #distinct paired fills;
 *                           no fill id appears in two events.
 *   P2  idempotent sync   — re-running sync over the same (mutating) store emits no new events.
 *   P2b partial growth    — a fill arriving in a later sync forms exactly ONE new event over
 *                           only the new fill; the prior event is untouched (WR-A2 invariant).
 *   P3  rebuild reconcile  — applying the WR-A1 sum-by-eventType recompute rule to the emitted
 *                           events yields openNetDebit/closeNetCredit that equal the summed raw
 *                           economics (price×qty) of the paired fills (OPEN debits + ROLL open
 *                           legs → openNetDebit; |CLOSE credits| + ROLL close legs → closeNetCredit).
 *
 * If a property finds a counterexample it is a real residual bug in 05-14/05-15 — the source is
 * fixed at root cause, never the generator narrowed to hide it (TDD rule, plan critical_rules).
 *
 * No Docker / no Drizzle, and no cross-boundary import: core (incl. its tests) imports only
 * @morai/shared (architecture-boundaries §2). The harness composes the real use-case with
 * capturing fake ports; P3 applies the exact eventType-summing recompute rule the adapters'
 * recomputeCalendarAmounts implements (the twin/Postgres parity is proven by 05-15's contract
 * suite) and reconciles it against the independent raw-fill economics. No `any`/`as`/`!`
 * (typescript.md); OCC symbols are built via formatOccSymbol (not casts).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ok, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeSyncFillsUseCase } from "./syncFills.ts";
import type {
  ForStoringCalendarEvent,
  ForReadingUnprocessedFills,
  ForReadingCalendarLegs,
  ForStoringOrphanFill,
  ForResettingCalendarAmounts,
  ForReadingCalendarEvents,
  ForMarkingFillsProcessed,
  StorageError,
} from "./ports.ts";
import type { RawFill, CalendarEvent } from "../domain/calendar-event.ts";

// ─── Fixed calendar legs (front/back) ───────────────────────────────────────────
// Built via formatOccSymbol so they match the in-memory twin's calendarLegSymbols exactly
// (same canonical OSI form) — the property feeds fills on these two legs.
const CAL_ID = "cal-prop-1";
const STRIKE_POINTS = 7100;
const FRONT_EXPIRY = "2026-06-20";
const BACK_EXPIRY = "2026-09-19";
const OCC_FRONT = formatOccSymbol({
  root: "SPX",
  expiry: new Date(FRONT_EXPIRY + "T12:00:00Z"),
  type: "P",
  strike: STRIKE_POINTS,
});
const OCC_BACK = formatOccSymbol({
  root: "SPX",
  expiry: new Date(BACK_EXPIRY + "T12:00:00Z"),
  type: "P",
  strike: STRIKE_POINTS,
});

// Injective fill-ids hasher: distinct id-sets → distinct strings (the existing
// `hash(sorted ids)` form). P1's distinct-event counting needs this to be injective so each
// event's fillIdsHash uniquely identifies its composing fill set.
const fakeHashFillIds = (ids: ReadonlyArray<string>): string =>
  `hash(${[...ids].sort().join(":")})`;

// ─── Arbitraries ────────────────────────────────────────────────────────────────

// A single fill spec on one of the two legs. positionEffect (via frontStatus/backStatus, set
// per-leg for the whole run) drives OPEN/CLOSE classification; side (fixed per-leg below,
// front=sell/back=buy — a realistic bought-back/sold-front calendar) independently drives
// netAmount's sign (journal-pnl-opennetdebit-units #2) — the two are orthogonal signals.
type FillSpec = {
  readonly leg: "front" | "back";
  readonly orderId: string;
  readonly qty: number; // > 0 (avoid the aggregation-error branch)
  readonly price: number; // finite > 0
};

const fillSpecArb: fc.Arbitrary<FillSpec> = fc.record({
  leg: fc.constantFrom("front" as const, "back" as const),
  // Small order-id alphabet so partial-fill buckets (same orderId+leg) and roll
  // candidates (same orderId across legs) actually occur.
  orderId: fc.constantFrom("o1", "o2", "o3"),
  qty: fc.integer({ min: 1, max: 10 }),
  price: fc
    .float({ min: Math.fround(0.05), max: Math.fround(500), noNaN: true })
    .map((p) => Math.round(p * 100) / 100),
});

const fillSpecsArb: fc.Arbitrary<ReadonlyArray<FillSpec>> = fc.array(fillSpecArb, {
  minLength: 1,
  maxLength: 12,
});

// Map FillSpecs → RawFills with distinct ids. side is irrelevant to CLASSIFICATION
// (positionEffect from the leg drives OPEN/CLOSE), but IS relevant to netAmount's sign
// (journal-pnl-opennetdebit-units #2); we set it deterministically per leg.
function specsToFills(specs: ReadonlyArray<FillSpec>): RawFill[] {
  return specs.map((s, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    orderId: s.orderId,
    occSymbol: s.leg === "front" ? OCC_FRONT : OCC_BACK,
    side: s.leg === "front" ? "sell" : "buy",
    qty: s.qty,
    price: s.price,
    filledAt: new Date("2026-06-15T14:00:00Z"),
    commission: null,
    fees: null,
  }));
}

// ─── Harness ────────────────────────────────────────────────────────────────────
// Composes the REAL makeSyncFillsUseCase with: a mutating processed-set fill source (so a
// second sync reads only unmarked fills — the idempotency precondition), a capturing event
// store, and per-leg positionEffect (so front CLOSE + back OPEN forms a ROLL). Leg matching
// mirrors the real adapter (single calendar, two canonical OCC legs).

type LegStatus = "open" | "closed";

function buildHarness(opts: {
  fills: RawFill[];
  frontStatus: LegStatus; // OPENING when "open", CLOSING when "closed"
  backStatus: LegStatus;
}) {
  const frontEffect = opts.frontStatus === "open" ? "OPENING" : "CLOSING";
  const backEffect = opts.backStatus === "open" ? "OPENING" : "CLOSING";

  const readCalendarLegs: ForReadingCalendarLegs = async (occSymbol) => {
    if (occSymbol === OCC_FRONT) {
      return ok([{ calendarId: CAL_ID, legOccSymbol: OCC_FRONT, positionEffect: frontEffect }]);
    }
    if (occSymbol === OCC_BACK) {
      return ok([{ calendarId: CAL_ID, legOccSymbol: OCC_BACK, positionEffect: backEffect }]);
    }
    return ok([]);
  };

  const processed = new Set<string>();
  const store = new Map<string, RawFill>();
  for (const f of opts.fills) store.set(f.id, f);

  const readUnprocessedFills: ForReadingUnprocessedFills = async () =>
    ok([...store.values()].filter((f) => !processed.has(f.id)));

  const storedEvents: CalendarEvent[] = [];
  const storeCalendarEvent: ForStoringCalendarEvent = async (event) => {
    // Idempotent on fillIdsHash, mirroring the calendar_events UNIQUE constraint, so a
    // re-emission of the same fill set is a no-op (P2).
    if (!storedEvents.some((e) => e.fillIdsHash === event.fillIdsHash)) {
      storedEvents.push(event);
    }
    return ok(undefined);
  };

  const storedOrphans: string[] = [];
  const storeOrphanFill: ForStoringOrphanFill = async (orphan) => {
    storedOrphans.push(orphan.fillId);
    return ok(undefined);
  };

  const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
  const readCalendarEvents: ForReadingCalendarEvents = async () => ok([]);
  const markFillsProcessed: ForMarkingFillsProcessed = async (ids) => {
    for (const id of ids) processed.add(id);
    return ok(undefined);
  };

  let idCounter = 0;
  const newId = (): string =>
    `00000000-0000-4000-9000-${String(idCounter++).padStart(12, "0")}`;

  const deps = {
    readUnprocessedFills,
    readCalendarLegs,
    storeCalendarEvent,
    storeOrphanFill,
    resetCalendarAmounts,
    readCalendarEvents,
    markFillsProcessed,
    newId,
    hashFillIds: fakeHashFillIds,
    now: () => new Date("2026-06-15T14:00:00Z"),
  };

  return {
    store,
    processed,
    storedEvents,
    storedOrphans,
    sync: makeSyncFillsUseCase(deps),
    // add a fill to the live store between syncs (partial-fill growth)
    addFill: (f: RawFill): void => {
      store.set(f.id, f);
    },
  };
}

// WR-A1 sum-by-eventType recompute rule — the exact rule recomputeCalendarAmounts implements
// on both adapters (twin/Postgres parity proven by 05-15's contract suite). Applied here to
// the emitted events so the property exercises the real reconciliation arithmetic without a
// cross-boundary import.
function recomputeByEventType(events: ReadonlyArray<CalendarEvent>): {
  openNetDebit: number;
  closeNetCredit: number;
} {
  let openNetDebit = 0;
  let closeNetCredit = 0;
  for (const e of events) {
    switch (e.eventType) {
      case "OPEN":
        openNetDebit += e.netAmount; // OPEN debit positive (D-08)
        break;
      case "CLOSE":
        closeNetCredit += -e.netAmount; // CLOSE credit negative (D-08) → abs
        break;
      case "ROLL":
        openNetDebit += e.rollOpenDebit ?? 0;
        closeNetCredit += e.rollCloseCredit ?? 0;
        break;
    }
  }
  return { openNetDebit, closeNetCredit };
}

// Decode an event's composing fill ids from its injective fillIdsHash ("hash(a:b:c)").
function fillIdsOf(event: CalendarEvent): string[] {
  const inner = event.fillIdsHash.replace(/^hash\(/, "").replace(/\)$/, "");
  return inner.length === 0 ? [] : inner.split(":");
}

async function expectOk(r: Promise<Result<void, StorageError>>): Promise<void> {
  const res = await r;
  expect(res.ok).toBe(true);
}

// ─── Properties ──────────────────────────────────────────────────────────────────

describe("syncFills properties", () => {
  it("P1 no double-count: distinct paired fills == fills summed over events, no fill in two events (numRuns≥200)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fillSpecsArb,
        fc.constantFrom("open" as const, "closed" as const),
        fc.constantFrom("open" as const, "closed" as const),
        async (specs, frontStatus, backStatus) => {
          const fills = specsToFills(specs);
          const h = buildHarness({ fills, frontStatus, backStatus });
          await expectOk(h.sync());

          // All paired fills = the union of fill ids across emitted events.
          const seen = new Set<string>();
          let totalFromEvents = 0;
          for (const e of h.storedEvents) {
            const ids = fillIdsOf(e);
            totalFromEvents += ids.length;
            for (const id of ids) {
              // No fill id appears in two events.
              expect(seen.has(id)).toBe(false);
              seen.add(id);
            }
          }
          // The distinct paired fills are exactly the non-orphaned input fills.
          const orphanSet = new Set(h.storedOrphans);
          const distinctPaired = fills.filter((f) => !orphanSet.has(f.id)).length;
          expect(totalFromEvents).toBe(seen.size); // no double-count within the sum
          expect(seen.size).toBe(distinctPaired); // every paired fill counted once
        },
      ),
      { numRuns: 300 },
    );
  });

  it("P2 idempotent: a second sync over the same (mutating) store emits no new events (numRuns≥200)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fillSpecsArb,
        fc.constantFrom("open" as const, "closed" as const),
        fc.constantFrom("open" as const, "closed" as const),
        async (specs, frontStatus, backStatus) => {
          const fills = specsToFills(specs);
          const h = buildHarness({ fills, frontStatus, backStatus });
          await expectOk(h.sync());
          const countAfterFirst = h.storedEvents.length;
          const orphansAfterFirst = h.storedOrphans.length;

          await expectOk(h.sync()); // markFillsProcessed mutated the store → reads nothing new
          expect(h.storedEvents.length).toBe(countAfterFirst);
          expect(h.storedOrphans.length).toBe(orphansAfterFirst);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("P2b partial-fill growth: a fill added in a later sync emits exactly ONE new event over only it (numRuns≥200)", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A single partial-fill bucket on the front leg, opened so it pairs into one OPEN event.
        fc.integer({ min: 1, max: 10 }),
        fc
          .float({ min: Math.fround(0.05), max: Math.fround(500), noNaN: true })
          .map((p) => Math.round(p * 100) / 100),
        fc.integer({ min: 1, max: 10 }),
        fc
          .float({ min: Math.fround(0.05), max: Math.fround(500), noNaN: true })
          .map((p) => Math.round(p * 100) / 100),
        async (qtyA, priceA, qtyB, priceB) => {
          const fillA: RawFill = {
            id: "00000000-0000-4000-8000-0000000000aa",
            orderId: "order-grow",
            occSymbol: OCC_FRONT,
            side: "buy",
            qty: qtyA,
            price: priceA,
            filledAt: new Date("2026-06-15T14:00:00Z"),
            commission: null,
            fees: null,
          };
          const fillB: RawFill = {
            ...fillA,
            id: "00000000-0000-4000-8000-0000000000bb",
            qty: qtyB,
            price: priceB,
          };

          // Front leg OPENING; start with bucket {A}.
          const h = buildHarness({ fills: [fillA], frontStatus: "open", backStatus: "open" });
          await expectOk(h.sync());
          expect(h.storedEvents.length).toBe(1);
          const eventA = h.storedEvents[0];
          const idsA = eventA === undefined ? [] : fillIdsOf(eventA);
          expect(idsA).toEqual([fillA.id]); // A's event covers only A

          // B arrives in a later sync (A already processed).
          h.addFill(fillB);
          await expectOk(h.sync());
          // Exactly ONE additional event, covering only B; A's event untouched.
          expect(h.storedEvents.length).toBe(2);
          expect(h.storedEvents[0]).toBe(eventA);
          const eventB = h.storedEvents[1];
          const idsB = eventB === undefined ? [] : fillIdsOf(eventB);
          expect(idsB).toEqual([fillB.id]);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("P3 rebuild reconciliation: recompute rule over events == summed raw economics of paired fills (numRuns≥200)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fillSpecsArb,
        fc.constantFrom("open" as const, "closed" as const),
        fc.constantFrom("open" as const, "closed" as const),
        async (specs, frontStatus, backStatus) => {
          const fills = specsToFills(specs);
          const h = buildHarness({ fills, frontStatus, backStatus });
          await expectOk(h.sync());

          // The WR-A1 recompute rule applied to the emitted events.
          const recomputed = recomputeByEventType(h.storedEvents);

          // Independently reconstruct the expected open/close totals from the RAW economics of
          // the paired fills. journal-pnl-opennetdebit-units #2: for OPEN/CLOSE (non-ROLL)
          // events, netAmount is signed by the fill's ACTUAL side (buy=debit/+, sell=credit/-),
          // NOT unconditionally by open/close role — a leg can be sold-to-open (credit) or
          // bought-to-close (debit). The ROLL branch's rollOpenDebit/rollCloseCredit were fixed
          // to the identical convention (money-path review follow-up): rollOpenDebit mirrors
          // OPEN netAmount's sign (debit positive, credit negative — a sold-to-open new leg is
          // a credit); rollCloseCredit mirrors the recompute CLOSE bucket's sign (credit
          // positive, debit negative — a bought-to-close leg is a debit), so ROLL-composing
          // fills now use the SAME side-signed reconstruction as OPEN/CLOSE, per leg role.
          const orphanSet = new Set(h.storedOrphans);
          const byId = new Map<string, RawFill>();
          for (const f of fills) byId.set(f.id, f);

          let expectedOpen = 0;
          let expectedClose = 0;
          for (const e of h.storedEvents) {
            for (const id of fillIdsOf(e)) {
              const f = byId.get(id);
              if (f === undefined) continue;
              const economics = f.price * f.qty;
              const signed = f.side === "sell" ? -economics : economics;
              if (e.eventType === "ROLL") {
                const effect = f.occSymbol === OCC_FRONT ? frontStatus : backStatus;
                if (effect === "open") expectedOpen += signed; // rollOpenDebit convention
                else expectedClose += f.side === "sell" ? economics : -economics; // rollCloseCredit convention
              } else if (e.eventType === "OPEN") {
                expectedOpen += signed;
              } else {
                expectedClose += -signed; // recomputeCalendarAmounts negates CLOSE netAmount
              }
            }
          }
          // Orphaned fills contribute to neither bucket.
          expect([...orphanSet].every((id) => byId.has(id))).toBe(true);

          expect(recomputed.openNetDebit).toBeCloseTo(expectedOpen, 5);
          expect(recomputed.closeNetCredit).toBeCloseTo(expectedClose, 5);
        },
      ),
      { numRuns: 300 },
    );
  });
});

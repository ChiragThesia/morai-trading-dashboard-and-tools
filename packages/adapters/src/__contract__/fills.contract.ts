/**
 * Shared contract-test suite for the fills persistence ports (A1 + A3).
 *
 * Run this suite against both:
 *   - The Postgres adapter (testcontainers) — packages/adapters/src/postgres/repos/fills.contract.test.ts
 *   - The in-memory twin — packages/adapters/src/memory/fills.contract.test.ts
 *
 * Ports under contract:
 *   - ForReadingUnprocessedFills           (all fills not parked in orphan_fills)
 *   - ForReadingUnprocessedFillsForCalendar (same, scoped to one calendar's leg OCC symbols)
 *   - ForReadingCalendarLegs               (OCC symbol → matching calendar legs)
 *   - ForResettingCalendarAmounts          (clear open_net_debit / close_net_credit)
 *   - ForRecomputingCalendarAmounts        (A3: recompute amounts from calendar_events)
 *   - ForWritingFills                      (idempotent INSERT on fill id PK)
 *
 * Unprocessed-fills exclusion rule (WR-A2, plan 05-15 — supersedes the 05-12 orphan-only rule):
 *   A fill is "processed" iff its id is parked in orphan_fills OR its processed_at column is
 *   set. syncFills calls markFillsProcessed once a bucket's event is stored (and orphan-parked
 *   fills are processed too). readUnprocessedFills = WHERE processed_at IS NULL AND id NOT IN
 *   orphan_fills. Semantics: each fill is incorporated into exactly ONE event; later fills for
 *   the same order/leg form a NEW event covering only the new fills — no fill is double-counted,
 *   and the full lifetime fills table is never re-paired unbounded.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForReadingUnprocessedFills,
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  ForMarkingFillsProcessed,
  ForWritingFills,
  RawFill,
  StorageError,
} from "@morai/core";

// ─── Seed inputs ────────────────────────────────────────────────────────────

/** A calendar to seed (both legs derived from strike/expiry/optionType). */
export type SeedCalendar = {
  readonly id: string;
  readonly underlying: string;
  readonly strike: number; // ×1000 int
  readonly optionType: "C" | "P";
  readonly frontExpiry: string; // YYYY-MM-DD
  readonly backExpiry: string; // YYYY-MM-DD
  readonly qty: number;
  readonly status: "open" | "closed";
  readonly openNetDebit: number | null;
};

/** A calendar_events row to seed (drives recomputeCalendarAmounts). */
export type SeedEvent = {
  readonly calendarId: string;
  readonly eventType: "OPEN" | "CLOSE" | "ROLL";
  readonly fillIdsHash: string; // 64-char unique
  readonly legOccSymbol: string;
  readonly netAmount: number; // OPEN debit positive; CLOSE credit negative (D-08)
  // WR-A1: explicit ROLL split components — recompute reads these (not re-parsed JSON).
  // Optional/nullable so existing OPEN/CLOSE seeds are unaffected (null = not a ROLL split).
  readonly rolledFromOccSymbol?: string | null;
  readonly rollOpenDebit?: number | null;
  readonly rollCloseCredit?: number | null;
};

/** An orphan_fills row to seed (drives the unprocessed exclusion). */
export type SeedOrphan = {
  readonly fillId: string;
};

export type FillsSeedContext = {
  readonly seedCalendar: (cal: SeedCalendar) => Promise<void>;
  readonly seedEvent: (event: SeedEvent) => Promise<void>;
  readonly seedOrphan: (orphan: SeedOrphan) => Promise<void>;
  /** Read back a calendar's amounts to assert reset/recompute results. */
  readonly readCalendarAmounts: (
    calendarId: string,
  ) => Promise<{ openNetDebit: number | null; closeNetCredit: number | null }>;
  /** Count fills rows (writeFills idempotency check). */
  readonly countFills: () => Promise<number>;
  /** WR-A2: read the ids of fills whose processed_at is set (assert mark-processed). */
  readonly readProcessedFillIds: () => Promise<ReadonlyArray<string>>;
};

export type FillsRepo = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly recomputeCalendarAmounts: ForRecomputingCalendarAmounts;
  readonly markFillsProcessed: ForMarkingFillsProcessed;
  readonly writeFills: ForWritingFills;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CAL_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CAL_ID = "22222222-2222-4222-8222-222222222222";

const FILL_ID_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FILL_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FILL_ID_3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// OSI 21-char canonical form (matches formatOccSymbol output): SPX strike 7100 put.
// front leg (2026-06-20) and back leg (2026-09-19).
const FRONT_OCC = "SPX   260620P07100000";
const BACK_OCC = "SPX   260919P07100000";
// A symbol belonging to no seeded calendar leg.
const FOREIGN_OCC = "SPX   260620C08000000";

function makeFill(id: string, occSymbol: string, overrides: Partial<RawFill> = {}): RawFill {
  return {
    id,
    orderId: "ORD-1",
    occSymbol,
    side: "buy",
    qty: 1,
    price: 15.5,
    filledAt: new Date("2026-06-15T14:00:00Z"),
    commission: null,
    fees: null,
    ...overrides,
  };
}

function calendar(overrides: Partial<SeedCalendar> = {}): SeedCalendar {
  return {
    id: CAL_ID,
    underlying: "SPX",
    strike: 7100000,
    optionType: "P",
    frontExpiry: "2026-06-20",
    backExpiry: "2026-09-19",
    qty: 1,
    status: "open",
    openNetDebit: null,
    ...overrides,
  };
}

// ─── Contract suite ────────────────────────────────────────────────────────────

export function runFillsContractTests(
  makeRepo: (seed: FillsSeedContext) => FillsRepo,
  getSeedContext: () => FillsSeedContext,
): void {
  describe("fills persistence contract", () => {
    let repo: FillsRepo;
    let seed: FillsSeedContext;

    beforeEach(() => {
      seed = getSeedContext();
      repo = makeRepo(seed);
    });

    describe("writeFills — idempotent on id PK", () => {
      it("inserts new fills", async () => {
        const result = await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC),
          makeFill(FILL_ID_2, BACK_OCC),
        ]);
        expect(result.ok).toBe(true);
        expect(await seed.countFills()).toBe(2);
      });

      it("same fill id twice → one row (onConflictDoNothing)", async () => {
        await repo.writeFills([makeFill(FILL_ID_1, FRONT_OCC)]);
        await repo.writeFills([makeFill(FILL_ID_1, FRONT_OCC)]);
        expect(await seed.countFills()).toBe(1);
      });
    });

    describe("readUnprocessedFills — excludes orphan-parked fills", () => {
      it("returns fills not parked in orphan_fills", async () => {
        await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC),
          makeFill(FILL_ID_2, BACK_OCC),
          makeFill(FILL_ID_3, FRONT_OCC),
        ]);
        await seed.seedOrphan({ fillId: FILL_ID_2 });

        const result = await repo.readUnprocessedFills();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((f) => f.id).sort();
        expect(ids).toEqual([FILL_ID_1, FILL_ID_3].sort());
      });

      it("returns empty when all fills parked", async () => {
        await repo.writeFills([makeFill(FILL_ID_1, FRONT_OCC)]);
        await seed.seedOrphan({ fillId: FILL_ID_1 });

        const result = await repo.readUnprocessedFills();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });

    describe("markFillsProcessed — WR-A2 processed_at tracking", () => {
      it("readUnprocessedFills excludes processed fills", async () => {
        await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC),
          makeFill(FILL_ID_2, BACK_OCC),
          makeFill(FILL_ID_3, FRONT_OCC),
        ]);
        const marked = await repo.markFillsProcessed([FILL_ID_2]);
        expect(marked.ok).toBe(true);

        const result = await repo.readUnprocessedFills();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((f) => f.id).sort();
        expect(ids).toEqual([FILL_ID_1, FILL_ID_3].sort());

        const processed = await seed.readProcessedFillIds();
        expect([...processed].sort()).toEqual([FILL_ID_2]);
      });

      it("readUnprocessedFillsForCalendar excludes processed fills", async () => {
        await seed.seedCalendar(calendar());
        await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC),
          makeFill(FILL_ID_2, BACK_OCC),
        ]);
        await repo.markFillsProcessed([FILL_ID_1]);

        const result = await repo.readUnprocessedFillsForCalendar(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((f) => f.id)).toEqual([FILL_ID_2]);
      });

      it("markFillsProcessed is idempotent (marking the same id twice is a no-op)", async () => {
        await repo.writeFills([makeFill(FILL_ID_1, FRONT_OCC)]);
        const first = await repo.markFillsProcessed([FILL_ID_1]);
        const second = await repo.markFillsProcessed([FILL_ID_1]);
        expect(first.ok).toBe(true);
        expect(second.ok).toBe(true);

        const result = await repo.readUnprocessedFills();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("markFillsProcessed with an empty array is a no-op", async () => {
        await repo.writeFills([makeFill(FILL_ID_1, FRONT_OCC)]);
        const result = await repo.markFillsProcessed([]);
        expect(result.ok).toBe(true);
        const unprocessed = await repo.readUnprocessedFills();
        expect(unprocessed.ok).toBe(true);
        if (!unprocessed.ok) return;
        expect(unprocessed.value).toHaveLength(1);
      });

      it("orphan-parked fills stay excluded even when processed_at IS NULL", async () => {
        await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC),
          makeFill(FILL_ID_2, BACK_OCC),
        ]);
        await seed.seedOrphan({ fillId: FILL_ID_1 });

        const result = await repo.readUnprocessedFills();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.map((f) => f.id)).toEqual([FILL_ID_2]);
      });
    });

    describe("readUnprocessedFillsForCalendar — scoped to calendar legs", () => {
      it("returns only fills whose OCC matches the calendar's legs", async () => {
        await seed.seedCalendar(calendar());
        await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC), // matches calendar front leg
          makeFill(FILL_ID_2, BACK_OCC), // matches calendar back leg
          makeFill(FILL_ID_3, FOREIGN_OCC), // belongs to no leg
        ]);

        const result = await repo.readUnprocessedFillsForCalendar(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((f) => f.id).sort();
        expect(ids).toEqual([FILL_ID_1, FILL_ID_2].sort());
      });

      it("excludes orphan-parked fills even when they match a leg", async () => {
        await seed.seedCalendar(calendar());
        await repo.writeFills([
          makeFill(FILL_ID_1, FRONT_OCC),
          makeFill(FILL_ID_2, BACK_OCC),
        ]);
        await seed.seedOrphan({ fillId: FILL_ID_1 });

        const result = await repo.readUnprocessedFillsForCalendar(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const ids = result.value.map((f) => f.id);
        expect(ids).toEqual([FILL_ID_2]);
      });
    });

    describe("readCalendarLegs — OCC symbol → calendar legs", () => {
      it("returns the matching calendar for a front-leg OCC symbol", async () => {
        await seed.seedCalendar(calendar());

        const result = await repo.readCalendarLegs(FRONT_OCC);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        const entry = result.value[0];
        expect(entry?.calendarId).toBe(CAL_ID);
        expect(entry?.legOccSymbol).toBe(FRONT_OCC);
        expect(entry?.positionEffect).toBe("OPENING"); // open calendar
      });

      it("returns empty for a symbol on no calendar leg", async () => {
        await seed.seedCalendar(calendar());

        const result = await repo.readCalendarLegs(FOREIGN_OCC);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("maps closed-calendar legs to CLOSING positionEffect", async () => {
        await seed.seedCalendar(calendar({ status: "closed" }));

        const result = await repo.readCalendarLegs(BACK_OCC);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value[0]?.positionEffect).toBe("CLOSING");
      });
    });

    describe("resetCalendarAmounts — clears amounts to null", () => {
      it("sets open_net_debit and close_net_credit to null", async () => {
        await seed.seedCalendar(calendar({ openNetDebit: 15.5 }));

        const result = await repo.resetCalendarAmounts(CAL_ID);
        expect(result.ok).toBe(true);
        const amounts = await seed.readCalendarAmounts(CAL_ID);
        expect(amounts.openNetDebit).toBeNull();
        expect(amounts.closeNetCredit).toBeNull();
      });
    });

    describe("recomputeCalendarAmounts — A3: derive amounts from events", () => {
      it("writes non-null totals summed from calendar_events", async () => {
        await seed.seedCalendar(calendar({ openNetDebit: null }));
        // OPEN debit (+15.50) + a partial OPEN (+5.00) → open_net_debit = 20.50
        // CLOSE credit (−8.00) → close_net_credit = 8.00 (abs of summed credits)
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "OPEN",
          fillIdsHash: "a".repeat(64),
          legOccSymbol: FRONT_OCC,
          netAmount: 15.5,
        });
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "OPEN",
          fillIdsHash: "b".repeat(64),
          legOccSymbol: BACK_OCC,
          netAmount: 5,
        });
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "CLOSE",
          fillIdsHash: "c".repeat(64),
          legOccSymbol: FRONT_OCC,
          netAmount: -8,
        });

        const result = await repo.recomputeCalendarAmounts(CAL_ID);
        expect(result.ok).toBe(true);

        const amounts = await seed.readCalendarAmounts(CAL_ID);
        expect(amounts.openNetDebit).toBeCloseTo(20.5, 5);
        expect(amounts.closeNetCredit).toBeCloseTo(8, 5);
      });

      // journal-pnl-opennetdebit-units #2: the case above only covers two SAME-direction OPEN
      // legs (both +debit) — the coverage gap that let a sold-to-open (credit) leg go
      // unexercised. This asserts recomputeCalendarAmounts NETS a bought leg against a sold
      // leg (a real calendar always has one of each) rather than summing two debits.
      it("nets a bought-to-open leg against a sold-to-open (credit) leg — not summed as two debits", async () => {
        await seed.seedCalendar(calendar({ openNetDebit: null }));
        // Back leg bought to open (+159.41 debit); front leg SOLD to open (-127.06 credit,
        // correctly signed by syncFills per the D-08 fix). True net debit: 32.35 — NOT the
        // wrongly-summed 286.47 the prod bug produced.
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "OPEN",
          fillIdsHash: "1".repeat(64),
          legOccSymbol: BACK_OCC,
          netAmount: 159.41,
        });
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "OPEN",
          fillIdsHash: "2".repeat(64),
          legOccSymbol: FRONT_OCC,
          netAmount: -127.06,
        });

        const result = await repo.recomputeCalendarAmounts(CAL_ID);
        expect(result.ok).toBe(true);

        const amounts = await seed.readCalendarAmounts(CAL_ID);
        expect(amounts.openNetDebit).toBeCloseTo(32.35, 5);
        expect(amounts.openNetDebit).not.toBeCloseTo(286.47, 5);
      });

      it("WR-A1: sums by eventType — a ROLL splits into openNetDebit + closeNetCredit", async () => {
        await seed.seedCalendar(calendar({ openNetDebit: null }));
        // OPEN debit (+10) → openNetDebit; CLOSE credit (−4) → closeNetCredit;
        // ROLL: open-leg debit +6 → openNetDebit, close-leg credit 5 → closeNetCredit
        // (combined netAmount = 6 − 5 = +1; sign-bucketing would wrongly add +1 to openNetDebit
        //  and nothing to closeNetCredit for the close leg).
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "OPEN",
          fillIdsHash: "e".repeat(64),
          legOccSymbol: FRONT_OCC,
          netAmount: 10,
        });
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "CLOSE",
          fillIdsHash: "f".repeat(64),
          legOccSymbol: FRONT_OCC,
          netAmount: -4,
        });
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "ROLL",
          fillIdsHash: "0".repeat(64),
          legOccSymbol: BACK_OCC,
          rolledFromOccSymbol: FRONT_OCC,
          netAmount: 1,
          rollOpenDebit: 6,
          rollCloseCredit: 5,
        });

        const result = await repo.recomputeCalendarAmounts(CAL_ID);
        expect(result.ok).toBe(true);

        const amounts = await seed.readCalendarAmounts(CAL_ID);
        // openNetDebit = 10 + 6 = 16; closeNetCredit = 4 + 5 = 9.
        expect(amounts.openNetDebit).toBeCloseTo(16, 5);
        expect(amounts.closeNetCredit).toBeCloseTo(9, 5);
      });

      it("scopes recompute to the target calendar only", async () => {
        await seed.seedCalendar(calendar({ openNetDebit: null }));
        await seed.seedCalendar(
          calendar({ id: OTHER_CAL_ID, openNetDebit: 99 }),
        );
        await seed.seedEvent({
          calendarId: CAL_ID,
          eventType: "OPEN",
          fillIdsHash: "d".repeat(64),
          legOccSymbol: FRONT_OCC,
          netAmount: 12,
        });

        await repo.recomputeCalendarAmounts(CAL_ID);

        const other = await seed.readCalendarAmounts(OTHER_CAL_ID);
        expect(other.openNetDebit).toBeCloseTo(99, 5);
        const target = await seed.readCalendarAmounts(CAL_ID);
        expect(target.openNetDebit).toBeCloseTo(12, 5);
      });
    });
  });
}

// Silence unused import — StorageError used in port signatures
export type { StorageError };

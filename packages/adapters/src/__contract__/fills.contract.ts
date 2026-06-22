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
 * Unprocessed-fills exclusion rule (documented, plan 05-12):
 *   A fill is "processed" iff its id is present in orphan_fills. calendar_events stores
 *   only fill_ids_hash (a hash, not per-fill ids), so we cannot join fills→events by id;
 *   re-emission is absorbed by the calendar_events.fill_ids_hash UNIQUE constraint
 *   (onConflictDoNothing). The contract therefore asserts orphan-parked fills are excluded.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForReadingUnprocessedFills,
  ForReadingUnprocessedFillsForCalendar,
  ForReadingCalendarLegs,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
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
};

export type FillsRepo = {
  readonly readUnprocessedFills: ForReadingUnprocessedFills;
  readonly readUnprocessedFillsForCalendar: ForReadingUnprocessedFillsForCalendar;
  readonly readCalendarLegs: ForReadingCalendarLegs;
  readonly resetCalendarAmounts: ForResettingCalendarAmounts;
  readonly recomputeCalendarAmounts: ForRecomputingCalendarAmounts;
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

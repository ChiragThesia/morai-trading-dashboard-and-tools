/**
 * snapshotCalendars use-case tests — RED phase.
 *
 * TDD: Tests written before implementation. They fail because snapshotCalendars.ts
 * does not yet exist.
 *
 * Covers:
 *   - Happy path: front+back legs → exact D-05 formulas for every column
 *   - NaN-leg case: row still written with frontIv='NaN', pnlOpen populated
 *   - Idempotency: persistSnapshot called once per calendar
 *   - fast-check property: pnlOpen = (netMark - openNetDebit) * qty * 100 for any inputs
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import * as fc from "fast-check";
import { makeSnapshotCalendarsUseCase } from "./snapshotCalendars.ts";
import type { SnapshotCalendarsDeps } from "./snapshotCalendars.ts";
import type {
  Calendar,
  LegSnapshot,
  SnapshotRow,
  StorageError,
  ForGettingOpenCalendars,
  ForResolvingLegSnapshot,
  ForPersistingSnapshot,
} from "./ports.ts";

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: "cal-001",
    underlying: "SPX",
    strike: 5000000, // ×1000 int → 5000 points
    optionType: "C",
    frontExpiry: "2026-07-18",
    backExpiry: "2026-09-19",
    qty: 2,
    openNetDebit: 5.0,
    status: "open",
    openedAt: new Date("2026-06-01T14:00:00Z"),
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

function makeLegSnapshot(overrides: Partial<LegSnapshot> = {}): LegSnapshot {
  // Import OccSymbol brand via formatOccSymbol — use a raw string for test double
  return {
    occSymbol: "SPX   260718C05000000" as unknown as import("@morai/shared").OccSymbol,
    mark: 20.0,
    underlyingPrice: 5010.0,
    ivRaw: 0.22,
    bsmIv: "0.22",
    bsmDelta: "0.55",
    bsmGamma: "0.003",
    bsmTheta: "-1.8",
    bsmVega: "6.2",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SnapshotCalendarsDeps> = {}): SnapshotCalendarsDeps {
  return {
    getOpenCalendars: async () => ok([makeCalendar()]),
    resolveLegs: async () => ok(makeLegSnapshot()),
    persistSnapshot: async () => ok(undefined),
    now: () => new Date("2026-07-01T19:00:00Z"),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeSnapshotCalendarsUseCase", () => {
  describe("happy path — both legs resolve with BSM greeks", () => {
    it("returns ok(undefined) when all calendars snapshot successfully", async () => {
      const useCase = makeSnapshotCalendarsUseCase(makeDeps());
      const result = await useCase();
      expect(result.ok).toBe(true);
    });

    it("persists exactly one row per open calendar", async () => {
      const cal1 = makeCalendar({ id: "cal-001" });
      const cal2 = makeCalendar({ id: "cal-002" });
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal1, cal2]),
          persistSnapshot,
        }),
      );

      await useCase();

      expect(persistSnapshot).toHaveBeenCalledTimes(2);
    });

    it("computes netMark = backMark - frontMark", async () => {
      const frontLeg = makeLegSnapshot({ mark: 10.0 });
      const backLeg = makeLegSnapshot({ mark: 25.0 });

      // resolveLegs alternates front/back based on call order
      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };

      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot }),
      );

      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(row.netMark).toBe(String(25.0 - 10.0)); // "15"
      expect(row.frontMark).toBe("10");
      expect(row.backMark).toBe("25");
    });

    it("computes netDelta = (backDelta - frontDelta) * qty * 100", async () => {
      const cal = makeCalendar({ qty: 3 });
      const frontLeg = makeLegSnapshot({ bsmDelta: "0.40", mark: 10.0 });
      const backLeg = makeLegSnapshot({ bsmDelta: "0.55", mark: 20.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot,
        }),
      );

      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      // netDelta = (0.55 - 0.40) * 3 * 100 = 45
      expect(parseFloat(row.netDelta)).toBeCloseTo((0.55 - 0.40) * 3 * 100, 5);
    });

    it("computes termSlope = backIv - frontIv", async () => {
      const frontLeg = makeLegSnapshot({ bsmIv: "0.20", mark: 10.0 });
      const backLeg = makeLegSnapshot({ bsmIv: "0.25", mark: 20.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(makeDeps({ resolveLegs, persistSnapshot }));
      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(parseFloat(row.termSlope)).toBeCloseTo(0.25 - 0.20, 10);
    });

    it("computes pnlOpen = (netMark - openNetDebit) * qty * 100", async () => {
      const cal = makeCalendar({ qty: 2, openNetDebit: 5.0 });
      const frontLeg = makeLegSnapshot({ mark: 10.0 });
      const backLeg = makeLegSnapshot({ mark: 25.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot,
        }),
      );
      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      // netMark = 25 - 10 = 15; pnlOpen = (15 - 5) * 2 * 100 = 2000
      expect(parseFloat(row.pnlOpen)).toBeCloseTo((15 - 5) * 2 * 100, 5);
    });

    it("sets source='cboe' on every row", async () => {
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));
      const useCase = makeSnapshotCalendarsUseCase(makeDeps({ persistSnapshot }));
      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(row.source).toBe("cboe");
    });

    it("sets dteFront and dteBack as integer calendar days", async () => {
      // now = 2026-07-01; frontExpiry = 2026-07-18 (17 days); backExpiry = 2026-09-19 (80 days)
      const now = new Date("2026-07-01T19:00:00Z");
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ now: () => now, persistSnapshot }),
      );
      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(row.dteFront).toBe(17);
      expect(row.dteBack).toBe(80);
    });
  });

  describe("NaN-leg path (D-06) — row still written", () => {
    it("when frontLeg.bsmIv='NaN': frontIv='NaN', row is still written", async () => {
      const frontLeg = makeLegSnapshot({ bsmIv: "NaN", mark: 10.0 });
      const backLeg = makeLegSnapshot({ bsmIv: "0.25", mark: 20.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(makeDeps({ resolveLegs, persistSnapshot }));
      await useCase();

      expect(persistSnapshot).toHaveBeenCalledTimes(1);
      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(row.frontIv).toBe("NaN");
      // When front is NaN, greeks are NaN too
      expect(row.netDelta).toBe("NaN");
      expect(row.termSlope).toBe("NaN");
    });

    it("when frontLeg.bsmIv='NaN': pnlOpen and marks still populate", async () => {
      const cal = makeCalendar({ qty: 1, openNetDebit: 5.0 });
      const frontLeg = makeLegSnapshot({ bsmIv: "NaN", mark: 10.0 });
      const backLeg = makeLegSnapshot({ bsmIv: "0.25", mark: 25.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot,
        }),
      );
      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      // Marks still compute
      expect(row.frontMark).toBe("10");
      expect(row.backMark).toBe("25");
      expect(row.netMark).toBe("15");
      // pnlOpen still computes from marks (not greeks): (15 - 5) * 1 * 100 = 1000
      expect(parseFloat(row.pnlOpen)).toBeCloseTo(1000, 5);
    });

    it("when front resolves null (storage error): row still written with NaN fields", async () => {
      const cal = makeCalendar({ qty: 1, openNetDebit: 3.0 });
      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        if (callCount === 1) {
          // Front leg fails
          return err<StorageError>({ kind: "storage-error", message: "not found" });
        }
        return ok(makeLegSnapshot({ mark: 20.0 }));
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot,
        }),
      );
      await useCase();

      // Row still persisted despite front leg error
      expect(persistSnapshot).toHaveBeenCalledTimes(1);
      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(row.frontIv).toBe("NaN");
      expect(row.netDelta).toBe("NaN");
      // Back mark still present; front mark defaults to 0
      expect(row.frontMark).toBe("0");
      expect(row.backMark).toBe("20");
    });

    it("when front resolves ok(null): treated as missing leg — NaN fields", async () => {
      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        if (callCount === 1) return ok(null); // front is null
        return ok(makeLegSnapshot({ mark: 20.0 }));
      };
      const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

      const useCase = makeSnapshotCalendarsUseCase(makeDeps({ resolveLegs, persistSnapshot }));
      await useCase();

      const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
      expect(row.frontIv).toBe("NaN");
      expect(persistSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe("error propagation", () => {
    it("returns err when getOpenCalendars fails", async () => {
      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () =>
            err<StorageError>({ kind: "storage-error", message: "DB down" }),
        }),
      );
      const result = await useCase();
      expect(result.ok).toBe(false);
    });

    it("returns err when persistSnapshot fails", async () => {
      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          persistSnapshot: async () =>
            err<StorageError>({ kind: "storage-error", message: "write failed" }),
        }),
      );
      const result = await useCase();
      expect(result.ok).toBe(false);
    });
  });

  describe("fast-check property: pnlOpen formula invariant", () => {
    it("pnlOpen = (netMark - openNetDebit) * qty * 100 for arbitrary inputs", async () => {
      await fc.assert(
        fc.asyncProperty(
          // frontMark, backMark, openNetDebit: finite numbers in a reasonable range
          fc.float({ min: 0.01, max: 500, noNaN: true }),
          fc.float({ min: 0.01, max: 500, noNaN: true }),
          fc.float({ min: 0.01, max: 50, noNaN: true }),
          // qty: positive integer
          fc.integer({ min: 1, max: 100 }),
          async (frontMark, backMark, openNetDebit, qty) => {
            const cal = makeCalendar({ qty, openNetDebit });
            const frontLeg = makeLegSnapshot({ mark: frontMark });
            const backLeg = makeLegSnapshot({ mark: backMark });

            let callCount = 0;
            const resolveLegs: ForResolvingLegSnapshot = async () => {
              callCount += 1;
              return ok(callCount === 1 ? frontLeg : backLeg);
            };
            const persistSnapshot = vi.fn().mockResolvedValue(ok(undefined));

            const useCase = makeSnapshotCalendarsUseCase(
              makeDeps({
                getOpenCalendars: async () => ok([cal]),
                resolveLegs,
                persistSnapshot,
              }),
            );
            await useCase();

            const row: SnapshotRow = persistSnapshot.mock.calls[0]?.[0] as SnapshotRow;
            const netMark = backMark - frontMark;
            const expectedPnl = (netMark - openNetDebit) * qty * 100;
            expect(parseFloat(row.pnlOpen)).toBeCloseTo(expectedPnl, 4);
          },
        ),
        { numRuns: 50 },
      );
    });
  });
});

/**
 * snapshotCalendars use-case tests — RED phase.
 *
 * TDD: Tests written before implementation. They fail because snapshotCalendars.ts
 * does not yet exist.
 *
 * Covers:
 *   - Happy path: front+back legs → exact D-05 formulas for every column
 *   - NaN-leg case (fresh-but-unsolved bsmIv): row still written with frontIv='NaN', pnlOpen populated
 *   - Idempotency: persistSnapshot called once per calendar
 *   - fast-check property: pnlOpen = (netMark - openNetDebit) * qty * 100 for any inputs
 *   - OPS-01 freshness gate: a missing or stale leg SKIPS the row entirely (no zero/NaN gap row)
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import * as fc from "fast-check";
import {
  makeSnapshotCalendarsUseCase,
  isLegFresh,
  SNAPSHOT_LEG_STALENESS_TOLERANCE_MS,
  computeLegPairMetrics,
} from "./snapshotCalendars.ts";
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

// Reusable branded OccSymbol for test doubles
const TEST_OCC = formatOccSymbol({ root: "SPX", expiry: new Date("2026-07-18T12:00:00Z"), type: "C", strike: 5000 });

// Default leg time: 1 minute before makeDeps' now (2026-07-01T19:00:00Z) — fresh under any
// reasonable tolerance, so existing fixtures stay green without every call site overriding it.
const FRESH_TIME = new Date("2026-07-01T18:59:00Z");

function makeLegSnapshot(overrides: Partial<LegSnapshot> = {}): LegSnapshot {
  return {
    occSymbol: TEST_OCC,
    time: FRESH_TIME,
    mark: 20.0,
    underlyingPrice: 5010.0,
    ivRaw: 0.22,
    bsmIv: "0.22",
    bsmDelta: "0.55",
    bsmGamma: "0.003",
    bsmTheta: "-1.8",
    bsmVega: "6.2",
    source: "cboe",
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

// ─── Typed capture helper ──────────────────────────────────────────────────────
// Capture rows via a typed array rather than extracting from vi.fn mock.calls (avoids `as` casts).
function makePersistCapture(): {
  persistSnapshot: ForPersistingSnapshot;
  rows: SnapshotRow[];
  calledTimes: () => number;
} {
  const rows: SnapshotRow[] = [];
  const persistSnapshot: ForPersistingSnapshot = async (row: SnapshotRow) => {
    rows.push(row);
    return ok(undefined);
  };
  return { persistSnapshot, rows, calledTimes: () => rows.length };
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal1, cal2]),
          persistSnapshot: capture.persistSnapshot,
        }),
      );

      await useCase();

      expect(capture.calledTimes()).toBe(2);
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

      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );

      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot: capture.persistSnapshot,
        }),
      );

      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot: capture.persistSnapshot,
        }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      // netMark = 25 - 10 = 15; pnlOpen = (15 - 5) * 2 * 100 = 2000
      expect(parseFloat(row.pnlOpen)).toBeCloseTo((15 - 5) * 2 * 100, 5);
    });

    it("sets source='cboe' on every row", async () => {
      const capture = makePersistCapture();
      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.source).toBe("cboe");
    });

    it("sets dteFront and dteBack as integer calendar days", async () => {
      // now = 2026-07-01; frontExpiry = 2026-07-18 (17 days); backExpiry = 2026-09-19 (80 days)
      const now = new Date("2026-07-01T19:00:00Z");
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ now: () => now, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      expect(capture.calledTimes()).toBe(1);
      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot: capture.persistSnapshot,
        }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      // Marks still compute
      expect(row.frontMark).toBe("10");
      expect(row.backMark).toBe("25");
      expect(row.netMark).toBe("15");
      // pnlOpen still computes from marks (not greeks): (15 - 5) * 1 * 100 = 1000
      expect(parseFloat(row.pnlOpen)).toBeCloseTo(1000, 5);
    });

    it("when front resolves with a storage error: calendar is SKIPPED (OPS-01) — no row, run still ok, warns 'resolve-error'", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot: capture.persistSnapshot,
        }),
      );
      const result = await useCase();

      // OPS-01: a resolveLegs storage error skips the row (freshness gate) instead of writing
      // a spot=0/NaN gap row. The run itself still succeeds; only this calendar's cycle is
      // skipped (self-heals next cycle). WR-01: the warn labels this "resolve-error", distinct
      // from a genuine ok(null) "missing" — an operator can tell a DB hiccup from a real miss.
      expect(result.ok).toBe(true);
      expect(capture.calledTimes()).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(warnMsg).toMatch(/front leg resolve-error/);
      expect(warnMsg).toMatch(/back leg fresh/);
      warnSpy.mockRestore();
    });
  });

  describe("freshness gate (OPS-01) — Jul-06 gap-row shapes eliminated", () => {
    it("Test A (zero-row shape): a missing leg (resolveLegs ok(null)) → persistSnapshot called ZERO times, warns", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        if (callCount === 1) return ok(null); // front is missing
        return ok(makeLegSnapshot({ mark: 20.0 }));
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      expect(capture.calledTimes()).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = String(warnSpy.mock.calls[0]?.[0] ?? "");
      expect(warnMsg).toMatch(/cal-001/);
      // WR-01: a genuine ok(null) miss is labeled "missing", distinct from "stale"/"resolve-error"
      expect(warnMsg).toMatch(/front leg missing/);
      expect(warnMsg).toMatch(/back leg fresh/);
      warnSpy.mockRestore();
    });

    it("Test B (stale-serve shape): both legs resolve but the front leg is older than the tolerance → skipped, warns with age", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const now = new Date("2026-07-01T19:00:00Z");
      const staleTime = new Date(now.getTime() - SNAPSHOT_LEG_STALENESS_TOLERANCE_MS - 1);
      const frontLeg = makeLegSnapshot({ time: staleTime, mark: 10.0 });
      const backLeg = makeLegSnapshot({ mark: 20.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      // Was: stale marks silently served. Now: skipped, zero persists.
      expect(capture.calledTimes()).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      const warnMsg = String(warnSpy.mock.calls[0]?.[0] ?? "");
      // WR-01: staleness age (minutes) + the observed/now timestamps are in the diagnostic
      expect(warnMsg).toMatch(/front leg stale \(45m, observed 2026-07-01T18:14:59\.999Z, now 2026-07-01T19:00:00\.000Z\)/);
      expect(warnMsg).toMatch(/back leg fresh/);
      warnSpy.mockRestore();
    });

    it("Test C (boundary): a leg exactly at the tolerance edge is fresh; one ms past is stale", () => {
      const now = new Date("2026-07-01T19:00:00Z");
      const atEdge = makeLegSnapshot({
        time: new Date(now.getTime() - SNAPSHOT_LEG_STALENESS_TOLERANCE_MS),
      });
      const pastEdge = makeLegSnapshot({
        time: new Date(now.getTime() - SNAPSHOT_LEG_STALENESS_TOLERANCE_MS - 1),
      });

      // Documented boundary semantics: <= tolerance = fresh, > tolerance = stale.
      expect(isLegFresh(atEdge, now)).toBe(true);
      expect(isLegFresh(pastEdge, now)).toBe(false);
      expect(isLegFresh(null, now)).toBe(false);
    });

    it("Test D (regression, both fresh): exactly one persist, row identical to today's D-05/D-06 output", async () => {
      const capture = makePersistCapture();
      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      expect(capture.calledTimes()).toBe(1);
      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.frontIv).toBe("0.22");
      expect(row.backIv).toBe("0.22");
    });

    it("Test E (D-06 preserved): both legs fresh but front bsmIv='NaN' → row STILL written with NaN greeks + populated marks", async () => {
      const frontLeg = makeLegSnapshot({ bsmIv: "NaN", mark: 10.0 });
      const backLeg = makeLegSnapshot({ bsmIv: "0.25", mark: 25.0 });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      // Freshness gate is about age/presence, NOT BSM solve state — D-06 continuity holds.
      expect(capture.calledTimes()).toBe(1);
      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.frontIv).toBe("NaN");
      expect(row.frontMark).toBe("10");
      expect(row.backMark).toBe("25");
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

  describe("SC3 regression: snapshot source propagation from leg observations", () => {
    it("when leg source is 'schwab_chain', snapshot row source is 'schwab_chain'", async () => {
      const front = makeLegSnapshot({ source: "schwab_chain" });
      const back = makeLegSnapshot({ source: "schwab_chain" });
      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? front : back);
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.source).toBe("schwab_chain");
    });

    it("when leg source is 'cboe', snapshot row source is 'cboe' (no regression)", async () => {
      const front = makeLegSnapshot({ source: "cboe" });
      const back = makeLegSnapshot({ source: "cboe" });
      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? front : back);
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.source).toBe("cboe");
    });
  });

  describe("trigger provenance (D-12)", () => {
    it("defaults trigger to 'scheduled' when the use-case is called with no args", async () => {
      const capture = makePersistCapture();
      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.trigger).toBe("scheduled");
    });

    it("stamps every row with 'event-move' when called with { trigger: 'event-move' }", async () => {
      const cal1 = makeCalendar({ id: "cal-001" });
      const cal2 = makeCalendar({ id: "cal-002" });
      const capture = makePersistCapture();
      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal1, cal2]),
          persistSnapshot: capture.persistSnapshot,
        }),
      );

      await useCase({ trigger: "event-move" });

      expect(capture.calledTimes()).toBe(2);
      for (const row of capture.rows) {
        expect(row.trigger).toBe("event-move");
      }
    });
  });

  describe("computeLegPairMetrics — PICK-04 extraction (27-02, Pattern 5)", () => {
    it("is directly callable with literal LegSnapshots (no Calendar row needed) and returns the leg-pair metric fields", () => {
      const front = makeLegSnapshot({ mark: 10.0, bsmIv: "0.20", bsmDelta: "0.40" });
      const back = makeLegSnapshot({ mark: 25.0, bsmIv: "0.25", bsmDelta: "0.55" });
      const now = new Date("2026-07-01T19:00:00Z");

      const metrics = computeLegPairMetrics(now, front, back, 2, "2026-07-18", "2026-09-19");

      expect(metrics.netMark).toBe("15");
      expect(metrics.frontMark).toBe("10");
      expect(metrics.backMark).toBe("25");
      expect(metrics.frontIv).toBe("0.20");
      expect(metrics.backIv).toBe("0.25");
      expect(parseFloat(metrics.netDelta)).toBeCloseTo((0.55 - 0.40) * 2 * 100, 5);
      expect(parseFloat(metrics.termSlope)).toBeCloseTo(0.25 - 0.20, 10);
      expect(metrics.dteFront).toBe(17);
      expect(metrics.dteBack).toBe(80);
      expect(metrics.source).toBe("cboe");
      // calendarId/pnlOpen/trigger are NOT on this return type (Omit<SnapshotRow, ...>) —
      // a hypothetical (never-traded) candidate has no Calendar row to derive them from.
      expect(Object.hasOwn(metrics, "calendarId")).toBe(false);
      expect(Object.hasOwn(metrics, "pnlOpen")).toBe(false);
      expect(Object.hasOwn(metrics, "trigger")).toBe(false);
    });

    it("parity: buildSnapshotRow's output (via the live use-case) is byte-identical to computeLegPairMetrics + calendarId/pnlOpen/trigger", async () => {
      const cal = makeCalendar({ id: "cal-parity", qty: 3, openNetDebit: 4.5 });
      const frontLeg = makeLegSnapshot({ mark: 12.0, bsmIv: "0.18" });
      const backLeg = makeLegSnapshot({ mark: 22.0, bsmIv: "0.23" });
      const now = new Date("2026-07-01T19:00:00Z");

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          getOpenCalendars: async () => ok([cal]),
          resolveLegs,
          persistSnapshot: capture.persistSnapshot,
          now: () => now,
        }),
      );
      await useCase();

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");

      const metrics = computeLegPairMetrics(now, frontLeg, backLeg, cal.qty, cal.frontExpiry, cal.backExpiry);
      const expectedPnlOpen = String((parseFloat(metrics.netMark) - cal.openNetDebit) * cal.qty * 100);

      expect(row).toEqual({
        ...metrics,
        calendarId: cal.id,
        pnlOpen: expectedPnlOpen,
        trigger: "scheduled",
      });
    });
  });

  describe("HIST-05 slot-rounding — scheduled row time collapses to the 30-min slot boundary", () => {
    it("two scheduled invocations whose now falls in the same 30-min RTH slot produce byte-identical SnapshotRow.time", async () => {
      // Monday 2026-06-15, EDT (UTC-4) — mirrors rth-slot.test.ts's own example.
      const legTime = new Date("2026-06-15T14:00:00Z");
      const leg = makeLegSnapshot({ time: legTime });
      const capture1 = makePersistCapture();
      const capture2 = makePersistCapture();

      const useCase1 = makeSnapshotCalendarsUseCase(
        makeDeps({
          now: () => new Date("2026-06-15T14:03:00Z"), // 10:03 ET
          resolveLegs: async () => ok(leg),
          persistSnapshot: capture1.persistSnapshot,
        }),
      );
      const useCase2 = makeSnapshotCalendarsUseCase(
        makeDeps({
          now: () => new Date("2026-06-15T14:14:00Z"), // 10:14 ET, same slot
          resolveLegs: async () => ok(leg),
          persistSnapshot: capture2.persistSnapshot,
        }),
      );

      await useCase1();
      await useCase2();

      const row1 = capture1.rows[0];
      const row2 = capture2.rows[0];
      if (row1 === undefined || row2 === undefined) throw new Error("no row captured");
      expect(row1.time.getTime()).toBe(row2.time.getTime());
      expect(row1.time.getTime()).toBe(new Date("2026-06-15T14:00:00Z").getTime()); // 10:00 ET slot start
    });

    it("event-move trigger keeps the real unrounded now as SnapshotRow.time (D-07)", async () => {
      const now = new Date("2026-06-15T14:14:00Z"); // 10:14 ET, mid-slot
      const leg = makeLegSnapshot({ time: new Date("2026-06-15T14:00:00Z") });
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({
          now: () => now,
          resolveLegs: async () => ok(leg),
          persistSnapshot: capture.persistSnapshot,
        }),
      );

      await useCase({ trigger: "event-move" });

      const row = capture.rows[0];
      if (row === undefined) throw new Error("no row captured");
      expect(row.time.getTime()).toBe(now.getTime());
    });

    it("OPS-01 freshness gate still evaluates against the real now, not the rounded slot — a leg stale relative to real-now is still skipped", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const now = new Date("2026-06-15T14:14:00Z"); // 10:14 ET
      // Stale relative to REAL now (14:14), but would look FRESH if freshness wrongly used the
      // rounded slot start (14:00) instead — this is the regression the split clock guards.
      const staleTime = new Date(now.getTime() - SNAPSHOT_LEG_STALENESS_TOLERANCE_MS - 1);
      const frontLeg = makeLegSnapshot({ time: staleTime });
      const backLeg = makeLegSnapshot({ time: new Date("2026-06-15T14:00:00Z") });

      let callCount = 0;
      const resolveLegs: ForResolvingLegSnapshot = async () => {
        callCount += 1;
        return ok(callCount === 1 ? frontLeg : backLeg);
      };
      const capture = makePersistCapture();

      const useCase = makeSnapshotCalendarsUseCase(
        makeDeps({ now: () => now, resolveLegs, persistSnapshot: capture.persistSnapshot }),
      );
      await useCase();

      expect(capture.calledTimes()).toBe(0);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("fast-check property: pnlOpen formula invariant", () => {
    it("pnlOpen = (netMark - openNetDebit) * qty * 100 for arbitrary inputs", async () => {
      await fc.assert(
        fc.asyncProperty(
          // frontMark, backMark, openNetDebit: finite 32-bit floats in a reasonable range
          // fast-check v4: min/max must be 32-bit floats (Math.fround per Phase-1 P02 decision)
          fc.float({ min: Math.fround(0.01), max: Math.fround(500), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(500), noNaN: true }),
          fc.float({ min: Math.fround(0.01), max: Math.fround(50), noNaN: true }),
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
            const capture = makePersistCapture();

            const useCase = makeSnapshotCalendarsUseCase(
              makeDeps({
                getOpenCalendars: async () => ok([cal]),
                resolveLegs,
                persistSnapshot: capture.persistSnapshot,
              }),
            );
            await useCase();

            const row = capture.rows[0];
            if (row === undefined) throw new Error("no row captured");
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

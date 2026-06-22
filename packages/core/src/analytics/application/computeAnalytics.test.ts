/**
 * computeAnalytics use-case — both halves (Phase 6, Plans 06-04/06-05) + the cycle-resolution
 * seam fix (06-06, CR-01/CR-02).
 *
 * `makeComputeAnalyticsUseCase` reads calendar_snapshots for the current cycle and writes one
 * term_structure_observations row per calendar, with `value = term_slope` PASSED THROUGH
 * UNCHANGED (SPEC R3 — no recompute). NaN-slope continuity rows are skipped.
 *
 * Cycle-resolution seam (06-06): the use-case resolves ONE canonical cycle instant from DATA and
 * NEVER stamps now(). The smile read returns {cycleTime, quotes}; skew + RR + term rows are all
 * stamped with the resolved cycle. The tests below use DISTINCT instants — SMILE_TIME, SNAPSHOT_TIME
 * and NOW are all different — so an exact-now() read/stamp fails them (RED for the old code).
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import { makeComputeAnalyticsUseCase } from "./computeAnalytics.ts";
import type {
  ForReadingSmileSource,
  ForReadingCalendarSnapshotsForCycle,
  ForWritingSkewObservations,
  ForWritingRiskReversalObservations,
  ForWritingTermStructureObservations,
  ForReadingRiskReversalHistory,
  CalendarSnapshotForCycle,
  SmileQuote,
  SkewObservationRow,
  RiskReversalObservationRow,
  TermStructureObservationRow,
} from "./ports.ts";

// ─── Distinct instants (06-06 seam): broker observedAt != snapshotTime != now() ────
const SMILE_TIME = new Date("2026-07-01T18:30:00Z"); // broker observedAt (leg cohort)
const SNAPSHOT_TIME = new Date("2026-07-01T19:00:00Z"); // calendar_snapshots cycle
const NOW = new Date("2026-07-01T19:07:42Z"); // wall-clock now() — never stamped
const NOW_LATER = new Date("2026-07-01T19:42:11Z"); // a different now() for re-run idempotency

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAL_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Default smile stub for the term-structure-only tests: empty cohort.
const emptySmile: ForReadingSmileSource = async () => ok({ cycleTime: null, quotes: [] });
const writeSkew: ForWritingSkewObservations = async () => ok(undefined);
const writeRr: ForWritingRiskReversalObservations = async () => ok(undefined);
const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

function makeSnapshot(
  calendarId: string,
  termSlope: number,
  frontIv = 0.2,
  backIv = 0.25,
): CalendarSnapshotForCycle {
  return { snapshotTime: SNAPSHOT_TIME, calendarId, termSlope, frontIv, backIv };
}

// A writeTerm spy that captures the rows it is handed and stores them idempotently
// (mirrors the repo's onConflictDoNothing grain so re-runs do not duplicate).
function makeWriteTermSpy() {
  const store = new Map<string, TermStructureObservationRow>();
  const calls: ReadonlyArray<TermStructureObservationRow>[] = [];
  const writeTerm: ForWritingTermStructureObservations = async (rows) => {
    calls.push(rows);
    for (const row of rows) {
      const key = `${row.snapshotTime.toISOString()}|${row.calendarId}`;
      if (!store.has(key)) store.set(key, row);
    }
    return ok(undefined);
  };
  return {
    writeTerm,
    get rows(): TermStructureObservationRow[] {
      return [...store.values()];
    },
    get calls() {
      return calls;
    },
  };
}

describe("makeComputeAnalyticsUseCase — term-structure half", () => {
  it("is callable with the full stub dependency surface and returns a runnable use-case", () => {
    const spy = makeWriteTermSpy();
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () => ok([]);
    const useCase = makeComputeAnalyticsUseCase({
      readSmile: emptySmile,
      readSnapshots,
      writeSkew,
      writeRr,
      writeTerm: spy.writeTerm,
      readRrHistory,
      now: () => NOW,
    });
    expect(typeof useCase).toBe("function");
  });

  it("writes one term-structure row per snapshot whose value EQUALS the source term_slope exactly", async () => {
    const spy = makeWriteTermSpy();
    const snapshots = [
      makeSnapshot(CAL_A, 0.05, 0.2, 0.25),
      makeSnapshot(CAL_B, 0.12, 0.18, 0.3),
      makeSnapshot(CAL_C, -0.03, 0.22, 0.19),
    ];
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () => ok(snapshots);
    const useCase = makeComputeAnalyticsUseCase({
      readSmile: emptySmile, readSnapshots, writeSkew, writeRr, writeTerm: spy.writeTerm, readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(spy.rows).toHaveLength(3);

    // R3 lock: written value === source term_slope, bit-for-bit (no recompute).
    for (const src of snapshots) {
      const written = spy.rows.find((r) => r.calendarId === src.calendarId);
      expect(written).toBeDefined();
      if (written === undefined) continue;
      expect(written.value).toBe(src.termSlope);
      expect(written.frontIv).toBe(src.frontIv);
      expect(written.backIv).toBe(src.backIv);
      expect(written.snapshotTime.getTime()).toBe(src.snapshotTime.getTime());
    }
  });

  it("is idempotent — running twice yields the same rows (no duplicates)", async () => {
    const spy = makeWriteTermSpy();
    const snapshots = [makeSnapshot(CAL_A, 0.05), makeSnapshot(CAL_B, 0.12)];
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () => ok(snapshots);
    const useCase = makeComputeAnalyticsUseCase({
      readSmile: emptySmile, readSnapshots, writeSkew, writeRr, writeTerm: spy.writeTerm, readRrHistory,
      now: () => NOW,
    });

    await useCase();
    await useCase();
    expect(spy.rows).toHaveLength(2);
  });

  it("skips NaN-slope continuity snapshots — writes 0 term-structure rows for them", async () => {
    const spy = makeWriteTermSpy();
    const snapshots = [
      makeSnapshot(CAL_A, Number.NaN, Number.NaN, 0.25),
      makeSnapshot(CAL_B, 0.1, 0.2, 0.3),
    ];
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () => ok(snapshots);
    const useCase = makeComputeAnalyticsUseCase({
      readSmile: emptySmile, readSnapshots, writeSkew, writeRr, writeTerm: spy.writeTerm, readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    // Only CAL_B (finite slope) is written; the NaN row is dropped.
    expect(spy.rows).toHaveLength(1);
    expect(spy.rows[0]?.calendarId).toBe(CAL_B);
  });
});

// ─── Skew / risk-reversal half (06-05) ─────────────────────────────────────────

// No term-structure for these tests — readSnapshots returns [].
const noSnapshots: ForReadingCalendarSnapshotsForCycle = async () => ok([]);
const noTermWrite: ForWritingTermStructureObservations = async () => ok(undefined);

// A skew spy that records written rows idempotently (mirrors the repo grain).
function makeWriteSkewSpy() {
  const store = new Map<string, SkewObservationRow>();
  const writeSkew: ForWritingSkewObservations = async (rows) => {
    for (const row of rows) {
      const key = `${row.snapshotTime.toISOString()}|${row.underlying}|${row.expiration}|${row.strike}`;
      if (!store.has(key)) store.set(key, row);
    }
    return ok(undefined);
  };
  return {
    writeSkew,
    get rows(): SkewObservationRow[] {
      return [...store.values()];
    },
  };
}

// An RR spy storing rows idempotently on the (snapshot_time, underlying, expiration) grain.
function makeWriteRrSpy() {
  const store = new Map<string, RiskReversalObservationRow>();
  const writeRr: ForWritingRiskReversalObservations = async (rows) => {
    for (const row of rows) {
      const key = `${row.snapshotTime.toISOString()}|${row.underlying}|${row.expiration}`;
      if (!store.has(key)) store.set(key, row);
    }
    return ok(undefined);
  };
  return {
    writeRr,
    get rows(): RiskReversalObservationRow[] {
      return [...store.values()];
    },
  };
}

// The worked-example smile (06-03): IV(25Δ put)=0.200, IV(25Δ call)=0.140 → rr=0.06.
function workedExampleSmile(underlying: string, expiration: string): SmileQuote[] {
  return [
    { underlying, expiration, strike: 5400000, iv: 0.18, delta: -0.2, moneyness: 0.98 },
    { underlying, expiration, strike: 5300000, iv: 0.22, delta: -0.3, moneyness: 0.96 },
    { underlying, expiration, strike: 5600000, iv: 0.15, delta: 0.3, moneyness: 1.02 },
    { underlying, expiration, strike: 5550000, iv: 0.13, delta: 0.2, moneyness: 1.01 },
  ];
}

/**
 * A smile stub that records the anchor it was called with and resolves the cohort to SMILE_TIME.
 * Mirrors the bounded "latest leg cycle ≤ anchor" adapter: cycleTime is the resolved DATA instant
 * (SMILE_TIME), never the passed anchor and never now().
 */
function makeSmileStub(quotes: SmileQuote[], cycleTime: Date | null = SMILE_TIME) {
  const anchors: Date[] = [];
  const readSmile: ForReadingSmileSource = async (anchor) => {
    anchors.push(anchor);
    return ok({ cycleTime: quotes.length === 0 ? null : cycleTime, quotes });
  };
  return {
    readSmile,
    get anchors(): Date[] {
      return anchors;
    },
  };
}

describe("makeComputeAnalyticsUseCase — skew / risk-reversal half", () => {
  it("writes the full N×M smile (one row per (underlying, expiration, strike)); re-run adds 0", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    // 2 expiries × 4 strikes = 8 smile rows.
    const smile = [
      ...workedExampleSmile("SPX", "2026-07-17"),
      ...workedExampleSmile("SPX", "2026-08-21"),
    ];
    const smileStub = makeSmileStub(smile);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => NOW,
    });

    const first = await useCase();
    expect(first.ok).toBe(true);
    expect(skewSpy.rows).toHaveLength(8);

    await useCase(); // idempotent re-run (same now)
    expect(skewSpy.rows).toHaveLength(8);
  });

  it("computes risk_reversal ≈ 0.06 from the worked-example smile", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const smileStub = makeSmileStub(workedExampleSmile("SPX", "2026-07-17"));
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(rrSpy.rows).toHaveLength(1);
    const row = rrSpy.rows[0];
    expect(row?.underlying).toBe("SPX");
    expect(row?.expiration).toBe("2026-07-17");
    expect(row?.riskReversal).not.toBeNull();
    expect(row?.riskReversal ?? Number.NaN).toBeCloseTo(0.06, 6);
  });

  it("writes null risk_reversal AND null rr_rank when ±25Δ cannot be bracketed (no fabricated number)", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    // Put wing too shallow to reach −0.25 → unbracketable.
    const unbracketable: SmileQuote[] = [
      { underlying: "SPX", expiration: "2026-07-17", strike: 5600000, iv: 0.17, delta: 0.1, moneyness: 1.02 },
      { underlying: "SPX", expiration: "2026-07-17", strike: 5700000, iv: 0.16, delta: 0.05, moneyness: 1.04 },
    ];
    const smileStub = makeSmileStub(unbracketable);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(rrSpy.rows).toHaveLength(1);
    expect(rrSpy.rows[0]?.riskReversal).toBeNull();
    expect(rrSpy.rows[0]?.rrRank).toBeNull();
  });

  it("sets rr_rank to the trailing-window inclusive percentile of the computed risk_reversal", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const smileStub = makeSmileStub(workedExampleSmile("SPX", "2026-07-17")); // rr = 0.06
    // History: percentileRank(0.06, [0.01,0.05,0.07,0.09]) = 100·2/4 = 50.
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([0.01, 0.05, 0.07, 0.09]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(rrSpy.rows[0]?.rrRank ?? Number.NaN).toBeCloseTo(50, 6);
  });
});

// ─── Cycle-resolution seam (06-06 / CR-01 + CR-02) ─────────────────────────────

describe("makeComputeAnalyticsUseCase — data-anchored cycle resolution (CR-01/CR-02)", () => {
  it("stamps skew + RR + term rows all with the resolved cycle, NOT now()", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const termSpy = makeWriteTermSpy();
    const smileStub = makeSmileStub(workedExampleSmile("SPX", "2026-07-17"), SNAPSHOT_TIME);
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () =>
      ok([makeSnapshot(CAL_A, 0.05)]);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: termSpy.writeTerm,
      readRrHistory,
      now: () => NOW, // a THIRD distinct instant
    });

    const result = await useCase();
    expect(result.ok).toBe(true);

    // Skew rows stamped with the resolved cycle (SNAPSHOT_TIME), never NOW.
    expect(skewSpy.rows.length).toBeGreaterThan(0);
    for (const row of skewSpy.rows) {
      expect(row.snapshotTime.getTime()).toBe(SNAPSHOT_TIME.getTime());
      expect(row.snapshotTime.getTime()).not.toBe(NOW.getTime());
    }
    // RR rows likewise.
    expect(rrSpy.rows.length).toBeGreaterThan(0);
    for (const row of rrSpy.rows) {
      expect(row.snapshotTime.getTime()).toBe(SNAPSHOT_TIME.getTime());
      expect(row.snapshotTime.getTime()).not.toBe(NOW.getTime());
    }
    // Term rows stamped with the snapshot cycle.
    for (const row of termSpy.rows) {
      expect(row.snapshotTime.getTime()).toBe(SNAPSHOT_TIME.getTime());
    }

    // Cross-table agreement (SC1): skew == term == RR snapshot_time for the cycle.
    const skewT = skewSpy.rows[0]?.snapshotTime.getTime();
    const termT = termSpy.rows[0]?.snapshotTime.getTime();
    const rrT = rrSpy.rows[0]?.snapshotTime.getTime();
    expect(skewT).toBe(termT);
    expect(skewT).toBe(rrT);
  });

  it("calls readSmile with the snapshot anchor (not now()) when snapshots exist", async () => {
    const smileStub = makeSmileStub(workedExampleSmile("SPX", "2026-07-17"), SNAPSHOT_TIME);
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () =>
      ok([makeSnapshot(CAL_A, 0.05)]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots,
      writeSkew,
      writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => NOW,
    });

    await useCase();
    expect(smileStub.anchors).toHaveLength(1);
    expect(smileStub.anchors[0]?.getTime()).toBe(SNAPSHOT_TIME.getTime());
    expect(smileStub.anchors[0]?.getTime()).not.toBe(NOW.getTime());
  });

  it("passes the resolved cycle (not now()) as beforeOrAt to the RR history reader", async () => {
    let historyQuery: { underlying: string; expiration: string; beforeOrAt: Date } | undefined;
    const smileStub = makeSmileStub(workedExampleSmile("SPX", "2026-07-17"), SNAPSHOT_TIME);
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () =>
      ok([makeSnapshot(CAL_A, 0.05)]);
    const readRrHistory: ForReadingRiskReversalHistory = async (query) => {
      historyQuery = query;
      return ok([]);
    };

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots,
      writeSkew,
      writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => NOW,
    });

    await useCase();
    expect(historyQuery?.underlying).toBe("SPX");
    expect(historyQuery?.expiration).toBe("2026-07-17");
    expect(historyQuery?.beforeOrAt.getTime()).toBe(SNAPSHOT_TIME.getTime());
    expect(historyQuery?.beforeOrAt.getTime()).not.toBe(NOW.getTime());
  });

  it("is idempotent across a now()-advanced re-run — skew/RR/term counts unchanged (CR-02)", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const termSpy = makeWriteTermSpy();
    const smile = workedExampleSmile("SPX", "2026-07-17");
    const readSnapshots: ForReadingCalendarSnapshotsForCycle = async () =>
      ok([makeSnapshot(CAL_A, 0.05)]);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    // First run at NOW. Smile resolves to SNAPSHOT_TIME (the data anchor).
    const firstStub = makeSmileStub(smile, SNAPSHOT_TIME);
    const firstRun = makeComputeAnalyticsUseCase({
      readSmile: firstStub.readSmile, readSnapshots,
      writeSkew: skewSpy.writeSkew, writeRr: rrSpy.writeRr, writeTerm: termSpy.writeTerm,
      readRrHistory, now: () => NOW,
    });
    await firstRun();
    const skewAfterFirst = skewSpy.rows.length;
    const rrAfterFirst = rrSpy.rows.length;
    const termAfterFirst = termSpy.rows.length;
    expect(skewAfterFirst).toBeGreaterThan(0);

    // Second run at a DIFFERENT now() — but the resolved cycle is still SNAPSHOT_TIME, so the PKs
    // collide and the idempotent spies show unchanged counts.
    const secondStub = makeSmileStub(smile, SNAPSHOT_TIME);
    const secondRun = makeComputeAnalyticsUseCase({
      readSmile: secondStub.readSmile, readSnapshots,
      writeSkew: skewSpy.writeSkew, writeRr: rrSpy.writeRr, writeTerm: termSpy.writeTerm,
      readRrHistory, now: () => NOW_LATER,
    });
    await secondRun();

    expect(skewSpy.rows).toHaveLength(skewAfterFirst);
    expect(rrSpy.rows).toHaveLength(rrAfterFirst);
    expect(termSpy.rows).toHaveLength(termAfterFirst);
  });

  it("snapshots-absent fallback: anchor = now(), smile resolves to its own cycle; skew/RR written, 0 term", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const termSpy = makeWriteTermSpy();
    // No snapshots → the smile read is anchored at now(); the bounded read resolves SMILE_TIME.
    const smileStub = makeSmileStub(workedExampleSmile("SPX", "2026-07-17"), SMILE_TIME);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile: smileStub.readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: termSpy.writeTerm,
      readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);

    // Anchor passed to readSmile is now() (no snapshot anchor available).
    expect(smileStub.anchors[0]?.getTime()).toBe(NOW.getTime());
    // Skew/RR stamped with the smile's own resolved cycle (SMILE_TIME), not now().
    expect(skewSpy.rows.length).toBeGreaterThan(0);
    for (const row of skewSpy.rows) {
      expect(row.snapshotTime.getTime()).toBe(SMILE_TIME.getTime());
    }
    expect(rrSpy.rows[0]?.snapshotTime.getTime()).toBe(SMILE_TIME.getTime());
    // No snapshots → 0 term rows.
    expect(termSpy.rows).toHaveLength(0);
  });

  it("clean no-op: no snapshots and an empty smile cohort → no writes, ok(undefined)", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const termSpy = makeWriteTermSpy();
    const useCase = makeComputeAnalyticsUseCase({
      readSmile: emptySmile, // cycleTime null, no quotes
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: termSpy.writeTerm,
      readRrHistory,
      now: () => NOW,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(skewSpy.rows).toHaveLength(0);
    expect(rrSpy.rows).toHaveLength(0);
    expect(termSpy.rows).toHaveLength(0);
  });
});

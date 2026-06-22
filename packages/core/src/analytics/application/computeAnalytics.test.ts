/**
 * computeAnalytics use-case — term-structure half (Phase 6, Plan 06-04 Task 2).
 *
 * `makeComputeAnalyticsUseCase` reads calendar_snapshots for the current cycle and writes one
 * term_structure_observations row per calendar, with `value = term_slope` PASSED THROUGH
 * UNCHANGED (SPEC R3 — no recompute). NaN-slope continuity rows are skipped.
 *
 * The skew/RR half (readSmile/writeSkew/writeRr/readRrHistory) lands in 06-05; those deps are
 * accepted now but exercised there.
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

const CYCLE = new Date("2026-07-01T19:00:00Z");
const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAL_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Skew/RR-half stubs (no-op for the term-structure half; exercised in 06-05).
const readSmile: ForReadingSmileSource = async () => ok([]);
const writeSkew: ForWritingSkewObservations = async () => ok(undefined);
const writeRr: ForWritingRiskReversalObservations = async () => ok(undefined);
const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

function makeSnapshot(
  calendarId: string,
  termSlope: number,
  frontIv = 0.2,
  backIv = 0.25,
): CalendarSnapshotForCycle {
  return { snapshotTime: CYCLE, calendarId, termSlope, frontIv, backIv };
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
      readSmile,
      readSnapshots,
      writeSkew,
      writeRr,
      writeTerm: spy.writeTerm,
      readRrHistory,
      now: () => CYCLE,
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
      readSmile, readSnapshots, writeSkew, writeRr, writeTerm: spy.writeTerm, readRrHistory,
      now: () => CYCLE,
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
      readSmile, readSnapshots, writeSkew, writeRr, writeTerm: spy.writeTerm, readRrHistory,
      now: () => CYCLE,
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
      readSmile, readSnapshots, writeSkew, writeRr, writeTerm: spy.writeTerm, readRrHistory,
      now: () => CYCLE,
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

// An RR spy capturing the last batch of rows written.
function makeWriteRrSpy() {
  const all: RiskReversalObservationRow[] = [];
  const writeRr: ForWritingRiskReversalObservations = async (rows) => {
    all.push(...rows);
    return ok(undefined);
  };
  return {
    writeRr,
    get rows(): RiskReversalObservationRow[] {
      return all;
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

describe("makeComputeAnalyticsUseCase — skew / risk-reversal half", () => {
  it("writes the full N×M smile (one row per (underlying, expiration, strike)); re-run adds 0", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    // 2 expiries × 4 strikes = 8 smile rows.
    const smile = [
      ...workedExampleSmile("SPX", "2026-07-17"),
      ...workedExampleSmile("SPX", "2026-08-21"),
    ];
    const readSmile: ForReadingSmileSource = async () => ok(smile);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => CYCLE,
    });

    const first = await useCase();
    expect(first.ok).toBe(true);
    expect(skewSpy.rows).toHaveLength(8);

    await useCase(); // idempotent re-run
    expect(skewSpy.rows).toHaveLength(8);
  });

  it("computes risk_reversal ≈ 0.06 from the worked-example smile", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    const readSmile: ForReadingSmileSource = async () =>
      ok(workedExampleSmile("SPX", "2026-07-17"));
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => CYCLE,
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
    const readSmile: ForReadingSmileSource = async () => ok(unbracketable);
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => CYCLE,
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
    const readSmile: ForReadingSmileSource = async () =>
      ok(workedExampleSmile("SPX", "2026-07-17")); // rr = 0.06
    // History: three of four prior values ≤ 0.06 → inclusive rank counts 0.06 itself once added.
    // percentileRank(0.06, [0.01,0.05,0.07,0.09]) = 100·(count ≤ 0.06)/4 = 100·2/4 = 50.
    const readRrHistory: ForReadingRiskReversalHistory = async () => ok([0.01, 0.05, 0.07, 0.09]);

    const useCase = makeComputeAnalyticsUseCase({
      readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => CYCLE,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(rrSpy.rows[0]?.rrRank ?? Number.NaN).toBeCloseTo(50, 6);
  });

  it("passes the computed snapshot time + (underlying, expiration) to the RR history reader", async () => {
    const skewSpy = makeWriteSkewSpy();
    const rrSpy = makeWriteRrSpy();
    let historyQuery: { underlying: string; expiration: string; beforeOrAt: Date } | undefined;
    const readSmile: ForReadingSmileSource = async () =>
      ok(workedExampleSmile("SPX", "2026-07-17"));
    const readRrHistory: ForReadingRiskReversalHistory = async (query) => {
      historyQuery = query;
      return ok([]);
    };

    const useCase = makeComputeAnalyticsUseCase({
      readSmile,
      readSnapshots: noSnapshots,
      writeSkew: skewSpy.writeSkew,
      writeRr: rrSpy.writeRr,
      writeTerm: noTermWrite,
      readRrHistory,
      now: () => CYCLE,
    });

    await useCase();
    expect(historyQuery?.underlying).toBe("SPX");
    expect(historyQuery?.expiration).toBe("2026-07-17");
    expect(historyQuery?.beforeOrAt.getTime()).toBe(CYCLE.getTime());
  });
});

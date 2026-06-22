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

/**
 * runBacktest.test.ts (Phase 27, Plan 06, Task 1) — the orchestrator that reduces the three
 * 05 replay paths into one persisted BacktestReport.
 *
 * Core cannot import @morai/adapters or testcontainers (architecture-boundaries §2) --
 * mirrors 05's in-memory-fake precedent. Each replay path's OWN correctness (score math,
 * haircut pricing, gap handling) is already covered by replayPickerCohort.test.ts /
 * replayExitsForCalendar.test.ts / replayHypotheticalEntry.test.ts -- these tests only cover
 * runBacktest's OWN job: enumerate, orchestrate, reduce with the 04 kernel, assemble, persist
 * exactly once.
 *
 * The stored picker_snapshot fixture uses an EMPTY ruleSet, which deterministically trips the
 * registry-drift guard (one CohortMismatch per cohort) -- avoids hand-building a byte-exact
 * score-reproducing fixture, which replayPickerCohort.test.ts already exercises.
 */

import { describe, it, expect } from "vitest";
import { ok, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { Calendar, CalendarEvent, EconomicEvent, ForListingCalendars, ForReadingCalendarEvents, ForReadingEconomicEvents } from "@morai/core";
import { makeRunBacktestUseCase } from "./runBacktest.ts";
import type { RunBacktestDeps } from "./runBacktest.ts";
import type {
  BacktestRunRow,
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  ForReadingFullSnapshotHistoryForCalendar,
  ForReadingPickerSnapshotsInRange,
  FullHistorySnapshotRow,
  StorageError,
  StoredPickerSnapshotRow,
} from "../application/ports.ts";

const R = 0.04;
const Q = 0.013;

const COHORT_1 = new Date("2026-07-01T14:30:00.000Z");
const COHORT_2 = new Date("2026-07-02T14:30:00.000Z");
const NOW = new Date("2026-07-09T12:00:00.000Z");

const CALENDAR_A: Calendar = {
  id: "cal-a",
  underlying: "SPX",
  strike: 7500000,
  optionType: "P",
  frontExpiry: "2026-07-31",
  backExpiry: "2026-08-28",
  qty: 1,
  openNetDebit: 1.2,
  status: "closed",
  openedAt: new Date("2026-06-15T14:30:00.000Z"),
  closedAt: new Date("2026-06-20T14:30:00.000Z"),
  notes: null,
};
const CALENDAR_B: Calendar = { ...CALENDAR_A, id: "cal-b" };

function storedSnapshot(): Record<string, unknown> {
  return {
    gexContextStatus: "missing",
    eventsContextStatus: "missing",
    events: [],
    gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null, nearTerm: null },
    // Deliberately empty -- guarantees a deterministic registry-drift mismatch (never equal to
    // the real RULE_SET_METADATA), so this fixture doesn't need to reproduce an exact score.
    ruleSet: [],
    candidates: [],
    gateDrops: { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 },
  };
}

function chainLeg(strikePoints: number, expiration: string, time: Date): ChainLegQuoteAsOf {
  const occSymbol = formatOccSymbol({
    root: "SPX",
    expiry: new Date(`${expiration}T00:00:00.000Z`),
    type: "P",
    strike: strikePoints,
  });
  return {
    occSymbol,
    strike: strikePoints * 1000,
    expiration,
    contractType: "P",
    bid: 99,
    ask: 101,
    mark: 100,
    bsmIv: 0.15,
    bsmDelta: -0.4,
    bsmGamma: 0.001,
    bsmTheta: -0.5,
    bsmVega: 1.2,
    openInterest: 1000,
    underlyingPrice: 7500,
    source: "schwab_chain",
    time,
  };
}

function candidateChain(time: Date): ReadonlyArray<ChainLegQuoteAsOf> {
  const strikes = [7600, 7550, 7500, 7450, 7400];
  const expiries = ["2026-07-31", "2026-08-26"];
  const chain: ChainLegQuoteAsOf[] = [];
  for (const expiration of expiries) {
    for (const strike of strikes) chain.push(chainLeg(strike, expiration, time));
  }
  return chain;
}

function fakeSnapshotsInRange(cohorts: ReadonlyArray<Date>): ForReadingPickerSnapshotsInRange {
  return async (): Promise<Result<ReadonlyArray<StoredPickerSnapshotRow>, StorageError>> =>
    ok(cohorts.map((observedAt) => ({ observedAt, snapshot: storedSnapshot() })));
}
function fakeChainAsOf(): ForReadingChainAsOf {
  return async (asOfT: Date): Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>> => ok(candidateChain(asOfT));
}
function fakeCloses(): ForReadingDailySpotClosesAsOf {
  return async (): Promise<Result<ReadonlyArray<number>, StorageError>> => ok([]);
}
function fakeHistory(rows: ReadonlyArray<FullHistorySnapshotRow>): ForReadingFullSnapshotHistoryForCalendar {
  return async (): Promise<Result<ReadonlyArray<FullHistorySnapshotRow>, StorageError>> => ok(rows);
}
function closeEvent(calendarId: string, realizedPnl: number): CalendarEvent {
  return {
    id: `evt-${calendarId}`,
    calendarId,
    eventType: "CLOSE",
    eventedAt: new Date("2026-06-20T14:30:00.000Z"),
    fillIdsHash: "a".repeat(64),
    legOccSymbol: "TEST",
    rolledFromOccSymbol: null,
    qty: 1,
    avgPrice: 1.5,
    netAmount: -150,
    realizedPnl,
    legBreakdown: null,
    entryThesis: null,
    rollOpenDebit: null,
    rollCloseCredit: null,
  };
}
function fakeCalendarEvents(events: ReadonlyArray<CalendarEvent>): ForReadingCalendarEvents {
  return async (): Promise<Result<ReadonlyArray<CalendarEvent>, StorageError>> => ok(events);
}
function fakeEconomicEvents(events: ReadonlyArray<EconomicEvent> = []): ForReadingEconomicEvents {
  return async (): Promise<Result<ReadonlyArray<EconomicEvent>, StorageError>> => ok(events);
}
function fakeListCalendars(closed: ReadonlyArray<Calendar>): ForListingCalendars {
  return async (): Promise<Result<ReadonlyArray<Calendar>, StorageError>> => ok(closed);
}

function baseDeps(overrides: Partial<RunBacktestDeps> = {}): RunBacktestDeps {
  return {
    readPickerSnapshotsInRange: fakeSnapshotsInRange([COHORT_1, COHORT_2]),
    readChainAsOf: fakeChainAsOf(),
    readDailySpotClosesAsOf: fakeCloses(),
    readFullSnapshotHistoryForCalendar: fakeHistory([
      { calendarId: CALENDAR_A.id, time: CALENDAR_A.openedAt, netMark: 1.2, frontIv: 0.15, backIv: 0.16, dteFront: 30, dteBack: 58, spot: 7500, source: "cboe" },
    ]),
    readCalendarEvents: fakeCalendarEvents([closeEvent(CALENDAR_A.id, 30)]),
    readEconomicEvents: fakeEconomicEvents(),
    listCalendars: fakeListCalendars([CALENDAR_A]),
    persistBacktestRun: async (): Promise<Result<void, StorageError>> => ok(undefined),
    rate: R,
    dividendYield: Q,
    now: () => NOW,
    ...overrides,
  };
}

describe("runBacktest", () => {
  it("assembles a fully-stamped report and persists it exactly once", async () => {
    const persisted: BacktestRunRow[] = [];
    const deps = baseDeps({
      persistBacktestRun: async (row: BacktestRunRow): Promise<Result<void, StorageError>> => {
        persisted.push(row);
        return ok(undefined);
      },
    });
    const runBacktest = makeRunBacktestUseCase(deps);
    const result = await runBacktest({ from: COHORT_1, to: COHORT_2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value;

    expect(report.n).toBe(2);
    expect(report.fromDate).toBe("2026-07-01");
    expect(report.toDate).toBe("2026-07-02");
    expect(report.generatedAt).toBe(NOW.toISOString());
    expect(report.mismatches).toHaveLength(2); // one registry-drift per cohort
    expect(report.mismatches.every((m) => m.kind === "registry-drift")).toBe(true);
    expect(report.tradeReproductions).toHaveLength(1);
    expect(report.tradeReproductions[0]?.calendarId).toBe(CALENDAR_A.id);
    expect(report.attribution).toHaveLength(9); // one row per BreakdownCriterion
    expect(report.ablation).toHaveLength(9);
    expect(report.ci.length).toBeGreaterThan(0);
    for (const row of report.ci) expect(row.low).toBeLessThanOrEqual(row.high);
    expect(report.coverage.length).toBeGreaterThan(0);
    expect(report.caveats.length).toBeGreaterThan(0);
    expect(report.caveats.some((c) => c.includes("bsm"))).toBe(true);
    expect(report.caveats.some((c) => c.includes("event"))).toBe(true);

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.report).toEqual(report);
  });

  it("attribution and ablation rows are structurally valid for every criterion", async () => {
    const runBacktest = makeRunBacktestUseCase(baseDeps());
    const result = await runBacktest({ from: COHORT_1, to: COHORT_2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const row of result.value.attribution) {
      expect(["positive", "negative", "insufficient"]).toContain(row.sign);
      expect(row.n).toBeGreaterThanOrEqual(0);
    }
    for (const row of result.value.ablation) {
      expect(Number.isFinite(row.rankDelta)).toBe(true);
      expect(Number.isFinite(row.outcomeDelta)).toBe(true);
      expect(row.n).toBeGreaterThanOrEqual(0);
    }
  });

  it("an empty range still produces a valid degenerate report and persists once", async () => {
    const persisted: BacktestRunRow[] = [];
    const deps = baseDeps({
      readPickerSnapshotsInRange: fakeSnapshotsInRange([]),
      listCalendars: fakeListCalendars([]),
      persistBacktestRun: async (row: BacktestRunRow): Promise<Result<void, StorageError>> => {
        persisted.push(row);
        return ok(undefined);
      },
    });
    const runBacktest = makeRunBacktestUseCase(deps);
    const result = await runBacktest({ from: COHORT_1, to: COHORT_2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.n).toBe(0);
    expect(result.value.mismatches).toEqual([]);
    expect(result.value.tradeReproductions).toEqual([]);
    expect(result.value.attribution.every((r) => r.sign === "insufficient" && r.n === 0)).toBe(true);
    expect(result.value.ablation.every((r) => r.n === 0)).toBe(true);
    expect(persisted).toHaveLength(1);
  });

  it("propagates a StorageError from readPickerSnapshotsInRange and never persists", async () => {
    const persisted: BacktestRunRow[] = [];
    const storageError: StorageError = { kind: "storage-error", message: "range read failed" };
    const deps = baseDeps({
      readPickerSnapshotsInRange: async (): Promise<Result<ReadonlyArray<StoredPickerSnapshotRow>, StorageError>> => ({ ok: false, error: storageError }),
      persistBacktestRun: async (row: BacktestRunRow): Promise<Result<void, StorageError>> => {
        persisted.push(row);
        return ok(undefined);
      },
    });
    const runBacktest = makeRunBacktestUseCase(deps);
    const result = await runBacktest({ from: COHORT_1, to: COHORT_2 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("range read failed");
    expect(persisted).toHaveLength(0);
  });

  it("a calendarId filter narrows trade reproduction to that one calendar", async () => {
    const deps = baseDeps({
      listCalendars: fakeListCalendars([CALENDAR_A, CALENDAR_B]),
      readCalendarEvents: fakeCalendarEvents([closeEvent(CALENDAR_A.id, 30), closeEvent(CALENDAR_B.id, -10)]),
    });
    const runBacktest = makeRunBacktestUseCase(deps);
    const result = await runBacktest({ from: COHORT_1, to: COHORT_2, calendarId: CALENDAR_B.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tradeReproductions).toHaveLength(1);
    expect(result.value.tradeReproductions[0]?.calendarId).toBe(CALENDAR_B.id);
  });
});

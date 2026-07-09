/**
 * computePickerSnapshot tests (Phase 19, Plan 06) — the read→select→score→tag→persist
 * orchestration seam, per tdd.md.
 *
 * Covers:
 *   - A seeded chain + GEX + events persists exactly one PickerSnapshotRow whose observedAt
 *     equals the chain cohort's data time, source from the cohort, candidates sorted
 *     score-desc capped at PICKER_TOP_N, both statuses "ok".
 *   - GEX context null -> gexContextStatus "missing" AND every candidate's gexFit
 *     contribution is 0.
 *   - economic_events empty -> eventsContextStatus "missing" AND eventAdjustment
 *     contribution is 0 (never a fabricated 1-fraction "no penalty" credit).
 *   - GEX computedAt older than the freshness window -> gexContextStatus "stale" (term
 *     still zeroed, D-17).
 *   - economic_events all older than the freshness window -> eventsContextStatus "stale"
 *     (term still zeroed, D-17 symmetry).
 *   - Empty chain cohort -> no row persisted, ok(undefined).
 *   - Chain present but zero candidates survive net-theta>0 -> a row IS persisted with
 *     candidates: [] (D-18), not ok(undefined).
 *   - rankAndCapCandidates: stable tie-break by id when scores are equal.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  makeComputePickerSnapshotUseCase,
  rankAndCapCandidates,
  PICKER_TOP_N,
  GEX_FRESHNESS_WINDOW_MS,
  EVENTS_FRESHNESS_WINDOW_MS,
} from "./computePickerSnapshot.ts";
import { selectCandidates } from "../domain/candidate-selection.ts";
import { scoreCalendarCandidates } from "../domain/scoring.ts";
import type {
  ChainQuoteForPicker,
  EconomicEvent,
  ForPersistingPickerSnapshot,
  ForReadingChainForPicker,
  ForReadingEconomicEvents,
  ForReadingGexContext,
  ForReadingPickerSnapshot,
  GexContextForPicker,
  PickerGate,
  PickerSnapshotRow,
  StorageError,
} from "../application/ports.ts";
import type {
  Calendar,
  ForGettingOpenCalendars,
  ForReadingMacroObservations,
  ForReadingRecentClosedCalendars,
  MacroObservationRow,
  RecentClosedCalendar,
} from "../../journal/index.ts";

const R = 0.04;
const Q = 0.013;

// ─────────────────────────────────────────────────────────────
// Synthetic chain builder (candidate-selection.test.ts precedent) — strike ×1000 convention.
// ─────────────────────────────────────────────────────────────
function chainQuote(
  strikePoints: number,
  expiration: string,
  iv: number,
  contractType: "C" | "P" = "P",
  underlyingPrice = 7500,
): ChainQuoteForPicker {
  return {
    time: new Date("2026-07-01T14:30:00.000Z"),
    strike: strikePoints * 1000,
    expiration,
    contractType,
    underlyingPrice,
    bsmIv: String(iv),
    bid: 99,
    ask: 101,
    openInterest: 1000,
    source: "schwab",
  };
}

/** A chain with a valid front (dte30) paired to two valid backs (dte56, dte76) -- produces
 * real, positive-theta candidates across the 4 delta rungs (candidate-selection.test.ts
 * "dedupes" fixture, reused verbatim). */
function realCandidateChain(): ChainQuoteForPicker[] {
  const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
  const expiries = ["2026-07-31", "2026-08-26", "2026-09-15"];
  const chain: ChainQuoteForPicker[] = [];
  for (const expiration of expiries) {
    for (const strike of strikes) {
      chain.push(chainQuote(strike, expiration, 0.15));
    }
  }
  return chain;
}

/** A chain whose only pairing has net theta <= 0 -- selectCandidates returns []. */
function zeroCandidateChain(): ChainQuoteForPicker[] {
  const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
  const chain: ChainQuoteForPicker[] = [];
  for (const strike of strikes) {
    chain.push(chainQuote(strike, "2026-07-31", 0.05, "P")); // front: dte 30, low iv
    chain.push(chainQuote(strike, "2026-08-21", 2.5, "P")); // back: dte 51, extreme iv
  }
  return chain;
}

const GEX_CONTEXT_FRESH: GexContextForPicker = {
  flip: 7480,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -47,
  absGammaStrike: 7500,
  nearTermFlip: null,
  nearTermCallWall: null,
  nearTermPutWall: null,
  computedAt: new Date("2026-07-01T14:00:00.000Z"), // 1h before "now" below
};

const GEX_CONTEXT_STALE: GexContextForPicker = {
  ...GEX_CONTEXT_FRESH,
  computedAt: new Date("2026-06-28T14:00:00.000Z"), // ~3 days before "now" below
};

const FUTURE_EVENTS: ReadonlyArray<EconomicEvent> = [
  { date: "2026-07-15", name: "FOMC", source: "seed" },
];

const STALE_EVENTS: ReadonlyArray<EconomicEvent> = [
  { date: "2026-06-01", name: "CPI", source: "fred" }, // ~1 month before "now" below
];

/** "now" for every test -- 30 minutes after the chain cohort's own time. */
const NOW = new Date("2026-07-01T15:00:00.000Z");
const NOW_ISO = "2026-07-01";

// ─────────────────────────────────────────────────────────────
// Entry-gate fixtures (28-03, PLAY-01/PLAY-02) — VIXCLS/VXVCLS macro rows, open calendars,
// recent-closed calendars.
// ─────────────────────────────────────────────────────────────

/** Calm macro pair -- VIX 15, VIX3M 20 (ratio 0.75) -- both well under the penalty floors. */
const CALM_MACRO_ROWS: ReadonlyArray<MacroObservationRow> = [
  { seriesId: "VIXCLS", date: NOW_ISO, value: 15, source: "fred" },
  { seriesId: "VXVCLS", date: NOW_ISO, value: 20, source: "fred" },
];

/** Penalty-band macro pair -- VIX 22 (in [20,25)), VIX3M 25 (ratio 0.88, under its own floor). */
const PENALTY_MACRO_ROWS: ReadonlyArray<MacroObservationRow> = [
  { seriesId: "VIXCLS", date: NOW_ISO, value: 22, source: "fred" },
  { seriesId: "VXVCLS", date: NOW_ISO, value: 25, source: "fred" },
];

/** Crisis macro pair -- VIX 26 (>= 25 block arm), ratio 1.3 (>= 0.95 block arm). */
const BLOCKED_MACRO_ROWS: ReadonlyArray<MacroObservationRow> = [
  { seriesId: "VIXCLS", date: NOW_ISO, value: 26, source: "fred" },
  { seriesId: "VXVCLS", date: NOW_ISO, value: 20, source: "fred" },
];

function openCalendar(id: string): Calendar {
  return {
    id,
    underlying: "SPX",
    strike: 7500000,
    optionType: "P",
    frontExpiry: "2026-07-31",
    backExpiry: "2026-08-26",
    qty: 1,
    openNetDebit: 1000,
    status: "open",
    openedAt: new Date("2026-06-01T14:30:00.000Z"),
    closedAt: null,
    notes: null,
  };
}

function lossRow(
  calendarId: string,
  closedAt: Date,
  openNetDebit: number,
  realizedPnl: number | null,
): RecentClosedCalendar {
  return { calendarId, closedAt, openNetDebit, realizedPnl };
}

function fakeReadMacroObservations(
  rows: ReadonlyArray<MacroObservationRow>,
): ForReadingMacroObservations {
  return async (): Promise<Result<ReadonlyArray<MacroObservationRow>, StorageError>> => ok(rows);
}

function fakeReadOpenCalendars(calendars: ReadonlyArray<Calendar>): ForGettingOpenCalendars {
  return async (): Promise<Result<ReadonlyArray<Calendar>, StorageError>> => ok(calendars);
}

function fakeReadRecentClosedCalendars(
  rows: ReadonlyArray<RecentClosedCalendar>,
): ForReadingRecentClosedCalendars {
  return async (): Promise<Result<ReadonlyArray<RecentClosedCalendar>, StorageError>> => ok(rows);
}

function fakeReadPickerSnapshot(row: PickerSnapshotRow | null): ForReadingPickerSnapshot {
  return async (): Promise<Result<PickerSnapshotRow | null, StorageError>> => ok(row);
}

/** A minimal persisted PickerSnapshotRow carrying only the `gate` field a hysteresis
 * self-read test cares about — the rest of the snapshot is never touched by resolveEntryGate. */
function previousSnapshotWithGate(gate: PickerGate): PickerSnapshotRow {
  return {
    observedAt: new Date("2026-06-30T14:30:00.000Z"),
    snapshot: {
      asOf: "2026-06-30",
      observedAt: "2026-06-30T14:30:00.000Z",
      spot: 7500,
      source: "schwab",
      gexContextStatus: "ok",
      eventsContextStatus: "ok",
      marketSession: "rth",
      termStructure: [],
      gex: { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null, nearTerm: null },
      events: [],
      candidates: [],
      ruleSet: [],
      gateDrops: { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 },
      gate,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Port fakes
// ─────────────────────────────────────────────────────────────

function fakeReadChain(chain: ReadonlyArray<ChainQuoteForPicker>): ForReadingChainForPicker {
  return async (): Promise<Result<ReadonlyArray<ChainQuoteForPicker>, StorageError>> => ok(chain);
}

function fakeReadGexContext(context: GexContextForPicker | null): ForReadingGexContext {
  return async (): Promise<Result<GexContextForPicker | null, StorageError>> => ok(context);
}

function fakeReadEvents(events: ReadonlyArray<EconomicEvent>): ForReadingEconomicEvents {
  return async (): Promise<Result<ReadonlyArray<EconomicEvent>, StorageError>> => ok(events);
}

function makeRecordingPersist(): {
  readonly persistPickerSnapshot: ForPersistingPickerSnapshot;
  readonly rows: PickerSnapshotRow[];
} {
  const rows: PickerSnapshotRow[] = [];
  const persistPickerSnapshot: ForPersistingPickerSnapshot = async (
    row: PickerSnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    rows.push(row);
    return ok(undefined);
  };
  return { persistPickerSnapshot, rows };
}

function baseDeps(overrides: {
  readonly chain?: ReadonlyArray<ChainQuoteForPicker>;
  readonly gexContext?: GexContextForPicker | null;
  readonly events?: ReadonlyArray<EconomicEvent>;
  readonly dailyCloses?: ReadonlyArray<number>;
  readonly slopeHistory?: ReadonlyArray<number>;
  readonly macroRows?: ReadonlyArray<MacroObservationRow>;
  readonly macroReadError?: boolean;
  readonly openCalendars?: ReadonlyArray<Calendar>;
  readonly openCalendarsReadError?: boolean;
  readonly recentClosed?: ReadonlyArray<RecentClosedCalendar>;
  readonly recentClosedReadError?: boolean;
  readonly previousSnapshot?: PickerSnapshotRow | null;
}) {
  const { persistPickerSnapshot, rows } = makeRecordingPersist();
  // Note: `??` would coalesce an explicit `null` (missing-GEX fixture) back to the default --
  // `gexContext` must be distinguished by presence-of-key, not nullishness.
  const gexContext = "gexContext" in overrides ? (overrides.gexContext ?? null) : GEX_CONTEXT_FRESH;
  const storageError: StorageError = { kind: "storage-error", message: "read failed" };

  let readMacroCallCount = 0;
  const readMacroObservationsInner = fakeReadMacroObservations(overrides.macroRows ?? CALM_MACRO_ROWS);
  const readMacroObservations: ForReadingMacroObservations = async () => {
    readMacroCallCount += 1;
    if (overrides.macroReadError === true) return err(storageError);
    return readMacroObservationsInner();
  };

  const readOpenCalendarsInner = fakeReadOpenCalendars(overrides.openCalendars ?? []);
  const readOpenCalendars: ForGettingOpenCalendars = async () => {
    if (overrides.openCalendarsReadError === true) return err(storageError);
    return readOpenCalendarsInner();
  };

  const readRecentClosedCalendarsInner = fakeReadRecentClosedCalendars(overrides.recentClosed ?? []);
  const readRecentClosedCalendars: ForReadingRecentClosedCalendars = async (sinceDate: string) => {
    if (overrides.recentClosedReadError === true) return err(storageError);
    return readRecentClosedCalendarsInner(sinceDate);
  };

  const previousSnapshot = "previousSnapshot" in overrides ? (overrides.previousSnapshot ?? null) : null;

  return {
    deps: {
      readChainForPicker: fakeReadChain(overrides.chain ?? realCandidateChain()),
      readGexContext: fakeReadGexContext(gexContext),
      readEconomicEvents: fakeReadEvents(overrides.events ?? FUTURE_EVENTS),
      persistPickerSnapshot,
      readDailySpotCloses: async (): Promise<Result<ReadonlyArray<number>, StorageError>> =>
        ok(overrides.dailyCloses ?? []),
      readPickerSlopeHistory: async (): Promise<Result<ReadonlyArray<number>, StorageError>> =>
        ok(overrides.slopeHistory ?? []),
      readMacroObservations,
      readOpenCalendars,
      readRecentClosedCalendars,
      readPickerSnapshot: fakeReadPickerSnapshot(previousSnapshot),
      rate: R,
      dividendYield: Q,
      now: () => NOW,
    },
    rows,
    readMacroCallCount: () => readMacroCallCount,
  };
}

describe("makeComputePickerSnapshotUseCase", () => {
  it("persists exactly one row: observedAt = cohort time, source from cohort, candidates ranked and capped, both statuses ok", async () => {
    const { deps, rows } = baseDeps({});
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.observedAt).toEqual(new Date("2026-07-01T14:30:00.000Z"));
    // WR-03: the snapshot's own observedAt field mirrors the row's instant exactly (full ISO,
    // not date-only asOf) — the UI freshness dot needs the real instant, not the calendar day.
    expect(row.snapshot.observedAt).toBe(row.observedAt.toISOString());
    expect(row.snapshot.source).toBe("schwab");
    expect(row.snapshot.gexContextStatus).toBe("ok");
    expect(row.snapshot.eventsContextStatus).toBe("ok");
    expect(row.snapshot.candidates.length).toBeGreaterThan(0);
    expect(row.snapshot.candidates.length).toBeLessThanOrEqual(PICKER_TOP_N);

    for (let i = 1; i < row.snapshot.candidates.length; i += 1) {
      const prevCandidate = row.snapshot.candidates[i - 1];
      const currCandidate = row.snapshot.candidates[i];
      expect(prevCandidate).toBeDefined();
      expect(currCandidate).toBeDefined();
      if (prevCandidate === undefined || currCandidate === undefined) continue;
      expect(prevCandidate.score).toBeGreaterThanOrEqual(currCandidate.score);
    }
  });

  it("GEX context null -> gexContextStatus missing AND every candidate's gexFit contributes 0", async () => {
    const { deps, rows } = baseDeps({ gexContext: null });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.gexContextStatus).toBe("missing");
    expect(row.snapshot.candidates.length).toBeGreaterThan(0);
    for (const candidate of row.snapshot.candidates) {
      const gexFitEntry = candidate.breakdown.find((entry) => entry.criterion === "gexFit");
      expect(gexFitEntry).toBeDefined();
      if (gexFitEntry !== undefined) {
        expect(gexFitEntry.contribution).toBe(0);
      }
    }
  });

  it("economic_events empty -> eventsContextStatus missing AND eventAdjustment contributes 0", async () => {
    const { deps, rows } = baseDeps({ events: [] });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.eventsContextStatus).toBe("missing");
    expect(row.snapshot.candidates.length).toBeGreaterThan(0);
    for (const candidate of row.snapshot.candidates) {
      const eventEntry = candidate.breakdown.find((entry) => entry.criterion === "eventAdjustment");
      expect(eventEntry).toBeDefined();
      if (eventEntry !== undefined) {
        expect(eventEntry.contribution).toBe(0);
      }
    }
  });

  it("GEX computedAt older than the freshness window -> gexContextStatus stale, term still zeroed", async () => {
    const { deps, rows } = baseDeps({ gexContext: GEX_CONTEXT_STALE });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.gexContextStatus).toBe("stale");
    for (const candidate of row.snapshot.candidates) {
      const gexFitEntry = candidate.breakdown.find((entry) => entry.criterion === "gexFit");
      expect(gexFitEntry).toBeDefined();
      if (gexFitEntry !== undefined) {
        expect(gexFitEntry.contribution).toBe(0);
      }
    }
  });

  it("economic_events all older than the freshness window -> eventsContextStatus stale, term still zeroed", async () => {
    const { deps, rows } = baseDeps({ events: STALE_EVENTS });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.eventsContextStatus).toBe("stale");
    for (const candidate of row.snapshot.candidates) {
      const eventEntry = candidate.breakdown.find((entry) => entry.criterion === "eventAdjustment");
      expect(eventEntry).toBeDefined();
      if (eventEntry !== undefined) {
        expect(eventEntry.contribution).toBe(0);
      }
    }
  });

  it("empty chain cohort -> no row persisted, ok(undefined)", async () => {
    const { deps, rows } = baseDeps({ chain: [] });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result).toEqual(ok(undefined));
    expect(rows).toHaveLength(0);
  });

  it("chain present but zero candidates survive net-theta>0 -> a row IS persisted with candidates: []", async () => {
    const { deps, rows } = baseDeps({ chain: zeroCandidateChain() });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.candidates).toEqual([]);
    expect(row.snapshot.asOf).toBe("2026-07-01");
  });

  it("propagates a chain read error", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "chain read failed" };
    const { deps } = baseDeps({});
    const useCase = makeComputePickerSnapshotUseCase({
      ...deps,
      readChainForPicker: async () => err(storageError),
    });

    const result = await useCase();
    expect(result).toEqual(err(storageError));
  });
});

describe("makeComputePickerSnapshotUseCase — entry gate (28-03, PLAY-01/PLAY-02)", () => {
  it("calm macro pair -> gate open, penaltyMultiplier 1, candidates present, gate evaluated ONCE", async () => {
    const { deps, rows, readMacroCallCount } = baseDeps({});
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.gate.state).toBe("open");
    expect(row.snapshot.gate.penaltyMultiplier).toBe(1);
    expect(row.snapshot.gate.brakes).toEqual({ maxOpen: false, cooldown: false, cooldownUntil: null });
    expect(row.snapshot.candidates.length).toBeGreaterThan(0);
    // T-28-10 regression: the gate read is called exactly once per invocation, never per candidate.
    expect(readMacroCallCount()).toBe(1);
    // T-28-10 regression: no RULE_SET_METADATA row represents the market gate (retired-gate scar).
    expect(row.snapshot.ruleSet.some((r) => /gate/i.test(r.id) || /gate/i.test(r.label))).toBe(false);
  });

  it("crisis VIX/ratio -> gate blocked, candidates: [] while termStructure/gex/events stay populated", async () => {
    const { deps, rows } = baseDeps({ macroRows: BLOCKED_MACRO_ROWS });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.gate.state).toBe("blocked");
    expect(row.snapshot.candidates).toEqual([]);
    expect(row.snapshot.termStructure.length).toBeGreaterThan(0);
    expect(row.snapshot.gex.putWall).not.toBeNull();
    expect(row.snapshot.events.length).toBeGreaterThan(0);
  });

  it("missing macro data -> gate blind (GATE BLIND, fails closed), candidates: []", async () => {
    const { deps, rows } = baseDeps({ macroRows: [] });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.gate.state).toBe("blind");
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("max-open brake tripped (6 open calendars) -> candidates: [], gate.brakes.maxOpen true, gate.state stays open", async () => {
    const openCalendars = Array.from({ length: 6 }, (_v, i) => openCalendar(`c${i}`));
    const { deps, rows } = baseDeps({ openCalendars });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // Calm VIX/ratio -> the crisis-gate LABEL stays "open"; the brake alone pauses entries.
    expect(row.snapshot.gate.state).toBe("open");
    expect(row.snapshot.gate.brakes.maxOpen).toBe(true);
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("loss-cooldown brake tripped (-26% close) -> candidates: [], gate.brakes.cooldown true + cooldownUntil named", async () => {
    const recentClosed = [lossRow("c1", new Date("2026-06-30T20:00:00.000Z"), 1000, -260)];
    const { deps, rows } = baseDeps({ recentClosed });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    expect(row.snapshot.gate.brakes.cooldown).toBe(true);
    expect(row.snapshot.gate.brakes.cooldownUntil).not.toBeNull();
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("a -24.9% close does NOT trip the cooldown brake (boundary, USER DECISION 2)", async () => {
    const recentClosed = [lossRow("c1", new Date("2026-06-30T20:00:00.000Z"), 1000, -249)];
    const { deps, rows } = baseDeps({ recentClosed });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    await useCase();
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.gate.brakes.cooldown).toBe(false);
    expect(row.snapshot.candidates.length).toBeGreaterThan(0);
  });

  it("penalty band -> every candidate's score is scaled down, breakdown untouched, re-ranked", async () => {
    const calm = baseDeps({});
    const calmResult = await makeComputePickerSnapshotUseCase(calm.deps)();
    expect(calmResult.ok).toBe(true);
    const calmRow = calm.rows[0];
    expect(calmRow).toBeDefined();
    if (calmRow === undefined) return;

    const penalty = baseDeps({ macroRows: PENALTY_MACRO_ROWS });
    const penaltyResult = await makeComputePickerSnapshotUseCase(penalty.deps)();
    expect(penaltyResult.ok).toBe(true);
    const penaltyRow = penalty.rows[0];
    expect(penaltyRow).toBeDefined();
    if (penaltyRow === undefined) return;

    expect(penaltyRow.snapshot.gate.state).toBe("penalty");
    expect(penaltyRow.snapshot.gate.penaltyMultiplier).toBeLessThan(1);
    expect(penaltyRow.snapshot.gate.penaltyMultiplier).toBeGreaterThan(0);
    expect(penaltyRow.snapshot.candidates.length).toBe(calmRow.snapshot.candidates.length);

    for (let i = 0; i < penaltyRow.snapshot.candidates.length; i += 1) {
      const calmCandidate = calmRow.snapshot.candidates[i];
      const penaltyCandidate = penaltyRow.snapshot.candidates[i];
      expect(calmCandidate).toBeDefined();
      expect(penaltyCandidate).toBeDefined();
      if (calmCandidate === undefined || penaltyCandidate === undefined) continue;
      // Same id at the same rank -> the multiplier scaled scores without reshuffling this fixture.
      expect(penaltyCandidate.id).toBe(calmCandidate.id);
      expect(penaltyCandidate.score).toBeLessThanOrEqual(calmCandidate.score);
      // Breakdown is untouched -- the gate penalty is not one of the 9 weighted criteria.
      expect(penaltyCandidate.breakdown).toEqual(calmCandidate.breakdown);
    }
  });

  it("a macro read error fails the gate CLOSED (blind), never a default-open", async () => {
    const { deps, rows } = baseDeps({ macroReadError: true });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.gate.state).toBe("blind");
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("a recent-closed read error fails the gate CLOSED (blind), never a default-open", async () => {
    const { deps, rows } = baseDeps({ recentClosedReadError: true });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.gate.state).toBe("blind");
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("an open-calendars read error fails the gate CLOSED (blind), never a default-open", async () => {
    const { deps, rows } = baseDeps({ openCalendarsReadError: true });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.gate.state).toBe("blind");
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("hysteresis: a held-blocked previous state stays blocked at a value between disarm and arm", async () => {
    // Previous cycle: VIX 26 -> blocked, tagged vixBlocked. This cycle: VIX 24.5 -- below the
    // 25 fresh-arm threshold but above the 24 disarm floor -- held-armed, stays blocked.
    const previousGate: PickerGate = {
      vix: 26,
      vix3m: 20,
      ratio: 1.3,
      asOf: "2026-06-30",
      state: "blocked",
      penaltyMultiplier: 0,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: ["vixBlocked", "ratioBlocked"],
    };
    const heldRows: ReadonlyArray<MacroObservationRow> = [
      { seriesId: "VIXCLS", date: NOW_ISO, value: 24.5, source: "fred" },
      { seriesId: "VXVCLS", date: NOW_ISO, value: 28, source: "fred" }, // ratio ~0.875, well clear
    ];
    const { deps, rows } = baseDeps({
      macroRows: heldRows,
      previousSnapshot: previousSnapshotWithGate(previousGate),
    });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.gate.state).toBe("blocked");
    expect(row.snapshot.candidates).toEqual([]);
  });

  it("no previous snapshot (cold start) -> hysteresis has nothing to hold, fresh-arm rules only", async () => {
    const { deps, rows } = baseDeps({ macroRows: CALM_MACRO_ROWS, previousSnapshot: null });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;
    expect(row.snapshot.gate.state).toBe("open");
  });
});

describe("rankAndCapCandidates", () => {
  it("sorts score-desc and breaks ties deterministically by ascending id", () => {
    const chain = realCandidateChain();
    const { candidates: raw } = selectCandidates(chain, [], { r: R, q: Q });
    const scored = scoreCalendarCandidates(raw, null, { r: R, q: Q });
    expect(scored.length).toBeGreaterThanOrEqual(2);

    // Force two candidates to the same score to exercise the tie-break path.
    const first = scored[0];
    const second = scored[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const tiedHigh = { ...first, id: "zzz-tied", score: 42 };
    const tiedLow = { ...second, id: "aaa-tied", score: 42 };
    const rest = scored.slice(2);

    const ranked = rankAndCapCandidates([tiedHigh, tiedLow, ...rest], PICKER_TOP_N);
    const tiedIndexHigh = ranked.findIndex((c) => c.id === "zzz-tied");
    const tiedIndexLow = ranked.findIndex((c) => c.id === "aaa-tied");
    expect(tiedIndexLow).toBeGreaterThanOrEqual(0);
    expect(tiedIndexHigh).toBeGreaterThanOrEqual(0);
    // Equal score (42) -> ascending id order: "aaa-tied" before "zzz-tied".
    expect(tiedIndexLow).toBeLessThan(tiedIndexHigh);
  });

  it("caps the result at topN", () => {
    const chain = realCandidateChain();
    const { candidates: raw } = selectCandidates(chain, [], { r: R, q: Q });
    const scored = scoreCalendarCandidates(raw, null, { r: R, q: Q });
    const ranked = rankAndCapCandidates(scored, 1);
    expect(ranked.length).toBeLessThanOrEqual(1);
  });
});

// Sanity: exported freshness-window constants exist and are positive durations (ms).
describe("exported freshness-window constants", () => {
  it("GEX_FRESHNESS_WINDOW_MS and EVENTS_FRESHNESS_WINDOW_MS are positive", () => {
    expect(GEX_FRESHNESS_WINDOW_MS).toBeGreaterThan(0);
    expect(EVENTS_FRESHNESS_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe("rule registry in the snapshot (rules.ts)", () => {
  it("ships ruleSet metadata, gateDrops counts, and per-candidate experimental context", async () => {
    const { deps, rows } = baseDeps({
      dailyCloses: [7400, 7410, 7405, 7420, 7415, 7430, 7425, 7440, 7450, 7445],
      slopeHistory: [0.05, 0.1, 0.3],
    });
    const useCase = makeComputePickerSnapshotUseCase(deps);

    const result = await useCase();
    expect(result.ok).toBe(true);
    const row = rows[0];
    expect(row).toBeDefined();
    if (row === undefined) return;

    // ruleSet mirrors the registry: 5 active scores summing to 100, gates, experimental.
    const activeScores = row.snapshot.ruleSet.filter(
      (r) => r.kind === "score" && r.status === "active",
    );
    expect(activeScores.reduce((sum, r) => sum + r.weight, 0)).toBe(100);
    expect(row.snapshot.ruleSet.some((r) => r.id === "liquidity" && r.kind === "gate")).toBe(true);
    expect(row.snapshot.ruleSet.some((r) => r.id === "vrp" && r.status === "active")).toBe(true);

    // Gate drops present (all-liquid fixture → zero drops, but the field is real).
    expect(row.snapshot.gateDrops).toEqual({ liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 });

    // Every candidate carries the 2 remaining experimental context entries; slopePercentile is
    // real numbers given the supplied history.
    const candidate = row.snapshot.candidates[0];
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    const ids = candidate.context.map((c) => c.id).sort();
    expect(ids).toEqual(["backEventBonus", "slopePercentile"]);
    const pct = candidate.context.find((c) => c.id === "slopePercentile");
    expect(pct?.value).not.toBeNull();
    // vrp is scored now — its breakdown entry carries the real RV-fed rawValue.
    expect(candidate.breakdown.some((b) => b.criterion === "vrp")).toBe(true);
  });

  it("labels the snapshot's market session: rth for an in-hours cohort, after-hours otherwise", async () => {
    // Baseline fixture cohort time is 14:30Z on a weekday = RTH.
    const { deps, rows } = baseDeps({});
    const useCase = makeComputePickerSnapshotUseCase(deps);
    await useCase();
    expect(rows[0]?.snapshot.marketSession).toBe("rth");

    // Same chain re-stamped at 22:00Z (after the 20:00Z cash close) = after-hours.
    const shifted = realCandidateChain().map((quote) => ({
      ...quote,
      time: new Date("2026-07-01T22:00:00.000Z"),
    }));
    const ah = baseDeps({ chain: shifted });
    await makeComputePickerSnapshotUseCase(ah.deps)();
    expect(ah.rows[0]?.snapshot.marketSession).toBe("after-hours");
  });
});

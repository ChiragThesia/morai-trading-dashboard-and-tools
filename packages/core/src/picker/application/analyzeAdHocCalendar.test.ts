/**
 * analyzeAdHocCalendar tests (Phase 30, Plan 04, Task 1, D-02) — per tdd.md's numerical-code
 * rule (fast-check property test) plus example tests for the core scoring parity guarantee.
 *
 * Covers:
 *   - Byte-parity vs `scoreCalendarCandidates` on the equivalent RawCandidate (fast-check over
 *     strike/iv/dte/debit ranges) -- T-30-10.
 *   - Gate-penalty parity: score(0.5) = round(0.5 * score(1)) -- A3.
 *   - Stale-events zeroing: eventsContextStatus !== "ok" -> eventAdjustment zeroed -- D-17.
 *   - Flat-IV paste (frontIv === backIv) surfaces slope rawValue 0 honestly -- Pitfall 6.
 *   - readPickerSnapshot StorageError propagates unchanged, never a throw.
 *
 * Task 2 (degradation, gate-blocked-still-scores, port hygiene) lands in a follow-up commit
 * in this same file.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ok, err } from "@morai/shared";
import { bsmGreeks } from "@morai/quant";
import { makeAnalyzeAdHocCalendarUseCase } from "./analyzeAdHocCalendar.ts";
import type { AnalyzeAdHocCalendarDeps } from "./analyzeAdHocCalendar.ts";
import { scoreCalendarCandidates } from "../domain/scoring.ts";
import { resolvePickerRuleConfig } from "../domain/rule-config.ts";
import type { RawCandidate } from "../domain/types.ts";
import type {
  AdHocCalendarInput,
  EconomicEvent,
  ForReadingDailySpotCloses,
  ForReadingEconomicEvents,
  ForReadingGexContext,
  ForReadingPickerSlopeHistory,
  ForReadingPickerSnapshot,
  GexContextForPicker,
  PickerGate,
  PickerSnapshot,
  PickerSnapshotRow,
  StorageError,
} from "./ports.ts";
import type { ForReadingRuleOverrides } from "../../settings/application/ports.ts";
import type { StoredRuleOverrides } from "../../settings/domain/merge.ts";

/** JsonObject's index signature is satisfied by `{}` directly -- no cast needed. */
const EMPTY_OVERRIDES: StoredRuleOverrides = {};

const R = 0.04;
const Q = 0.013;
const SNAPSHOT_SPOT = 7500;
const SNAPSHOT_ASOF = "2026-07-01";

const GEX_CONTEXT: GexContextForPicker = {
  flip: 7480,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -47,
  absGammaStrike: 7500,
  nearTermFlip: 7486,
  nearTermCallWall: 7550,
  nearTermPutWall: 7450,
  computedAt: new Date("2026-07-01T14:30:00.000Z"),
};

const OPEN_GATE: PickerGate = {
  vix: 15,
  vix3m: 17,
  ratio: 0.88,
  asOf: SNAPSHOT_ASOF,
  state: "open",
  penaltyMultiplier: 1,
  brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
  reasons: [],
};

/** A minimal but structurally complete PickerSnapshot, overridable per test. */
function snapshotRow(overrides: Partial<PickerSnapshot> = {}): PickerSnapshotRow {
  const snapshot: PickerSnapshot = {
    asOf: SNAPSHOT_ASOF,
    observedAt: "2026-07-01T14:30:00.000Z",
    spot: SNAPSHOT_SPOT,
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
    gate: OPEN_GATE,
    sizing: { tier: null, contracts: null, vix: null },
    ...overrides,
  };
  return { observedAt: new Date(snapshot.observedAt), snapshot };
}

const SAMPLE_INPUT: AdHocCalendarInput = {
  putCall: "P",
  strike: 7500,
  frontDte: 30,
  backDte: 56,
  frontIv: 0.14,
  backIv: 0.155,
  debit: 54.14,
  qty: 1,
  frontExpiry: "2026-07-31",
  backExpiry: "2026-08-26",
};

/** Fresh, fully-wired fake deps — each field overridable per test. */
function makeDeps(overrides: Partial<AnalyzeAdHocCalendarDeps> = {}): AnalyzeAdHocCalendarDeps {
  const readPickerSnapshot: ForReadingPickerSnapshot = async () => ok(snapshotRow());
  const readGexContext: ForReadingGexContext = async () => ok(GEX_CONTEXT);
  const readEconomicEvents: ForReadingEconomicEvents = async () => ok([]);
  const readDailySpotCloses: ForReadingDailySpotCloses = async () => ok([]);
  const readPickerSlopeHistory: ForReadingPickerSlopeHistory = async () => ok([]);
  const readRuleOverrides: ForReadingRuleOverrides = async () => ok(EMPTY_OVERRIDES);
  return {
    readPickerSnapshot,
    readGexContext,
    readEconomicEvents,
    readDailySpotCloses,
    readPickerSlopeHistory,
    readRuleOverrides,
    rate: R,
    dividendYield: Q,
    ...overrides,
  };
}

describe("makeAnalyzeAdHocCalendarUseCase", () => {
  it("scores byte-identically to scoreCalendarCandidates on the equivalent RawCandidate (T-30-10 parity)", async () => {
    const strikeArb = fc.integer({ min: 7300, max: 7700 });
    const ivArb = fc.double({ min: 0.08, max: 0.35, noNaN: true });
    const frontDteArb = fc.integer({ min: 21, max: 36 });
    const gapArb = fc.integer({ min: 21, max: 50 });
    const debitArb = fc.double({ min: 5, max: 80, noNaN: true });

    await fc.assert(
      fc.asyncProperty(
        strikeArb,
        ivArb,
        ivArb,
        frontDteArb,
        gapArb,
        debitArb,
        async (strike, ivF, ivB, frontDte, gap, debit) => {
          const backDte = frontDte + gap;
          const frontExpiry = "2026-07-31";
          const backExpiry = "2026-09-15";
          const input: AdHocCalendarInput = {
            putCall: "P",
            strike,
            frontDte,
            backDte,
            frontIv: ivF,
            backIv: ivB,
            debit,
            qty: 3, // deliberately != 1 -- qty must NOT fold into the scored debit (parity).
            frontExpiry,
            backExpiry,
          };
          const analyze = makeAnalyzeAdHocCalendarUseCase(makeDeps());
          const result = await analyze(input);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const analysis = result.value;
          expect(analysis.scored).toBe(true);
          if (!analysis.scored) return;

          // The equivalent RawCandidate, built by hand (candidate-selection.ts:370-411 shape)
          // and scored via the SAME scoreCalendarCandidates function -- the byte-parity oracle.
          const gF = bsmGreeks(SNAPSHOT_SPOT, strike, frontDte / 365, ivF, R, Q, "P");
          const gB = bsmGreeks(SNAPSHOT_SPOT, strike, backDte / 365, ivB, R, Q, "P");
          const expectedRaw: RawCandidate = {
            id: "expected",
            name: "expected",
            frontLeg: { strike, putCall: "P", expiration: frontExpiry, dte: frontDte, iv: ivF },
            backLeg: { strike, putCall: "P", expiration: backExpiry, dte: backDte, iv: ivB },
            deltaRung: "0D",
            spot: SNAPSHOT_SPOT,
            theta: (gB.theta - gF.theta) * 100,
            vega: (gB.vega - gF.vega) * 100,
            delta: (gB.delta - gF.delta) * 100,
            debit: debit * 100,
            slope: ((ivB - ivF) / (backDte - frontDte)) * 365,
            frontEvents: [],
            backEvents: [],
            exitBeforeIso: null,
            eventInPeakTheta: false,
          };
          const defaultConfig = resolvePickerRuleConfig();
          const [expectedScored] = scoreCalendarCandidates([expectedRaw], GEX_CONTEXT, {
            r: R,
            q: Q,
            realizedVol20: null,
            slopeHistory: [],
            weights: defaultConfig.weights,
            debitBand: defaultConfig.debitBand,
          });
          expect(expectedScored).toBeDefined();
          if (expectedScored === undefined) return;

          expect(analysis.candidate.score).toBe(expectedScored.score);
          expect(analysis.candidate.breakdown).toEqual(expectedScored.breakdown);
          expect(analysis.candidate.fwdIv).toBe(expectedScored.fwdIv);
          expect(analysis.candidate.exitPlan).toEqual(expectedScored.exitPlan);
          expect(analysis.candidate.debit).toBe(debit * 100);
        },
      ),
    );
  });

  it("applies the gate penalty verbatim: score(0.5) = round(0.5 * score(1)) (A3)", async () => {
    const analyzeOpen = makeAnalyzeAdHocCalendarUseCase(
      makeDeps({ readPickerSnapshot: async () => ok(snapshotRow({ gate: OPEN_GATE })) }),
    );
    const analyzePenalized = makeAnalyzeAdHocCalendarUseCase(
      makeDeps({
        readPickerSnapshot: async () =>
          ok(snapshotRow({ gate: { ...OPEN_GATE, state: "penalty", penaltyMultiplier: 0.5 } })),
      }),
    );

    const openResult = await analyzeOpen(SAMPLE_INPUT);
    const penalizedResult = await analyzePenalized(SAMPLE_INPUT);
    expect(openResult.ok && openResult.value.scored).toBe(true);
    expect(penalizedResult.ok && penalizedResult.value.scored).toBe(true);
    if (!openResult.ok || !openResult.value.scored || !penalizedResult.ok || !penalizedResult.value.scored) return;

    expect(penalizedResult.value.candidate.score).toBe(Math.round(0.5 * openResult.value.candidate.score));
  });

  it("zeroes eventAdjustment when the snapshot's eventsContextStatus is stale (D-17 reused verbatim)", async () => {
    const events: ReadonlyArray<EconomicEvent> = [{ date: "2026-07-30", name: "FOMC", source: "seed" }];
    const okDeps = makeDeps({
      readPickerSnapshot: async () => ok(snapshotRow({ eventsContextStatus: "ok" })),
      readEconomicEvents: async () => ok(events),
    });
    const staleDeps = makeDeps({
      readPickerSnapshot: async () => ok(snapshotRow({ eventsContextStatus: "stale" })),
      readEconomicEvents: async () => ok(events),
    });

    const okResult = await makeAnalyzeAdHocCalendarUseCase(okDeps)(SAMPLE_INPUT);
    const staleResult = await makeAnalyzeAdHocCalendarUseCase(staleDeps)(SAMPLE_INPUT);
    expect(okResult.ok && okResult.value.scored).toBe(true);
    expect(staleResult.ok && staleResult.value.scored).toBe(true);
    if (!okResult.ok || !okResult.value.scored || !staleResult.ok || !staleResult.value.scored) return;

    const okEntry = okResult.value.candidate.breakdown.find((b) => b.criterion === "eventAdjustment");
    const staleEntry = staleResult.value.candidate.breakdown.find((b) => b.criterion === "eventAdjustment");
    expect(okEntry?.rawValue).toBeGreaterThan(0); // the FOMC penalty is live on the "ok" run
    expect(staleEntry).toEqual({ criterion: "eventAdjustment", weight: staleEntry?.weight, rawValue: 0, contribution: 0 });
  });

  it("flat-IV paste (frontIv === backIv) surfaces slope rawValue 0 honestly, never hidden (Pitfall 6)", async () => {
    const flatInput: AdHocCalendarInput = { ...SAMPLE_INPUT, frontIv: 0.15, backIv: 0.15 };
    const result = await makeAnalyzeAdHocCalendarUseCase(makeDeps())(flatInput);
    expect(result.ok && result.value.scored).toBe(true);
    if (!result.ok || !result.value.scored) return;

    const slopeEntry = result.value.candidate.breakdown.find((b) => b.criterion === "slope");
    expect(slopeEntry?.rawValue).toBe(0);
    expect(Number.isFinite(result.value.candidate.score)).toBe(true);
  });

  it("propagates a StorageError from readPickerSnapshot unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "read failed" };
    const deps = makeDeps({ readPickerSnapshot: async () => err(storageError) });
    const result = await makeAnalyzeAdHocCalendarUseCase(deps)(SAMPLE_INPUT);
    expect(result).toEqual(err(storageError));
  });
});

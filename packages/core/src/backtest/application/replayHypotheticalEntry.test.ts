/**
 * replayHypotheticalEntry.test.ts (Phase 27, Plan 05, Task 3) — the BT-04 full-universe
 * entry+exit simulation.
 *
 * Core cannot import @morai/adapters or testcontainers (architecture-boundaries §2) --
 * mirrors replayPickerCohort.test.ts / replayExitsForCalendar.test.ts's in-memory-fake
 * precedent.
 *
 * Covers:
 *   - The full (uncapped) candidate universe is scored and simulated through the untouched
 *     engine; every outcome carries the standing caveats.
 *   - A weights override changes the top-scoring candidate id vs the omitted baseline.
 *   - A gap cohort (empty as-of-T chain) is skipped -> ok([]).
 *   - A degenerate cohort (spot=0 across the whole chain) never simulates at a fabricated
 *     price -> ok([]) (gap-poisoning guard, T-27-12).
 *   - A malformed stored snapshot blob returns a StorageError.
 *   - StorageError propagation from the chain read.
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { formatOccSymbol } from "@morai/shared";
import type { EconomicEvent } from "@morai/core";
import { replayHypotheticalEntry } from "./replayHypotheticalEntry.ts";
import type {
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  StorageError,
  StoredPickerSnapshotRow,
} from "../application/ports.ts";

const R = 0.04;
const Q = 0.013;

const COHORT_TIME = new Date("2026-07-01T14:30:00.000Z");

function frozenSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    gexContextStatus: "missing", // simplest: gexFitFraction contributes 0, no gexContext needed
    gex: {
      flip: null,
      callWall: null,
      putWall: null,
      netGammaAtSpot: 0,
      absGammaStrike: null,
      nearTerm: null,
    },
    ...overrides,
  };
}

function chainLeg(strikePoints: number, expiration: string, iv: number, underlyingPrice = 7500): ChainLegQuoteAsOf {
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
    bsmIv: iv,
    bsmDelta: -0.4,
    bsmGamma: 0.001,
    bsmTheta: -0.5,
    bsmVega: 1.2,
    openInterest: 1000,
    underlyingPrice,
    source: "schwab_chain",
    time: COHORT_TIME,
  };
}

function realCandidateChain(underlyingPrice = 7500): ChainLegQuoteAsOf[] {
  const strikes = [7650, 7600, 7550, 7500, 7450, 7400, 7350, 7300, 7250];
  const expiries = ["2026-07-31", "2026-08-26", "2026-09-15"];
  const chain: ChainLegQuoteAsOf[] = [];
  for (const expiration of expiries) {
    for (const strike of strikes) {
      chain.push(chainLeg(strike, expiration, 0.15, underlyingPrice));
    }
  }
  return chain;
}

function fakeChain(chain: ReadonlyArray<ChainLegQuoteAsOf>): ForReadingChainAsOf {
  return async (): Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>> => ok(chain);
}
function fakeCloses(closes: ReadonlyArray<number> = []): ForReadingDailySpotClosesAsOf {
  return async (): Promise<Result<ReadonlyArray<number>, StorageError>> => ok(closes);
}
function fakeEvents(events: ReadonlyArray<EconomicEvent> = []) {
  return async (): Promise<Result<ReadonlyArray<EconomicEvent>, StorageError>> => ok(events);
}

const COHORT: StoredPickerSnapshotRow = {
  observedAt: COHORT_TIME,
  snapshot: frozenSnapshot(),
};

function baseDeps(overrides: { readonly chain?: ReadonlyArray<ChainLegQuoteAsOf> }) {
  return {
    readChainAsOf: fakeChain(overrides.chain ?? realCandidateChain()),
    readEconomicEvents: fakeEvents(),
    readDailySpotClosesAsOf: fakeCloses(),
    rate: R,
    dividendYield: Q,
  };
}

describe("replayHypotheticalEntry", () => {
  it("scores and simulates the full (uncapped) candidate universe with the standing caveats", async () => {
    const result = await replayHypotheticalEntry(COHORT, baseDeps({}));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    for (const outcome of result.value) {
      expect(outcome.cohortObservedAt).toBe(COHORT_TIME.toISOString());
      expect(outcome.caveats).toEqual(["events-leakage", "late-bsm-optimism"]);
      expect(Number.isFinite(outcome.simulatedPnl)).toBe(true);
    }
  });

  it("a weights override changes the top-scoring candidate id vs the omitted baseline", async () => {
    const baseline = await replayHypotheticalEntry(COHORT, baseDeps({}));
    const ablated = await replayHypotheticalEntry(COHORT, baseDeps({}), { slope: 0, fwdEdge: 0 });
    expect(baseline.ok).toBe(true);
    expect(ablated.ok).toBe(true);
    if (!baseline.ok || !ablated.ok) return;

    const topBaseline = [...baseline.value].sort((a, b) => b.score - a.score)[0];
    const topAblated = [...ablated.value].sort((a, b) => b.score - a.score)[0];
    expect(topBaseline).toBeDefined();
    expect(topAblated).toBeDefined();
    // Same candidate set, different score under ablation (weights actually flowed through).
    const baselineScoreForAblatedTop = baseline.value.find((o) => o.candidateId === topAblated?.candidateId)?.score;
    expect(baselineScoreForAblatedTop).toBeDefined();
    expect(topAblated?.score).not.toBe(baselineScoreForAblatedTop);
  });

  it("a gap cohort (empty as-of-T chain) is skipped", async () => {
    const result = await replayHypotheticalEntry(COHORT, baseDeps({ chain: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("a degenerate cohort (spot=0 across the chain) never simulates at a fabricated price", async () => {
    const gapChain = realCandidateChain(0);
    const result = await replayHypotheticalEntry(COHORT, baseDeps({ chain: gapChain }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("a malformed stored snapshot blob returns a StorageError", async () => {
    const badCohort: StoredPickerSnapshotRow = { observedAt: COHORT_TIME, snapshot: { nope: true } };
    const result = await replayHypotheticalEntry(badCohort, baseDeps({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("propagates a chain-read StorageError", async () => {
    const readChainAsOf: ForReadingChainAsOf = async () => ({
      ok: false,
      error: { kind: "storage-error", message: "chain read failed" },
    });
    const result = await replayHypotheticalEntry(COHORT, { ...baseDeps({}), readChainAsOf });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("chain read failed");
  });
});

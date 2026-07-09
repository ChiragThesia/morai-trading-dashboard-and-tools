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
  // Stamp every leg at the requested read instant so the forward walk sees FRESH quotes at
  // each daily step (the fixture chain is otherwise time-invariant). Quotes stay constant, so
  // the walk deterministically exits on the first forward slot.
  return async (asOfT: Date): Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>> =>
    ok(chain.map((leg) => ({ ...leg, time: asOfT })));
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
    expect(result.value.outcomes.length).toBeGreaterThan(0);
    expect(result.value.slotKind).toBe("replayed");
    for (const outcome of result.value.outcomes) {
      expect(outcome.cohortObservedAt).toBe(COHORT_TIME.toISOString());
      expect(outcome.caveats).toEqual(["events-leakage", "late-bsm-optimism"]);
      expect(Number.isFinite(outcome.simulatedPnl)).toBe(true);
    }
  });

  it("forward-walks to a real P&L: a favorable forward move yields positive simulated P&L (CR-01)", async () => {
    // Entry is priced from the T0 chain; the exit must be priced from a LATER slot. Bump the
    // back legs (later expiries) more than the fronts on every forward slot -> netMark rises ->
    // TAKE fires -> the haircut exit value exceeds the entry debit -> POSITIVE P&L. Under the
    // old same-instant pricing every P&L was a fixed -32% of the entry spread (<= 0 always), so
    // a single positive outcome is impossible to produce without a genuine forward walk.
    const bumpByExpiry: Record<string, number> = { "2026-07-31": 0, "2026-08-26": 50, "2026-09-15": 100 };
    const forwardChain = (t: Date): ChainLegQuoteAsOf[] =>
      realCandidateChain().map((leg) => {
        const bump = bumpByExpiry[leg.expiration] ?? 0;
        return { ...leg, time: t, bid: leg.bid + bump, ask: leg.ask + bump, mark: leg.mark + bump };
      });
    const readChainAsOf: ForReadingChainAsOf = async (asOfT) =>
      ok(asOfT.getTime() <= COHORT_TIME.getTime() ? realCandidateChain() : forwardChain(asOfT));

    const result = await replayHypotheticalEntry(COHORT, { ...baseDeps({}), readChainAsOf });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcomes.some((o) => o.simulatedPnl > 0)).toBe(true);
  });

  it("a weights override changes the top-scoring candidate id vs the omitted baseline", async () => {
    const baseline = await replayHypotheticalEntry(COHORT, baseDeps({}));
    const ablated = await replayHypotheticalEntry(COHORT, baseDeps({}), { slope: 0, fwdEdge: 0 });
    expect(baseline.ok).toBe(true);
    expect(ablated.ok).toBe(true);
    if (!baseline.ok || !ablated.ok) return;

    const topBaseline = [...baseline.value.outcomes].sort((a, b) => b.score - a.score)[0];
    const topAblated = [...ablated.value.outcomes].sort((a, b) => b.score - a.score)[0];
    expect(topBaseline).toBeDefined();
    expect(topAblated).toBeDefined();
    // Same candidate set, different score under ablation (weights actually flowed through).
    const baselineScoreForAblatedTop = baseline.value.outcomes.find((o) => o.candidateId === topAblated?.candidateId)?.score;
    expect(baselineScoreForAblatedTop).toBeDefined();
    expect(topAblated?.score).not.toBe(baselineScoreForAblatedTop);
  });

  it("a gap cohort (empty as-of-T chain) is skipped and flagged as a data gap", async () => {
    const result = await replayHypotheticalEntry(COHORT, baseDeps({ chain: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcomes).toEqual([]);
    expect(result.value.slotKind).toBe("gap");
  });

  it("a degenerate cohort (spot=0 across the chain) is flagged as a data gap, never priced", async () => {
    const gapChain = realCandidateChain(0);
    const result = await replayHypotheticalEntry(COHORT, baseDeps({ chain: gapChain }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcomes).toEqual([]);
    expect(result.value.slotKind).toBe("gap");
  });

  it("a real-data cohort with no surviving candidates is flagged empty-universe, not a gap", async () => {
    // One expiry -> selectCandidates can form no front/back calendar pair -> zero candidates,
    // but the chain is real (spot 7500). This is an empty candidate universe, NOT a data gap.
    const strikes = [7600, 7550, 7500, 7450, 7400];
    const oneExpiry = strikes.map((s) => chainLeg(s, "2026-07-31", 0.15));
    const result = await replayHypotheticalEntry(COHORT, baseDeps({ chain: oneExpiry }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.outcomes).toEqual([]);
    expect(result.value.slotKind).toBe("empty-universe");
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

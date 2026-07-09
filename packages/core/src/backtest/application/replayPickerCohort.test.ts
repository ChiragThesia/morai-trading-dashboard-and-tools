/**
 * replayPickerCohort.test.ts (Phase 27, Plan 05, Task 1) — the BT-02 leakage-oracle seam.
 *
 * Core cannot import @morai/adapters or testcontainers (architecture-boundaries §2; no
 * tsconfig reference, no devDependency) -- this mirrors the established pattern for EVERY
 * other application-layer use-case test in this codebase (computePickerSnapshot.test.ts,
 * computeExitAdvice.test.ts, getCot.test.ts): in-memory port fakes, real untouched pure
 * domain functions underneath. This is still a genuine reproduction proof, not a mock-heavy
 * unit test: the "stored" fixture is produced by actually RUNNING
 * makeComputePickerSnapshotUseCase (the live use-case) once, then replaying the SAME chain
 * through replayPickerCohort and asserting byte-identical reproduction -- a real two-path
 * determinism check, not a hand-derived expected value.
 *
 * Covers:
 *   - Baseline: replaying a freshly-generated stored cohort reproduces its score exactly
 *     for every candidate (ok([])).
 *   - eventsContextStatus stale/missing still reproduces exactly (proves the
 *     zeroEventAdjustment mirror matches the live private helper).
 *   - ruleSet drift is flagged as registry-drift, NOT a score-mismatch (guard runs first).
 *   - A corrupted stored score surfaces a hard-failure score-mismatch naming the id.
 *   - A stored candidate id absent from the replay (or vice versa) is a membership-mismatch.
 *   - A gateDrops mismatch is reported.
 *   - A malformed stored snapshot blob returns a StorageError (parse, don't cast).
 *   - A chain-read StorageError propagates.
 */

import { describe, it, expect } from "vitest";
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeComputePickerSnapshotUseCase } from "@morai/core";
import type {
  ChainQuoteForPicker,
  EconomicEvent,
  ForPersistingPickerSnapshot,
  ForReadingChainForPicker,
  ForReadingEconomicEvents,
  ForReadingGexContext,
  GexContextForPicker,
  PickerSnapshotRow,
  StorageError as PickerStorageError,
} from "@morai/core";
import { replayPickerCohort } from "./replayPickerCohort.ts";
import type {
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  StorageError,
  StoredPickerSnapshotRow,
} from "../application/ports.ts";

const R = 0.04;
const Q = 0.013;

// ─── Chain fixture (computePickerSnapshot.test.ts's "realCandidateChain" precedent) ───────

function chainQuote(
  strikePoints: number,
  expiration: string,
  iv: number,
  underlyingPrice = 7500,
): ChainQuoteForPicker {
  return {
    time: new Date("2026-07-01T14:30:00.000Z"),
    strike: strikePoints * 1000,
    expiration,
    contractType: "P",
    underlyingPrice,
    bsmIv: String(iv),
    bid: 99,
    ask: 101,
    openInterest: 1000,
    source: "schwab",
  };
}

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

function toChainLegQuoteAsOf(quote: ChainQuoteForPicker): ChainLegQuoteAsOf {
  return {
    occSymbol: `TEST-${quote.strike}-${quote.expiration}-${quote.contractType}`,
    strike: quote.strike,
    expiration: quote.expiration,
    contractType: quote.contractType,
    bid: quote.bid,
    ask: quote.ask,
    mark: (quote.bid + quote.ask) / 2,
    bsmIv: quote.bsmIv === null ? null : Number(quote.bsmIv),
    bsmDelta: null,
    bsmGamma: null,
    bsmTheta: null,
    bsmVega: null,
    openInterest: quote.openInterest,
    underlyingPrice: quote.underlyingPrice,
    source: quote.source === "schwab" ? "schwab_chain" : "cboe",
    time: quote.time,
  };
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
  computedAt: new Date("2026-07-01T14:00:00.000Z"),
};

const FUTURE_EVENTS: ReadonlyArray<EconomicEvent> = [{ date: "2026-07-15", name: "FOMC", source: "seed" }];

const NOW = new Date("2026-07-01T15:00:00.000Z");

// ─── Build a real stored PickerSnapshotRow by running the live use-case once ──────────────

function fakeReadChain(chain: ReadonlyArray<ChainQuoteForPicker>): ForReadingChainForPicker {
  return async (): Promise<Result<ReadonlyArray<ChainQuoteForPicker>, PickerStorageError>> => ok(chain);
}
function fakeReadGex(context: GexContextForPicker | null): ForReadingGexContext {
  return async (): Promise<Result<GexContextForPicker | null, PickerStorageError>> => ok(context);
}
function fakeReadEvents(events: ReadonlyArray<EconomicEvent>): ForReadingEconomicEvents {
  return async (): Promise<Result<ReadonlyArray<EconomicEvent>, PickerStorageError>> => ok(events);
}

async function buildStoredRow(overrides: {
  readonly events?: ReadonlyArray<EconomicEvent>;
}): Promise<PickerSnapshotRow> {
  const rows: PickerSnapshotRow[] = [];
  const persistPickerSnapshot: ForPersistingPickerSnapshot = async (row) => {
    rows.push(row);
    return ok(undefined);
  };
  const useCase = makeComputePickerSnapshotUseCase({
    readChainForPicker: fakeReadChain(realCandidateChain()),
    readGexContext: fakeReadGex(GEX_CONTEXT_FRESH),
    readEconomicEvents: fakeReadEvents(overrides.events ?? FUTURE_EVENTS),
    persistPickerSnapshot,
    readDailySpotCloses: async () => ok([]),
    readPickerSlopeHistory: async () => ok([]),
    // 28-03: calm gate inputs -- the backtest oracle isn't exercising the entry gate, just
    // needs it to resolve to "open" so candidates aren't zeroed out.
    readMacroObservations: async () =>
      ok([
        { seriesId: "VIXCLS", date: "2026-07-01", value: 15, source: "fred" as const },
        { seriesId: "VXVCLS", date: "2026-07-01", value: 20, source: "fred" as const },
      ]),
    readOpenCalendars: async () => ok([]),
    readRecentClosedCalendars: async () => ok([]),
    readPickerSnapshot: async () => ok(null),
    rate: R,
    dividendYield: Q,
    now: () => NOW,
  });
  const result = await useCase();
  expect(result.ok).toBe(true);
  const row = rows[0];
  expect(row).toBeDefined();
  if (row === undefined) throw new Error("buildStoredRow: no row persisted");
  return row;
}

function replayDeps(overrides: {
  readonly chainReadOk?: boolean;
  readonly closesReadOk?: boolean;
}): { readChainAsOf: ForReadingChainAsOf; readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf } {
  return {
    readChainAsOf: async (): Promise<Result<ReadonlyArray<ChainLegQuoteAsOf>, StorageError>> => {
      if (overrides.chainReadOk === false) {
        return { ok: false, error: { kind: "storage-error", message: "chain read failed" } };
      }
      return ok(realCandidateChain().map(toChainLegQuoteAsOf));
    },
    readDailySpotClosesAsOf: async (): Promise<Result<ReadonlyArray<number>, StorageError>> => {
      if (overrides.closesReadOk === false) {
        return { ok: false, error: { kind: "storage-error", message: "closes read failed" } };
      }
      return ok([]);
    },
  };
}

describe("replayPickerCohort", () => {
  it("reproduces the stored score exactly for every matched candidate id (baseline determinism)", async () => {
    const stored = await buildStoredRow({});
    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: stored.snapshot },
      { ...replayDeps({}), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("reproduces exactly when eventsContextStatus was stale/missing at write time (zeroEventAdjustment mirror)", async () => {
    const stored = await buildStoredRow({ events: [] }); // empty -> eventsContextStatus "missing"
    expect(stored.snapshot.eventsContextStatus).toBe("missing");
    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: stored.snapshot },
      { ...replayDeps({}), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("flags ruleSet drift as registry-drift, not a score-mismatch", async () => {
    const stored = await buildStoredRow({});
    const mutatedRuleSet = stored.snapshot.ruleSet.map((rule) =>
      rule.id === "slope" ? { ...rule, weight: rule.weight + 1 } : rule,
    );
    const mutatedSnapshot: Record<string, unknown> = { ...stored.snapshot, ruleSet: mutatedRuleSet };

    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: mutatedSnapshot },
      { ...replayDeps({}), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.kind).toBe("registry-drift");
  });

  it("a corrupted stored score surfaces a hard-failure score-mismatch naming the diverging id", async () => {
    const stored = await buildStoredRow({});
    const targetId = stored.snapshot.candidates[0]?.id;
    expect(targetId).toBeDefined();
    if (targetId === undefined) return;
    const mutatedCandidates = stored.snapshot.candidates.map((c) =>
      c.id === targetId ? { ...c, score: c.score + 999 } : c,
    );
    const mutatedSnapshot: Record<string, unknown> = { ...stored.snapshot, candidates: mutatedCandidates };

    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: mutatedSnapshot },
      { ...replayDeps({}), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mismatch = result.value.find((m) => m.candidateId === targetId);
    expect(mismatch).toBeDefined();
    expect(mismatch?.kind).toBe("score-mismatch");
  });

  it("a stored candidate id absent from the replay is a membership-mismatch", async () => {
    const stored = await buildStoredRow({});
    const template = stored.snapshot.candidates[0];
    expect(template).toBeDefined();
    if (template === undefined) return;
    const bogusCandidate = { ...template, id: "bogus-id-never-generated" };
    const mutatedSnapshot: Record<string, unknown> = {
      ...stored.snapshot,
      candidates: [...stored.snapshot.candidates, bogusCandidate],
    };

    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: mutatedSnapshot },
      { ...replayDeps({}), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mismatch = result.value.find((m) => m.candidateId === "bogus-id-never-generated");
    expect(mismatch).toBeDefined();
    expect(mismatch?.kind).toBe("membership-mismatch");
  });

  it("a gateDrops mismatch is reported", async () => {
    const stored = await buildStoredRow({});
    const mutatedSnapshot: Record<string, unknown> = {
      ...stored.snapshot,
      gateDrops: { ...stored.snapshot.gateDrops, liquidity: stored.snapshot.gateDrops.liquidity + 5 },
    };

    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: mutatedSnapshot },
      { ...replayDeps({}), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.some((m) => m.kind === "gate-drop-mismatch")).toBe(true);
  });

  it("a malformed stored snapshot blob returns a StorageError", async () => {
    const badSnapshot: StoredPickerSnapshotRow = {
      observedAt: new Date("2026-07-01T14:30:00.000Z"),
      snapshot: { not: "a valid picker snapshot" },
    };
    const result = await replayPickerCohort(badSnapshot, { ...replayDeps({}), rate: R, dividendYield: Q });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("propagates a closes-read StorageError instead of crying wolf on the vrp rule", async () => {
    // A transient DB error on the closes read must NOT degrade to [] -> realizedVol20=null,
    // which would score `vrp` differently from the stored snapshot and surface a FABRICATED
    // score-mismatch (WR-01). It must propagate as a storage error, like the chain read.
    const stored = await buildStoredRow({});
    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: stored.snapshot },
      { ...replayDeps({ closesReadOk: false }), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("closes read failed");
  });

  it("propagates a chain-read StorageError", async () => {
    const stored = await buildStoredRow({});
    const result = await replayPickerCohort(
      { observedAt: stored.observedAt, snapshot: stored.snapshot },
      { ...replayDeps({ chainReadOk: false }), rate: R, dividendYield: Q },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("chain read failed");
  });
});

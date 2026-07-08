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
  GexContextForPicker,
  PickerSnapshotRow,
  StorageError,
} from "../application/ports.ts";

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
}) {
  const { persistPickerSnapshot, rows } = makeRecordingPersist();
  // Note: `??` would coalesce an explicit `null` (missing-GEX fixture) back to the default --
  // `gexContext` must be distinguished by presence-of-key, not nullishness.
  const gexContext = "gexContext" in overrides ? (overrides.gexContext ?? null) : GEX_CONTEXT_FRESH;
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
      rate: R,
      dividendYield: Q,
      now: () => NOW,
    },
    rows,
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
    expect(row.snapshot.ruleSet.some((r) => r.id === "vrp" && r.status === "experimental")).toBe(true);

    // Gate drops present (all-liquid fixture → zero drops, but the field is real).
    expect(row.snapshot.gateDrops).toEqual({ liquidity: 0, netTheta: 0 });

    // Every candidate carries the 3 experimental context entries; vrp/slopePercentile are
    // real numbers given the supplied history.
    const candidate = row.snapshot.candidates[0];
    expect(candidate).toBeDefined();
    if (candidate === undefined) return;
    const ids = candidate.context.map((c) => c.id).sort();
    expect(ids).toEqual(["backEventBonus", "slopePercentile", "vrp"]);
    const vrp = candidate.context.find((c) => c.id === "vrp");
    expect(vrp?.value).not.toBeNull();
    const pct = candidate.context.find((c) => c.id === "slopePercentile");
    expect(pct?.value).not.toBeNull();
  });
});

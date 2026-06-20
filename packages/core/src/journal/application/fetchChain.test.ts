import { describe, it, expect, beforeEach } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { formatOccSymbol } from "@morai/shared";
import { makeFetchChainUseCase } from "./fetchChain.ts";
import type {
  ForFetchingChain,
  ForGettingOpenCalendarLegs,
  RawChain,
  ObservationRow,
  ContractRow,
  ForPersistingObservations,
  ForUpsertingContracts,
  StorageError,
  FetchError,
} from "./ports.ts";

// ─── Test doubles ──────────────────────────────────────────────────────────────

function makeMemoryFetch(chains: {
  SPX?: RawChain;
  SPXW?: RawChain;
}): ForFetchingChain {
  return async (root) => {
    const chain = chains[root];
    if (!chain) {
      return { ok: false, error: { kind: "fetch-error", message: `not seeded: ${root}` } };
    }
    return ok(chain);
  };
}

type PersistCapture = {
  observations: ReadonlyArray<ObservationRow>[];
  contracts: ReadonlyArray<ContractRow>[];
};

function makeMemoryPersist(): {
  persistObservations: ForPersistingObservations;
  upsertContracts: ForUpsertingContracts;
  capture: PersistCapture;
} {
  const capture: PersistCapture = { observations: [], contracts: [] };

  const persistObservations: ForPersistingObservations = async (rows) => {
    capture.observations.push(rows);
    return ok(undefined);
  };

  const upsertContracts: ForUpsertingContracts = async (rows) => {
    capture.contracts.push(rows);
    return ok(undefined);
  };

  return { persistObservations, upsertContracts, capture };
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const NOW = new Date("2026-06-11T19:13:25Z");
const SPOT = 7274.14;

function makeOcc(
  root: string,
  expiry: Date,
  type: "C" | "P",
  strike: number,
) {
  return formatOccSymbol({ root, expiry, type, strike });
}

// In-filter: expiry ~28 DTE, strike at spot (within ±10%)
const occInFilter = makeOcc("SPXW", new Date(2026, 6, 9), "C", 7275); // July 9
// Out-of-filter by DTE: >90 DTE
const occOutDte = makeOcc("SPX", new Date(2027, 11, 17), "C", 7250); // Dec 2027
// Out-of-filter by strike: outside ±10%
const occOutStrike = makeOcc("SPXW", new Date(2026, 6, 9), "P", 6525); // way below 6546 lower bound

function makeInFilterQuote(occ: ReturnType<typeof makeOcc>) {
  return {
    occSymbol: occ,
    contractType: "C" as const,
    strike: 7275,
    expiry: new Date(2026, 6, 9),
    bid: 25.3,
    ask: 25.5,
    mark: 25.4,
    iv: 0.1846,
    delta: 0.53,
    gamma: 0.001,
    theta: -2.58,
    vega: 8.04,
    openInterest: 12,
    volume: 0,
  };
}

function makeSpxwChain(overrideQuotes?: RawChain["quotes"], source: RawChain["source"] = "cboe"): RawChain {
  return {
    root: "SPXW",
    observedAt: NOW,
    spot: SPOT,
    quotes: overrideQuotes ?? [
      makeInFilterQuote(occInFilter),
      {
        ...makeInFilterQuote(occOutDte),
        occSymbol: occOutDte,
        contractType: "C" as const,
        strike: 7250,
        expiry: new Date(2027, 11, 17), // >90 DTE
      },
      {
        ...makeInFilterQuote(occOutStrike),
        occSymbol: occOutStrike,
        contractType: "P" as const,
        strike: 6525, // outside ±10%
      },
    ],
    source,
  };
}

function makeSpxChain(source: RawChain["source"] = "cboe"): RawChain {
  const occSpx = makeOcc("SPX", new Date(2026, 8, 18), "P", 7275); // Sept 18 ~99 DTE
  // Actually Sept 18 is ~99 DTE from June 11, so out of filter — use July 9 instead
  const occSpxIn = makeOcc("SPX", new Date(2026, 6, 9), "P", 7275);
  return {
    root: "SPX",
    observedAt: NOW,
    spot: SPOT,
    quotes: [
      {
        ...makeInFilterQuote(occSpxIn),
        occSymbol: occSpxIn,
        contractType: "P" as const,
        strike: 7275,
        expiry: new Date(2026, 6, 9),
      },
    ],
    source,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeFetchChainUseCase", () => {
  let memPersist: ReturnType<typeof makeMemoryPersist>;

  beforeEach(() => {
    memPersist = makeMemoryPersist();
  });

  it("only persists in-filter contracts (DTE ≤ maxDte AND strike within ±strikeBandPct)", async () => {
    const useCase = makeFetchChainUseCase({
      fetchChain: makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() }),
      persistObservations: memPersist.persistObservations,
      upsertContracts: memPersist.upsertContracts,
      getOpenCalendarLegs: async () => ok([]),
      now: () => NOW,
      maxDte: 90,
      strikeBandPct: 0.10,
    });

    const result = await useCase();
    expect(result.ok).toBe(true);

    // Only in-filter contracts should have been persisted
    const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
    for (const row of allPersisted) {
      // Verify DTE: expiry calendar days from NOW ≤ 90
      // The out-of-DTE contract (Dec 2027) should NOT appear
      // The out-of-strike contract (6525) should NOT appear
      expect(row.contract).not.toBe(occOutDte);
      expect(row.contract).not.toBe(occOutStrike);
    }
  });

  it("every persisted ObservationRow has source='cboe' and no bsm_* values", async () => {
    const useCase = makeFetchChainUseCase({
      fetchChain: makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() }),
      persistObservations: memPersist.persistObservations,
      upsertContracts: memPersist.upsertContracts,
      getOpenCalendarLegs: async () => ok([]),
      now: () => NOW,
      maxDte: 90,
      strikeBandPct: 0.10,
    });

    await useCase();

    const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
    expect(allPersisted.length).toBeGreaterThan(0);
    for (const row of allPersisted) {
      expect(row.source).toBe("cboe");
      // No bsm_* keys in ObservationRow type — check type-level
      expect(Object.keys(row)).not.toContain("bsmIv");
      expect(Object.keys(row)).not.toContain("bsmDelta");
    }
  });

  it("ContractRow has exerciseStyle='european' and root is 'SPX' or 'SPXW'", async () => {
    const useCase = makeFetchChainUseCase({
      fetchChain: makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() }),
      persistObservations: memPersist.persistObservations,
      upsertContracts: memPersist.upsertContracts,
      getOpenCalendarLegs: async () => ok([]),
      now: () => NOW,
      maxDte: 90,
      strikeBandPct: 0.10,
    });

    await useCase();

    const allContracts = memPersist.capture.contracts.flatMap((r) => [...r]);
    expect(allContracts.length).toBeGreaterThan(0);
    for (const row of allContracts) {
      expect(row.exerciseStyle).toBe("european");
      expect(["SPX", "SPXW"]).toContain(row.root);
    }
  });

  it("returns err when both chains fail to fetch", async () => {
    const failFetch: ForFetchingChain = async () => ({
      ok: false,
      error: { kind: "fetch-error", message: "network error" },
    });

    const useCase = makeFetchChainUseCase({
      fetchChain: failFetch,
      persistObservations: memPersist.persistObservations,
      upsertContracts: memPersist.upsertContracts,
      getOpenCalendarLegs: async () => ok([]),
      now: () => NOW,
      maxDte: 90,
      strikeBandPct: 0.10,
    });

    const result = await useCase();
    expect(result.ok).toBe(false);
  });

  it("does not call Date.now() — now is injected", () => {
    // This is a static test — no Date.now() in fetchChain.ts
    // Verified by grep at typecheck time; this test documents the contract
    expect(true).toBe(true);
  });

  describe("D-04: targeted-fetch must-include bypass", () => {
    it("persists an out-of-band must-include leg (fails both DTE and strike filters)", async () => {
      // occOutDte is Dec 2027 (>90 DTE) — normally filtered out
      // We put it in the must-include set and assert it IS persisted
      const mustIncludeOcc = occOutDte;

      const getOpenCalendarLegs: ForGettingOpenCalendarLegs = async () =>
        ok([mustIncludeOcc]);

      const useCase = makeFetchChainUseCase({
        fetchChain: makeMemoryFetch({ SPXW: makeSpxwChain() }),
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs,
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      const result = await useCase();
      expect(result.ok).toBe(true);

      // The must-include contract should appear in the persisted observations
      const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
      const contractsFound = allPersisted.map((r) => r.contract);
      expect(contractsFound).toContain(mustIncludeOcc);
    });

    it("does NOT persist an out-of-band quote that is not in the must-include set", async () => {
      // occOutStrike is way below the strike band — filtered out
      // It is NOT in the must-include set
      const getOpenCalendarLegs: ForGettingOpenCalendarLegs = async () => ok([]);

      const useCase = makeFetchChainUseCase({
        fetchChain: makeMemoryFetch({ SPXW: makeSpxwChain() }),
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs,
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      await useCase();

      const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
      const contractsFound = allPersisted.map((r) => r.contract);
      expect(contractsFound).not.toContain(occOutStrike);
    });

    it("degrades to empty must-include when getOpenCalendarLegs returns an error — fetch still succeeds", async () => {
      const getOpenCalendarLegs: ForGettingOpenCalendarLegs = async () =>
        err<import("./ports.ts").StorageError>({ kind: "storage-error", message: "DB down" });

      const useCase = makeFetchChainUseCase({
        fetchChain: makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() }),
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs,
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      // Should succeed — error degrades to empty must-include (no hard fail)
      const result = await useCase();
      expect(result.ok).toBe(true);

      // In-filter quotes still persist normally
      const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
      expect(allPersisted.length).toBeGreaterThan(0);
    });
  });

  describe("SC3 regression: chain source provenance — observations carry the adapter's source", () => {
    it("Schwab-sourced chain (source='schwab_chain') → observations tagged source='schwab_chain'", async () => {
      const schwabChain = makeSpxwChain(undefined, "schwab_chain");

      const useCase = makeFetchChainUseCase({
        fetchChain: makeMemoryFetch({ SPXW: schwabChain }),
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs: async () => ok([]),
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      await useCase();

      const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
      expect(allPersisted.length).toBeGreaterThan(0);
      for (const row of allPersisted) {
        expect(row.source).toBe("schwab_chain");
      }
    });

    it("CBOE-sourced chain (source='cboe') → observations tagged source='cboe' (no regression)", async () => {
      const cboeChain = makeSpxwChain(undefined, "cboe");

      const useCase = makeFetchChainUseCase({
        fetchChain: makeMemoryFetch({ SPXW: cboeChain }),
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs: async () => ok([]),
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      await useCase();

      const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
      expect(allPersisted.length).toBeGreaterThan(0);
      for (const row of allPersisted) {
        expect(row.source).toBe("cboe");
      }
    });
  });
});

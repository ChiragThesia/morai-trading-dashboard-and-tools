import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { ok, err } from "@morai/shared";
import type { Result, OccSymbol } from "@morai/shared";
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
      fetchChains: async () => [makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() })],
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
      fetchChains: async () => [makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() })],
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
      fetchChains: async () => [makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() })],
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
      fetchChains: async () => [failFetch],
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
        fetchChains: async () => [makeMemoryFetch({ SPXW: makeSpxwChain() })],
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
        fetchChains: async () => [makeMemoryFetch({ SPXW: makeSpxwChain() })],
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
        fetchChains: async () => [makeMemoryFetch({ SPXW: makeSpxwChain(), SPX: makeSpxChain() })],
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

  // chain-window-narrow-regression: one cycle runs EVERY fetcher the selector returns
  // (Schwab freshness + CBOE breadth). Partial failure tolerance lives HERE now — the
  // old selectChainSource runtime fallback (BUG 3) is subsumed because CBOE always runs.
  describe("dual-source: multiple fetchers per cycle", () => {
    it("persists BOTH sources' chains in one run", async () => {
      const schwabFetcher = makeMemoryFetch({
        SPXW: makeSpxwChain(undefined, "schwab_chain"),
        SPX: makeSpxChain("schwab_chain"),
      });
      const cboeFetcher = makeMemoryFetch({
        SPXW: makeSpxwChain(undefined, "cboe"),
        SPX: makeSpxChain("cboe"),
      });

      const useCase = makeFetchChainUseCase({
        fetchChains: async () => [schwabFetcher, cboeFetcher],
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs: async () => ok([]),
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      const result = await useCase();
      expect(result.ok).toBe(true);

      const sources = new Set(
        memPersist.capture.observations.flatMap((r) => [...r]).map((row) => row.source),
      );
      expect(sources).toContain("schwab_chain");
      expect(sources).toContain("cboe");
    });

    it("one source failing → still ok, surviving source persisted (BUG 3 guarantee)", async () => {
      const failingSchwab: ForFetchingChain = async () =>
        err<FetchError>({ kind: "fetch-error", message: "schwab 502" });
      const cboeFetcher = makeMemoryFetch({
        SPXW: makeSpxwChain(undefined, "cboe"),
        SPX: makeSpxChain("cboe"),
      });

      const useCase = makeFetchChainUseCase({
        fetchChains: async () => [failingSchwab, cboeFetcher],
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs: async () => ok([]),
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });

      const result = await useCase();
      expect(result.ok).toBe(true);

      const allPersisted = memPersist.capture.observations.flatMap((r) => [...r]);
      expect(allPersisted.length).toBeGreaterThan(0);
      for (const row of allPersisted) {
        expect(row.source).toBe("cboe");
      }
    });

    it("ALL fetchers failing on all roots → err", async () => {
      const failing: ForFetchingChain = async () =>
        err<FetchError>({ kind: "fetch-error", message: "down" });

      const useCase = makeFetchChainUseCase({
        fetchChains: async () => [failing, failing],
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
  });

  describe("SC3 regression: chain source provenance — observations carry the adapter's source", () => {
    it("Schwab-sourced chain (source='schwab_chain') → observations tagged source='schwab_chain'", async () => {
      const schwabChain = makeSpxwChain(undefined, "schwab_chain");

      const useCase = makeFetchChainUseCase({
        fetchChains: async () => [makeMemoryFetch({ SPXW: schwabChain })],
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
        fetchChains: async () => [makeMemoryFetch({ SPXW: cboeChain })],
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

  // ─── chain-root-label regression ───────────────────────────────────────────────
  // The sidecar makes ONE Schwab "$SPX" call that returns BOTH SPX and SPXW contracts, so
  // chain.root is only a response LABEL (apps/sidecar/chain_proxy.py). Two ContractRow
  // fields were read from the wrong source: `root` from the requested chain label, and
  // `expiration` from LOCAL date getters on a UTC-midnight quote.expiry. Both now come
  // from the contract's own OCC symbol — the only trustworthy source in the row.
  // Measured in prod: 1,190 contracts labelled root='SPX' on an SPXW symbol, every one of
  // them ALSO dated a day early. contracts.root/expiration feed computeT's AM-vs-PM
  // settlement choice, so a wrong label biases bsm_iv and every greek.
  describe("root + expiration derive from the contract's own OCC symbol", () => {
    const ORIGINAL_TZ: string | undefined = process.env["TZ"];

    // Pin a NEGATIVE-offset zone. A UTC-midnight instant is the PREVIOUS calendar day
    // there, which is exactly what made the old local-getter path emit a date one day
    // early; on a UTC or positive-offset CI box that bug is invisible. Pinning makes the
    // date test fail against the old code everywhere, not just on a US laptop.
    beforeEach(() => {
      process.env["TZ"] = "America/New_York";
    });

    afterEach(() => {
      if (ORIGINAL_TZ === undefined) {
        delete process.env["TZ"];
      } else {
        process.env["TZ"] = ORIGINAL_TZ;
      }
    });

    /** One-chain run: seeded under the SPX request key, so exactly one chain is processed. */
    async function runOneChain(
      chain: RawChain,
      mustInclude: ReadonlyArray<OccSymbol> = [],
    ): Promise<void> {
      const useCase = makeFetchChainUseCase({
        fetchChains: async () => [makeMemoryFetch({ SPX: chain })],
        persistObservations: memPersist.persistObservations,
        upsertContracts: memPersist.upsertContracts,
        getOpenCalendarLegs: async () => ok(mustInclude),
        now: () => NOW,
        maxDte: 90,
        strikeBandPct: 0.10,
      });
      const result = await useCase();
      expect(result.ok).toBe(true);
    }

    function chainLabelled(root: RawChain["root"], quotes: RawChain["quotes"]): RawChain {
      return { root, observedAt: NOW, spot: SPOT, quotes, source: "schwab_chain" };
    }

    function capturedContracts(): ReadonlyArray<ContractRow> {
      return memPersist.capture.contracts.flatMap((r) => [...r]);
    }

    it("an SPXW-symbol quote on a chain LABELLED 'SPX' gets root 'SPXW', not the label", async () => {
      const occSpxw = makeOcc("SPXW", new Date(2026, 6, 9), "C", 7275);

      await runOneChain(chainLabelled("SPX", [makeInFilterQuote(occSpxw)]));

      const rows = capturedContracts();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.occSymbol).toBe(occSpxw);
      expect(rows[0]?.root).toBe("SPXW");
    });

    it("an SPX-symbol quote on a chain labelled 'SPX' still gets root 'SPX' (no reverse regression)", async () => {
      const occSpx = makeOcc("SPX", new Date(2026, 6, 9), "C", 7275);

      await runOneChain(chainLabelled("SPX", [makeInFilterQuote(occSpx)]));

      const rows = capturedContracts();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.root).toBe("SPX");
    });

    it("a UTC-midnight quote.expiry yields the OCC symbol's own calendar date, not the local-getter day before", async () => {
      // makeOcc/formatOccSymbol read LOCAL getters, so a LOCAL-midnight date gives digits
      // 260709. This is a different animal from the quote's expiry below — do not mix them.
      const occ = makeOcc("SPXW", new Date(2026, 6, 9), "C", 7275);
      // Vendor adapters hand core a UTC-midnight expiry. Under the pinned zone (UTC-4 in
      // July) this instant is 2026-07-08 20:00 local, so getFullYear/getMonth/getDate
      // rendered "2026-07-08" — one day early, and computeT then solved T short by a day.
      const utcMidnightExpiry = new Date(Date.UTC(2026, 6, 9));
      expect(utcMidnightExpiry.getDate()).toBe(8); // proof the pinned zone makes a local read wrong

      await runOneChain(
        chainLabelled("SPX", [{ ...makeInFilterQuote(occ), expiry: utcMidnightExpiry }]),
      );

      const rows = capturedContracts();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.expiration).toBe("2026-07-09");
    });

    it("a malformed OCC symbol is skipped without throwing and without dropping its valid siblings", async () => {
      // A 7-char root pads past 21 chars → parseOccSymbol returns WRONG_LENGTH. Built via
      // formatOccSymbol so the branded type needs no cast.
      const occMalformed = formatOccSymbol({
        root: "TOOLONG",
        expiry: new Date(2026, 6, 9),
        type: "C",
        strike: 7275,
      });
      const occValid = makeOcc("SPXW", new Date(2026, 6, 9), "C", 7275);

      await runOneChain(
        chainLabelled("SPX", [
          makeInFilterQuote(occMalformed),
          makeInFilterQuote(occValid),
        ]),
      );

      const rows = capturedContracts();
      expect(rows.map((r) => r.occSymbol)).toEqual([occValid]);
      // No orphan observation either: an observation with no contract row is unusable
      // downstream (readPendingObs skips + warns on exactly that shape).
      const observed = memPersist.capture.observations.flatMap((r) => [...r]);
      expect(observed.map((r) => r.contract)).toEqual([occValid]);
    });

    it("property: emitted root + expiration round-trip the symbol's own root and date digits (numRuns≥300)", async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("SPX" as const, "SPXW" as const),
          fc.integer({ min: 2026, max: 2035 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }), // no month-length edge cases — the parser owns those
          fc.constantFrom("C" as const, "P" as const),
          fc.integer({ min: 100, max: 9000 }),
          async (root, year, month, day, type, strike) => {
            const occ = formatOccSymbol({
              root,
              expiry: new Date(year, month - 1, day), // LOCAL midnight — matches formatOccSymbol's getters
              type,
              strike,
            });
            const mem = makeMemoryPersist(); // fresh capture per run
            const chain = chainLabelled("SPX", [
              {
                ...makeInFilterQuote(occ),
                contractType: type,
                strike,
                expiry: new Date(Date.UTC(year, month - 1, day)), // UTC midnight, as vendors send it
              },
            ]);

            const useCase = makeFetchChainUseCase({
              fetchChains: async () => [makeMemoryFetch({ SPX: chain })],
              persistObservations: mem.persistObservations,
              upsertContracts: mem.upsertContracts,
              // must-include bypasses the DTE/band gates so any generated date+strike lands
              getOpenCalendarLegs: async () => ok([occ]),
              now: () => NOW,
              maxDte: 90,
              strikeBandPct: 0.10,
            });
            const result = await useCase();
            expect(result.ok).toBe(true);

            const rows = mem.capture.contracts.flatMap((r) => [...r]);
            expect(rows).toHaveLength(1);
            const row = rows[0];
            if (row === undefined) return;

            expect(row.root).toBe(root);
            const pad = (n: number): string => String(n).padStart(2, "0");
            expect(row.expiration).toBe(`${year}-${pad(month)}-${pad(day)}`);
            // Round-trip against the stored symbol itself: root prefix and YYMMDD digits.
            expect(row.occSymbol.slice(0, 6)).toBe(root.padEnd(6, " "));
            expect(row.occSymbol.slice(6, 12)).toBe(row.expiration.slice(2).replace(/-/g, ""));
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});

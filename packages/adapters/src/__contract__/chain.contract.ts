import { describe, it, expect, beforeEach } from "vitest";
import type { ForFetchingChain, RawChain } from "@morai/core";

/**
 * Shared contract-test suite for the ForFetchingChain port.
 * Run this suite against BOTH the CBOE HTTP adapter (msw-backed)
 * and the in-memory adapter (no Docker, no network).
 *
 * Adapter type includes an optional `seed` for in-memory adapters.
 */
export type ChainAdapter = {
  readonly fetchChain: ForFetchingChain;
  readonly seed?: (root: "SPX" | "SPXW", chain: RawChain) => Promise<void>;
};

export function runChainContractTests(makeAdapter: () => ChainAdapter): void {
  describe("chain port contract", () => {
    let adapter: ChainAdapter;

    beforeEach(() => {
      adapter = makeAdapter();
    });

    it("returns ok(chain) with the correct root after seed", async () => {
      if (!adapter.seed) {
        // HTTP adapter — just test it returns ok
        const result = await adapter.fetchChain("SPX");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.root).toBe("SPX");
        return;
      }
      const chain: RawChain = {
        root: "SPX",
        observedAt: new Date("2026-06-11T19:13:25Z"),
        spot: 7274.14,
        quotes: [],
        source: "cboe",
      };
      await adapter.seed("SPX", chain);
      const result = await adapter.fetchChain("SPX");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.root).toBe("SPX");
      expect(result.value.spot).toBe(7274.14);
    });

    it("returns err when root is not seeded (in-memory) or not present", async () => {
      if (!adapter.seed) {
        // HTTP adapter served by msw — skip this check (http adapter never has 'unseeded' state)
        return;
      }
      // In-memory: no seed called — should err
      const result = await adapter.fetchChain("SPXW");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("fetch-error");
    });

    it("returned occSymbol values are 21-char OCC strings (when quotes present)", async () => {
      if (!adapter.seed) {
        const result = await adapter.fetchChain("SPXW");
        if (!result.ok) return; // skip if not seeded
        for (const q of result.value.quotes) {
          expect(q.occSymbol).toHaveLength(21);
        }
        return;
      }
      // For in-memory — seed with pre-built OCC symbol
      // OCC: "SPXW  260611C07275000" (21 chars)
      const { formatOccSymbol } = await import("@morai/shared");
      const occ = formatOccSymbol({
        root: "SPXW",
        expiry: new Date(2026, 5, 11),
        type: "C",
        strike: 7275,
      });
      const chain: RawChain = {
        root: "SPXW",
        observedAt: new Date("2026-06-11T19:13:25Z"),
        spot: 7274.14,
        quotes: [
          {
            occSymbol: occ,
            contractType: "C",
            strike: 7275,
            expiry: new Date(2026, 5, 11),
            bid: 25.3,
            ask: 25.5,
            mark: 25.4,
            iv: 0.3761,
            delta: 0.498,
            gamma: 0.0061,
            theta: -25.8764,
            vega: 0.6955,
            openInterest: 474,
            volume: 2898,
          },
        ],
        source: "cboe",
      };
      await adapter.seed("SPXW", chain);
      const result = await adapter.fetchChain("SPXW");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      for (const q of result.value.quotes) {
        expect(q.occSymbol).toHaveLength(21);
      }
    });
  });
}

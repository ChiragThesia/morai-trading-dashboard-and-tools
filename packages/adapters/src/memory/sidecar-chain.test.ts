/**
 * Tests for makeMemorySidecarChainAdapter — in-memory twin of the sidecar chain adapter.
 *
 * Verifies the ForFetchingChain contract:
 *   - seed(root, chain) → fetchChain(root) returns ok(chain)
 *   - fetchChain on unseeded root → err({kind:'fetch-error'})
 *
 * D-07: in-memory twin ships in the same PR as the driven-port adapter (architecture-boundaries §8).
 */
import { describe, it, expect } from "vitest";
import { formatOccSymbol } from "@morai/shared";
import { makeMemorySidecarChainAdapter } from "./sidecar-chain.ts";
import type { RawChain } from "@morai/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SAMPLE_CHAIN: RawChain = {
  root: "SPX",
  observedAt: new Date("2026-06-25T15:30:00.000Z"),
  spot: 5950.0,
  quotes: [
    {
      occSymbol: formatOccSymbol({
        root: "SPX",
        expiry: new Date(2026, 5, 20), // 2026-06-20
        type: "C",
        strike: 5950,
      }),
      contractType: "C",
      strike: 5950.0,
      expiry: new Date(2026, 5, 20),
      bid: 12.5,
      ask: 13.0,
      mark: 12.75,
      iv: 0.18,
      delta: 0.45,
      gamma: 0.002,
      theta: -0.85,
      vega: 1.2,
      openInterest: 1500,
      volume: 320,
    },
  ],
  source: "schwab_chain",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("makeMemorySidecarChainAdapter", () => {
  it("returns ok(chain) after seeding root", async () => {
    const adapter = makeMemorySidecarChainAdapter();

    await adapter.seed("SPX", SAMPLE_CHAIN);
    const result = await adapter.fetchChain("SPX");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok result");

    expect(result.value).toBe(SAMPLE_CHAIN);
    expect(result.value.source).toBe("schwab_chain");
    expect(result.value.root).toBe("SPX");
  });

  it("returns err({kind:fetch-error}) for an unseeded root", async () => {
    const adapter = makeMemorySidecarChainAdapter();

    const result = await adapter.fetchChain("SPXW");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected err result");

    expect(result.error.kind).toBe("fetch-error");
    expect(result.error.message).toContain("Root not seeded");
  });

  it("seeds and fetches different roots independently", async () => {
    const adapter = makeMemorySidecarChainAdapter();

    const spxChain: RawChain = { ...SAMPLE_CHAIN, root: "SPX" };
    const spxwChain: RawChain = { ...SAMPLE_CHAIN, root: "SPXW" };

    await adapter.seed("SPX", spxChain);
    await adapter.seed("SPXW", spxwChain);

    const spxResult = await adapter.fetchChain("SPX");
    const spxwResult = await adapter.fetchChain("SPXW");

    expect(spxResult.ok).toBe(true);
    expect(spxwResult.ok).toBe(true);

    if (!spxResult.ok || !spxwResult.ok) throw new Error("Expected ok results");

    expect(spxResult.value.root).toBe("SPX");
    expect(spxwResult.value.root).toBe("SPXW");
  });
});

import { describe, it, expect } from "vitest";
import { makeMemoryVvixAdapter } from "./vvix.ts";
import type { MacroObservationRow } from "@morai/core";

/**
 * Tests for the in-memory ForFetchingVvixQuote twin (review WR-03,
 * architecture-boundaries §8). No Docker, no network — runs always.
 *
 * No-fallback parity with makeCboeVvixAdapter: unseeded fetch returns
 * err(FetchError), never a fabricated quote.
 */

const vvixRow: MacroObservationRow = {
  seriesId: "VVIX",
  date: "2026-06-30",
  value: 89.0,
  source: "cboe",
};

describe("makeMemoryVvixAdapter", () => {
  it("returns err(fetch-error) when unseeded (no fabricated fallback)", async () => {
    const adapter = makeMemoryVvixAdapter();
    const result = await adapter.fetchVvixQuote();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns ok with the exact seeded row", async () => {
    const adapter = makeMemoryVvixAdapter();
    adapter.seed(vvixRow);
    const result = await adapter.fetchVvixQuote();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(vvixRow);
    expect(result.value.seriesId).toBe("VVIX");
    expect(result.value.source).toBe("cboe");
  });

  it("re-seeding replaces the stored row", async () => {
    const adapter = makeMemoryVvixAdapter();
    adapter.seed(vvixRow);
    adapter.seed({ ...vvixRow, date: "2026-07-01", value: 91.2 });
    const result = await adapter.fetchVvixQuote();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.date).toBe("2026-07-01");
    expect(result.value.value).toBe(91.2);
  });
});

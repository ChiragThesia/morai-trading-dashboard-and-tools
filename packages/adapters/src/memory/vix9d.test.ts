import { describe, it, expect } from "vitest";
import { makeMemoryVix9dAdapter } from "./vix9d.ts";
import type { MacroObservationRow } from "@morai/core";

/**
 * Tests for the in-memory ForFetchingVix9dQuote twin (architecture-boundaries §8).
 * No Docker, no network — runs always.
 *
 * No-fallback parity with makeCboeVix9dAdapter: unseeded fetch returns
 * err(FetchError), never a fabricated quote.
 */

const vix9dRow: MacroObservationRow = {
  seriesId: "VIX9D",
  date: "2026-06-30",
  value: 14.2,
  source: "cboe",
};

describe("makeMemoryVix9dAdapter", () => {
  it("returns err(fetch-error) when unseeded (no fabricated fallback)", async () => {
    const adapter = makeMemoryVix9dAdapter();
    const result = await adapter.fetchVix9dQuote();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns ok with the exact seeded row", async () => {
    const adapter = makeMemoryVix9dAdapter();
    adapter.seed(vix9dRow);
    const result = await adapter.fetchVix9dQuote();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(vix9dRow);
    expect(result.value.seriesId).toBe("VIX9D");
    expect(result.value.source).toBe("cboe");
  });

  it("re-seeding replaces the stored row", async () => {
    const adapter = makeMemoryVix9dAdapter();
    adapter.seed(vix9dRow);
    adapter.seed({ ...vix9dRow, date: "2026-07-01", value: 15.1 });
    const result = await adapter.fetchVix9dQuote();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.date).toBe("2026-07-01");
    expect(result.value.value).toBe(15.1);
  });
});

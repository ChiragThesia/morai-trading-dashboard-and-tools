import { describe, it, expect } from "vitest";
import { makeMemoryFredSeriesAdapter } from "./fred-series.ts";
import type { MacroObservationRow } from "@morai/core";

/**
 * Tests for the in-memory ForFetchingFredSeries twin (review WR-03,
 * architecture-boundaries §8). No Docker, no network — runs always.
 *
 * D-09 parity with makeFredSeriesAdapter: no fabricated fallback —
 * an unseeded seriesId returns err(FetchError), never a fake value.
 */

const dffRow: MacroObservationRow = {
  seriesId: "DFF",
  date: "2026-06-30",
  value: 4.33,
  source: "fred",
};

describe("makeMemoryFredSeriesAdapter", () => {
  it("returns err(fetch-error) for an unseeded seriesId (D-09 — no fabricated fallback)", async () => {
    const adapter = makeMemoryFredSeriesAdapter();
    const result = await adapter.fetchFredSeries("DFF");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });

  it("returns ok with the exact seeded row for its seriesId", async () => {
    const adapter = makeMemoryFredSeriesAdapter();
    adapter.seed(dffRow);
    const result = await adapter.fetchFredSeries("DFF");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(dffRow);
  });

  it("resolves multiple seeded series independently; unseeded ids still err", async () => {
    const adapter = makeMemoryFredSeriesAdapter();
    const vixRow: MacroObservationRow = {
      seriesId: "VIXCLS",
      date: "2026-06-30",
      value: 18.9,
      source: "fred",
    };
    adapter.seed(dffRow);
    adapter.seed(vixRow);

    const dff = await adapter.fetchFredSeries("DFF");
    expect(dff.ok).toBe(true);
    if (dff.ok) expect(dff.value.value).toBe(4.33);

    const vix = await adapter.fetchFredSeries("VIXCLS");
    expect(vix.ok).toBe(true);
    if (vix.ok) expect(vix.value.value).toBe(18.9);

    const sofr = await adapter.fetchFredSeries("SOFR");
    expect(sofr.ok).toBe(false);
  });

  it("re-seeding a seriesId replaces the stored row (upsert semantics)", async () => {
    const adapter = makeMemoryFredSeriesAdapter();
    adapter.seed(dffRow);
    adapter.seed({ ...dffRow, date: "2026-07-01", value: 4.35 });
    const result = await adapter.fetchFredSeries("DFF");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.date).toBe("2026-07-01");
    expect(result.value.value).toBe(4.35);
  });

  it("returns ok with the exact seeded VXVCLS row — raw index level, no /100 (D-14 parity with VIXCLS)", async () => {
    const adapter = makeMemoryFredSeriesAdapter();
    const vxvclsRow: MacroObservationRow = {
      seriesId: "VXVCLS",
      date: "2026-07-07",
      value: 19.01,
      source: "fred",
    };
    adapter.seed(vxvclsRow);
    const result = await adapter.fetchFredSeries("VXVCLS");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(vxvclsRow);
  });

  it("returns ok with the exact seeded BAMLH0A0HYM2 row — raw percent units, no /100 (Phase 24 HY OAS)", async () => {
    const adapter = makeMemoryFredSeriesAdapter();
    const hyOasRow: MacroObservationRow = {
      seriesId: "BAMLH0A0HYM2",
      date: "2026-07-07",
      value: 2.67,
      source: "fred",
    };
    adapter.seed(hyOasRow);
    const result = await adapter.fetchFredSeries("BAMLH0A0HYM2");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(hyOasRow);
  });
});

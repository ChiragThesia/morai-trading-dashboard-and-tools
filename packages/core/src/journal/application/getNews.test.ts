/**
 * getNews.test.ts — makeGetNewsUseCase read use-case (D28).
 *
 * Tests verify:
 *   1. rows map to NewsEntry with publishedAt as ISO string
 *   2. empty store → ok([])
 *   3. StorageError propagated unchanged
 *   4. reads with the default limit of 50
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { NewsItemRow, ForReadingNewsItems } from "./ports.ts";
import { makeGetNewsUseCase } from "./getNews.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROW: NewsItemRow = {
  id: "24843171",
  headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
  summary: "Markets retreated after hawkish commentary.",
  source: "benzinga",
  url: "https://www.benzinga.com/markets/24843171",
  symbols: ["SPY", "QQQ"],
  publishedAt: new Date("2026-07-24T13:05:00Z"),
  updatedAt: new Date("2026-07-24T13:06:00Z"),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeGetNewsUseCase", () => {
  it("maps rows to entries with ISO publishedAt (Date never crosses the contract)", async () => {
    const readNewsItems: ForReadingNewsItems = vi.fn().mockResolvedValue(ok([ROW]));

    const result = await makeGetNewsUseCase({ readNewsItems })();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        id: "24843171",
        headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
        summary: "Markets retreated after hawkish commentary.",
        source: "benzinga",
        url: "https://www.benzinga.com/markets/24843171",
        symbols: ["SPY", "QQQ"],
        publishedAt: "2026-07-24T13:05:00.000Z",
      },
    ]);
  });

  it("empty store → ok([])", async () => {
    const readNewsItems: ForReadingNewsItems = vi.fn().mockResolvedValue(ok([]));

    const result = await makeGetNewsUseCase({ readNewsItems })();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("propagates StorageError unchanged", async () => {
    const storageErr = { kind: "storage-error" as const, message: "pool down" };
    const readNewsItems: ForReadingNewsItems = vi
      .fn()
      .mockResolvedValue(err(storageErr));

    const result = await makeGetNewsUseCase({ readNewsItems })();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(storageErr);
  });

  it("reads a wide raw window so the relevance filter has material to work with", async () => {
    const readNewsItems: ForReadingNewsItems = vi.fn().mockResolvedValue(ok([]));

    await makeGetNewsUseCase({ readNewsItems })();

    expect(readNewsItems).toHaveBeenCalledExactlyOnceWith(300);
  });

  // ─── Relevance filter (D28) ─────────────────────────────────────────────────
  // The raw store keeps the whole Alpaca firehose; the read path serves only what
  // can move SPX implied vol. See domain/news-relevance.ts.

  it("drops analyst-rating noise and keeps macro prints", async () => {
    const rating: NewsItemRow = {
      ...ROW,
      id: "rating",
      headline: "Truist Securities Maintains Hold on Quest Diagnostics, Raises Price Target to $250",
      symbols: ["DGX"],
    };
    const macro: NewsItemRow = {
      ...ROW,
      id: "macro",
      headline: "Fed Holds Rates Steady, Powell Signals Higher-For-Longer",
      symbols: [],
    };
    const readNewsItems: ForReadingNewsItems = vi
      .fn()
      .mockResolvedValue(ok([rating, macro]));

    const result = await makeGetNewsUseCase({ readNewsItems })();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((e) => e.id)).toEqual(["macro"]);
  });

  it("caps the filtered result at 50 entries", async () => {
    const many: ReadonlyArray<NewsItemRow> = Array.from({ length: 120 }, (_, i) => ({
      ...ROW,
      id: String(i),
      headline: `S&P 500 Moves On Headline ${i}`,
    }));
    const readNewsItems: ForReadingNewsItems = vi.fn().mockResolvedValue(ok(many));

    const result = await makeGetNewsUseCase({ readNewsItems })();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(50);
  });
});

/**
 * fetchNews.test.ts — makeFetchNews orchestration use-case (D28).
 *
 * Tests verify:
 *   1. fetch ok → persist called with the fetched rows
 *   2. fetch err → propagated, persist not called (short-circuit)
 *   3. persist err → propagated
 *   4. empty fetch → ok, persist skipped (nothing to write)
 *   5. idempotency: double-invoke same ids → memory store holds unique ids only
 *
 * Test doubles are inline function implementations (core cannot import adapters —
 * architecture-boundaries §2).
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type {
  NewsItemRow,
  ForFetchingNewsHeadlines,
  ForPersistingNewsItems,
} from "./ports.ts";
import { makeFetchNews } from "./fetchNews.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ROW_A: NewsItemRow = {
  id: "24843171",
  headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
  summary: "Markets retreated after hawkish commentary.",
  source: "benzinga",
  url: "https://www.benzinga.com/markets/24843171",
  symbols: ["SPY", "QQQ"],
  publishedAt: new Date("2026-07-24T13:05:00Z"),
  updatedAt: new Date("2026-07-24T13:06:00Z"),
};

const ROW_B: NewsItemRow = {
  ...ROW_A,
  id: "24843200",
  headline: "Crude Rallies On Inventory Draw",
  symbols: [],
  url: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeFetchNews", () => {
  it("returns ok(void) and persists the fetched rows", async () => {
    const fetchNewsHeadlines: ForFetchingNewsHeadlines = vi
      .fn()
      .mockResolvedValue(ok([ROW_A, ROW_B]));
    const persistNewsItems: ForPersistingNewsItems = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    const useCase = makeFetchNews({ fetchNewsHeadlines, persistNewsItems });
    const result = await useCase();

    expect(result.ok).toBe(true);
    expect(persistNewsItems).toHaveBeenCalledExactlyOnceWith([ROW_A, ROW_B]);
  });

  it("propagates fetch error and does NOT call persist", async () => {
    const fetchErr = { kind: "fetch-error" as const, message: "alpaca unavailable" };
    const fetchNewsHeadlines: ForFetchingNewsHeadlines = vi
      .fn()
      .mockResolvedValue(err(fetchErr));
    const persistNewsItems: ForPersistingNewsItems = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    const useCase = makeFetchNews({ fetchNewsHeadlines, persistNewsItems });
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
    expect(persistNewsItems).not.toHaveBeenCalled();
  });

  it("propagates persist/storage error", async () => {
    const fetchNewsHeadlines: ForFetchingNewsHeadlines = vi
      .fn()
      .mockResolvedValue(ok([ROW_A]));
    const storageErr = { kind: "storage-error" as const, message: "disk full" };
    const persistNewsItems: ForPersistingNewsItems = vi
      .fn()
      .mockResolvedValue(err(storageErr));

    const useCase = makeFetchNews({ fetchNewsHeadlines, persistNewsItems });
    const result = await useCase();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("empty fetch → ok(void), persist skipped", async () => {
    const fetchNewsHeadlines: ForFetchingNewsHeadlines = vi
      .fn()
      .mockResolvedValue(ok([]));
    const persistNewsItems: ForPersistingNewsItems = vi
      .fn()
      .mockResolvedValue(ok(undefined));

    const result = await makeFetchNews({ fetchNewsHeadlines, persistNewsItems })();

    expect(result.ok).toBe(true);
    expect(persistNewsItems).not.toHaveBeenCalled();
  });

  it("idempotency: double-invoke same ids → store holds unique ids (repo upsert semantics)", async () => {
    // Inline memory store — mirrors the news repo's ON CONFLICT (id) DO UPDATE semantics
    const store = new Map<string, NewsItemRow>();
    const persistNewsItems: ForPersistingNewsItems = async (rows) => {
      for (const row of rows) {
        store.set(row.id, row);
      }
      return ok(undefined);
    };
    const fetchNewsHeadlines: ForFetchingNewsHeadlines = vi
      .fn()
      .mockResolvedValue(ok([ROW_A, ROW_B]));

    const useCase = makeFetchNews({ fetchNewsHeadlines, persistNewsItems });
    await useCase();
    await useCase();

    expect(store.size).toBe(2);
  });
});

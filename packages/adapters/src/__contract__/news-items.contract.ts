import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingNewsItems,
  ForReadingNewsItems,
  NewsItemRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the news-items persistence port (D28).
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - Bulk upsert persists all fields (id, headline, summary, source, url, symbols, timestamps)
 * - ON CONFLICT (id) DO UPDATE: re-upserting an id REFRESHES the row (headline corrections)
 * - listNewsItems(limit) returns rows ordered by publishedAt DESC and honours the limit
 * - Empty batch upsert is an ok no-op
 * - listNewsItems returns [] when no rows exist (requires fresh store per test)
 *
 * The Postgres wrapper MUST truncate news_items in its beforeEach so the
 * "empty array" and limit tests see a predictable table state.
 */

export type NewsItemsRepo = {
  readonly upsertNewsItems: ForPersistingNewsItems;
  readonly listNewsItems: ForReadingNewsItems;
};

function makeRow(overrides: Partial<NewsItemRow> = {}): NewsItemRow {
  return {
    id: "24843171",
    headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
    summary: "Markets retreated after hawkish commentary.",
    source: "benzinga",
    url: "https://www.benzinga.com/markets/24843171",
    symbols: ["SPY", "QQQ"],
    publishedAt: new Date("2026-07-24T13:05:00.000Z"),
    updatedAt: new Date("2026-07-24T13:06:00.000Z"),
    ...overrides,
  };
}

export function runNewsItemsContractTests(makeRepo: () => NewsItemsRepo): void {
  describe("news-items persistence contract", () => {
    let repo: NewsItemsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("bulk upsert persists all fields, including null url and empty symbols", async () => {
      const tagged = makeRow();
      const untagged = makeRow({
        id: "24843200",
        url: null,
        symbols: [],
        summary: "",
        publishedAt: new Date("2026-07-24T13:10:00.000Z"),
      });

      const upsertResult = await repo.upsertNewsItems([tagged, untagged]);
      expect(upsertResult.ok).toBe(true);

      const listResult = await repo.listNewsItems(50);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value).toHaveLength(2);

      const foundTagged = listResult.value.find((r) => r.id === tagged.id);
      expect(foundTagged).toBeDefined();
      if (foundTagged === undefined) return;
      expect(foundTagged.headline).toBe(tagged.headline);
      expect(foundTagged.summary).toBe(tagged.summary);
      expect(foundTagged.source).toBe(tagged.source);
      expect(foundTagged.url).toBe(tagged.url);
      expect([...foundTagged.symbols]).toEqual(["SPY", "QQQ"]);
      expect(foundTagged.publishedAt).toBeInstanceOf(Date);
      expect(foundTagged.publishedAt.getTime()).toBe(tagged.publishedAt.getTime());
      expect(foundTagged.updatedAt.getTime()).toBe(tagged.updatedAt.getTime());

      const foundUntagged = listResult.value.find((r) => r.id === untagged.id);
      expect(foundUntagged).toBeDefined();
      if (foundUntagged === undefined) return;
      expect(foundUntagged.url).toBeNull();
      expect([...foundUntagged.symbols]).toEqual([]);
      expect(foundUntagged.summary).toBe("");
    });

    it("re-upserting the same id UPDATES the row (headline correction, DO UPDATE not DO NOTHING)", async () => {
      const original = makeRow();
      await repo.upsertNewsItems([original]);

      const corrected = makeRow({
        headline: "CORRECTED: S&P 500 Flat After Fed Commentary",
        updatedAt: new Date("2026-07-24T13:30:00.000Z"),
      });
      const second = await repo.upsertNewsItems([corrected]);
      expect(second.ok).toBe(true);

      const listResult = await repo.listNewsItems(50);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;

      const rowsForId = listResult.value.filter((r) => r.id === original.id);
      expect(rowsForId).toHaveLength(1);
      const row = rowsForId.at(0);
      expect(row).toBeDefined();
      if (row === undefined) return;
      expect(row.headline).toBe("CORRECTED: S&P 500 Flat After Fed Commentary");
      expect(row.updatedAt.getTime()).toBe(corrected.updatedAt.getTime());
    });

    it("listNewsItems returns rows ordered by publishedAt DESC (newest first)", async () => {
      const older = makeRow({ id: "1", publishedAt: new Date("2026-07-24T09:00:00Z") });
      const newest = makeRow({ id: "2", publishedAt: new Date("2026-07-24T15:00:00Z") });
      const middle = makeRow({ id: "3", publishedAt: new Date("2026-07-24T12:00:00Z") });
      await repo.upsertNewsItems([older, newest, middle]);

      const listResult = await repo.listNewsItems(50);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value.map((r) => r.id)).toEqual(["2", "3", "1"]);
    });

    it("listNewsItems honours the limit (newest kept)", async () => {
      const older = makeRow({ id: "1", publishedAt: new Date("2026-07-24T09:00:00Z") });
      const newest = makeRow({ id: "2", publishedAt: new Date("2026-07-24T15:00:00Z") });
      await repo.upsertNewsItems([older, newest]);

      const listResult = await repo.listNewsItems(1);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value).toHaveLength(1);
      expect(listResult.value.at(0)?.id).toBe("2");
    });

    it("empty batch upsert is an ok no-op", async () => {
      const upsertResult = await repo.upsertNewsItems([]);
      expect(upsertResult.ok).toBe(true);

      const listResult = await repo.listNewsItems(50);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value).toEqual([]);
    });

    it("listNewsItems returns empty array when no rows exist", async () => {
      const listResult = await repo.listNewsItems(50);
      expect(listResult.ok).toBe(true);
      if (!listResult.ok) return;
      expect(listResult.value).toEqual([]);
    });
  });
}

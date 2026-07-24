/**
 * News contract tests (D28).
 *
 * newsItem and newsResponse are the single Zod schema source for both
 * GET /api/analytics/news and the get_news MCP tool.
 */

import { describe, it, expect } from "vitest";
import { newsItem, newsResponse } from "./news.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A fully-populated, valid headline. */
const validItem = {
  id: "24843171",
  headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates",
  summary: "Markets retreated after hawkish commentary from two Fed governors.",
  source: "benzinga",
  url: "https://www.benzinga.com/markets/24843171",
  symbols: ["SPY", "QQQ"],
  publishedAt: "2026-07-24T13:05:00.000Z",
};

// ─── newsItem ────────────────────────────────────────────────────────────────

describe("newsItem", () => {
  it("parses a fully-populated valid item (round-trip)", () => {
    const parsed = newsItem.parse(validItem);
    expect(parsed.id).toBe("24843171");
    expect(parsed.symbols).toEqual(["SPY", "QQQ"]);
    expect(parsed.publishedAt).toBe("2026-07-24T13:05:00.000Z");
  });

  it("accepts a null url (article link may be absent)", () => {
    expect(() => newsItem.parse({ ...validItem, url: null })).not.toThrow();
  });

  it("accepts an empty summary and empty symbols (untagged wire item)", () => {
    expect(() =>
      newsItem.parse({ ...validItem, summary: "", symbols: [] }),
    ).not.toThrow();
  });

  it("rejects a missing headline", () => {
    const { headline: _omit, ...withoutField } = validItem;
    expect(newsItem.safeParse(withoutField).success).toBe(false);
  });

  it("rejects a publishedAt that is not a datetime", () => {
    const result = newsItem.safeParse({ ...validItem, publishedAt: "2026-07-24" });
    expect(result.success).toBe(false);
  });

  it("rejects a numeric id (Alpaca ids are stringified at the adapter)", () => {
    const result = newsItem.safeParse({ ...validItem, id: 24843171 });
    expect(result.success).toBe(false);
  });
});

// ─── newsResponse ────────────────────────────────────────────────────────────

describe("newsResponse", () => {
  it("parses an array with entries", () => {
    expect(() => newsResponse.parse([validItem, { ...validItem, id: "2" }])).not.toThrow();
  });

  it("parses an empty array (no-data valid case)", () => {
    expect(() => newsResponse.parse([])).not.toThrow();
  });

  it("rejects a non-array (single object without wrapping)", () => {
    expect(() => newsResponse.parse(validItem)).toThrow();
  });
});

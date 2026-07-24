import { z } from "zod";

// News contracts (D28): ONE schema source for GET /api/analytics/news + get_news MCP tool.
//
// Headlines come from the Alpaca News API (Benzinga wire) via the fetch-news cron and are
// served newest-first from news_items. Headlines + summaries only — article bodies are
// never fetched or stored.

// ─── Single headline ─────────────────────────────────────────────────────────

/**
 * newsItem — one market headline.
 *
 * `id` is Alpaca's numeric news id stringified at the adapter (stable upsert key).
 */
export const newsItem = z.object({
  id: z.string(),
  headline: z.string(),
  /** May be empty — not every wire item carries a summary. */
  summary: z.string(),
  /** Wire source, e.g. 'benzinga'. */
  source: z.string(),
  /** Link out to the article; null when the wire item has none. */
  url: z.string().nullable(),
  /** Tagged tickers; empty for untagged macro items. */
  symbols: z.array(z.string()),
  /** ISO 8601 datetime the item was published. */
  publishedAt: z.string().datetime(),
});

export type NewsItem = z.infer<typeof newsItem>;

/**
 * newsResponse — the GET /api/analytics/news + get_news MCP tool response shape.
 * Newest-first array; `[]` is the valid no-data case (keys unset or cron not yet run).
 */
export const newsResponse = z.array(newsItem);

export type NewsResponse = z.infer<typeof newsResponse>;

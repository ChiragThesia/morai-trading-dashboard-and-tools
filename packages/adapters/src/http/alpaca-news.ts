import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingNewsHeadlines, NewsItemRow, FetchError } from "@morai/core";

// Alpaca News API (D28) — Benzinga wire relay, free tier.
// https://data.alpaca.markets/v1beta1/news?limit=50&sort=desc
// Auth: APCA-API-KEY-ID + APCA-API-SECRET-KEY headers (paper-account key pair).
// include_content stays off — headlines + summaries only, bodies never fetched.
// Response: { news: [{ id, headline, summary, source, url, symbols, created_at,
//   updated_at, ... }], next_page_token }
const ALPACA_NEWS_URL = "https://data.alpaca.markets/v1beta1/news";
const FETCH_LIMIT = 50;

// ─── Zod schema ───────────────────────────────────────────────────────────────
// Only the fields we persist; Zod strips the rest (author, images, content).
// z.coerce.date() rejects invalid datetime strings (NaN Date fails the parse).

const AlpacaNewsItemSchema = z.object({
  id: z.number(),
  headline: z.string(),
  summary: z.string().default(""),
  source: z.string(),
  url: z.string().nullish(),
  symbols: z.array(z.string()).default([]),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

const AlpacaNewsResponseSchema = z.object({
  news: z.array(AlpacaNewsItemSchema),
});

// ─── Adapter factory ──────────────────────────────────────────────────────────

/**
 * makeAlpacaNewsAdapter — Alpaca News driven adapter implementing
 * ForFetchingNewsHeadlines (D28).
 *
 * No-fallback pattern (mirrors makeFredSeriesAdapter): missing/empty key pair,
 * network error, non-2xx, and Zod parse failure all return err(FetchError) —
 * never a fabricated batch. Key values are never logged (static warn text only).
 *
 * Mapping to NewsItemRow: numeric id → string (stable upsert key), empty-string
 * url → null, vendor created_at/updated_at → publishedAt/updatedAt Dates.
 */
export function makeAlpacaNewsAdapter(deps: {
  readonly fetch: typeof globalThis.fetch;
  readonly keyId: string | undefined;
  readonly secretKey: string | undefined;
}): ForFetchingNewsHeadlines {
  return async (): Promise<Result<ReadonlyArray<NewsItemRow>, FetchError>> => {
    if (
      deps.keyId === undefined ||
      deps.keyId === "" ||
      deps.secretKey === undefined ||
      deps.secretKey === ""
    ) {
      console.warn("Alpaca: missing API key pair, cannot fetch news");
      return err({ kind: "fetch-error", message: "Alpaca API key pair missing" });
    }

    const url = new URL(ALPACA_NEWS_URL);
    url.searchParams.set("limit", String(FETCH_LIMIT));
    url.searchParams.set("sort", "desc");

    let rawBody: unknown;
    try {
      const response = await deps.fetch(url.toString(), {
        headers: {
          "APCA-API-KEY-ID": deps.keyId,
          "APCA-API-SECRET-KEY": deps.secretKey,
        },
      });
      if (!response.ok) {
        console.warn(`Alpaca: HTTP ${response.status}, no fallback for news fetch`);
        return err({ kind: "fetch-error", message: `HTTP ${response.status}` });
      }
      rawBody = await response.json();
    } catch {
      console.warn("Alpaca: network error, no fallback for news fetch");
      return err({ kind: "fetch-error", message: "network error" });
    }

    const parsed = AlpacaNewsResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      console.warn("Alpaca: unexpected payload shape, no fallback for news fetch");
      return err({ kind: "fetch-error", message: "unexpected payload shape" });
    }

    const rows: ReadonlyArray<NewsItemRow> = parsed.data.news.map((item) => ({
      id: String(item.id),
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url === undefined || item.url === null || item.url === "" ? null : item.url,
      symbols: item.symbols,
      publishedAt: item.created_at,
      updatedAt: item.updated_at,
    }));

    return ok(rows);
  };
}

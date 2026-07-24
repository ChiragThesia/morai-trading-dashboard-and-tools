/**
 * getNews.ts — makeGetNewsUseCase read use-case (D28).
 *
 * Reads the latest NewsItemRow[] from the repo (published_at DESC, fixed limit 50) and
 * maps each row to a NewsEntry with publishedAt as an ISO datetime string.
 *
 * NewsEntry is structurally compatible with newsItem from @morai/contracts.
 * It is defined here (not imported from contracts) so the hexagon stays pure
 * (architecture-boundaries §2: core → @morai/shared only).
 *
 * Empty store → ok([]).  StorageError from the repo is propagated unchanged.
 *
 * ForRunningGetNews is the driver port type consumed by the HTTP route + MCP tool.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingNewsItems, StorageError } from "./ports.ts";

// ─── Domain shape (mirrored from newsItem contract) ───────────────────────────

/**
 * NewsEntry — one market headline as served to the API edge.
 * Structurally compatible with NewsItem from @morai/contracts.
 */
export type NewsEntry = {
  readonly id: string;
  readonly headline: string;
  readonly summary: string;
  readonly source: string;
  readonly url: string | null;
  readonly symbols: ReadonlyArray<string>;
  readonly publishedAt: string; // ISO 8601 datetime
};

// ─── Port types ───────────────────────────────────────────────────────────────

/** Fixed read window — the card shows ~15, the API serves the top 50. */
const NEWS_READ_LIMIT = 50;

/** ForRunningGetNews — driver port returned by makeGetNewsUseCase (D28). */
export type ForRunningGetNews = () => Promise<
  Result<ReadonlyArray<NewsEntry>, StorageError>
>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeGetNewsUseCase — inject deps, return ForRunningGetNews.
 *
 * The returned driver:
 *   1. Reads the latest 50 NewsItemRow[] from the repo (published_at DESC).
 *   2. Maps each row → NewsEntry (Date → ISO string; updatedAt dropped — storage-only).
 *   3. Returns ok([]) when no rows exist; propagates StorageError on failure.
 */
export function makeGetNewsUseCase(deps: {
  readonly readNewsItems: ForReadingNewsItems;
}): ForRunningGetNews {
  return async (): Promise<Result<ReadonlyArray<NewsEntry>, StorageError>> => {
    const result = await deps.readNewsItems(NEWS_READ_LIMIT);
    if (!result.ok) {
      return result;
    }

    const entries: ReadonlyArray<NewsEntry> = result.value.map((row) => ({
      id: row.id,
      headline: row.headline,
      summary: row.summary,
      source: row.source,
      url: row.url,
      symbols: row.symbols,
      publishedAt: row.publishedAt.toISOString(),
    }));

    return ok(entries);
  };
}

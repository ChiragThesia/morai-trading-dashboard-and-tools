import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingNewsItems,
  ForReadingNewsItems,
  NewsItemRow,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryNewsItemsRepo — in-memory twin of the Postgres news-items adapter (D28).
 *
 * Implements ForPersistingNewsItems + ForReadingNewsItems using a Map keyed by id.
 * Upsert overwrites an existing key, mirroring ON CONFLICT (id) DO UPDATE —
 * Benzinga corrects headlines upstream, so a re-fetched id refreshes the row.
 *
 * Ordering: listNewsItems returns rows sorted by publishedAt DESC (id DESC tiebreak,
 * matching the Postgres ORDER BY), sliced to `limit`.
 *
 * Always returns ok(...) — no network or DB calls, no error paths.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the
 * same PR (architecture-boundaries.md §8).
 */
export type MemoryNewsItemsRepo = {
  readonly upsertNewsItems: ForPersistingNewsItems;
  readonly listNewsItems: ForReadingNewsItems;
};

export function makeMemoryNewsItemsRepo(): MemoryNewsItemsRepo {
  const store = new Map<string, NewsItemRow>();

  const upsertNewsItems: ForPersistingNewsItems = async (
    rows: ReadonlyArray<NewsItemRow>,
  ): Promise<Result<void, StorageError>> => {
    for (const row of rows) {
      store.set(row.id, row); // DO UPDATE: existing key → overwrite
    }
    return ok(undefined);
  };

  const listNewsItems: ForReadingNewsItems = async (
    limit: number,
  ): Promise<Result<ReadonlyArray<NewsItemRow>, StorageError>> => {
    const sorted = [...store.values()].sort(
      (a, b) =>
        b.publishedAt.getTime() - a.publishedAt.getTime() ||
        b.id.localeCompare(a.id),
    );
    return ok(sorted.slice(0, limit));
  };

  return { upsertNewsItems, listNewsItems };
}

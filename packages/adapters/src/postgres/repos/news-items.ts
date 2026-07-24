import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingNewsItems,
  ForReadingNewsItems,
  NewsItemRow,
  StorageError,
} from "@morai/core";
import { desc, sql } from "drizzle-orm";
import { newsItems } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresNewsItemsRepo — Postgres implementation of
 * ForPersistingNewsItems and ForReadingNewsItems (D28).
 *
 * Bulk upsert: one parameterized multi-row INSERT with
 * ON CONFLICT (id) DO UPDATE (excluded.*) — Benzinga corrects headlines
 * upstream, so a re-fetched id refreshes the row instead of skipping it.
 * Read path: published_at DESC (id DESC tiebreak), LIMIT n.
 */
export type PostgresNewsItemsRepo = {
  readonly upsertNewsItems: ForPersistingNewsItems;
  readonly listNewsItems: ForReadingNewsItems;
};

export function makePostgresNewsItemsRepo(db: Db): PostgresNewsItemsRepo {
  const upsertNewsItems: ForPersistingNewsItems = async (
    rows: ReadonlyArray<NewsItemRow>,
  ): Promise<Result<void, StorageError>> => {
    if (rows.length === 0) {
      return ok(undefined); // Drizzle rejects an empty VALUES list
    }
    try {
      await db
        .insert(newsItems)
        .values(
          rows.map((row) => ({
            id: row.id,
            headline: row.headline,
            summary: row.summary,
            source: row.source,
            url: row.url,
            symbols: row.symbols,
            publishedAt: row.publishedAt,
            updatedAt: row.updatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: newsItems.id,
          set: {
            headline: sql`excluded.headline`,
            summary: sql`excluded.summary`,
            source: sql`excluded.source`,
            url: sql`excluded.url`,
            symbols: sql`excluded.symbols`,
            publishedAt: sql`excluded.published_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const listNewsItems: ForReadingNewsItems = async (
    limit: number,
  ): Promise<Result<ReadonlyArray<NewsItemRow>, StorageError>> => {
    try {
      const rawRows = await db
        .select()
        .from(newsItems)
        .orderBy(desc(newsItems.publishedAt), desc(newsItems.id))
        .limit(limit);

      return ok(
        rawRows.map((r) => ({
          id: r.id,
          headline: r.headline,
          summary: r.summary,
          source: r.source,
          url: r.url,
          symbols: r.symbols,
          publishedAt: r.publishedAt,
          updatedAt: r.updatedAt,
        })),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { upsertNewsItems, listNewsItems };
}

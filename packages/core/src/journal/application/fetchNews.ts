/**
 * fetchNews.ts — makeFetchNews orchestration use-case (D28).
 *
 * Orchestrates: fetch headline batch → persist (bulk idempotent upsert).
 *
 * Port contract:
 *   fetchNewsHeadlines: ForFetchingNewsHeadlines  (Alpaca News HTTP adapter / in-memory twin)
 *   persistNewsItems:   ForPersistingNewsItems    (Postgres repo / in-memory twin)
 *
 * Behaviour on err: fetch failure → propagate err, skip persist (no fabricated fallback).
 * Empty batch → ok(void), persist skipped. Timestamps are the vendor's own publish/update
 * times carried on each row — no injected clock.
 * Idempotency: the repo's ON CONFLICT (id) DO UPDATE absorbs re-fetched ids; the use-case
 * does not need its own dedup logic.
 *
 * ForRunningFetchNews is the driver port type consumed by the fetch-news pg-boss handler.
 *
 * Core must not import pg-boss, Hono, process.env, or node I/O (architecture-boundaries §2).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForFetchingNewsHeadlines,
  ForPersistingNewsItems,
  FetchError,
  StorageError,
} from "./ports.ts";

// ─── Port type ────────────────────────────────────────────────────────────────

/**
 * ForRunningFetchNews — the driver port returned by makeFetchNews.
 * The fetch-news pg-boss job handler injects this as its `fetchNews` dependency.
 */
export type ForRunningFetchNews = () => Promise<Result<void, FetchError | StorageError>>;

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makeFetchNews — inject deps, return the driver function (ForRunningFetchNews).
 *
 * The returned driver:
 *   1. Fetches the latest headline batch via `fetchNewsHeadlines`.
 *   2. On fetch err → returns err (persist is skipped).
 *   3. On an empty batch → returns ok(void) without touching the repo.
 *   4. Calls `persistNewsItems(rows)` — idempotent at the repo layer.
 *   5. Returns ok(void) on success or propagates the StorageError on persist failure.
 */
export function makeFetchNews(deps: {
  readonly fetchNewsHeadlines: ForFetchingNewsHeadlines;
  readonly persistNewsItems: ForPersistingNewsItems;
}): ForRunningFetchNews {
  return async (): Promise<Result<void, FetchError | StorageError>> => {
    const fetchResult = await deps.fetchNewsHeadlines();
    if (!fetchResult.ok) {
      return err(fetchResult.error);
    }

    if (fetchResult.value.length === 0) {
      return ok(undefined);
    }

    const persistResult = await deps.persistNewsItems(fetchResult.value);
    if (!persistResult.ok) {
      return err(persistResult.error);
    }

    return ok(undefined);
  };
}

import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runNewsItemsContractTests } from "../../__contract__/news-items.contract.ts";
import { makePostgresNewsItemsRepo } from "./news-items.ts";
import { makeDb } from "../db.ts";
import { newsItems } from "../schema.ts";

/**
 * Contract test for the Postgres news-items adapter (D28).
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * The beforeEach truncates news_items before each test so the shared contract
 * (which includes an "empty array" test and a limit test) sees a clean state.
 * Migrations — including 0027 which creates the news_items table — are applied
 * in globalSetup before any test runs.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres news-items adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    // Migrations already run in globalSetup
    db = makeDb(dbUrl);
  });

  // Truncate before each test for row-level isolation
  beforeEach(async () => {
    if (!db) return;
    await db.delete(newsItems);
  });

  runNewsItemsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresNewsItemsRepo(db);
    return {
      upsertNewsItems: repo.upsertNewsItems,
      listNewsItems: repo.listNewsItems,
    };
  });
});

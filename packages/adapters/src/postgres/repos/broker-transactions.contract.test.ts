import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runBrokerTransactionsContractTests } from "../../__contract__/broker-transactions.contract.ts";
import { makePostgresBrokerTransactionsRepo } from "./broker-transactions.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres broker-transactions adapter (Trade Ledger).
 * Requires Docker (testcontainers postgres:16 with migrations applied).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres broker-transactions adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(() => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // broker_transactions has no FK deps — truncate alone is safe
    await db.execute(sql`TRUNCATE TABLE broker_transactions`);
  });

  runBrokerTransactionsContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      return makePostgresBrokerTransactionsRepo(db);
    },
    () => ({ __dummy: undefined }),
  );
});

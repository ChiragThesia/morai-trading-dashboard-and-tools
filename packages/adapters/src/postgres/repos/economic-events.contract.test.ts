import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runEconomicEventsContractTests } from "../../__contract__/economic-events.contract.ts";
import { makePostgresEconomicEventsRepo } from "./economic-events.ts";
import { makeDb } from "../db.ts";
import { economicEvents } from "../schema.ts";

/**
 * Contract test for the Postgres economic-events adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * The beforeEach truncates economic_events before each test so the shared contract (which
 * includes an "empty array" test) sees a clean state.
 * Migrations — including 0014 which creates the economic_events table — are applied in
 * globalSetup before any test runs.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres economic-events adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    // Migrations already run in globalSetup
    db = makeDb(dbUrl);
  });

  // Truncate before each test for row-level isolation
  // (shared Postgres DB across tests in the same testcontainers run)
  beforeEach(async () => {
    if (!db) return;
    await db.delete(economicEvents);
  });

  runEconomicEventsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresEconomicEventsRepo(db);
    return {
      persistEconomicEvents: repo.persistEconomicEvents,
      readEconomicEvents: repo.readEconomicEvents,
    };
  });
});

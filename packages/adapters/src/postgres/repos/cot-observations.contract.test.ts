import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runCotObservationsContractTests } from "../../__contract__/cot-observations.contract.ts";
import { makePostgresCotObservationsRepo } from "./cot-observations.ts";
import { makeDb } from "../db.ts";
import { cotObservations } from "../schema.ts";

/**
 * Contract test for the Postgres cot-observations adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * The beforeEach truncates cot_observations before each test so the shared contract
 * (which includes an "empty array" test and a limit test) sees a clean state.
 * Migrations — including 0012 which creates the cot_observations table — are applied
 * in globalSetup before any test runs.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres cot-observations adapter", () => {
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
    await db.delete(cotObservations);
  });

  runCotObservationsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresCotObservationsRepo(db);
    return {
      insertCotObservation: repo.insertCotObservation,
      listCotObservations: repo.listCotObservations,
    };
  });
});

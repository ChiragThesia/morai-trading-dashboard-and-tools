import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runMacroObservationsContractTests } from "../../__contract__/macro-observations.contract.ts";
import { makePostgresMacroObservationsRepo } from "./macro-observations.ts";
import { makeDb } from "../db.ts";
import { macroObservations } from "../schema.ts";

/**
 * Contract test for the Postgres macro-observations adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * The beforeEach truncates macro_observations before each test so the shared
 * contract (which includes an "empty array" test) sees a clean state.
 * Migrations — including 0013 which creates the macro_observations table — are
 * applied in globalSetup before any test runs.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres macro-observations adapter", () => {
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
    await db.delete(macroObservations);
  });

  runMacroObservationsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresMacroObservationsRepo(db);
    return {
      insertMacroObservation: repo.insertMacroObservation,
      readMacroObservations: repo.readMacroObservations,
    };
  });
});

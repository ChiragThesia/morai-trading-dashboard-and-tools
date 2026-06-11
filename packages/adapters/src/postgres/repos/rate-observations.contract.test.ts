import { describe, beforeAll } from "vitest";
import { inject } from "vitest";
import { runRateObservationsContractTests } from "../../__contract__/rate-observations.contract.ts";
import { makePostgresRateObservationsRepo } from "./rate-observations.ts";
import { makeDb } from "../db.ts";

/**
 * Contract test for the Postgres rate-observations adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres rate-observations adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    // Migrations have already been run in globalSetup
    db = makeDb(dbUrl);
  });

  runRateObservationsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresRateObservationsRepo(db);
    return {
      persistRate: repo.persistRate,
      readRate: repo.readRate,
    };
  });
});

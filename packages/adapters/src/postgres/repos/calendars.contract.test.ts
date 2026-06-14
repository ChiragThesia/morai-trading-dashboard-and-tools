import { describe, beforeAll, afterAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runCalendarsContractTests } from "../../__contract__/calendars.contract.ts";
import { makePostgresCalendarsRepo } from "./calendars.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres calendars adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    // Migrations have already been run in globalSetup
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    // Truncate calendars between tests to prevent state leak
    if (!db) return;
    await db.execute(sql`TRUNCATE TABLE calendars CASCADE`);
  });

  afterAll(async () => {
    // postgres.js auto-closes connections when process exits; no explicit close needed
    // for the test db (container handles teardown in globalSetup afterAll)
  });

  runCalendarsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    return makePostgresCalendarsRepo(db);
  });
});

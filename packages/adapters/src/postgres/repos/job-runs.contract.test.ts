import { describe, it, expect, beforeAll } from "vitest";
import { inject } from "vitest";
import { makePostgresJobRunsRepo } from "./job-runs.ts";
import { makeDb } from "../db.ts";

/**
 * Contract test for the Postgres job-runs adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * Key assertion: when pgboss.job has no matching rows (first deploy, fresh DB),
 * the repo MUST return ok with an empty map — never throw.
 * (Pitfall 6 — pgboss schema may exist but have no data on first deploy)
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres job-runs adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    // Migrations have already been run in globalSetup (which runs Drizzle migrations)
    // pgboss.job is created by pg-boss at boss.start() — NOT by our migrations.
    // Therefore pgboss schema may not exist yet in the test DB.
    db = makeDb(dbUrl);
  });

  it("returns ok with empty map when pgboss.job has no matching rows (first deploy, Pitfall 6)", async () => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresJobRunsRepo(db);
    const result = await repo.readJobRuns();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("never throws — even when pgboss schema does not exist", async () => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresJobRunsRepo(db);
    // Should resolve (not reject) regardless of pgboss schema presence
    await expect(repo.readJobRuns()).resolves.toBeDefined();
  });
});

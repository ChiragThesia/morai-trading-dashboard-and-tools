import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inject } from "vitest";
import { makePostgresJobRunsRepo } from "./job-runs.ts";
import { makeDb } from "../db.ts";
import { jobRunRecord } from "@morai/contracts";
import { sql } from "drizzle-orm";

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

// ---------------------------------------------------------------------------
// RED: populated pgboss.job contract test
// Seed a minimal pgboss.job fixture and assert the adapter output satisfies
// the contracts jobRunRecord schema (Z-anchored ISO-8601).
// On the CURRENT code this MUST FAIL because extractCompletedOn passes the
// Postgres text string ("2026-06-12 13:31:38.031+00") through unchanged,
// which does not satisfy z.string().datetime() (requires Z-anchored ISO-8601).
// ---------------------------------------------------------------------------
describe.skipIf(shouldSkip)(
  "postgres job-runs adapter — populated pgboss.job",
  () => {
    let db: ReturnType<typeof makeDb>;

    beforeAll(async () => {
      if (!dbUrl) return;
      db = makeDb(dbUrl);

      // Build a minimal pgboss.job table.
      // pg-boss is NOT in our Drizzle migrations — we create the schema/table
      // here with raw SQL. Any NOT NULL column that pg-boss would normally set
      // gets a DEFAULT so our minimal INSERTs stay clean.
      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pgboss.job (
          id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
          name        text        NOT NULL,
          state       text        NOT NULL,
          completed_on timestamptz,
          output      jsonb,
          created_on  timestamptz NOT NULL DEFAULT now(),
          started_on  timestamptz,
          expire_in   interval    NOT NULL DEFAULT interval '15 minutes',
          data        jsonb,
          retry_limit integer     NOT NULL DEFAULT 0,
          retry_count integer     NOT NULL DEFAULT 0,
          retry_delay integer     NOT NULL DEFAULT 0,
          retry_backoff boolean   NOT NULL DEFAULT false,
          singleton_key text,
          singleton_on timestamptz,
          dead_letter  text,
          policy      text,
          priority    integer     NOT NULL DEFAULT 0,
          on_complete  boolean    NOT NULL DEFAULT false,
          keep_until   timestamptz NOT NULL DEFAULT now() + interval '14 days'
        )
      `);

      // Insert a 'completed' row for fetch-schwab-chain (the scheduled chain job
      // since the P4 Schwab-primary switch; fetch-cboe-chain is fallback-only and
      // is not in TRACKED_JOBS, so readJobRuns would correctly exclude it).
      await db.execute(sql`
        INSERT INTO pgboss.job (name, state, completed_on, output)
        VALUES (
          'fetch-schwab-chain',
          'completed',
          '2026-06-12 13:31:38.031+00'::timestamptz,
          NULL
        )
      `);

      // Insert a 'failed' row for fetch-rates with an output message
      await db.execute(sql`
        INSERT INTO pgboss.job (name, state, completed_on, output)
        VALUES (
          'fetch-rates',
          'failed',
          '2026-06-12 13:00:00.000+00'::timestamptz,
          '{"message": "FRED_API_KEY not set"}'::jsonb
        )
      `);
    });

    afterAll(async () => {
      if (!db) return;
      // Drop the pgboss schema so the no-schema Pitfall-6 tests in the sibling
      // describe block and other suites remain unaffected.
      await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
    });

    it("readJobRuns returns records that parse against the contracts jobRunRecord schema", async () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresJobRunsRepo(db);
      const result = await repo.readJobRuns();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const map = result.value;

      // Both seeded jobs should appear
      expect(Object.keys(map)).toContain("fetch-schwab-chain");
      expect(Object.keys(map)).toContain("fetch-rates");

      // Each record must satisfy the contracts schema
      for (const [jobName, record] of Object.entries(map)) {
        const parsed = jobRunRecord.safeParse(record);
        expect(
          parsed.success,
          `jobRunRecord.safeParse failed for "${jobName}": ${
            parsed.success ? "" : JSON.stringify(parsed.error.issues)
          }`,
        ).toBe(true);
      }
    });

    it("completed_on is emitted as Z-anchored ISO-8601", async () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresJobRunsRepo(db);
      const result = await repo.readJobRuns();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const map = result.value;

      for (const [jobName, record] of Object.entries(map)) {
        const ts = record.lastSuccessAt ?? record.lastErrorAt;
        if (ts !== null) {
          expect(
            ts,
            `${jobName}: timestamp "${ts}" does not end with Z`,
          ).toMatch(/Z$/);
          // Must round-trip through new Date → toISOString unchanged
          expect(
            new Date(ts).toISOString(),
            `${jobName}: timestamp "${ts}" does not round-trip cleanly`,
          ).toBe(ts);
        }
      }
    });

    it("failed row carries lastError message from output", async () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresJobRunsRepo(db);
      const result = await repo.readJobRuns();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const ratesRecord = result.value["fetch-rates"];
      expect(ratesRecord).toBeDefined();
      if (ratesRecord === undefined) return;

      expect(ratesRecord.lastErrorAt).not.toBeNull();
      expect(ratesRecord.lastError).toBe("FRED_API_KEY not set");
    });
  },
);

// ---------------------------------------------------------------------------
// CR-03: independent last-success AND last-error per job.
// Seed ONE job with a completed run at T1 then a FAILED run at T2 (T2 > T1).
// On the CURRENT DISTINCT ON (name) code this MUST FAIL: only the most-recent
// row (the failure) survives, so lastSuccessAt is forced to null even though
// the job succeeded earlier. The fix surfaces BOTH timestamps independently.
// ---------------------------------------------------------------------------
describe.skipIf(shouldSkip)(
  "postgres job-runs adapter — independent success/error per job (CR-03)",
  () => {
    let db: ReturnType<typeof makeDb>;

    const T1 = "2026-06-12 10:00:00.000+00"; // earlier completed
    const T2 = "2026-06-12 11:00:00.000+00"; // later failed

    beforeAll(async () => {
      if (!dbUrl) return;
      db = makeDb(dbUrl);

      await db.execute(sql`CREATE SCHEMA IF NOT EXISTS pgboss`);
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pgboss.job (
          id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
          name         text        NOT NULL,
          state        text        NOT NULL,
          completed_on timestamptz,
          output       jsonb,
          created_on   timestamptz NOT NULL DEFAULT now()
        )
      `);

      // sync-fills: completed at T1, then failed at T2 (T2 > T1)
      await db.execute(sql`
        INSERT INTO pgboss.job (name, state, completed_on, output)
        VALUES ('sync-fills', 'completed', ${T1}::timestamptz, NULL)
      `);
      await db.execute(sql`
        INSERT INTO pgboss.job (name, state, completed_on, output)
        VALUES ('sync-fills', 'failed', ${T2}::timestamptz, '{"message": "broker 503"}'::jsonb)
      `);

      // refresh-tokens: only completed runs → lastErrorAt/lastError stay null
      await db.execute(sql`
        INSERT INTO pgboss.job (name, state, completed_on, output)
        VALUES ('refresh-tokens', 'completed', ${T1}::timestamptz, NULL)
      `);
      await db.execute(sql`
        INSERT INTO pgboss.job (name, state, completed_on, output)
        VALUES ('refresh-tokens', 'completed', ${T2}::timestamptz, NULL)
      `);
    });

    afterAll(async () => {
      if (!db) return;
      await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);
    });

    it("reports lastSuccessAt AND lastErrorAt independently for a completed-then-failed job", async () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresJobRunsRepo(db);
      const result = await repo.readJobRuns();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const rec = result.value["sync-fills"];
      expect(rec).toBeDefined();
      if (rec === undefined) return;

      expect(rec.lastSuccessAt).toBe(new Date(T1).toISOString());
      expect(rec.lastErrorAt).toBe(new Date(T2).toISOString());
      expect(rec.lastError).toBe("broker 503");
    });

    it("a job with only completed runs has null lastErrorAt and lastError", async () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresJobRunsRepo(db);
      const result = await repo.readJobRuns();

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const rec = result.value["refresh-tokens"];
      expect(rec).toBeDefined();
      if (rec === undefined) return;

      expect(rec.lastSuccessAt).toBe(new Date(T2).toISOString());
      expect(rec.lastErrorAt).toBeNull();
      expect(rec.lastError).toBeNull();
    });
  },
);

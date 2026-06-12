import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingJobRuns, JobRunMap, JobRunRecord, StorageError } from "@morai/core";
import { sql } from "drizzle-orm";
import type { Db } from "../db.ts";

// The three job names this repo knows about (D-06, D-07)
const TRACKED_JOBS = ["fetch-cboe-chain", "fetch-rates", "compute-bsm-greeks"] as const;
type TrackedJob = (typeof TRACKED_JOBS)[number];

function isTrackedJob(name: unknown): name is TrackedJob {
  return TRACKED_JOBS.some((j) => j === name);
}

/**
 * makePostgresJobRunsRepo — reads pgboss.job for the most recent success/error
 * per tracked job name.
 *
 * Uses raw db.execute(sql`...`) because pgboss.job is an external schema NOT
 * defined in our schema.ts.
 *
 * Critical invariant (Pitfall 6): MUST return ok({}) when:
 *   - pgboss.job has no matching rows (first deploy)
 *   - pgboss schema does not exist yet (pg-boss not yet started)
 * Never throws across the port boundary.
 *
 * T-02-19: SELECT only — app DB user needs no GRANT beyond SELECT on pgboss.job.
 * T-02-20: lastError carries the pg-boss output message string only; no stack traces.
 */
export type PostgresJobRunsRepo = {
  readonly readJobRuns: ForReadingJobRuns;
};

function extractString(value: unknown): string | null {
  if (typeof value === "string") return value;
  return null;
}

function extractCompletedOn(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    // postgres.js returns timestamptz as a Postgres text string
    // (e.g. "2026-06-12 13:31:38.031+00") — normalize to Z-anchored ISO-8601
    // so the value satisfies z.string().datetime() at the contracts boundary.
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return null;
}

function extractLastError(output: unknown, state: string): string | null {
  if (state !== "failed") return null;
  if (output === null || output === undefined) return null;

  if (typeof output === "string") return output;

  // output is an object (pg-boss stores JSON); extract 'message' field without as-cast
  if (typeof output === "object") {
    const entries = Object.entries(output);
    for (const [key, val] of entries) {
      if (key === "message" && typeof val === "string") {
        return val;
      }
    }
  }
  return null;
}

export function makePostgresJobRunsRepo(db: Db): PostgresJobRunsRepo {
  const readJobRuns: ForReadingJobRuns = async (): Promise<
    Result<JobRunMap, StorageError>
  > => {
    try {
      // RESEARCH.md Pattern 6: DISTINCT ON (name) for most-recent row per job.
      // pg-boss uses snake_case column names and stores completed_on as a timestamp.
      // Rows with state='completed' → lastSuccessAt; state='failed' → lastErrorAt + lastError.
      const rows = await db.execute(sql`
        SELECT DISTINCT ON (name)
          name,
          state,
          completed_on,
          output
        FROM pgboss.job
        WHERE name IN ('fetch-cboe-chain', 'fetch-rates', 'compute-bsm-greeks')
          AND state IN ('completed', 'failed')
        ORDER BY name, completed_on DESC NULLS LAST
      `);

      // db.execute returns an array of row objects (unknown shape from postgres.js)
      const map: Record<string, JobRunRecord> = {};

      for (const rawRow of rows) {
        // rawRow is Record<string, unknown> from Drizzle's execute return type
        const rowEntries = Object.fromEntries(Object.entries(rawRow));
        const name = rowEntries["name"];
        const state = extractString(rowEntries["state"]) ?? "";

        if (!isTrackedJob(name)) continue;

        const completedOn = extractCompletedOn(rowEntries["completed_on"]);
        const lastError = extractLastError(rowEntries["output"], state);

        const record: JobRunRecord = {
          lastSuccessAt: state === "completed" ? completedOn : null,
          lastErrorAt: state === "failed" ? completedOn : null,
          lastError,
        };

        map[name] = record;
      }

      return ok(map);
    } catch (e) {
      // Pitfall 6: pgboss schema may not exist on first deploy.
      // Return empty map when the error indicates the table/schema is absent.
      const message = e instanceof Error ? e.message : String(e);
      if (
        message.includes("pgboss") ||
        message.includes("does not exist") ||
        message.includes("no such table")
      ) {
        return ok({});
      }
      // Other storage errors surface normally
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readJobRuns };
}

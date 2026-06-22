import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingJobRuns, JobRunMap, JobRunRecord, StorageError } from "@morai/core";
import { sql } from "drizzle-orm";
import type { Db } from "../db.ts";

// All seven tracked job names (D-12, SC1 — Phase 5 extension).
// Schwab-primary queue name used (D-07); CBOE queue name no longer tracked.
const TRACKED_JOBS = [
  "fetch-schwab-chain",
  "fetch-rates",
  "compute-bsm-greeks",
  "snapshot-calendars",
  "sync-fills",
  "refresh-tokens",
  "rebuild-journal",
] as const;
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

  // output is an object (pg-boss stores JSON); extract the single known 'message' key
  // directly via an `in` + typeof narrow (no entries scan, no as-cast).
  if (
    typeof output === "object" &&
    output !== null &&
    "message" in output &&
    typeof output.message === "string"
  ) {
    return output.message;
  }
  return null;
}

export function makePostgresJobRunsRepo(db: Db): PostgresJobRunsRepo {
  const readJobRuns: ForReadingJobRuns = async (): Promise<
    Result<JobRunMap, StorageError>
  > => {
    try {
      // CR-03: report last-success and last-error INDEPENDENTLY per job.
      // FILTER aggregates compute the most-recent completed timestamp and the
      // most-recent failed timestamp separately, so a job that succeeded then
      // later failed surfaces BOTH (the D-10 "succeeded at X but now failing" signal).
      // The correlated subselect carries the LATEST failed run's output → lastError.
      const rows = await db.execute(sql`
        SELECT
          j.name AS name,
          MAX(j.completed_on) FILTER (WHERE j.state = 'completed') AS last_success_at,
          MAX(j.completed_on) FILTER (WHERE j.state = 'failed')    AS last_error_at,
          (
            SELECT f.output
            FROM pgboss.job f
            WHERE f.name = j.name AND f.state = 'failed'
            ORDER BY f.completed_on DESC NULLS LAST
            LIMIT 1
          ) AS last_error_output
        FROM pgboss.job j
        WHERE j.name IN ('fetch-schwab-chain', 'fetch-rates', 'compute-bsm-greeks', 'snapshot-calendars', 'sync-fills', 'refresh-tokens', 'rebuild-journal')
          AND j.state IN ('completed', 'failed')
        GROUP BY j.name
      `);

      // db.execute returns an array of row objects (unknown shape from postgres.js)
      const map: Record<string, JobRunRecord> = {};

      for (const rawRow of rows) {
        // rawRow is Record<string, unknown> from Drizzle's execute return type
        const rowEntries = Object.fromEntries(Object.entries(rawRow));
        const name = rowEntries["name"];

        if (!isTrackedJob(name)) continue;

        const lastSuccessAt = extractCompletedOn(rowEntries["last_success_at"]);
        const lastErrorAt = extractCompletedOn(rowEntries["last_error_at"]);
        // lastError carries the latest failed run's output message — and only when
        // a failure actually occurred (lastErrorAt non-null).
        const lastError =
          lastErrorAt === null
            ? null
            : extractLastError(rowEntries["last_error_output"], "failed");

        const record: JobRunRecord = {
          lastSuccessAt,
          lastErrorAt,
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

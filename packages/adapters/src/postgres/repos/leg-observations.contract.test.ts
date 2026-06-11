import { describe, it, beforeAll, afterAll } from "vitest";
import { inject } from "vitest";
import { runLegObservationsContractTests } from "../../__contract__/leg-observations.contract.ts";
import { makePostgresLegObservationsRepo } from "./leg-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres leg-observations adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

/** Type guard to extract the `cnt` field from a raw DB result row without as-casts. */
function extractCnt(row: unknown): number | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  // Access via bracket notation after narrowing to object with index signature
  const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
  const cnt = rec["cnt"];
  if (typeof cnt === "number") return cnt;
  if (typeof cnt === "string") return Number(cnt);
  return undefined;
}

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres leg-observations adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    // Migrations have already been run in globalSetup
    db = makeDb(dbUrl);
  });

  afterAll(async () => {
    // postgres.js auto-closes connections when process exits
  });

  runLegObservationsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresLegObservationsRepo(db);
    return {
      persistObservations: repo.persistObservations,
      upsertContracts: repo.upsertContracts,
      readPendingObs: repo.readPendingObs,
      writeBsmResults: repo.writeBsmResults,
      countObservations: async (time: Date): Promise<number> => {
        // Pass timestamp as ISO string; postgres.js handles timestamptz conversion
        const timeStr = time.toISOString();
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations WHERE time = ${timeStr}::timestamptz AND source = 'cboe' AND bsm_iv IS NULL`,
        );
        const row = rows[0];
        if (row === undefined) return 0;
        const cnt = extractCnt(row);
        return typeof cnt === "number" ? cnt : Number(cnt ?? 0);
      },
      countContracts: async (
        roots: ReadonlyArray<string>,
      ): Promise<number> => {
        // Use IN clause instead of ANY for ReadonlyArray compatibility
        const rootsArr = [...roots];
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM contracts WHERE root IN (${sql.join(rootsArr.map((r) => sql`${r}`), sql`, `)}) AND exercise_style = 'european'`,
        );
        const row = rows[0];
        if (row === undefined) return 0;
        const cnt = extractCnt(row);
        return typeof cnt === "number" ? cnt : Number(cnt ?? 0);
      },
      countPendingBsm: async (time: Date): Promise<number> => {
        const timeStr = time.toISOString();
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations WHERE time = ${timeStr}::timestamptz AND bsm_iv IS NULL AND mark IS NOT NULL`,
        );
        const row = rows[0];
        if (row === undefined) return 0;
        const cnt = extractCnt(row);
        return typeof cnt === "number" ? cnt : Number(cnt ?? 0);
      },
      countNanStamped: async (time: Date): Promise<number> => {
        const timeStr = time.toISOString();
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations WHERE time = ${timeStr}::timestamptz AND bsm_iv = 'NaN'::numeric`,
        );
        const row = rows[0];
        if (row === undefined) return 0;
        const cnt = extractCnt(row);
        return typeof cnt === "number" ? cnt : Number(cnt ?? 0);
      },
      getVendorMark: async (time: Date, contract: string): Promise<string | null> => {
        const timeStr = time.toISOString();
        const rows = await db.execute(
          sql`SELECT mark FROM leg_observations WHERE time = ${timeStr}::timestamptz AND contract = ${contract}`,
        );
        const row = rows[0];
        if (row === undefined) return null;
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const mark = rec["mark"];
        return typeof mark === "string" ? mark : mark !== null && mark !== undefined ? String(mark) : null;
      },
    };
  });
});

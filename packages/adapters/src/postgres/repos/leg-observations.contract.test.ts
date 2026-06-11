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
      countObservations: async (time: Date): Promise<number> => {
        // Pass timestamp as ISO string; postgres.js handles timestamptz conversion
        const timeStr = time.toISOString();
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations WHERE time = ${timeStr}::timestamptz AND source = 'cboe' AND bsm_iv IS NULL`,
        );
        const row = rows[0];
        if (row === undefined) return 0;
        const cnt = (row as Record<string, unknown>)["cnt"];
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
        const cnt = (row as Record<string, unknown>)["cnt"];
        return typeof cnt === "number" ? cnt : Number(cnt ?? 0);
      },
    };
  });
});

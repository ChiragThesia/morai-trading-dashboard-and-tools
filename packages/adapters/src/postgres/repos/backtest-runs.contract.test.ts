import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runBacktestRunsContractTests } from "../../__contract__/backtest-runs.contract.ts";
import { makePostgresBacktestRunsRepo } from "./backtest-runs.ts";
import { makeDb } from "../db.ts";
import { backtestRuns } from "../schema.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres backtest-runs adapter (Phase 27, Plan 01).
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0021_backtest_runs.sql).
 * SQL is never mocked (tdd.md): proves append-only insert-only behavior and the report
 * JSONB validation boundary on write.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres backtest-runs adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(backtestRuns);
  });

  runBacktestRunsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresBacktestRunsRepo(db);
    return {
      insertBacktestRun: repo.insertBacktestRun,
      countRuns: async (): Promise<number> => {
        const rows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM backtest_runs`);
        const row = rows[0];
        if (row === undefined) return 0;
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const cnt = rec["cnt"];
        return typeof cnt === "number" ? cnt : Number(cnt ?? 0);
      },
    };
  });
});

import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import {
  runRiskReversalContractTests,
  type RiskReversalSeedContext,
} from "../../__contract__/risk-reversal-observations.contract.ts";
import { makePostgresRiskReversalObservationsRepo } from "./risk-reversal-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres risk-reversal-observations adapter.
 * Requires Docker (testcontainers postgres:16, migration chain incl. risk_reversal_observations).
 * SQL is never mocked (tdd.md): proves idempotency + nullable round-trip + trailing-window history.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres risk-reversal-observations adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.execute(sql`TRUNCATE TABLE risk_reversal_observations CASCADE`);
  });

  runRiskReversalContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresRiskReversalObservationsRepo(db);
      return {
        storeRiskReversalObservations: repo.storeRiskReversalObservations,
        readRiskReversalSeries: repo.readRiskReversalSeries,
        readRiskReversalHistory: repo.readRiskReversalHistory,
        countObservations: async (underlying?: string): Promise<number> => {
          const rows =
            underlying === undefined
              ? await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM risk_reversal_observations`)
              : await db.execute(
                  sql`SELECT COUNT(*)::int AS cnt FROM risk_reversal_observations WHERE underlying = ${underlying}`,
                );
          const row = rows[0];
          if (row === undefined) return 0;
          const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
          const cnt = rec["cnt"];
          if (typeof cnt === "number") return cnt;
          if (typeof cnt === "string") return Number(cnt);
          return 0;
        },
      };
    },
    (): RiskReversalSeedContext => ({
      seedNoop: async (): Promise<void> => {},
    }),
  );
});

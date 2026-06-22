import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import {
  runSkewContractTests,
  type SkewSeedContext,
} from "../../__contract__/skew-observations.contract.ts";
import { makePostgresSkewObservationsRepo } from "./skew-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres skew-observations adapter.
 * Requires Docker (testcontainers postgres:16, migration chain incl. skew_observations).
 * SQL is never mocked (tdd.md): proves idempotency (onConflictDoNothing) + nullable round-trip.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres skew-observations adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.execute(sql`TRUNCATE TABLE skew_observations CASCADE`);
  });

  runSkewContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresSkewObservationsRepo(db);
      return {
        storeSkewObservations: repo.storeSkewObservations,
        readSkewSmileDetail: repo.readSkewSmileDetail,
        countObservations: async (underlying?: string): Promise<number> => {
          const rows =
            underlying === undefined
              ? await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM skew_observations`)
              : await db.execute(
                  sql`SELECT COUNT(*)::int AS cnt FROM skew_observations WHERE underlying = ${underlying}`,
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
    (): SkewSeedContext => ({
      seedNoop: async (): Promise<void> => {},
    }),
  );
});

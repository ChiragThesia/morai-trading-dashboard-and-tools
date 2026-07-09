import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runBacktestHistoryContractTests } from "../../__contract__/backtest-history.contract.ts";
import { makePostgresBacktestHistoryRepo } from "./backtest-history.ts";
import { makeDb } from "../db.ts";
import { legObservations, pickerSnapshots } from "../schema.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres backtest-history adapter (Phase 27, Plan 03).
 * Requires Docker (testcontainers postgres:16). SQL is never mocked (tdd.md): proves the
 * RV20 as-of-T bound and the picker_snapshot cohort-ledger range read.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres backtest-history adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(legObservations);
    await db.delete(pickerSnapshots);
  });

  runBacktestHistoryContractTests(
    () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresBacktestHistoryRepo(db);
      return {
        readDailySpotClosesAsOf: repo.readDailySpotClosesAsOf,
        readPickerSnapshotsInRange: repo.readPickerSnapshotsInRange,
      };
    },
    () => ({
      seedDailyClose: async (time: Date, underlyingPrice: number): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        const occ = `O:SPXTEST${time.getTime()}`;
        await db.execute(sql`
          INSERT INTO leg_observations
            (time, contract, bid, ask, mark, underlying_price, open_interest, volume, source)
          VALUES (${time.toISOString()}::timestamptz, ${occ}, '0', '0', '0', ${String(underlyingPrice)}, 0, 0, 'cboe')
          ON CONFLICT DO NOTHING
        `);
      },
      seedSnapshot: async (observedAt: Date, snapshot: Record<string, unknown>): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(sql`
          INSERT INTO picker_snapshot (observed_at, snapshot)
          VALUES (${observedAt.toISOString()}::timestamptz, ${JSON.stringify(snapshot)}::jsonb)
          ON CONFLICT DO NOTHING
        `);
      },
    }),
  );
});

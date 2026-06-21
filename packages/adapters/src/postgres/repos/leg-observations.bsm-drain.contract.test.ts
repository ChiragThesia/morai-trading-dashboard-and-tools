import { describe, beforeAll, beforeEach, afterAll } from "vitest";
import { inject } from "vitest";
import {
  runBsmDrainContractTests,
  type BsmDrainContractRepo,
} from "../../__contract__/leg-observations.bsm-drain.contract.ts";
import { makePostgresLegObservationsRepo } from "./leg-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";
import type { OccSymbol } from "@morai/shared";

/**
 * SC3 / D-15: compute-bsm-greeks drain-to-zero + idempotent-upsert integration test.
 *
 * Requires Docker (testcontainers postgres:16 started in globalSetup).
 * Skips gracefully when dbUrl is not provided (Docker unavailable).
 *
 * Each test:
 *   1. Uses the shared container from globalSetup (no per-test container spin-up)
 *   2. Truncates relevant tables in beforeEach to ensure isolation
 *   3. Seeds data directly via raw SQL so bsm_iv values are precisely controlled
 *   4. Drives the real makeComputeBsmGreeksUseCase via the contract
 *
 * Assertions:
 *   - SC3: after drain, count(bsm_iv IS NULL AND mark IS NOT NULL) == 0
 *   - M already-computed rows untouched (bsm_iv preserved verbatim)
 *   - K NaN-stamped rows (bsm_iv = 'NaN') remain excluded from pending scan (T-02-16)
 *   - D-15: re-run yields still 0 pending + same total row count (no duplicates)
 */

/** Type guard to extract `cnt` from raw SQL result row without as-casts. */
function extractCnt(row: unknown): number {
  if (typeof row !== "object" || row === null) return 0;
  const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
  const cnt = rec["cnt"];
  if (typeof cnt === "number") return cnt;
  if (typeof cnt === "string") return Number(cnt);
  return 0;
}

/** Type guard to extract a nullable string field from raw SQL result row. */
function extractNullableString(row: unknown, field: string): string | null {
  if (typeof row !== "object" || row === null) return null;
  const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
  const val = rec[field];
  if (val === null || val === undefined) return null;
  return String(val);
}

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres leg-observations BSM drain contract (SC3 / D-15)", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // Truncate in FK-safe order; contracts and leg_observations have no FK to calendar-level tables
    // but we cascade to avoid orphan constraint violations from prior test runs
    await db.execute(sql`TRUNCATE TABLE leg_observations, contracts CASCADE`);
  });

  afterAll(async () => {
    // postgres.js auto-closes on process exit
  });

  runBsmDrainContractTests((): BsmDrainContractRepo => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresLegObservationsRepo(db);

    return {
      readPendingObs: repo.readPendingObs,
      writeBsmResults: repo.writeBsmResults,

      countAllPendingBsm: async (): Promise<number> => {
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations WHERE bsm_iv IS NULL AND mark IS NOT NULL`,
        );
        const row = rows[0];
        return extractCnt(row);
      },

      countNanStampedRows: async (): Promise<number> => {
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations WHERE bsm_iv = 'NaN'::numeric`,
        );
        const row = rows[0];
        return extractCnt(row);
      },

      countAllRows: async (): Promise<number> => {
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const row = rows[0];
        return extractCnt(row);
      },

      getBsmIv: async (time: Date, contract: OccSymbol): Promise<string | null> => {
        const timeStr = time.toISOString();
        const rows = await db.execute(
          sql`SELECT bsm_iv::text AS bsm_iv FROM leg_observations WHERE time = ${timeStr}::timestamptz AND contract = ${contract}`,
        );
        const row = rows[0];
        if (row === undefined) return null;
        return extractNullableString(row, "bsm_iv");
      },

      seedPendingRow: async (
        occ: OccSymbol,
        time: Date,
        mark: number,
        underlyingPrice: number,
        strike: number,
        expiration: string,
        root: "SPX" | "SPXW",
        contractType: "C" | "P",
      ): Promise<void> => {
        const timeStr = time.toISOString();
        // Insert the contract row first (FK reference from leg_observations)
        await db.execute(
          sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
              VALUES (${occ}, 'SPX', ${root}, ${contractType}, 'european', ${strike * 1000}, ${expiration}, 100)
              ON CONFLICT DO NOTHING`,
        );
        // Insert the observation row with bsm_iv NULL (pending state)
        await db.execute(
          sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, open_interest, volume, source)
              VALUES (${timeStr}::timestamptz, ${occ}, '0', '0', ${String(mark)}, ${String(underlyingPrice)}, 0, 0, 'cboe')
              ON CONFLICT DO NOTHING`,
        );
      },

      seedComputedRow: async (
        occ: OccSymbol,
        time: Date,
        mark: number,
        underlyingPrice: number,
        bsmIv: string,
      ): Promise<void> => {
        const timeStr = time.toISOString();
        // Insert a minimal contracts row keyed only on occ_symbol (ON CONFLICT DO NOTHING).
        // The strike/expiration/root values here are placeholders — what matters for the
        // drain test is that the row has bsm_iv IS NOT NULL (already-computed state).
        await db.execute(
          sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
              VALUES (${occ}, 'SPX', 'SPX', 'C', 'european', 6000000, '2026-09-19', 100)
              ON CONFLICT DO NOTHING`,
        );
        // Insert with bsm_iv already set (already-computed state — excluded from pending scan)
        await db.execute(
          sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, open_interest, volume, source)
              VALUES (${timeStr}::timestamptz, ${occ}, '0', '0', ${String(mark)}, ${String(underlyingPrice)},
                ${bsmIv}::numeric, '0.5'::numeric, '0.001'::numeric, '-0.05'::numeric, '0.3'::numeric,
                0, 0, 'cboe')
              ON CONFLICT DO NOTHING`,
        );
      },

      seedNanStampedRow: async (
        occ: OccSymbol,
        time: Date,
        mark: number,
        underlyingPrice: number,
      ): Promise<void> => {
        const timeStr = time.toISOString();
        // Insert a minimal contracts row keyed only on occ_symbol (ON CONFLICT DO NOTHING).
        await db.execute(
          sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
              VALUES (${occ}, 'SPX', 'SPXW', 'P', 'european', 4500000, '2026-09-19', 100)
              ON CONFLICT DO NOTHING`,
        );
        // Insert with bsm_iv = 'NaN'::numeric (T-02-16 sentinel for unsolvable rows).
        // bsm_iv IS NOT NULL so these rows are excluded from the partial index scan.
        await db.execute(
          sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, open_interest, volume, source)
              VALUES (${timeStr}::timestamptz, ${occ}, '0', '0', ${String(mark)}, ${String(underlyingPrice)},
                'NaN'::numeric, 'NaN'::numeric, 'NaN'::numeric, 'NaN'::numeric, 'NaN'::numeric,
                0, 0, 'cboe')
              ON CONFLICT DO NOTHING`,
        );
      },
    };
  });
});

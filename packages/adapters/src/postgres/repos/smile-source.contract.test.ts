import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { formatOccSymbol } from "@morai/shared";
import {
  runSmileSourceContractTests,
  type SmileSourceRepo,
} from "../../__contract__/smile-source.contract.ts";
import { makePostgresLegObservationsRepo } from "./leg-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres leg-observations smile-source read (ForReadingSmileSource).
 * Requires Docker (testcontainers postgres:16). SQL is never mocked (tdd.md): the smile read
 * joins leg_observations × contracts on a real Postgres 16, proving bsm_iv→iv / bsm_delta→delta
 * mapping and the NaN/NULL exclusion.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

/** Build a deterministic OCC symbol from the smile grain (root SPX, type C). */
function occFor(expiration: string, strikeX1000: number): string {
  const [y, m, d] = expiration.split("-").map((n) => Number(n));
  return formatOccSymbol({
    root: "SPX",
    expiry: new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)),
    type: "C",
    strike: strikeX1000 / 1000,
  });
}

describe.skipIf(shouldSkip)("postgres leg-observations smile-source read", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.execute(sql`TRUNCATE TABLE leg_observations, contracts CASCADE`);
  });

  runSmileSourceContractTests((): SmileSourceRepo => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresLegObservationsRepo(db);
    return {
      readSmile: repo.readSmile,
      seedLeg: async (leg): Promise<void> => {
        const occ = occFor(leg.expiration, leg.strike);
        // Contract row supplies underlying/expiration/strike for the join.
        await db.execute(
          sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
              VALUES (${occ}, ${leg.underlying}, 'SPX', 'C', 'european', ${leg.strike}, ${leg.expiration}, 100)
              ON CONFLICT DO NOTHING`,
        );
        // leg_observations row at the snapshot time with the BSM result (or NaN/null).
        // underlying_price is NOT NULL in the schema; spot omitted → '0' so the moneyness guard
        // (finite positive) yields null moneyness, matching the memory twin's "no spot" behaviour.
        const spot = leg.spot ?? "0";
        const bsmIvSql = leg.bsmIv === null ? sql`NULL` : sql`${leg.bsmIv}::numeric`;
        const bsmDeltaSql = leg.bsmDelta === null ? sql`NULL` : sql`${leg.bsmDelta}::numeric`;
        await db.execute(
          sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, open_interest, volume, source, bsm_iv, bsm_delta)
              VALUES (${leg.snapshotTime.toISOString()}::timestamptz, ${occ}, '1.0', '1.1', '1.05', ${spot}, 0, 0, 'cboe', ${bsmIvSql}, ${bsmDeltaSql})
              ON CONFLICT DO NOTHING`,
        );
      },
    };
  });
});

import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runBacktestChainContractTests } from "../../__contract__/backtest-chain.contract.ts";
import { makePostgresBacktestChainRepo } from "./backtest-chain.ts";
import { makeDb } from "../db.ts";
import { legObservations, contracts } from "../schema.ts";
import { sql } from "drizzle-orm";
import type { ChainLegQuoteAsOf } from "@morai/core";

/**
 * Contract test for the Postgres backtest-chain adapter (Phase 27, Plan 03).
 * Requires Docker (testcontainers postgres:16). SQL is never mocked (tdd.md): proves the
 * as-of-T cohort resolution, full column set, and BT-01's no-lookahead required check.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres backtest-chain adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(legObservations);
    await db.delete(contracts);
  });

  runBacktestChainContractTests(
    () => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresBacktestChainRepo(db);
      return { readChainAsOf: repo.readChainAsOf };
    },
    () => ({
      seedLeg: async (leg: ChainLegQuoteAsOf): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(sql`
          INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
          VALUES (${leg.occSymbol}, 'SPX', 'SPX', ${leg.contractType}, 'european', ${leg.strike}, ${leg.expiration}, 100)
          ON CONFLICT DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO leg_observations
            (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, open_interest, volume, source)
          VALUES (
            ${leg.time.toISOString()}::timestamptz, ${leg.occSymbol}, ${String(leg.bid)}, ${String(leg.ask)}, ${String(leg.mark)},
            ${String(leg.underlyingPrice)},
            ${leg.bsmIv !== null ? String(leg.bsmIv) : null}::numeric,
            ${leg.bsmDelta !== null ? String(leg.bsmDelta) : null}::numeric,
            ${leg.bsmGamma !== null ? String(leg.bsmGamma) : null}::numeric,
            ${leg.bsmTheta !== null ? String(leg.bsmTheta) : null}::numeric,
            ${leg.bsmVega !== null ? String(leg.bsmVega) : null}::numeric,
            ${leg.openInterest}, 0, ${leg.source}
          )
          ON CONFLICT DO NOTHING
        `);
      },
    }),
  );
});

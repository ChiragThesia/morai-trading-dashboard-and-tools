import { describe, beforeAll, beforeEach, it, expect } from "vitest";
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

  /**
   * REGRESSION (prod, 2026-07-27). Third consumer of the open-interest shadowing bug, after
   * picker-chain and gex-snapshot. Schwab's chain returns `openInterest: 0` outside RTH and writes
   * about a minute after CBOE, so `DISTINCT ON (contract) ORDER BY time DESC` served Schwab's zero
   * for ~2,971 contracts a day. In a backtest that silently starves the `liquidity` gate on every
   * replayed cohort whose newest row happened to be Schwab's — so the corpus the calibration reads
   * was scored against open interest that did not exist.
   *
   * Open interest is a once-daily non-negative OCC figure, so MAX across sources in the cohort
   * window is the reported value; an untraded strike still reads 0 because both sources report 0.
   */
  it("takes the MAX open interest per contract, so a Schwab zero cannot starve the liquidity gate", async () => {
    if (!db) return;
    const repo = makePostgresBacktestChainRepo(db);

    const asOf = new Date("2026-06-24T04:35:00Z");
    const cboeTime = new Date("2026-06-24T04:29:18Z");
    const schwabTime = new Date("2026-06-24T04:30:21Z"); // newest — wins DISTINCT ON
    const occ = "O:SPX260627P07250";

    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES (${occ}, 'SPX', 'SPX', 'P', 'european', 7250000, '2026-06-27', 100)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO leg_observations
        (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_gamma, open_interest, volume, source)
      VALUES
        (${cboeTime.toISOString()}::timestamptz, ${occ}, '9.4', '9.9', '9.65', '7411', '0.16', '0.0011', 15926, 0, 'cboe'),
        (${schwabTime.toISOString()}::timestamptz, ${occ}, '9.5', '10.0', '9.75', '7411', '0.16', '0.0011', 0, 0, 'schwab_chain')
      ON CONFLICT DO NOTHING
    `);

    const result = await repo.readChainAsOf(asOf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const leg = result.value.find((l) => l.occSymbol === occ);
    expect(leg).toBeDefined();
    if (leg === undefined) return;

    expect(leg.openInterest).toBe(15926);
    // Prices still come from the newest row — the fix is scoped to open interest.
    expect(leg.bid).toBe(9.5);
  });
});

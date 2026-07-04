import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { makePostgresPickerChainRepo } from "./picker-chain.ts";
import { makeDb } from "../db.ts";
import { legObservations, contracts } from "../schema.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres picker-chain adapter.
 * Requires Docker (testcontainers postgres:16). SQL is never mocked (tdd.md).
 *
 * Asserts:
 * - readChainForPicker returns ok([]) when leg_observations is empty (no crash).
 * - readChainForPicker returns the latest cohort's PUT rows only, with strike/expiration
 *   resolved via the contracts JOIN (Pitfall 2) and source projected from
 *   leg_observations.source (schwab_chain → "schwab", cboe → "cboe").
 * - A call row at the same cohort time is excluded (puts only).
 * - An older cohort's put row is excluded (latest cohort only).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres picker-chain adapter", () => {
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

  it("returns ok([]) when no legs are seeded (no crash)", async () => {
    if (!db) return;
    const repo = makePostgresPickerChainRepo(db);
    const result = await repo.readChainForPicker();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("returns the latest cohort's PUT rows with strike/expiration/source, excluding calls and older cohorts", async () => {
    if (!db) return;
    const repo = makePostgresPickerChainRepo(db);

    const olderTime = new Date("2026-07-01T14:00:00Z");
    const latestTime = new Date("2026-07-01T14:30:00Z");
    const putOccOlder = "O:SPX260801P07400";
    const putOccLatest = "O:SPX260801P07500";
    const callOccLatest = "O:SPX260801C07500";

    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES
        (${putOccOlder}, 'SPX', 'SPX', 'P', 'european', 7400000, '2026-08-01', 100),
        (${putOccLatest}, 'SPX', 'SPX', 'P', 'european', 7500000, '2026-08-01', 100),
        (${callOccLatest}, 'SPX', 'SPX', 'C', 'european', 7500000, '2026-08-01', 100)
      ON CONFLICT DO NOTHING
    `);

    await db.execute(sql`
      INSERT INTO leg_observations
        (time, contract, bid, ask, mark, underlying_price, bsm_iv, open_interest, volume, source)
      VALUES
        (${olderTime.toISOString()}::timestamptz, ${putOccOlder}, '1.0', '1.5', '1.25', '7380', '0.15', 500, 0, 'cboe'),
        (${latestTime.toISOString()}::timestamptz, ${putOccLatest}, '2.0', '2.5', '2.25', '7390', '0.16', 700, 0, 'schwab_chain'),
        (${latestTime.toISOString()}::timestamptz, ${callOccLatest}, '3.0', '3.5', '3.25', '7390', '0.17', 800, 0, 'schwab_chain')
      ON CONFLICT DO NOTHING
    `);

    const result = await repo.readChainForPicker();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Only the latest-cohort PUT row — the older cohort row and the call row are excluded.
    expect(result.value).toHaveLength(1);
    const leg = result.value[0];
    expect(leg).toBeDefined();
    if (leg === undefined) return;

    expect(leg.strike).toBe(7500000);
    expect(leg.expiration).toBe("2026-08-01");
    expect(leg.contractType).toBe("P");
    expect(leg.bsmIv).toBe("0.16");
    expect(leg.underlyingPrice).toBe(7390);
    expect(leg.source).toBe("schwab"); // schwab_chain → "schwab"
    expect(leg.time.getTime()).toBe(latestTime.getTime());
  });

  it("maps a 'cboe'-sourced leg to source: 'cboe'", async () => {
    if (!db) return;
    const repo = makePostgresPickerChainRepo(db);

    const time = new Date("2026-07-02T14:00:00Z");
    const putOcc = "O:SPX260801P07600";

    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES (${putOcc}, 'SPX', 'SPX', 'P', 'european', 7600000, '2026-08-01', 100)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO leg_observations
        (time, contract, bid, ask, mark, underlying_price, bsm_iv, open_interest, volume, source)
      VALUES
        (${time.toISOString()}::timestamptz, ${putOcc}, '1.0', '1.5', '1.25', '7380', '0.15', 500, 0, 'cboe')
      ON CONFLICT DO NOTHING
    `);

    const result = await repo.readChainForPicker();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const leg = result.value.find((l) => l.strike === 7600000);
    expect(leg).toBeDefined();
    if (leg === undefined) return;
    expect(leg.source).toBe("cboe");
  });
});

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
 * - readChainForPicker returns BOTH wings of the latest cohort (calls AND puts — the 25-delta
 *   risk reversal needs the call side), with strike/expiration resolved via the contracts JOIN
 *   (Pitfall 2) and source projected from leg_observations.source (schwab_chain → "schwab",
 *   cboe → "cboe"). The puts-only universe is the PICKER's rule, applied in the picker
 *   use-case — never here.
 * - An older cohort's row is excluded (latest cohort only).
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

  it("returns BOTH wings of the latest cohort with strike/expiration/source, excluding older cohorts", async () => {
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

    // Both latest-cohort rows — the put AND the call. Only the older cohort row is excluded.
    expect(result.value).toHaveLength(2);
    expect(result.value.map((l) => l.contractType).sort()).toEqual(["C", "P"]);

    const leg = result.value.find((l) => l.contractType === "P");
    expect(leg).toBeDefined();
    if (leg === undefined) return;

    expect(leg.strike).toBe(7500000);
    expect(leg.expiration).toBe("2026-08-01");
    expect(leg.bsmIv).toBe("0.16");
    expect(leg.underlyingPrice).toBe(7390);
    expect(leg.source).toBe("schwab"); // schwab_chain → "schwab"
    // Settlement classification input (yearFractionToSettlement) — projected from
    // contracts.root, narrowed to the SPX/SPXW union.
    expect(leg.root).toBe("SPX");
    expect(leg.time.getTime()).toBe(latestTime.getTime());
    // Liquidity-gate inputs ride along (rules.ts).
    expect(leg.bid).toBe(2.0);
    expect(leg.ask).toBe(2.5);
    expect(leg.openInterest).toBe(700);

    // The call wing carries the same projected shape — it is what the 25-delta risk
    // reversal (IV(25Δ put) − IV(25Δ call)) reads.
    const call = result.value.find((l) => l.contractType === "C");
    expect(call).toBeDefined();
    if (call === undefined) return;
    expect(call.strike).toBe(7500000);
    expect(call.expiration).toBe("2026-08-01");
    expect(call.bsmIv).toBe("0.17");
    expect(call.source).toBe("schwab");
    expect(call.time.getTime()).toBe(latestTime.getTime());
  });

  // Same regression class as the 2026-07-08 GEX cohort bug: a dual-source cycle lands as
  // TWO nearby timestamps (CBOE ~:59:31, Schwab ~:00:31). A strict max(time) read collapses
  // to a single source; the lookback union must keep both, deduped per contract.
  it("unions a boundary-straddling dual-source cycle and dedupes per contract (newest wins)", async () => {
    if (!db) return;
    const repo = makePostgresPickerChainRepo(db);

    const cboeTime = new Date("2026-07-08T16:59:31Z");
    const schwabTime = new Date("2026-07-08T17:00:31Z");
    const cboeOnlyOcc = "O:SPX260801P07000"; // far-OTM breadth (cboe only)
    const overlapOcc = "O:SPX260801P07500"; // near-ATM, both sources

    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES
        (${cboeOnlyOcc}, 'SPX', 'SPX', 'P', 'european', 7000000, '2026-08-01', 100),
        (${overlapOcc}, 'SPX', 'SPX', 'P', 'european', 7500000, '2026-08-01', 100)
      ON CONFLICT DO NOTHING
    `);
    await db.execute(sql`
      INSERT INTO leg_observations
        (time, contract, bid, ask, mark, underlying_price, bsm_iv, open_interest, volume, source)
      VALUES
        (${cboeTime.toISOString()}::timestamptz, ${cboeOnlyOcc}, '1.0', '1.1', '1.05', '7480', '0.19', 900, 0, 'cboe'),
        (${cboeTime.toISOString()}::timestamptz, ${overlapOcc}, '2.0', '2.2', '2.1', '7480', '0.16', 700, 0, 'cboe'),
        (${schwabTime.toISOString()}::timestamptz, ${overlapOcc}, '2.1', '2.3', '2.2', '7481', '0.165', 710, 0, 'schwab_chain')
      ON CONFLICT DO NOTHING
    `);

    const result = await repo.readChainForPicker();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Union: the CBOE-only far strike survives despite living on the other side of the
    // half-hour boundary.
    const strikes = result.value.map((l) => l.strike);
    expect(strikes).toContain(7000000);

    // Dedup: the overlap contract appears exactly once, newest (schwab) row winning.
    const overlapRows = result.value.filter((l) => l.strike === 7500000);
    expect(overlapRows).toHaveLength(1);
    expect(overlapRows[0]?.source).toBe("schwab");
    expect(overlapRows[0]?.bsmIv).toBe("0.165");
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

  /**
   * REGRESSION (prod, 2026-07-27). Schwab's chain returns `openInterest: 0` for EVERY contract
   * outside RTH — measured 0.0% non-zero from 04:00Z through 10:00Z, then 86.3% from 10:30Z. CBOE
   * carries real OI in every snapshot (78.7% non-zero, max 268,662). Both land in the same 10-min
   * lookback window, and Schwab writes ~1 minute AFTER CBOE, so `DISTINCT ON (contract) ORDER BY
   * time DESC` handed the whole chain Schwab's zeros overnight. 2,971 contracts a day were
   * shadowed that way; GEX is open interest × gamma, so it computed zero gamma everywhere and
   * reported null call/put walls until RTH data arrived.
   *
   * Open interest is a once-daily OCC figure and is never negative, so within one cohort window
   * the MAX across sources is the true value — and a genuinely untraded strike still reads 0,
   * because then both sources report 0.
   */
  describe("open interest is never shadowed by a zero from another source", () => {
    const cboeTime = new Date("2026-07-03T04:29:18Z");
    const schwabTime = new Date("2026-07-03T04:30:21Z"); // newest — wins DISTINCT ON
    const traded = "O:SPX260801P07400";
    const untraded = "O:SPX260801P06000";

    async function seedTwoSources(): Promise<void> {
      await db.execute(sql`
        INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
        VALUES
          (${traded}, 'SPX', 'SPX', 'P', 'european', 7400000, '2026-08-01', 100),
          (${untraded}, 'SPX', 'SPX', 'P', 'european', 6000000, '2026-08-01', 100)
        ON CONFLICT DO NOTHING
      `);
      await db.execute(sql`
        INSERT INTO leg_observations
          (time, contract, bid, ask, mark, underlying_price, bsm_iv, open_interest, volume, source)
        VALUES
          -- CBOE, one minute earlier, carries the REAL open interest.
          (${cboeTime.toISOString()}::timestamptz, ${traded}, '75.5', '76.5', '76.0', '7411', '0.16', 16713, 0, 'cboe'),
          -- Schwab, newest, overnight zero. This is the row DISTINCT ON picks.
          (${schwabTime.toISOString()}::timestamptz, ${traded}, '75.6', '76.6', '76.1', '7411', '0.16', 0, 0, 'schwab_chain'),
          -- A strike neither source shows interest in: both report 0, so 0 is the truth.
          (${cboeTime.toISOString()}::timestamptz, ${untraded}, '0.05', '0.10', '0.075', '7411', '0.55', 0, 0, 'cboe'),
          (${schwabTime.toISOString()}::timestamptz, ${untraded}, '0.05', '0.10', '0.075', '7411', '0.55', 0, 0, 'schwab_chain')
        ON CONFLICT DO NOTHING
      `);
    }

    it("keeps CBOE's real open interest when the newest row is Schwab's overnight zero", async () => {
      if (!db) return;
      const repo = makePostgresPickerChainRepo(db);
      await seedTwoSources();

      const result = await repo.readChainForPicker();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const leg = result.value.find((l) => l.strike === 7400000);
      expect(leg).toBeDefined();
      if (leg === undefined) return;

      expect(leg.openInterest).toBe(16713);
      // Everything ELSE still comes from the newest row — this fix is scoped to open interest.
      // Prices must stay fresh, because during RTH Schwab's quotes are the newer ones.
      expect(leg.source).toBe("schwab");
      expect(leg.bid).toBe(75.6);
      expect(leg.ask).toBe(76.6);
      expect(leg.time.getTime()).toBe(schwabTime.getTime());
    });

    it("still reports 0 when BOTH sources say 0 — a real zero is not overwritten", async () => {
      if (!db) return;
      const repo = makePostgresPickerChainRepo(db);
      await seedTwoSources();

      const result = await repo.readChainForPicker();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const leg = result.value.find((l) => l.strike === 6000000);
      expect(leg).toBeDefined();
      if (leg === undefined) return;
      // An untraded strike genuinely has no open interest. The max of 0 and 0 is 0.
      expect(leg.openInterest).toBe(0);
    });

    it("does not borrow open interest from a DIFFERENT contract", async () => {
      if (!db) return;
      const repo = makePostgresPickerChainRepo(db);
      await seedTwoSources();

      const result = await repo.readChainForPicker();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The partition is per contract: 16713 belongs to 7400 only, never to its neighbour.
      expect(result.value.find((l) => l.strike === 6000000)?.openInterest).not.toBe(16713);
    });
  });
});

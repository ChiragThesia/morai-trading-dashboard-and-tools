import { describe, beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { inject } from "vitest";
import { runCalendarSnapshotsContractTests } from "../../__contract__/calendar-snapshots.contract.ts";
import { makePostgresCalendarSnapshotsRepo } from "./calendar-snapshots.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";
import type { OccSymbol } from "@morai/shared";

/**
 * Contract test for the Postgres calendar-snapshots adapter.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres calendar-snapshots adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // Truncate in FK-safe order
    await db.execute(sql`TRUNCATE TABLE calendar_snapshots, leg_observations, contracts, calendars CASCADE`);
  });

  afterAll(async () => {
    // postgres.js auto-closes on process exit
  });

  runCalendarSnapshotsContractTests(
    // makeRepo receives seed context — ignore it here; the Postgres repo needs only db
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresCalendarSnapshotsRepo(db);
      return {
        persistSnapshot: repo.persistSnapshot,
        readJournal: repo.readJournal,
        resolveLegSnapshot: repo.resolveLegSnapshot,
        readSnapshotsForCycle: repo.readSnapshotsForCycle,
        readLatestSnapshotTime: repo.readLatestSnapshotTime,
        countSnapshots: async (calendarId: string): Promise<number> => {
          const rows = await db.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM calendar_snapshots WHERE calendar_id = ${calendarId}::uuid`,
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
    () => ({
      seedCalendar: async (id: string): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(
          sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
              VALUES (${id}::uuid, 'SPX', 5000000, 'C', '2026-07-18', '2026-09-19', 2, 'open', NOW(), '5.00')
              ON CONFLICT DO NOTHING`,
        );
      },
      seedContract: async (
        occ: OccSymbol,
        strike: number,
        expiration: string,
        optionType: "C" | "P",
      ): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(
          sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
              VALUES (${occ}, 'SPX', 'SPX', ${optionType}, 'european', ${strike}, ${expiration}, 100)
              ON CONFLICT DO NOTHING`,
        );
      },
      seedObservation: async (
        occ: OccSymbol,
        time: Date,
        mark: number,
        underlyingPrice: number,
        bsmIv: string | null,
        bsmDelta: string | null,
        bsmGamma: string | null,
        bsmTheta: string | null,
        bsmVega: string | null,
        ivRaw: number | null,
      ): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        const timeStr = time.toISOString();
        const ivRawStr = ivRaw !== null ? String(ivRaw) : null;
        await db.execute(
          sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, iv, open_interest, volume, source)
              VALUES (
                ${timeStr}::timestamptz, ${occ}, '0', '0', ${String(mark)}, ${String(underlyingPrice)},
                ${bsmIv}::numeric, ${bsmDelta}::numeric, ${bsmGamma}::numeric, ${bsmTheta}::numeric, ${bsmVega}::numeric,
                ${ivRawStr}::numeric, 0, 0, 'cboe'
              )
              ON CONFLICT DO NOTHING`,
        );
      },
    }),
  );
});

/**
 * Regression: resolveLegSnapshot must match the calendar underlying against the contract
 * ROOT, not contracts.underlying.
 *
 * Real prod data: SPXW weekly options are stored with occ root "SPXW" but
 * contracts.underlying = "SPX" (the index). Every calendar is tracked as "SPXW". The old
 * resolver matched contracts.underlying = "SPXW" → 0 rows → null legs → every journal
 * snapshot was spot 0 / NaN greeks. The leg data existed the whole time under root "SPXW".
 */
describe.skipIf(shouldSkip)("postgres resolveLegSnapshot — matches on contract root (SPXW weeklys)", () => {
  let rdb: ReturnType<typeof makeDb>;

  beforeAll(() => {
    if (dbUrl) rdb = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (rdb) await rdb.execute(sql`TRUNCATE TABLE leg_observations, contracts CASCADE`);
  });

  it("resolves a leg when calendar underlying is 'SPXW' but contracts.underlying is 'SPX' (root='SPXW')", async () => {
    if (!rdb) return;
    const occ = "SPXW  260807P07425000";
    // underlying='SPX' (index), root='SPXW' (option root) — exactly how the chain stores weeklys.
    await rdb.execute(
      sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
          VALUES (${occ}, 'SPX', 'SPXW', 'P', 'european', 7425000, '2026-08-07', 100)`,
    );
    await rdb.execute(
      sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_delta, bsm_gamma, bsm_theta, bsm_vega, iv, open_interest, volume, source)
          VALUES (NOW(), ${occ}, '0', '0', '169.4', '7381.12', '0.1564', NULL, NULL, NULL, NULL, '0.15', 0, 0, 'cboe')`,
    );

    const repo = makePostgresCalendarSnapshotsRepo(rdb);
    const result = await repo.resolveLegSnapshot({
      underlying: "SPXW", // calendar underlying = the option root
      strike: 7425000,
      optionType: "P",
      expiry: "2026-08-07",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull(); // RED before fix: resolver matched contracts.underlying ('SPX') → null
    expect(result.value?.mark).toBeCloseTo(169.4, 2);
    expect(result.value?.underlyingPrice).toBeCloseTo(7381.12, 2);
  });
});

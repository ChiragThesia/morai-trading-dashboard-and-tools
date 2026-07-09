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
        recomputeSnapshotPnl: repo.recomputeSnapshotPnl,
        readLatestSnapshotPerOpenCalendar: repo.readLatestSnapshotPerOpenCalendar,
        readFullSnapshotHistoryForCalendar: repo.readFullSnapshotHistoryForCalendar,
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
 * readFullSnapshotHistoryForCalendar (27-03, BT-03): the plan's behavior spec requires rows
 * to be returned "regardless of calendars.status (closed included)". The implementation
 * performs NO join to calendars at all, so status is structurally irrelevant — this test
 * proves it directly against a status='closed' calendar (raw SQL, since the shared seed
 * helper's seedCalendar always inserts status='open').
 */
describe.skipIf(shouldSkip)("postgres readFullSnapshotHistoryForCalendar — closed calendars included", () => {
  let cdb: ReturnType<typeof makeDb>;

  beforeAll(() => {
    if (dbUrl) cdb = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (cdb) await cdb.execute(sql`TRUNCATE TABLE calendar_snapshots, calendars CASCADE`);
  });

  it("returns snapshot rows for a CLOSED calendar", async () => {
    if (!cdb) return;
    const closedCalId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await cdb.execute(sql`
      INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, closed_at, open_net_debit)
      VALUES (${closedCalId}::uuid, 'SPX', 5000000, 'P', '2026-07-18', '2026-09-19', 2, 'closed', '2026-06-01T14:00:00Z'::timestamptz, '2026-06-15T14:00:00Z'::timestamptz, '5.00')
    `);
    const time = new Date("2026-06-10T19:00:00Z");
    await cdb.execute(sql`
      INSERT INTO calendar_snapshots (time, calendar_id, spot, net_mark, front_mark, back_mark, front_iv, back_iv, front_iv_raw, back_iv_raw, net_delta, net_gamma, net_theta, net_vega, term_slope, dte_front, dte_back, pnl_open, source)
      VALUES (${time.toISOString()}::timestamptz, ${closedCalId}::uuid, '5000', '15', '10', '25', '0.20', '0.25', '0.19', '0.24', '30', '0.6', '-360', '1240', '0.05', 17, 80, '2000', 'cboe')
    `);

    const repo = makePostgresCalendarSnapshotsRepo(cdb);
    const result = await repo.readFullSnapshotHistoryForCalendar(closedCalId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.calendarId).toBe(closedCalId);
    expect(result.value[0]?.time.getTime()).toBe(time.getTime());
  });
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

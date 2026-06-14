import { describe, beforeAll, beforeEach, afterAll } from "vitest";
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

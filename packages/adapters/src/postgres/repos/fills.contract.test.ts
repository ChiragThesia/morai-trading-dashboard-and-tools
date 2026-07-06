import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { runFillsContractTests } from "../../__contract__/fills.contract.ts";
import type { SeedCalendar, SeedEvent, SeedOrphan } from "../../__contract__/fills.contract.ts";
import { makePostgresFillsRepo } from "./fills.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres fills adapter (A1 + A3).
 * Requires Docker (testcontainers postgres:16 with migrations applied).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres fills adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // Truncate in FK-safe order (calendar_events references calendars by id logically).
    // calendar_snapshots included so the wipeDerivedFills postgres-only test (below) starts
    // from a clean slate across runs — it seeds one directly to prove wipeDerivedFills never
    // touches it.
    await db.execute(
      sql`TRUNCATE TABLE fills, calendar_events, orphan_fills, calendars, calendar_snapshots CASCADE`,
    );
  });

  runFillsContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresFillsRepo(db);
      return {
        readUnprocessedFills: repo.readUnprocessedFills,
        readUnprocessedFillsForCalendar: repo.readUnprocessedFillsForCalendar,
        readCalendarLegs: repo.readCalendarLegs,
        resetCalendarAmounts: repo.resetCalendarAmounts,
        recomputeCalendarAmounts: repo.recomputeCalendarAmounts,
        markFillsProcessed: repo.markFillsProcessed,
        resetFillsProcessedForCalendar: repo.resetFillsProcessedForCalendar,
        writeFills: repo.writeFills,
        wipeDerivedFills: repo.wipeDerivedFills,
      };
    },
    () => ({
      seedCalendar: async (cal: SeedCalendar): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(
          sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
              VALUES (${cal.id}::uuid, ${cal.underlying}, ${cal.strike}, ${cal.optionType}, ${cal.frontExpiry}, ${cal.backExpiry}, ${cal.qty}, ${cal.status}, NOW(),
                      ${cal.openNetDebit === null ? null : String(cal.openNetDebit)})
              ON CONFLICT DO NOTHING`,
        );
      },
      seedEvent: async (event: SeedEvent): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        const rolledFrom = event.rolledFromOccSymbol ?? null;
        const rollOpen =
          event.rollOpenDebit === undefined || event.rollOpenDebit === null
            ? null
            : String(event.rollOpenDebit);
        const rollClose =
          event.rollCloseCredit === undefined || event.rollCloseCredit === null
            ? null
            : String(event.rollCloseCredit);
        await db.execute(
          sql`INSERT INTO calendar_events (calendar_id, event_type, evented_at, fill_ids_hash, leg_occ_symbol, rolled_from_occ_symbol, qty, avg_price, net_amount, roll_open_debit, roll_close_credit)
              VALUES (${event.calendarId}::uuid, ${event.eventType}, NOW(), ${event.fillIdsHash}, ${event.legOccSymbol}, ${rolledFrom}, 1, '0', ${String(event.netAmount)}, ${rollOpen}, ${rollClose})`,
        );
      },
      seedOrphan: async (orphan: SeedOrphan): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(
          sql`INSERT INTO orphan_fills (fill_id, occ_symbol, side, qty, price, filled_at, reason)
              VALUES (${orphan.fillId}::uuid, 'O:UNUSED', 'buy', 1, '0', NOW(), 'seed')
              ON CONFLICT DO NOTHING`,
        );
      },
      readCalendarAmounts: async (
        calendarId: string,
      ): Promise<{ openNetDebit: number | null; closeNetCredit: number | null }> => {
        if (!db) throw new Error("db not initialized");
        const rows = await db.execute(
          sql`SELECT open_net_debit::float AS ond, close_net_credit::float AS cnc
              FROM calendars WHERE id = ${calendarId}::uuid`,
        );
        const row = rows[0];
        if (row === undefined) return { openNetDebit: null, closeNetCredit: null };
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const ond = rec["ond"];
        const cnc = rec["cnc"];
        return {
          openNetDebit: typeof ond === "number" ? ond : null,
          closeNetCredit: typeof cnc === "number" ? cnc : null,
        };
      },
      countFills: async (): Promise<number> => {
        if (!db) throw new Error("db not initialized");
        const rows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM fills`);
        const row = rows[0];
        if (row === undefined) return 0;
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const cnt = rec["cnt"];
        if (typeof cnt === "number") return cnt;
        if (typeof cnt === "string") return Number(cnt);
        return 0;
      },
      readProcessedFillIds: async (): Promise<ReadonlyArray<string>> => {
        if (!db) throw new Error("db not initialized");
        const rows = await db.execute(
          sql`SELECT id::text AS id FROM fills WHERE processed_at IS NOT NULL`,
        );
        const ids: string[] = [];
        for (const row of rows) {
          const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
          const id = rec["id"];
          if (typeof id === "string") ids.push(id);
        }
        return ids;
      },
      countEvents: async (): Promise<number> => {
        if (!db) throw new Error("db not initialized");
        const rows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM calendar_events`);
        return readCount(rows[0]);
      },
      countOrphans: async (): Promise<number> => {
        if (!db) throw new Error("db not initialized");
        const rows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM orphan_fills`);
        return readCount(rows[0]);
      },
    }),
  );

  // journal-pnl-opennetdebit-units (round 3): wipeDerivedFills must NEVER touch calendars or
  // calendar_snapshots — those are not derived-fills caches (calendars.openNetDebit is fixed
  // by rebuild-journal; calendar_snapshots.pnl_open by recompute-snapshot-pnl). The shared
  // fills contract above only has a seed/read surface for calendars.open_net_debit — this
  // postgres-only test additionally proves calendar_snapshots rows survive untouched, since
  // that table lives outside the fills repo's normal scope.
  describe.skipIf(shouldSkip)(
    "wipeDerivedFills — calendars + calendar_snapshots survive (postgres-only, direct table check)",
    () => {
      it("leaves an existing calendars row and calendar_snapshots row untouched", async () => {
        if (!db) throw new Error("db not initialized");
        const calId = "33333333-3333-4333-8333-333333333333";
        await db.execute(
          sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
              VALUES (${calId}::uuid, 'SPX', 7100000, 'P', '2026-06-20', '2026-09-19', 1, 'open', NOW(), '15.5')`,
        );
        await db.execute(
          sql`INSERT INTO calendar_snapshots (time, calendar_id, spot, net_mark, front_mark, back_mark, front_iv, back_iv, front_iv_raw, back_iv_raw, net_delta, net_gamma, net_theta, net_vega, term_slope, dte_front, dte_back, pnl_open, source)
              VALUES (NOW(), ${calId}::uuid, '5000', '10', '20', '30', '0.2', '0.25', '0.2', '0.25', '0', '0', '0', '0', '0.05', 30, 90, '100', 'cboe')`,
        );

        const repo = makePostgresFillsRepo(db);
        await repo.writeFills([
          {
            id: "44444444-4444-4444-8444-444444444444",
            orderId: "ORD-WIPE",
            occSymbol: "SPX   260620P07100000",
            side: "buy",
            qty: 1,
            price: 10,
            filledAt: new Date(),
            commission: null,
            fees: null,
          },
        ]);

        const result = await repo.wipeDerivedFills();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.fillsDeleted).toBe(1);

        const calRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM calendars WHERE id = ${calId}::uuid`,
        );
        const snapRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM calendar_snapshots WHERE calendar_id = ${calId}::uuid`,
        );
        expect(readCount(calRows[0])).toBe(1);
        expect(readCount(snapRows[0])).toBe(1);
      });
    },
  );
});

// Small helper shared by the count-style seed helpers above and the postgres-only test.
function readCount(row: unknown): number {
  if (row === undefined || row === null) return 0;
  const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
  const cnt = rec["cnt"];
  if (typeof cnt === "number") return cnt;
  if (typeof cnt === "string") return Number(cnt);
  return 0;
}

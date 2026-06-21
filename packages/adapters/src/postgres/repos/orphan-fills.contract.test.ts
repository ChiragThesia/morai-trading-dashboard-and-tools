import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runOrphanFillsContractTests } from "../../__contract__/orphan-fills.contract.ts";
import { makePostgresOrphanFillsRepo } from "./orphan-fills.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres orphan-fills adapter.
 * Requires Docker (testcontainers postgres:16 with migrations applied).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * Verifies:
 * - storeOrphanFill: idempotent on fill_id PK (T-05-18 / D-05)
 * - getAllOrphans: returns all parked orphan rows for review surface
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres orphan-fills adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // orphan_fills has no FK deps — truncate alone is safe
    await db.execute(sql`TRUNCATE TABLE orphan_fills`);
  });

  runOrphanFillsContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresOrphanFillsRepo(db);
      return {
        storeOrphanFill: repo.storeOrphanFill,
        countOrphans: async (): Promise<number> => {
          const rows = await db.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM orphan_fills`,
          );
          const row = rows[0];
          if (row === undefined) return 0;
          const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
          const cnt = rec["cnt"];
          if (typeof cnt === "number") return cnt;
          if (typeof cnt === "string") return Number(cnt);
          return 0;
        },
        getAllOrphans: async () => {
          const rows = await db.execute(
            sql`SELECT fill_id, occ_symbol, side, qty, price::float, filled_at, reason FROM orphan_fills ORDER BY fill_id`,
          );
          return rows.map((row) => {
            const r: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
            return {
              fillId: String(r["fill_id"] ?? ""),
              occSymbol: String(r["occ_symbol"] ?? ""),
              side: (r["side"] === "sell" ? "sell" : "buy") as "buy" | "sell",
              qty: Number(r["qty"] ?? 0),
              price: Number(r["price"] ?? 0),
              filledAt: new Date(String(r["filled_at"] ?? "")),
              reason: String(r["reason"] ?? ""),
            };
          });
        },
      };
    },
    () => ({
      __dummy: undefined,
    }),
  );
});

import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import {
  runTermStructureContractTests,
  type TermStructureSeedContext,
} from "../../__contract__/term-structure-observations.contract.ts";
import { makePostgresTermStructureObservationsRepo } from "./term-structure-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres term-structure-observations adapter.
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0007 applied).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * SQL is never mocked (tdd.md): this runs against a real Postgres 16 container, proving
 * idempotency (onConflictDoNothing) and the exact numeric round-trip (T-06-07).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres term-structure-observations adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // FK-safe truncate: term-structure rows reference calendars.
    await db.execute(
      sql`TRUNCATE TABLE term_structure_observations, calendars CASCADE`,
    );
  });

  runTermStructureContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresTermStructureObservationsRepo(db);
      return {
        storeTermStructureObservations: repo.storeTermStructureObservations,
        readTermStructureSeries: repo.readTermStructureSeries,
        countObservations: async (calendarId?: string): Promise<number> => {
          const rows =
            calendarId === undefined
              ? await db.execute(
                  sql`SELECT COUNT(*)::int AS cnt FROM term_structure_observations`,
                )
              : await db.execute(
                  sql`SELECT COUNT(*)::int AS cnt FROM term_structure_observations WHERE calendar_id = ${calendarId}::uuid`,
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
    (): TermStructureSeedContext => ({
      seedCalendar: async (id: string): Promise<void> => {
        if (!db) throw new Error("db not initialized");
        await db.execute(
          sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
              VALUES (${id}::uuid, 'SPX', 5000000, 'C', '2026-07-18', '2026-09-19', 2, 'open', NOW(), '5.00')
              ON CONFLICT DO NOTHING`,
        );
      },
    }),
  );
});

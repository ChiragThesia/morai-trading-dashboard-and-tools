/**
 * Contract test for the Postgres GEX snapshot adapter.
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0008_gex_snapshot.sql).
 * SQL is never mocked (tdd.md): proves round-trip, SC-4 idempotency, JOIN leg-obs read,
 * and nullable field handling.
 *
 * Phase-3 cross-test contamination lesson: use distinct cycle_time values per test +
 * TRUNCATE gex_snapshots in beforeEach to avoid flaky re-persist/idempotency tests.
 */

import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import {
  runGexSnapshotContractTests,
  type GexSnapshotSeedContext,
} from "../__contract__/gex-snapshot.contract.ts";
import { makePostgresGexSnapshotRepo } from "./gex-snapshot.repo.ts";
import { makeDb } from "./db.ts";
import { sql } from "drizzle-orm";
import type { GexSnapshotRow } from "@morai/core";

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres gex-snapshot adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    // Clean up between tests. leg_observations references contracts — truncate together
    // so the dual-source cohort tests see only their own seeded rows.
    await db.execute(sql`TRUNCATE TABLE gex_snapshots`);
    await db.execute(sql`TRUNCATE TABLE leg_observations, contracts CASCADE`);
  });

  // ── Standard contract tests (shared suite) ─────────────────────────────────
  runGexSnapshotContractTests(
    (_seed) => {
      if (!db) throw new Error("db not initialized");
      const repo = makePostgresGexSnapshotRepo(db);
      return {
        readLegObsForGex: repo.readLegObsForGex,
        persistGexSnapshot: repo.persistGexSnapshot,
        readGexSnapshot: repo.readGexSnapshot,
        countSnapshots: async (): Promise<number> => {
          const rows = await db.execute(
            sql`SELECT COUNT(*)::int AS cnt FROM gex_snapshots`,
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
    (): GexSnapshotSeedContext => ({
      seedLegs: async (legs) => {
        if (!db || legs === undefined) return;
        // Insert contract metadata first (FK), then the observation rows.
        for (const leg of legs) {
          await db.execute(sql`
            INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
            VALUES (${leg.contract}, 'SPX', 'SPXW', ${leg.contractType}, 'european', ${leg.strike}, ${leg.expiration}, 100)
            ON CONFLICT DO NOTHING
          `);
          await db.execute(sql`
            INSERT INTO leg_observations
              (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_gamma, open_interest, volume, source)
            VALUES
              (${leg.time.toISOString()}::timestamptz, ${leg.contract}, '1.5', '2.0', ${leg.mark},
               ${String(leg.underlyingPrice)}, ${leg.bsmIv}, ${leg.bsmGamma}, ${leg.openInterest}, 0, 'cboe')
            ON CONFLICT DO NOTHING
          `);
        }
      },
    }),
  );

  // ── Postgres-specific: SC-4 idempotency via raw count (belt-and-suspenders) ─
  it("SC-4: re-persisting same cycleTime upserts → count = 1 (raw SQL verify)", async () => {
    if (!db) return;
    const repo = makePostgresGexSnapshotRepo(db);
    const cycleTime = new Date("2026-06-23T15:00:00Z");

    const flip: number | null = 7488;
    const callWall: number | null = 7600;
    const putWall: number | null = 7400;
    // WR-01: profile axis field is `spot` (simulated spot-price grid level), not `strike`
    const profile: ReadonlyArray<{ readonly spot: number; readonly gamma: number }> = [
      { spot: 7380, gamma: -47.43 },
      { spot: 7500, gamma: 5.98 },
    ] as const;
    const strikes: ReadonlyArray<{ readonly k: number; readonly gex: number; readonly coi: number; readonly poi: number; readonly vol: number }> = [
      { k: 7400, gex: -5974395559.1, coi: 17071, poi: 52786, vol: 69857 },
    ] as const;
    const byExpiry: ReadonlyArray<{ readonly date: string; readonly gex: number }> = [
      { date: "2026-06-27", gex: -12345678.9 },
    ] as const;
    const row: GexSnapshotRow = {
      cycleTime,
      spot: 7381,
      flip,
      callWall,
      putWall,
      netGammaAtSpot: -47.3,
      profile,
      strikes,
      byExpiry,
      computedAt: cycleTime,
    };

    // First insert
    const r1 = await repo.persistGexSnapshot(row);
    expect(r1.ok).toBe(true);

    // Second insert with same cycleTime — must be a no-op
    const r2 = await repo.persistGexSnapshot(row);
    expect(r2.ok).toBe(true);

    // Raw SQL count must be exactly 1 (SC-4 proven against real Postgres)
    const countRows = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM gex_snapshots WHERE cycle_time = ${cycleTime.toISOString()}::timestamptz`,
    );
    const countRow = countRows[0];
    expect(countRow).toBeDefined();
    if (countRow === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(countRow));
    const cnt = rec["cnt"];
    const count = typeof cnt === "number" ? cnt : Number(cnt ?? 0);
    expect(count).toBe(1);
  });

  // ── Postgres-specific: JOIN leg_observations ↔ contracts (Pitfall 2) ────────
  it("readLegObsForGex JOINs leg_observations with contracts — returns contractType/strike/expiration", async () => {
    if (!db) return;
    const repo = makePostgresGexSnapshotRepo(db);

    // Seed a contract + leg_observation row with BSM data
    const cycleTime = new Date("2026-06-23T14:00:00Z");
    const occSymbol = "O:SPX260627C07400";

    // Seed contract metadata
    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES (${occSymbol}, 'SPX', 'SPX', 'C', 'european', 7400000, '2026-06-27', 100)
      ON CONFLICT DO NOTHING
    `);

    // Seed leg observation with BSM gamma (not NaN)
    await db.execute(sql`
      INSERT INTO leg_observations
        (time, contract, bid, ask, mark, underlying_price, bsm_iv, bsm_gamma, open_interest, volume, source)
      VALUES
        (${cycleTime.toISOString()}::timestamptz, ${occSymbol}, '1.5', '2.0', '1.75', '7381', '0.14', '0.001', 1000, 0, 'cboe')
      ON CONFLICT DO NOTHING
    `);

    const result = await repo.readLegObsForGex();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Must have received the seeded row with JOIN fields populated
    const legs = result.value;
    expect(legs.length).toBeGreaterThan(0);

    const leg = legs.find((l) => l.contract === occSymbol);
    expect(leg).toBeDefined();
    if (leg === undefined) return;

    // JOIN fields from contracts table (Pitfall 2)
    expect(leg.contractType).toBe("C");
    expect(leg.strike).toBe(7400000); // ×1000 convention
    expect(leg.expiration).toBe("2026-06-27");
    expect(leg.bsmGamma).toBe("0.001");
    expect(leg.bsmIv).toBe("0.14");
    expect(leg.openInterest).toBe(1000);
    expect(leg.underlyingPrice).toBe(7381);
  });
});

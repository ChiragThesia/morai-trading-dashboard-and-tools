import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { makePostgresPickerHistoryRepo } from "./picker-history.ts";
import { makeDb } from "../db.ts";
import { legObservations, contracts, pickerSnapshots } from "../schema.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres picker-history adapter (experimental-rule inputs).
 * Requires Docker (testcontainers postgres:16). SQL is never mocked (tdd.md).
 *
 * Asserts:
 * - readDailySpotCloses: last observation per UTC day, last N available days, ASCENDING;
 *   intra-day earlier rows are ignored; empty table → [].
 * - readPickerSlopeHistory: flattens candidates[].slope from the newest N snapshot rows;
 *   unparseable blobs are skipped; empty table → [].
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres picker-history adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(legObservations);
    await db.delete(contracts);
    await db.delete(pickerSnapshots);
  });

  it("readDailySpotCloses returns the last close per day, ascending, capped at N days", async () => {
    if (!db) return;
    const repo = makePostgresPickerHistoryRepo(db);

    const occ = "O:SPX260801P07500";
    await db.execute(sql`
      INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
      VALUES (${occ}, 'SPX', 'SPX', 'P', 'european', 7500000, '2026-08-01', 100)
      ON CONFLICT DO NOTHING
    `);
    // 3 days; day 2 has TWO observations — the later one (7460) must win.
    await db.execute(sql`
      INSERT INTO leg_observations
        (time, contract, bid, ask, mark, underlying_price, open_interest, volume, source)
      VALUES
        ('2026-07-01T15:00:00Z'::timestamptz, ${occ}, '1', '2', '1.5', '7400', 100, 0, 'cboe'),
        ('2026-07-02T14:00:00Z'::timestamptz, ${occ}, '1', '2', '1.5', '7450', 100, 0, 'cboe'),
        ('2026-07-02T19:30:00Z'::timestamptz, ${occ}, '1', '2', '1.5', '7460', 100, 0, 'cboe'),
        ('2026-07-03T15:00:00Z'::timestamptz, ${occ}, '1', '2', '1.5', '7480', 100, 0, 'cboe')
      ON CONFLICT DO NOTHING
    `);

    const all = await repo.readDailySpotCloses(10);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.value).toEqual([7400, 7460, 7480]);

    // Cap: only the LAST 2 available days survive, still ascending.
    const capped = await repo.readDailySpotCloses(2);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.value).toEqual([7460, 7480]);
  });

  it("readDailySpotCloses returns [] on an empty table", async () => {
    if (!db) return;
    const repo = makePostgresPickerHistoryRepo(db);
    const result = await repo.readDailySpotCloses(10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("readPickerSlopeHistory flattens candidate slopes from the newest N rows, skipping junk", async () => {
    if (!db) return;
    const repo = makePostgresPickerHistoryRepo(db);

    await db.execute(sql`
      INSERT INTO picker_snapshot (observed_at, snapshot)
      VALUES
        ('2026-07-01T15:00:00Z'::timestamptz, ${JSON.stringify({ candidates: [{ slope: 0.1 }, { slope: 0.2 }] })}::jsonb),
        ('2026-07-02T15:00:00Z'::timestamptz, ${JSON.stringify({ junk: true })}::jsonb),
        ('2026-07-03T15:00:00Z'::timestamptz, ${JSON.stringify({ candidates: [{ slope: 0.3 }] })}::jsonb)
    `);

    const all = await repo.readPickerSlopeHistory(10);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect([...all.value].sort()).toEqual([0.1, 0.2, 0.3]);

    // Limit applies to ROWS (newest first): limit 1 → only the 07-03 row's slopes.
    const capped = await repo.readPickerSlopeHistory(1);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.value).toEqual([0.3]);
  });
});

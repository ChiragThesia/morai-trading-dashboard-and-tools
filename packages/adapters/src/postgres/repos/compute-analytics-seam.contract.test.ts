import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { formatOccSymbol } from "@morai/shared";
import { makeComputeAnalyticsUseCase } from "@morai/core";
import {
  runComputeAnalyticsSeamContractTests,
  type ComputeAnalyticsSeamHarness,
} from "../../__contract__/compute-analytics-seam.contract.ts";
import { makePostgresLegObservationsRepo } from "./leg-observations.ts";
import { makePostgresCalendarSnapshotsRepo } from "./calendar-snapshots.ts";
import { makePostgresSkewObservationsRepo } from "./skew-observations.ts";
import { makePostgresRiskReversalObservationsRepo } from "./risk-reversal-observations.ts";
import { makePostgresTermStructureObservationsRepo } from "./term-structure-observations.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Postgres testcontainer runner for the compute-analytics cycle-resolution seam (06-06 / CR-01+02).
 *
 * Wires the REAL makeComputeAnalyticsUseCase over the real Postgres repos (leg-observations smile
 * read, calendar-snapshots cycle read, skew/RR/term writers, RR history reader) with an injectable
 * now(). SQL is never mocked (tdd.md): the bounded read, the idempotent onConflictDoNothing writes,
 * and the single-anchor invariant are all exercised against real Postgres 16.
 *
 * Pre-fix proof: on the old exact-now() read/stamp these assertions FAIL (0 skew rows, dup on
 * re-run). Post-fix they pass.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

/** Deterministic OCC symbol from the smile grain (root SPX, type C). */
function occFor(expiration: string, strikeX1000: number): string {
  const [y, m, d] = expiration.split("-").map((n) => Number(n));
  return formatOccSymbol({
    root: "SPX",
    expiry: new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, d ?? 1)),
    type: "C",
    strike: strikeX1000 / 1000,
  });
}

async function countOf(
  db: ReturnType<typeof makeDb>,
  table: "skew_observations" | "risk_reversal_observations" | "term_structure_observations",
): Promise<number> {
  const rows =
    table === "skew_observations"
      ? await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM skew_observations`)
      : table === "risk_reversal_observations"
        ? await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM risk_reversal_observations`)
        : await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM term_structure_observations`);
  const row = rows[0];
  if (row === undefined) return 0;
  const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
  const cnt = rec["cnt"];
  if (typeof cnt === "number") return cnt;
  if (typeof cnt === "string") return Number(cnt);
  return 0;
}

async function distinctSnapshotTimes(
  db: ReturnType<typeof makeDb>,
  table: "skew_observations" | "term_structure_observations",
): Promise<string[]> {
  const rows =
    table === "skew_observations"
      ? await db.execute(
          sql`SELECT DISTINCT snapshot_time FROM skew_observations ORDER BY snapshot_time`,
        )
      : await db.execute(
          sql`SELECT DISTINCT snapshot_time FROM term_structure_observations ORDER BY snapshot_time`,
        );
  return rows.map((row) => {
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
    const t = rec["snapshot_time"];
    if (t instanceof Date) return t.toISOString();
    return new Date(String(t)).toISOString();
  });
}

describe.skipIf(shouldSkip)("postgres compute-analytics cycle-resolution seam", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.execute(
      sql`TRUNCATE TABLE skew_observations, risk_reversal_observations, term_structure_observations, leg_observations, calendar_snapshots, contracts, calendars CASCADE`,
    );
  });

  runComputeAnalyticsSeamContractTests((): ComputeAnalyticsSeamHarness => {
    if (!db) throw new Error("db not initialized");

    const legObsRepo = makePostgresLegObservationsRepo(db);
    const calendarSnapshotsRepo = makePostgresCalendarSnapshotsRepo(db);
    const skewRepo = makePostgresSkewObservationsRepo(db);
    const rrRepo = makePostgresRiskReversalObservationsRepo(db);
    const termRepo = makePostgresTermStructureObservationsRepo(db);

    return {
      run: async (now: Date): Promise<boolean> => {
        const useCase = makeComputeAnalyticsUseCase({
          readSmile: legObsRepo.readSmile,
          readSnapshots: calendarSnapshotsRepo.readSnapshotsForCycle,
          writeSkew: skewRepo.storeSkewObservations,
          writeRr: rrRepo.storeRiskReversalObservations,
          writeTerm: termRepo.storeTermStructureObservations,
          readRrHistory: rrRepo.readRiskReversalHistory,
          now: () => now,
        });
        const result = await useCase();
        return result.ok;
      },
      seedCalendar: async (calendarId: string): Promise<void> => {
        await db.execute(
          sql`INSERT INTO calendars (id, underlying, strike, option_type, front_expiry, back_expiry, qty, status, opened_at, open_net_debit)
              VALUES (${calendarId}::uuid, 'SPX', 5000000, 'C', '2026-07-18', '2026-09-19', 2, 'open', NOW(), '5.00')
              ON CONFLICT DO NOTHING`,
        );
      },
      seedLeg: async (leg): Promise<void> => {
        const occ = occFor(leg.expiration, leg.strike);
        await db.execute(
          sql`INSERT INTO contracts (occ_symbol, underlying, root, contract_type, exercise_style, strike, expiration, multiplier)
              VALUES (${occ}, ${leg.underlying}, 'SPX', 'C', 'european', ${leg.strike}, ${leg.expiration}, 100)
              ON CONFLICT DO NOTHING`,
        );
        await db.execute(
          sql`INSERT INTO leg_observations (time, contract, bid, ask, mark, underlying_price, open_interest, volume, source, bsm_iv, bsm_delta)
              VALUES (${leg.time.toISOString()}::timestamptz, ${occ}, '1.0', '1.1', '1.05', '5500.0', 0, 0, 'cboe', ${leg.bsmIv}::numeric, ${leg.bsmDelta}::numeric)
              ON CONFLICT DO NOTHING`,
        );
      },
      seedSnapshot: async (snap): Promise<void> => {
        await db.execute(
          sql`INSERT INTO calendar_snapshots (time, calendar_id, spot, net_mark, front_mark, back_mark, front_iv, back_iv, front_iv_raw, back_iv_raw, net_delta, net_gamma, net_theta, net_vega, term_slope, dte_front, dte_back, pnl_open, source)
              VALUES (${snap.time.toISOString()}::timestamptz, ${snap.calendarId}::uuid, '5500', '5.0', '10.0', '15.0', ${snap.frontIv}::numeric, ${snap.backIv}::numeric, ${snap.frontIv}::numeric, ${snap.backIv}::numeric, '0.1', '0.01', '-0.5', '1.2', ${snap.termSlope}::numeric, 17, 52, '100.0', 'cboe')
              ON CONFLICT DO NOTHING`,
        );
      },
      reset: async (): Promise<void> => {
        await db.execute(
          sql`TRUNCATE TABLE skew_observations, risk_reversal_observations, term_structure_observations, leg_observations, calendar_snapshots, contracts, calendars CASCADE`,
        );
      },
      countSkew: (): Promise<number> => countOf(db, "skew_observations"),
      countRr: (): Promise<number> => countOf(db, "risk_reversal_observations"),
      countTerm: (): Promise<number> => countOf(db, "term_structure_observations"),
      skewSnapshotTimes: (): Promise<string[]> => distinctSnapshotTimes(db, "skew_observations"),
      termSnapshotTimes: (): Promise<string[]> =>
        distinctSnapshotTimes(db, "term_structure_observations"),
    };
  });
});

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { CalendarRankingRow, ForPersistingCalendarRanking, StorageError } from "@morai/core";
import { calendarRanking } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresCalendarRankingRepo — Postgres implementation of ForPersistingCalendarRanking.
 *
 * One statement per cycle: a bulk INSERT of every ranked expiry pair, ON CONFLICT DO NOTHING
 * on the composite PK `(as_of, root, contract_type, front_expiration, back_expiration, strike)`.
 *
 * CAN THAT CONFLICT KEY REPEAT WITHIN ONE BATCH? No — one batch is one `rankCalendars` call,
 * which has already collapsed to one row per `(root, front, back)`, and `as_of`/`contract_type`
 * are single literals for the whole call. But the adapter does not RELY on that, because this
 * repo has been wrong about exactly that reasoning three times. DO NOTHING is chosen over DO
 * UPDATE for two independent reasons: it is first-write-wins, so re-running a cycle whose
 * `as_of` has not advanced writes nothing (the cron's idempotency); and unlike DO UPDATE it
 * cannot raise "ON CONFLICT DO UPDATE command cannot affect row a second time" on an in-batch
 * duplicate — the error that took ingest down for ~80 minutes in commit 0224db1.
 *
 * NO CHUNKING. The use-case caps a write at 200 rows (measured 96 pairs a cycle) × 20 columns =
 * 4,000 bind parameters, 6% of Postgres's 65,534 limit — the bound that forced chunking in
 * leg-observations does not apply here.
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/. Numeric columns cross the
 * boundary via String() (skew-observations.ts precedent); nullable score terms and a null spot
 * survive as NULL rather than a fabricated 0.
 */
export type PostgresCalendarRankingRepo = {
  readonly insertCalendarRanking: ForPersistingCalendarRanking;
};

export function makePostgresCalendarRankingRepo(db: Db): PostgresCalendarRankingRepo {
  const insertCalendarRanking: ForPersistingCalendarRanking = async (
    rows: ReadonlyArray<CalendarRankingRow>,
  ): Promise<Result<void, StorageError>> => {
    // Drizzle throws on `.values([])`. The use-case already refuses to call with an empty
    // ranking; this keeps the port honest for any other caller.
    if (rows.length === 0) return ok(undefined);
    try {
      await db.insert(calendarRanking).values(
        rows.map((row) => ({
          asOf: row.asOf,
          root: row.root,
          contractType: row.contractType,
          frontExpiration: row.frontExpiration,
          backExpiration: row.backExpiration,
          strike: String(row.strike),
          rank: row.rank,
          score: String(row.score),
          fwdEdgeRaw: row.fwdEdgeRaw === null ? null : String(row.fwdEdgeRaw),
          fwdEdgePercentile:
            row.fwdEdgePercentile === null ? null : String(row.fwdEdgePercentile),
          deltaBalanceRaw: row.deltaBalanceRaw === null ? null : String(row.deltaBalanceRaw),
          deltaBalancePercentile:
            row.deltaBalancePercentile === null ? null : String(row.deltaBalancePercentile),
          fwdIv: String(row.fwdIv),
          frontRefIv: String(row.frontRefIv),
          backRefIv: String(row.backRefIv),
          debit: String(row.debit),
          netTheta: String(row.netTheta),
          netVega: String(row.netVega),
          spot: row.spot === null ? null : String(row.spot),
          noIvLegs: row.noIvLegs,
        })),
      )
        // Every PK column named explicitly, so a future migration that changes the key breaks
        // here rather than silently conflicting on a narrower one.
        .onConflictDoNothing({
          target: [
            calendarRanking.asOf,
            calendarRanking.root,
            calendarRanking.contractType,
            calendarRanking.frontExpiration,
            calendarRanking.backExpiration,
            calendarRanking.strike,
          ],
        });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { insertCalendarRanking };
}

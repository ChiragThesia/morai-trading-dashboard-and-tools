/**
 * makePostgresBrokerTransactionsRepo — Postgres implementation of the
 * broker-transactions ports (Trade Ledger).
 *
 * storeBrokerTransactions: batch INSERT onConflictDoNothing on activity_id PK —
 *   first-seen raw wins; the 7-day trailing sync window re-covers old rows as no-ops.
 * readBrokerTransactions: all rows, ORDER BY exec_time DESC NULLS LAST.
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * Numeric columns map string↔number at this boundary (existing repo pattern).
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { z } from "zod";
import type {
  ForStoringBrokerTransactions,
  ForReadingBrokerTransactions,
  StoredBrokerTransaction,
  StoredBrokerTransactionLeg,
  StorageError,
} from "@morai/core";
import { desc, sql } from "drizzle-orm";
import { brokerTransactions } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresBrokerTransactionsRepo = {
  readonly storeBrokerTransactions: ForStoringBrokerTransactions;
  readonly readBrokerTransactions: ForReadingBrokerTransactions;
};

// legs jsonb round-trip: parse-don't-cast at the read boundary (typescript.md).
const legSchema = z.object({
  occSymbol: z.string(),
  qty: z.number(),
  price: z.number(),
  positionEffect: z.enum(["OPENING", "CLOSING", "UNKNOWN"]),
  side: z.enum(["buy", "sell"]),
});
const legsSchema = z.array(legSchema);

export function makePostgresBrokerTransactionsRepo(
  db: Db,
): PostgresBrokerTransactionsRepo {
  const storeBrokerTransactions: ForStoringBrokerTransactions = async (
    batch: ReadonlyArray<StoredBrokerTransaction>,
  ): Promise<Result<void, StorageError>> => {
    if (batch.length === 0) return ok(undefined);
    try {
      await db
        .insert(brokerTransactions)
        .values(
          batch.map((tx) => ({
            activityId: tx.activityId,
            orderId: tx.orderId,
            activityType: tx.activityType,
            execTime: tx.execTime,
            tradeDate: tx.tradeDate,
            settlementDate: tx.settlementDate,
            netAmount: String(tx.netAmount),
            fees: tx.fees !== null ? String(tx.fees) : null,
            legs: tx.legs,
            raw: tx.raw,
          })),
        )
        .onConflictDoNothing(); // activity_id PK → re-run = no-op, first-seen wins
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readBrokerTransactions: ForReadingBrokerTransactions = async (): Promise<
    Result<ReadonlyArray<StoredBrokerTransaction>, StorageError>
  > => {
    try {
      const rows = await db
        .select()
        .from(brokerTransactions)
        .orderBy(sql`${desc(brokerTransactions.execTime)} NULLS LAST`);

      const mapped: StoredBrokerTransaction[] = [];
      for (const row of rows) {
        const legsParsed = legsSchema.safeParse(row.legs);
        const legs: ReadonlyArray<StoredBrokerTransactionLeg> = legsParsed.success
          ? legsParsed.data
          : [];
        mapped.push({
          activityId: row.activityId,
          orderId: row.orderId,
          activityType: row.activityType,
          execTime: row.execTime,
          tradeDate: row.tradeDate,
          settlementDate: row.settlementDate,
          netAmount: parseFloat(row.netAmount),
          fees: row.fees !== null ? parseFloat(row.fees) : null,
          legs,
          raw: row.raw,
        });
      }
      return ok(mapped);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { storeBrokerTransactions, readBrokerTransactions };
}

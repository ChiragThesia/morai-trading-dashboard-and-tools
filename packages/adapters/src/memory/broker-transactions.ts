/**
 * makeMemoryBrokerTransactionsRepo — in-memory twin of the Postgres broker-transactions
 * adapter (Trade Ledger).
 *
 * Architecture law: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 *
 * Idempotency mirrors Postgres: Map keyed on activityId (PK equivalent) — first-seen wins.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringBrokerTransactions,
  ForReadingBrokerTransactions,
  StoredBrokerTransaction,
  StorageError,
} from "@morai/core";

export type MemoryBrokerTransactionsRepo = {
  readonly storeBrokerTransactions: ForStoringBrokerTransactions;
  readonly readBrokerTransactions: ForReadingBrokerTransactions;
};

export function makeMemoryBrokerTransactionsRepo(): MemoryBrokerTransactionsRepo {
  // Key: activityId (PK equivalent — first-seen wins, onConflictDoNothing twin)
  const store = new Map<number, StoredBrokerTransaction>();

  const storeBrokerTransactions: ForStoringBrokerTransactions = async (
    batch: ReadonlyArray<StoredBrokerTransaction>,
  ): Promise<Result<void, StorageError>> => {
    for (const tx of batch) {
      if (!store.has(tx.activityId)) store.set(tx.activityId, tx);
    }
    return ok(undefined);
  };

  // Newest-first by execTime, null execTime last (mirrors ORDER BY exec_time DESC NULLS LAST).
  const readBrokerTransactions: ForReadingBrokerTransactions = async (): Promise<
    Result<ReadonlyArray<StoredBrokerTransaction>, StorageError>
  > => {
    const rows = [...store.values()].sort((a, b) => {
      if (a.execTime === null && b.execTime === null) return 0;
      if (a.execTime === null) return 1;
      if (b.execTime === null) return -1;
      return b.execTime.getTime() - a.execTime.getTime();
    });
    return ok(rows);
  };

  return { storeBrokerTransactions, readBrokerTransactions };
}

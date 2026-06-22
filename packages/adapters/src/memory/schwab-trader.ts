/**
 * schwab-trader.ts — in-memory twin for all Schwab trader ports (BRK-02).
 *
 * Provides in-memory implementations of ForFetchingPositions, ForFetchingTransactions,
 * ForFetchingOrders, and ForResolvingAccountHash plus `seed()` helpers for tests.
 *
 * Architecture rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 */
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  BrokerPosition,
  BrokerTransaction,
  BrokerOrder,
  FetchError,
  AuthExpiredError,
  ForFetchingPositions,
  ForFetchingTransactions,
  ForFetchingOrders,
  ForResolvingAccountHash,
} from "@morai/core";

// ─── Memory trader type ────────────────────────────────────────────────────────

export type MemorySchwabTrader = {
  readonly fetchPositions: ForFetchingPositions;
  readonly fetchTransactions: ForFetchingTransactions;
  readonly fetchOrders: ForFetchingOrders;
  readonly resolveAccountHash: ForResolvingAccountHash;
  /** seed positions for a given account hash */
  readonly seedPositions: (
    accountHash: string,
    positions: ReadonlyArray<BrokerPosition>,
  ) => Promise<void>;
  /** seed transactions for a given account hash */
  readonly seedTransactions: (
    accountHash: string,
    transactions: ReadonlyArray<BrokerTransaction>,
  ) => Promise<void>;
  /** seed orders for a given account hash */
  readonly seedOrders: (
    accountHash: string,
    orders: ReadonlyArray<BrokerOrder>,
  ) => Promise<void>;
  /** seed the resolved account hash */
  readonly seedAccountHash: (hashValue: string) => Promise<void>;
};

/**
 * makeMemorySchwabTrader — in-memory twin for all Schwab trader ports.
 *
 * Implements ForFetchingPositions, ForFetchingTransactions, ForFetchingOrders,
 * and ForResolvingAccountHash using plain Maps.
 * Exposes seed*() helpers for test setup.
 */
export function makeMemorySchwabTrader(): MemorySchwabTrader {
  const positionsStore = new Map<string, ReadonlyArray<BrokerPosition>>();
  const transactionsStore = new Map<string, ReadonlyArray<BrokerTransaction>>();
  const ordersStore = new Map<string, ReadonlyArray<BrokerOrder>>();
  let storedHashValue: string | undefined;

  const fetchPositions: ForFetchingPositions = async (
    accountHash: string,
  ): Promise<Result<ReadonlyArray<BrokerPosition>, FetchError | AuthExpiredError>> => {
    const positions = positionsStore.get(accountHash);
    if (positions === undefined) {
      return err<FetchError>({
        kind: "fetch-error",
        message: `Positions not seeded for hash: ${accountHash}`,
      });
    }
    return ok(positions);
  };

  const fetchTransactions: ForFetchingTransactions = async (
    accountHash: string,
    _from: string,
    _to: string,
  ): Promise<Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>> => {
    const transactions = transactionsStore.get(accountHash);
    if (transactions === undefined) {
      return err<FetchError>({
        kind: "fetch-error",
        message: `Transactions not seeded for hash: ${accountHash}`,
      });
    }
    return ok(transactions);
  };

  const fetchOrders: ForFetchingOrders = async (
    accountHash: string,
  ): Promise<Result<ReadonlyArray<BrokerOrder>, FetchError | AuthExpiredError>> => {
    const orders = ordersStore.get(accountHash);
    if (orders === undefined) {
      return err<FetchError>({
        kind: "fetch-error",
        message: `Orders not seeded for hash: ${accountHash}`,
      });
    }
    return ok(orders);
  };

  const resolveAccountHash: ForResolvingAccountHash =
    async (): Promise<Result<string, FetchError | AuthExpiredError>> => {
      if (storedHashValue === undefined) {
        return err<FetchError>({
          kind: "fetch-error",
          message: "Account hash not seeded",
        });
      }
      return ok(storedHashValue);
    };

  const seedPositions = async (
    accountHash: string,
    positions: ReadonlyArray<BrokerPosition>,
  ): Promise<void> => {
    positionsStore.set(accountHash, positions);
  };

  const seedTransactions = async (
    accountHash: string,
    transactions: ReadonlyArray<BrokerTransaction>,
  ): Promise<void> => {
    transactionsStore.set(accountHash, transactions);
  };

  const seedOrders = async (
    accountHash: string,
    orders: ReadonlyArray<BrokerOrder>,
  ): Promise<void> => {
    ordersStore.set(accountHash, orders);
  };

  const seedAccountHash = async (hashValue: string): Promise<void> => {
    storedHashValue = hashValue;
  };

  return {
    fetchPositions,
    fetchTransactions,
    fetchOrders,
    resolveAccountHash,
    seedPositions,
    seedTransactions,
    seedOrders,
    seedAccountHash,
  };
}

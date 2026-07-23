import { describe } from "vitest";
import { runBrokerTransactionsContractTests } from "../__contract__/broker-transactions.contract.ts";
import { makeMemoryBrokerTransactionsRepo } from "./broker-transactions.ts";

/**
 * Contract test for the in-memory broker-transactions twin (Trade Ledger).
 * Same suite runs against the Postgres adapter (testcontainers).
 */

describe("memory broker-transactions adapter", () => {
  runBrokerTransactionsContractTests(
    (_seed) => makeMemoryBrokerTransactionsRepo(),
    () => ({ __dummy: undefined }),
  );
});

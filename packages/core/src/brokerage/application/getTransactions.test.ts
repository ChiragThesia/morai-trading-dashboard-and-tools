/**
 * getTransactions.test.ts — BRK-02 use-case tests for getTransactions and getOrders.
 *
 * Uses the in-memory twin (not the real adapter). Tests:
 *   - ok(data) passthrough from adapter
 *   - err(auth-expired) passthrough (D-09: trader expired pauses reads)
 *   - err(fetch-error) passthrough
 */
import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import { makeGetTransactionsUseCase } from "./getTransactions.ts";
import { makeGetOrdersUseCase } from "./getOrders.ts";
import type {
  ForFetchingTransactions,
  ForFetchingOrders,
  ForResolvingAccountHash,
  BrokerTransaction,
  BrokerOrder,
} from "./ports.ts";

// ─── Test doubles ─────────────────────────────────────────────────────────────

const ACCOUNT_HASH = "HASH_ABC123";

function makeSchwabOcc() {
  return formatOccSymbol({
    root: "SPX",
    expiry: new Date(2026, 5, 20),
    type: "P",
    strike: 5950,
  });
}

function makeTx(): BrokerTransaction {
  return {
    activityId: 987654321,
    tradeDate: "2026-06-10",
    netAmount: -1250.0,
    orderId: 111222333,
    legs: [
      {
        occSymbol: makeSchwabOcc(),
        qty: 1,
        price: 12.5,
        positionEffect: "OPENING",
        side: "buy",
      },
    ],
  };
}

function makeOrder(): BrokerOrder {
  return {
    orderId: 111222333,
    status: "FILLED",
    legs: [
      {
        occSymbol: makeSchwabOcc(),
        qty: 1,
        side: "SELL",
      },
    ],
  };
}

function freshHashResolver(): ForResolvingAccountHash {
  return async () => ok(ACCOUNT_HASH);
}

function expiredHashResolver(): ForResolvingAccountHash {
  return async () => err({ kind: "auth-expired" as const, appId: "trader" as const });
}

function freshFetchTransactions(txs: ReadonlyArray<BrokerTransaction>): ForFetchingTransactions {
  return async (_hash, _from, _to) => ok(txs);
}

function errorFetchTransactions(): ForFetchingTransactions {
  return async (_hash, _from, _to) => err({ kind: "fetch-error", message: "network error" });
}

function freshFetchOrders(orders: ReadonlyArray<BrokerOrder>): ForFetchingOrders {
  return async (_hash) => ok(orders);
}

function errorFetchOrders(): ForFetchingOrders {
  return async (_hash) => err({ kind: "fetch-error", message: "network error" });
}

// ─── getTransactions tests ────────────────────────────────────────────────────

describe("makeGetTransactionsUseCase", () => {
  it("resolves account hash and returns ok(transactions) from fetchTransactions", async () => {
    const tx = makeTx();
    const getTransactions = makeGetTransactionsUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchTransactions: freshFetchTransactions([tx]),
    });
    const result = await getTransactions("2026-06-01", "2026-06-30");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    const first = result.value[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.activityId).toBe(987654321);
    expect(first.legs.length).toBe(1);
  });

  it("returns ok([]) when fetchTransactions returns empty array", async () => {
    const getTransactions = makeGetTransactionsUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchTransactions: freshFetchTransactions([]),
    });
    const result = await getTransactions("2026-06-01", "2026-06-30");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("returns err(auth-expired) when resolveAccountHash fails with auth-expired (D-09)", async () => {
    const getTransactions = makeGetTransactionsUseCase({
      resolveAccountHash: expiredHashResolver(),
      fetchTransactions: freshFetchTransactions([]),
    });
    const result = await getTransactions("2026-06-01", "2026-06-30");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth-expired");
  });

  it("returns err(fetch-error) when fetchTransactions fails", async () => {
    const getTransactions = makeGetTransactionsUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchTransactions: errorFetchTransactions(),
    });
    const result = await getTransactions("2026-06-01", "2026-06-30");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });
});

// ─── getOrders tests ──────────────────────────────────────────────────────────

describe("makeGetOrdersUseCase", () => {
  it("resolves account hash and returns ok(orders) from fetchOrders", async () => {
    const order = makeOrder();
    const getOrders = makeGetOrdersUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchOrders: freshFetchOrders([order]),
    });
    const result = await getOrders();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBe(1);
    const first = result.value[0];
    expect(first).toBeDefined();
    if (!first) return;
    expect(first.orderId).toBe(111222333);
    expect(first.status).toBe("FILLED");
  });

  it("returns ok([]) when fetchOrders returns empty array", async () => {
    const getOrders = makeGetOrdersUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchOrders: freshFetchOrders([]),
    });
    const result = await getOrders();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("returns err(auth-expired) when resolveAccountHash fails with auth-expired (D-09)", async () => {
    const getOrders = makeGetOrdersUseCase({
      resolveAccountHash: expiredHashResolver(),
      fetchOrders: freshFetchOrders([]),
    });
    const result = await getOrders();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("auth-expired");
  });

  it("returns err(fetch-error) when fetchOrders fails", async () => {
    const getOrders = makeGetOrdersUseCase({
      resolveAccountHash: freshHashResolver(),
      fetchOrders: errorFetchOrders(),
    });
    const result = await getOrders();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("fetch-error");
  });
});

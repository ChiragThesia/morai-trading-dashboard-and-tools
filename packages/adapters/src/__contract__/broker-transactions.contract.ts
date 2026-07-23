/**
 * Shared contract-test suite for the broker-transactions persistence ports (Trade Ledger).
 *
 * Run this suite against both:
 *   - The Postgres adapter (testcontainers) — packages/adapters/src/postgres/repos/broker-transactions.contract.test.ts
 *   - The in-memory twin — packages/adapters/src/memory/broker-transactions.contract.test.ts
 *
 * Asserts:
 * - storeBrokerTransactions: batch insert → rows readable back with full field fidelity
 * - idempotency: same activityId re-stored → no duplicate, first-seen row wins
 * - readBrokerTransactions: newest-first by execTime, null execTime last
 * - empty batch is a valid no-op
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ForStoringBrokerTransactions, ForReadingBrokerTransactions, StoredBrokerTransaction } from "@morai/core";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type BrokerTransactionsRepo = {
  readonly storeBrokerTransactions: ForStoringBrokerTransactions;
  readonly readBrokerTransactions: ForReadingBrokerTransactions;
};

export type BrokerTransactionsSeedContext = {
  /** No FK deps for broker_transactions; no seed needed. */
  readonly __dummy: undefined;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeTx(
  activityId: number,
  overrides: Partial<StoredBrokerTransaction> = {},
): StoredBrokerTransaction {
  return {
    activityId,
    orderId: 111222333,
    activityType: "EXECUTION",
    execTime: new Date("2026-07-23T19:50:12Z"),
    tradeDate: "2026-07-23",
    settlementDate: "2026-07-24",
    netAmount: -1250.5,
    fees: -0.7,
    legs: [
      {
        occSymbol: "SPXW  260811P07400000",
        qty: 1,
        price: 103.36,
        positionEffect: "OPENING",
        side: "sell",
      },
    ],
    raw: { activityId, time: "2026-07-23T19:50:12+0000", note: "verbatim" },
    ...overrides,
  };
}

// ─── Contract suite ───────────────────────────────────────────────────────────

export function runBrokerTransactionsContractTests(
  makeRepo: (seed: BrokerTransactionsSeedContext) => BrokerTransactionsRepo,
  getSeedContext: () => BrokerTransactionsSeedContext,
): void {
  describe("broker-transactions persistence contract", () => {
    let repo: BrokerTransactionsRepo;

    beforeEach(() => {
      repo = makeRepo(getSeedContext());
    });

    it("stores a batch and reads it back with full field fidelity", async () => {
      const tx = makeTx(126084076123);
      const stored = await repo.storeBrokerTransactions([tx]);
      expect(stored.ok).toBe(true);

      const read = await repo.readBrokerTransactions();
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value).toHaveLength(1);
      const row = read.value[0];
      expect(row).toBeDefined();
      if (!row) return;
      expect(row.activityId).toBe(126084076123);
      expect(row.orderId).toBe(111222333);
      expect(row.activityType).toBe("EXECUTION");
      expect(row.execTime?.toISOString()).toBe("2026-07-23T19:50:12.000Z");
      expect(row.tradeDate).toBe("2026-07-23");
      expect(row.settlementDate).toBe("2026-07-24");
      expect(row.netAmount).toBeCloseTo(-1250.5, 10);
      expect(row.fees).toBeCloseTo(-0.7, 10);
      expect(row.legs).toEqual(tx.legs);
      expect(row.raw).toEqual(tx.raw);
    });

    it("same activityId re-stored → exactly one row, first-seen wins (onConflictDoNothing)", async () => {
      await repo.storeBrokerTransactions([makeTx(1, { netAmount: 100 })]);
      await repo.storeBrokerTransactions([makeTx(1, { netAmount: 999 })]);

      const read = await repo.readBrokerTransactions();
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value).toHaveLength(1);
      expect(read.value[0]?.netAmount).toBeCloseTo(100, 10);
    });

    it("reads newest-first by execTime, null execTime last", async () => {
      await repo.storeBrokerTransactions([
        makeTx(1, { execTime: new Date("2026-07-01T14:00:00Z") }),
        makeTx(2, { execTime: new Date("2026-07-20T14:00:00Z") }),
        makeTx(3, { execTime: null }),
      ]);

      const read = await repo.readBrokerTransactions();
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value.map((r) => r.activityId)).toEqual([2, 1, 3]);
    });

    it("nullable fields round-trip as null", async () => {
      await repo.storeBrokerTransactions([
        makeTx(7, {
          orderId: null,
          activityType: null,
          execTime: null,
          settlementDate: null,
          fees: null,
        }),
      ]);

      const read = await repo.readBrokerTransactions();
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const row = read.value[0];
      expect(row?.orderId).toBeNull();
      expect(row?.activityType).toBeNull();
      expect(row?.execTime).toBeNull();
      expect(row?.settlementDate).toBeNull();
      expect(row?.fees).toBeNull();
    });

    it("empty batch is a valid no-op", async () => {
      const stored = await repo.storeBrokerTransactions([]);
      expect(stored.ok).toBe(true);
      const read = await repo.readBrokerTransactions();
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      expect(read.value).toHaveLength(0);
    });
  });
}

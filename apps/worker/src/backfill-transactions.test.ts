/**
 * backfill-transactions.test.ts — historical trade-history backfill orchestrator (BRK-04).
 *
 * Exercises the PURE orchestrator (runBackfill) offline: a faked ForFetchingTransactions and
 * the in-memory fills twin (makeMemoryFillsRepo). No live Schwab, no testcontainer — the twin
 * is the SPEC-permitted idempotency substrate.
 *
 * Proves:
 *  - Test A: a multi-chunk range writes fills for the FULL range; the (from,to) windows the
 *    fetch is called with exactly match chunkDateRange's output.
 *  - Test B: a second run over the same range adds 0 fills (deterministic ids + twin no-op).
 *  - Test C: an over-cap total range returns a clear error and writes NOTHING.
 *
 * No any/as/! (typescript.md).
 */

import { describe, it, expect } from "vitest";
import { ok, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  chunkDateRange,
  hashFillIds,
  SCHWAB_TX_MAX_RANGE_DAYS,
} from "@morai/core";
import type {
  BrokerTransaction,
  ForFetchingTransactions,
  FetchError,
  AuthExpiredError,
} from "@morai/core";
import { makeMemoryFillsRepo } from "@morai/adapters";
import {
  runBackfill,
  SCHWAB_TX_LOOKBACK_MAX_DAYS,
} from "./backfill-transactions.ts";

// Deterministic 64-hex hasher test double (mirrors the injected sha256-hex port shape;
// node:crypto stays out — this is the worker side but we keep the test self-contained).
function testHashFillIds(ids: ReadonlyArray<string>): string {
  const input = [...ids].sort().join(":");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").repeat(8); // 64 hex chars
}

const LEG = formatOccSymbol({
  root: "SPX",
  expiry: new Date("2026-06-20T12:00:00Z"),
  type: "P",
  strike: 7100,
});

// One distinct transaction per chunk window — activityId derived from the chunk index so each
// chunk contributes one new fill (deterministic id → idempotent across runs).
function txForChunk(index: number, tradeDate: string): BrokerTransaction {
  return {
    activityId: 5000 + index,
    tradeDate,
    netAmount: -100,
    orderId: 9000 + index,
    legs: [{ occSymbol: LEG, qty: 1, price: 10, positionEffect: "OPENING" }],
  };
}

// A faked fetch that records the (from,to) windows it is called with and returns one tx per
// window (the tx's tradeDate = the window's `from`, so it falls inside the chunk).
function makeRecordingFetch(): {
  fetch: ForFetchingTransactions;
  windows: Array<{ from: string; to: string }>;
} {
  const windows: Array<{ from: string; to: string }> = [];
  const fetch: ForFetchingTransactions = async (
    _accountHash: string,
    from: string,
    to: string,
  ): Promise<
    Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>
  > => {
    const index = windows.length;
    windows.push({ from, to });
    return ok([txForChunk(index, from)]);
  };
  return { fetch, windows };
}

const baseDeps = {
  hashFillIds: testHashFillIds,
  accountHash: "ACCT-HASH",
  now: () => new Date("2026-06-20T00:00:00Z"),
  maxDays: 30,
};

describe("runBackfill — historical trade-history backfill (BRK-04)", () => {
  it("Test A: a multi-chunk range writes fills for the full range with chunk boundaries matching chunkDateRange", async () => {
    const twin = makeMemoryFillsRepo();
    const { fetch, windows } = makeRecordingFetch();

    const from = "2026-01-01";
    const to = "2026-03-31"; // 90 days → 3 chunks at maxDays=30

    const result = await runBackfill({
      ...baseDeps,
      fetchTransactions: fetch,
      writeFills: twin.writeFills,
      from,
      to,
    });

    expect(result.ok).toBe(true);

    // Chunk boundaries the fetch was called with MUST equal chunkDateRange's output.
    const expected = chunkDateRange(from, to, baseDeps.maxDays);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(windows).toEqual(expected.value.map((w) => ({ from: w.from, to: w.to })));
    expect(windows.length).toBeGreaterThanOrEqual(3);

    // One distinct fill per chunk → twin holds exactly that many fills.
    expect(twin.countFills()).toBe(windows.length);
  });

  it("Test B: a second run over the same range adds 0 fills (idempotent)", async () => {
    const twin = makeMemoryFillsRepo();
    const from = "2026-01-01";
    const to = "2026-03-31";

    const first = makeRecordingFetch();
    await runBackfill({
      ...baseDeps,
      fetchTransactions: first.fetch,
      writeFills: twin.writeFills,
      from,
      to,
    });
    const countAfterFirst = twin.countFills();
    expect(countAfterFirst).toBeGreaterThan(0);

    const second = makeRecordingFetch();
    await runBackfill({
      ...baseDeps,
      fetchTransactions: second.fetch,
      writeFills: twin.writeFills,
      from,
      to,
    });

    expect(twin.countFills()).toBe(countAfterFirst); // no new rows
  });

  it("Test C: an over-cap total range returns a clear error and writes nothing", async () => {
    const twin = makeMemoryFillsRepo();
    const { fetch } = makeRecordingFetch();

    // Total span > SCHWAB_TX_LOOKBACK_MAX_DAYS (inclusive days).
    const from = "2024-01-01";
    const to = "2026-01-01"; // ~731 days, well over 365

    const result = await runBackfill({
      ...baseDeps,
      fetchTransactions: fetch,
      writeFills: twin.writeFills,
      from,
      to,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("backfill-error");
    expect(twin.countFills()).toBe(0); // no silent truncation, no partial write
  });

  it("the documented cap constant is 365 days", () => {
    expect(SCHWAB_TX_LOOKBACK_MAX_DAYS).toBe(365);
  });

  it("WR-04: with the production per-call cap, a within-lookback span splits into multiple windows", () => {
    // Span that survives the lookback guard (< 365 days) but exceeds the per-call cap.
    const from = "2026-01-01";
    const to = "2026-06-30"; // ~181 days, within lookback, > SCHWAB_TX_MAX_RANGE_DAYS (90)
    const chunks = chunkDateRange(from, to, SCHWAB_TX_MAX_RANGE_DAYS);
    expect(chunks.ok).toBe(true);
    if (!chunks.ok) return;
    // The whole point of WR-04: chunking is NOT inert in production — it actually splits.
    expect(chunks.value.length).toBeGreaterThan(1);
    for (const w of chunks.value) {
      const fromMs = Date.parse(`${w.from}T00:00:00Z`);
      const toMs = Date.parse(`${w.to}T00:00:00Z`);
      const days = Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
      expect(days).toBeLessThanOrEqual(SCHWAB_TX_MAX_RANGE_DAYS);
    }
  });

  it("an inverted range (from > to) returns a clear error and writes nothing", async () => {
    const twin = makeMemoryFillsRepo();
    const { fetch } = makeRecordingFetch();

    const result = await runBackfill({
      ...baseDeps,
      fetchTransactions: fetch,
      writeFills: twin.writeFills,
      from: "2026-03-31",
      to: "2026-01-01",
    });

    expect(result.ok).toBe(false);
    expect(twin.countFills()).toBe(0);
  });

  // Sanity check the hasher contract the production wiring uses (sha256-injected hashFillIds):
  // the second arg is a string→hex hasher, exactly the shape the CLI passes (sha256Hex).
  it("the core hashFillIds composes with an injected string→hex hasher (production wiring shape)", () => {
    const hexHasher = (input: string): string =>
      testHashFillIds([input]);
    const digest = hashFillIds(["1001:0"], hexHasher);
    expect(typeof digest).toBe("string");
  });
});

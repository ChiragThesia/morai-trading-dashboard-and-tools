/**
 * syncTransactions.test.ts — A4 fills source use-case (BrokerTransaction → fills).
 *
 * Proves:
 *  - each tx's legs flatten to RawFill rows with correct occSymbol/qty/price/side
 *  - side derives from positionEffect (OPENING→buy, CLOSING→sell)
 *  - a second run over the same window writes ZERO new fills (deterministic ids)
 *  - AUTH_EXPIRED from fetchTransactions → ok(undefined), no writes (worker degrades)
 */

import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  BrokerTransaction,
  ForFetchingTransactions,
  FetchError,
  AuthExpiredError,
} from "../../brokerage/application/ports.ts";
import type { ForWritingFills, RawFill, StorageError } from "./ports.ts";
import { makeSyncTransactionsUseCase } from "./syncTransactions.ts";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FRONT = formatOccSymbol({
  root: "SPX",
  expiry: new Date("2026-06-20T12:00:00Z"),
  type: "P",
  strike: 7100,
});
const BACK = formatOccSymbol({
  root: "SPX",
  expiry: new Date("2026-09-19T12:00:00Z"),
  type: "P",
  strike: 7100,
});

const OPEN_TX: BrokerTransaction = {
  activityId: 1001,
  tradeDate: "2026-06-15",
  netAmount: -1550,
  orderId: 9001,
  legs: [
    { occSymbol: FRONT, qty: 1, price: 15.5, positionEffect: "OPENING" },
    { occSymbol: BACK, qty: 1, price: 20.0, positionEffect: "OPENING" },
  ],
};

const CLOSE_TX: BrokerTransaction = {
  activityId: 1002,
  tradeDate: "2026-06-18",
  netAmount: 800,
  orderId: 9002,
  legs: [{ occSymbol: FRONT, qty: 1, price: 8.0, positionEffect: "CLOSING" }],
};

// ─── Test doubles ──────────────────────────────────────────────────────────────

function makeFetch(
  txs: ReadonlyArray<BrokerTransaction>,
): ForFetchingTransactions {
  return async (): Promise<
    Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>
  > => ok(txs);
}

function makeAuthExpiredFetch(): ForFetchingTransactions {
  return async (): Promise<
    Result<ReadonlyArray<BrokerTransaction>, FetchError | AuthExpiredError>
  > => err<AuthExpiredError>({ kind: "auth-expired", appId: "trader" });
}

function makeCapturingWriteFills(): {
  writeFills: ForWritingFills;
  captured: RawFill[];
} {
  const seen = new Set<string>();
  const captured: RawFill[] = [];
  const writeFills: ForWritingFills = async (
    rows: ReadonlyArray<RawFill>,
  ): Promise<Result<void, StorageError>> => {
    for (const f of rows) {
      if (!seen.has(f.id)) {
        seen.add(f.id); // onConflictDoNothing equivalent
        captured.push(f);
      }
    }
    return ok(undefined);
  };
  return { writeFills, captured };
}

// Deterministic 64-hex hasher test double (mirrors the injected sha256-hex port shape).
// Pure FNV-1a over the joined ids, repeated to fill 64 hex chars — stable per input.
function testHashFillIds(ids: ReadonlyArray<string>): string {
  const input = [...ids].sort().join(":");
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const base = h.toString(16).padStart(8, "0");
  return base.repeat(8); // 64 hex chars
}

const baseDeps = {
  accountHash: "ACCT-HASH",
  from: "2026-06-01",
  to: "2026-06-30",
  now: () => new Date("2026-06-20T00:00:00Z"),
  hashFillIds: testHashFillIds,
};

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("makeSyncTransactionsUseCase — A4 fills source", () => {
  it("flattens tx legs into RawFill rows with correct fields and side", async () => {
    const { writeFills, captured } = makeCapturingWriteFills();
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeFetch([OPEN_TX, CLOSE_TX]),
      writeFills,
    });

    const result = await run();
    expect(result.ok).toBe(true);

    // 2 legs from OPEN_TX + 1 leg from CLOSE_TX = 3 fills
    expect(captured).toHaveLength(3);

    const front = captured.find(
      (f) => f.occSymbol === FRONT && f.orderId === "9001",
    );
    expect(front).toBeDefined();
    expect(front?.side).toBe("buy"); // OPENING → buy
    expect(front?.qty).toBe(1);
    expect(front?.price).toBe(15.5);
    expect(front?.filledAt.toISOString().slice(0, 10)).toBe("2026-06-15");

    const closeLeg = captured.find((f) => f.orderId === "9002");
    expect(closeLeg?.side).toBe("sell"); // CLOSING → sell
    expect(closeLeg?.price).toBe(8.0);
  });

  it("derives valid UUID-shaped fill ids", async () => {
    const { writeFills, captured } = makeCapturingWriteFills();
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeFetch([OPEN_TX]),
      writeFills,
    });
    await run();

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const f of captured) {
      expect(f.id).toMatch(uuidRe);
    }
    // distinct legs → distinct ids
    const ids = new Set(captured.map((f) => f.id));
    expect(ids.size).toBe(captured.length);
  });

  it("is idempotent — a second run writes zero new fills (deterministic ids)", async () => {
    const { writeFills, captured } = makeCapturingWriteFills();
    const deps = {
      ...baseDeps,
      fetchTransactions: makeFetch([OPEN_TX, CLOSE_TX]),
      writeFills,
    };

    await makeSyncTransactionsUseCase(deps)();
    const countAfterFirst = captured.length;
    await makeSyncTransactionsUseCase(deps)(); // re-run same window

    expect(captured).toHaveLength(countAfterFirst); // no new rows
    expect(countAfterFirst).toBe(3);
  });

  it("AUTH_EXPIRED → ok(undefined) and no writes (degrade, do not abort)", async () => {
    const { writeFills, captured } = makeCapturingWriteFills();
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeAuthExpiredFetch(),
      writeFills,
    });

    const result = await run();
    expect(result.ok).toBe(true);
    expect(captured).toHaveLength(0);
  });

  it("FetchError → err (retryable; pg-boss retries the job)", async () => {
    const { writeFills, captured } = makeCapturingWriteFills();
    const fetchTransactions: ForFetchingTransactions = async () =>
      err<FetchError>({ kind: "fetch-error", message: "network down" });
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions,
      writeFills,
    });

    const result = await run();
    expect(result.ok).toBe(false);
    expect(captured).toHaveLength(0);
  });
});

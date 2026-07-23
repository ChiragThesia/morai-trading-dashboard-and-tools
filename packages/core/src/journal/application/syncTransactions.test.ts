/**
 * syncTransactions.test.ts — A4 fills source use-case (BrokerTransaction → fills).
 *
 * Proves:
 *  - each tx's legs flatten to RawFill rows with correct occSymbol/qty/price/side
 *  - side comes from the leg's OWN reported direction (BrokerTransaction.legs[].side),
 *    NOT inferred from positionEffect — journal-pnl-opennetdebit-units #2: OPENING does not
 *    imply buy, nor CLOSING sell (a leg can be sold-to-open or bought-to-close, e.g. a
 *    calendar's front leg)
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
import type {
  ForStoringBrokerTransactions,
  ForWritingFills,
  RawFill,
  StorageError,
  StoredBrokerTransaction,
} from "./ports.ts";
import { hexToUuid, makeSyncTransactionsUseCase } from "./syncTransactions.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

// A calendar open: front leg SOLD to open (credit), back leg BOUGHT to open (debit) — both
// positionEffect "OPENING". Deliberately the OPPOSITE of the old (buggy) side-from-positionEffect
// inference, so this fixture would silently mis-derive side under the old code.
const OPEN_TX: BrokerTransaction = {
  activityId: 1001,
  tradeDate: "2026-06-15",
  netAmount: -1550,
  orderId: 9001,
  legs: [
    { occSymbol: FRONT, qty: 1, price: 15.5, positionEffect: "OPENING", side: "sell" },
    { occSymbol: BACK, qty: 1, price: 20.0, positionEffect: "OPENING", side: "buy" },
  ],
};

// A CLOSING leg that is a BUY (buying back the previously sold-to-open front leg) — again
// the opposite of the old inference (CLOSING -> sell).
const CLOSE_TX: BrokerTransaction = {
  activityId: 1002,
  tradeDate: "2026-06-18",
  netAmount: 800,
  orderId: 9002,
  legs: [{ occSymbol: FRONT, qty: 1, price: 8.0, positionEffect: "CLOSING", side: "buy" }],
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

// Trade Ledger: capturing store double (Map-keyed on activityId, first-seen wins).
function makeCapturingStore(): {
  storeBrokerTransactions: ForStoringBrokerTransactions;
  captured: StoredBrokerTransaction[];
} {
  const captured: StoredBrokerTransaction[] = [];
  const storeBrokerTransactions: ForStoringBrokerTransactions = async (
    batch: ReadonlyArray<StoredBrokerTransaction>,
  ): Promise<Result<void, StorageError>> => {
    captured.push(...batch);
    return ok(undefined);
  };
  return { storeBrokerTransactions, captured };
}

const noopStore: ForStoringBrokerTransactions = async () => ok(undefined);

const baseDeps = {
  accountHash: "ACCT-HASH",
  window: () => ({ from: "2026-06-01", to: "2026-06-30" }),
  now: () => new Date("2026-06-20T00:00:00Z"),
  hashFillIds: testHashFillIds,
  storeBrokerTransactions: noopStore,
};

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("makeSyncTransactionsUseCase — A4 fills source", () => {
  it("flattens tx legs into RawFill rows with correct fields and side (journal-pnl-opennetdebit-units #2)", async () => {
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

    const openFront = captured.find(
      (f) => f.occSymbol === FRONT && f.orderId === "9001",
    );
    const openBack = captured.find((f) => f.occSymbol === BACK && f.orderId === "9001");
    expect(openFront).toBeDefined();
    expect(openBack).toBeDefined();
    // side comes from the leg's OWN reported direction, NOT from positionEffect: both legs
    // are OPENING, but the front was SOLD and the back was BOUGHT.
    expect(openFront?.side).toBe("sell");
    expect(openBack?.side).toBe("buy");
    expect(openFront?.qty).toBe(1);
    expect(openFront?.price).toBe(15.5);
    expect(openFront?.filledAt.toISOString().slice(0, 10)).toBe("2026-06-15");
    // journal-pnl-opennetdebit-units round 4: positionEffect carries through onto the
    // RawFill too — it used to be read only as a drop-filter here and then discarded.
    expect(openFront?.positionEffect).toBe("OPENING");
    expect(openBack?.positionEffect).toBe("OPENING");

    const closeLeg = captured.find((f) => f.orderId === "9002");
    // CLOSING leg that is a BUY (buying back the sold-to-open leg) — not "sell".
    expect(closeLeg?.side).toBe("buy");
    expect(closeLeg?.price).toBe(8.0);
    expect(closeLeg?.positionEffect).toBe("CLOSING");
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

  // ─── WR-A3: hexToUuid is total (every prefix nibble contributes) ──────────────

  it("hexToUuid: two digests differing ONLY at nibble 12 yield DIFFERENT UUIDs (collision regression)", () => {
    const d1 = "a".repeat(12) + "0" + "a".repeat(51); // nibble 12 = "0"
    const d2 = "a".repeat(12) + "f" + "a".repeat(51); // nibble 12 = "f"
    expect(d1).toHaveLength(64);
    expect(d2).toHaveLength(64);
    // The previously-dropped nibble (index 12) must now change the output.
    expect(hexToUuid(d1)).not.toBe(hexToUuid(d2));
  });

  it("hexToUuid: flipping ANY single nibble of the 32-nibble prefix changes the UUID (total mapping)", () => {
    // A prefix where each nibble differs from a chosen replacement, so a flip is observable.
    const base = "0123456789abcdef0123456789abcdef" + "0".repeat(32); // 64 hex chars
    expect(base).toHaveLength(64);
    const baseUuid = hexToUuid(base);
    for (let i = 0; i < 32; i++) {
      const original = base[i];
      // pick a different hex nibble deterministically
      const flipped = original === "0" ? "f" : "0";
      const mutated = base.slice(0, i) + flipped + base.slice(i + 1);
      expect(hexToUuid(mutated), `nibble index ${i} must affect the UUID`).not.toBe(
        baseUuid,
      );
    }
  });

  it("hexToUuid: output is a syntactically valid UUID (fills.id is a Postgres uuid)", () => {
    const samples = [
      "0".repeat(64),
      "f".repeat(64),
      "0123456789abcdef".repeat(4),
      "a".repeat(12) + "f" + "a".repeat(51),
    ];
    for (const s of samples) {
      expect(hexToUuid(s)).toMatch(UUID_RE);
    }
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

describe("makeSyncTransactionsUseCase — Trade Ledger raw persistence", () => {
  const RAW_TX: BrokerTransaction = {
    activityId: 3001,
    tradeDate: "2026-07-23",
    netAmount: -4010.26,
    orderId: 9101,
    legs: [
      { occSymbol: FRONT, qty: 1, price: 103.36, positionEffect: "OPENING", side: "sell" },
    ],
    execTime: "2026-07-23T19:50:12+0000",
    activityType: "EXECUTION",
    settlementDate: "2026-07-24",
    fees: -0.7,
    raw: { activityId: 3001, verbatim: true },
  };

  it("stores the full mapped batch (raw included) before writing fills", async () => {
    const { writeFills, captured: fills } = makeCapturingWriteFills();
    const { storeBrokerTransactions, captured: stored } = makeCapturingStore();
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeFetch([RAW_TX]),
      writeFills,
      storeBrokerTransactions,
    });

    const result = await run();
    expect(result.ok).toBe(true);

    expect(stored).toHaveLength(1);
    const row = stored[0];
    expect(row).toBeDefined();
    if (!row) return;
    expect(row.activityId).toBe(3001);
    expect(row.orderId).toBe(9101);
    expect(row.activityType).toBe("EXECUTION");
    expect(row.execTime?.toISOString()).toBe("2026-07-23T19:50:12.000Z");
    expect(row.tradeDate).toBe("2026-07-23");
    expect(row.settlementDate).toBe("2026-07-24");
    expect(row.netAmount).toBeCloseTo(-4010.26, 10);
    expect(row.fees).toBeCloseTo(-0.7, 10);
    expect(row.legs).toEqual(RAW_TX.legs);
    expect(row.raw).toEqual({ activityId: 3001, verbatim: true });
    // Fills still written as before.
    expect(fills).toHaveLength(1);
  });

  it("optional fields absent → nulls; invalid execTime → null, never Invalid Date", async () => {
    const { storeBrokerTransactions, captured: stored } = makeCapturingStore();
    const bare: BrokerTransaction = {
      activityId: 3002,
      tradeDate: "2026-07-23",
      netAmount: 1,
      orderId: null,
      legs: [],
      execTime: "not-a-date",
    };
    const { writeFills } = makeCapturingWriteFills();
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeFetch([bare]),
      writeFills,
      storeBrokerTransactions,
    });

    const result = await run();
    expect(result.ok).toBe(true);
    const row = stored[0];
    expect(row?.orderId).toBeNull();
    expect(row?.activityType).toBeNull();
    expect(row?.execTime).toBeNull();
    expect(row?.settlementDate).toBeNull();
    expect(row?.fees).toBeNull();
  });

  it("store failure → err (retryable) and fills are NOT written — raw never lags derived", async () => {
    const { writeFills, captured: fills } = makeCapturingWriteFills();
    const failingStore: ForStoringBrokerTransactions = async () =>
      err<StorageError>({ kind: "storage-error", message: "insert failed" });
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeFetch([RAW_TX]),
      writeFills,
      storeBrokerTransactions: failingStore,
    });

    const result = await run();
    expect(result.ok).toBe(false);
    expect(fills).toHaveLength(0);
  });

  it("AUTH_EXPIRED still degrades to ok with no store call", async () => {
    const { storeBrokerTransactions, captured: stored } = makeCapturingStore();
    const { writeFills } = makeCapturingWriteFills();
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions: makeAuthExpiredFetch(),
      writeFills,
      storeBrokerTransactions,
    });

    const result = await run();
    expect(result.ok).toBe(true);
    expect(stored).toHaveLength(0);
  });
});

describe("makeSyncTransactionsUseCase — per-run window (auto-pull, 2026-07-10)", () => {
  // The worker wired from/to as module constants computed once at BOOT, so a
  // long-running worker re-synced the same frozen 7-day window forever — fills after
  // boot day were never pulled and closed calendars stayed open in the journal
  // (the UNLINKED VERDICTS pile-up). The window is now a thunk evaluated on EVERY
  // run, so each 10-min RTH cycle pulls a fresh trailing window.
  it("evaluates the window thunk on every run and passes the fresh window to fetchTransactions", async () => {
    const seen: Array<{ from: string; to: string }> = [];
    const fetchTransactions: ForFetchingTransactions = (_accountHash, from, to) => {
      seen.push({ from, to });
      return Promise.resolve(ok([]));
    };
    const { writeFills } = makeCapturingWriteFills();

    let day = 8;
    const run = makeSyncTransactionsUseCase({
      ...baseDeps,
      fetchTransactions,
      writeFills,
      window: () => ({ from: `2026-07-0${day - 7}`, to: `2026-07-0${day}` }),
    });

    await run();
    day = 9;
    await run();

    expect(seen).toEqual([
      { from: "2026-07-01", to: "2026-07-08" },
      { from: "2026-07-02", to: "2026-07-09" },
    ]);
  });
});

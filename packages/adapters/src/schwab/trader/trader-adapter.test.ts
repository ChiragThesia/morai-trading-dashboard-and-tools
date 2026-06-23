/**
 * trader-adapter.test.ts — BRK-02 msw-backed unit tests for all trader adapters.
 *
 * Mirrors chain-adapter.test.ts lifecycle:
 *   - setupServer with { onUnhandledRequest: "error" }
 *   - One fixture per endpoint; error paths override per test
 *   - D-12: Zod safeParse at boundary; malformed body → Result.err, NEVER thrown exception
 *   - T-04-20: hashValue used in data-call URLs (not raw account number)
 *   - T-04-21: AUTH_EXPIRED short-circuits before network call
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ok, err } from "@morai/shared";
import { makeAccountHashResolver } from "./account-hash.ts";
import { makeSchwabPositionsAdapter } from "./positions-adapter.ts";
import { makeSchwabTransactionsAdapter } from "./transactions-adapter.ts";
import { makeSchwabOrdersAdapter } from "./orders-adapter.ts";
import schwabPositionsFixture from "../../test/fixtures/schwab-positions.fixture.json";
import schwabTransactionsFixture from "../../test/fixtures/schwab-transactions.fixture.json";

// ─── Endpoint constants ────────────────────────────────────────────────────────

const ACCOUNT_NUMBERS_URL =
  "https://api.schwabapi.com/trader/v1/accounts/accountNumbers";
const ACCOUNT_HASH = "HASH_ABC123";
const RAW_ACCOUNT = "12345678";
const POSITIONS_URL = `https://api.schwabapi.com/trader/v1/accounts/${ACCOUNT_HASH}`;
const TRANSACTIONS_URL = `https://api.schwabapi.com/trader/v1/accounts/${ACCOUNT_HASH}/transactions`;
const ORDERS_URL = `https://api.schwabapi.com/trader/v1/accounts/${ACCOUNT_HASH}/orders`;

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const accountNumbersFixture = [
  { accountNumber: RAW_ACCOUNT, hashValue: ACCOUNT_HASH },
];

const ordersFixture = [
  {
    orderId: 111222333,
    status: "FILLED",
    orderLegCollection: [
      {
        instrument: { symbol: "SPX   260620P05950000" },
        quantity: 1,
        orderLegType: "OPTION",
        instruction: "SELL_TO_OPEN",
      },
    ],
  },
];

// ─── MSW server setup ─────────────────────────────────────────────────────────

const server = setupServer(
  http.get(ACCOUNT_NUMBERS_URL, () => HttpResponse.json(accountNumbersFixture)),
  http.get(POSITIONS_URL, () => HttpResponse.json(schwabPositionsFixture)),
  http.get(TRANSACTIONS_URL, () => HttpResponse.json(schwabTransactionsFixture)),
  http.get(ORDERS_URL, () => HttpResponse.json(ordersFixture)),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ─── Factory helpers ──────────────────────────────────────────────────────────

function freshToken() {
  // No type assertion needed — string literal is already a string
  const token: string = "test-access-token";
  return async () => ok(token);
}
function expiredToken() {
  return async () =>
    err({ kind: "auth-expired" as const, appId: "trader" as const });
}

function makeHashResolver(getAccessToken = freshToken()) {
  return makeAccountHashResolver({
    fetch: globalThis.fetch,
    getAccessToken,
    userAgent: "Morai-Test/1.0",
  });
}

function makePositions(getAccessToken = freshToken()) {
  return makeSchwabPositionsAdapter({
    fetch: globalThis.fetch,
    getAccessToken,
    userAgent: "Morai-Test/1.0",
  });
}

function makeTransactions(getAccessToken = freshToken()) {
  return makeSchwabTransactionsAdapter({
    fetch: globalThis.fetch,
    getAccessToken,
    userAgent: "Morai-Test/1.0",
  });
}

function makeOrders(getAccessToken = freshToken()) {
  return makeSchwabOrdersAdapter({
    fetch: globalThis.fetch,
    getAccessToken,
    userAgent: "Morai-Test/1.0",
  });
}

// ─── account-hash resolver tests ─────────────────────────────────────────────

describe("makeAccountHashResolver", () => {
  describe("resolveAccountHash()", () => {
    it("returns ok(hashValue) from /accounts/accountNumbers", async () => {
      const resolver = makeHashResolver();
      const result = await resolver.resolveAccountHash();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(ACCOUNT_HASH);
    });

    it("returns err({kind:'auth-expired'}) when getAccessToken fails", async () => {
      const resolver = makeHashResolver(expiredToken());
      const result = await resolver.resolveAccountHash();
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("auth-expired");
    });

    it("returns err when HTTP call fails (non-ok status)", async () => {
      server.use(
        http.get(ACCOUNT_NUMBERS_URL, () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
        ),
      );
      const resolver = makeHashResolver();
      const result = await resolver.resolveAccountHash();
      expect(result.ok).toBe(false);
    });

    it("returns err when response has no entries (empty array)", async () => {
      server.use(
        http.get(ACCOUNT_NUMBERS_URL, () => HttpResponse.json([])),
      );
      const resolver = makeHashResolver();
      const result = await resolver.resolveAccountHash();
      expect(result.ok).toBe(false);
    });

    it("returns err on Zod parse failure (garbage body), does NOT throw", async () => {
      server.use(
        http.get(ACCOUNT_NUMBERS_URL, () =>
          HttpResponse.json("garbage-not-an-array"),
        ),
      );
      const resolver = makeHashResolver();
      // Must NOT throw — D-12
      const result = await resolver.resolveAccountHash();
      expect(result.ok).toBe(false);
    });
  });
});

// ─── positions adapter tests ──────────────────────────────────────────────────

describe("makeSchwabPositionsAdapter", () => {
  describe("fetchPositions(accountHash)", () => {
    it("returns ok(BrokerPosition[]) from fixture", async () => {
      const adapter = makePositions();
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
    });

    it("returns a position with occSymbol exactly 21 chars", async () => {
      const adapter = makePositions();
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value[0];
      expect(pos).toBeDefined();
      if (!pos) return;
      expect(pos.occSymbol).toHaveLength(21);
    });

    it("maps shortQuantity=1 longQuantity=0 correctly", async () => {
      const adapter = makePositions();
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value[0];
      expect(pos).toBeDefined();
      if (!pos) return;
      expect(pos.shortQty).toBe(1);
      expect(pos.longQty).toBe(0);
    });

    it("maps putCall=PUT to 'P'", async () => {
      const adapter = makePositions();
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value[0];
      expect(pos).toBeDefined();
      if (!pos) return;
      expect(pos.putCall).toBe("P");
    });

    it("maps averagePrice and underlyingSymbol", async () => {
      const adapter = makePositions();
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const pos = result.value[0];
      expect(pos).toBeDefined();
      if (!pos) return;
      expect(pos.averagePrice).toBe(12.5);
      expect(pos.underlyingSymbol).toBe("SPX");
    });

    it("returns err({kind:'auth-expired'}) without calling fetch when token expired", async () => {
      const adapter = makePositions(expiredToken());
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("auth-expired");
    });

    it("returns err when Schwab returns non-ok status", async () => {
      server.use(
        http.get(POSITIONS_URL, () =>
          HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
        ),
      );
      const adapter = makePositions();
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(false);
    });

    it("returns err on malformed body (no throw) — D-12", async () => {
      server.use(
        http.get(POSITIONS_URL, () =>
          new HttpResponse("this is not json", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      );
      const adapter = makePositions();
      // Must NOT throw
      const result = await adapter.fetchPositions(ACCOUNT_HASH);
      expect(result.ok).toBe(false);
    });
  });
});

// ─── transactions adapter tests ───────────────────────────────────────────────

describe("makeSchwabTransactionsAdapter", () => {
  describe("fetchTransactions(accountHash, from, to)", () => {
    it("returns ok(BrokerTransaction[]) from fixture", async () => {
      const adapter = makeTransactions();
      const result = await adapter.fetchTransactions(
        ACCOUNT_HASH,
        "2026-06-01",
        "2026-06-30",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBe(2);
    });

    it("sends startDate/endDate as ISO-8601 datetimes (regression: date-only → Schwab 400)", async () => {
      let captured: URL | null = null;
      server.use(
        http.get(TRANSACTIONS_URL, ({ request }) => {
          captured = new URL(request.url);
          return HttpResponse.json(schwabTransactionsFixture);
        }),
      );
      const adapter = makeTransactions();
      await adapter.fetchTransactions(ACCOUNT_HASH, "2026-06-01", "2026-06-30");
      const url = captured;
      if (url === null) throw new Error("transactions request was not captured");
      expect(url.searchParams.get("startDate")).toBe("2026-06-01T00:00:00.000Z");
      expect(url.searchParams.get("endDate")).toBe("2026-06-30T23:59:59.999Z");
    });

    it("returns a transaction with activityId, tradeDate, netAmount", async () => {
      const adapter = makeTransactions();
      const result = await adapter.fetchTransactions(
        ACCOUNT_HASH,
        "2026-06-01",
        "2026-06-30",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tx = result.value[0];
      expect(tx).toBeDefined();
      if (!tx) return;
      expect(tx.activityId).toBe(987654321);
      expect(tx.tradeDate).toBe("2026-06-10");
      expect(tx.netAmount).toBe(-1250.0);
      expect(tx.orderId).toBe(111222333);
    });

    it("returns transaction legs with occSymbol, price, positionEffect", async () => {
      const adapter = makeTransactions();
      const result = await adapter.fetchTransactions(
        ACCOUNT_HASH,
        "2026-06-01",
        "2026-06-30",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tx = result.value[0];
      expect(tx).toBeDefined();
      if (!tx) return;
      expect(tx.legs.length).toBe(1);
      const leg = tx.legs[0];
      expect(leg).toBeDefined();
      if (!leg) return;
      expect(leg.occSymbol).toHaveLength(21);
      expect(leg.price).toBe(12.5);
      expect(leg.positionEffect).toBe("OPENING");
    });

    it("maps CLOSING positionEffect on second transaction", async () => {
      const adapter = makeTransactions();
      const result = await adapter.fetchTransactions(
        ACCOUNT_HASH,
        "2026-06-01",
        "2026-06-30",
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tx = result.value[1];
      expect(tx).toBeDefined();
      if (!tx) return;
      const leg = tx.legs[0];
      expect(leg).toBeDefined();
      if (!leg) return;
      expect(leg.positionEffect).toBe("CLOSING");
    });

    it("returns err({kind:'auth-expired'}) without calling fetch when token expired", async () => {
      const adapter = makeTransactions(expiredToken());
      const result = await adapter.fetchTransactions(
        ACCOUNT_HASH,
        "2026-06-01",
        "2026-06-30",
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("auth-expired");
    });

    it("returns err on malformed body (no throw) — D-12", async () => {
      server.use(
        http.get(TRANSACTIONS_URL, () =>
          new HttpResponse("garbage", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      );
      const adapter = makeTransactions();
      const result = await adapter.fetchTransactions(
        ACCOUNT_HASH,
        "2026-06-01",
        "2026-06-30",
      );
      expect(result.ok).toBe(false);
    });
  });
});

// ─── orders adapter tests ─────────────────────────────────────────────────────

describe("makeSchwabOrdersAdapter", () => {
  describe("fetchOrders(accountHash)", () => {
    it("returns ok(BrokerOrder[]) from fixture", async () => {
      const adapter = makeOrders();
      const result = await adapter.fetchOrders(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.length).toBeGreaterThan(0);
    });

    it("returns an order with orderId and status", async () => {
      const adapter = makeOrders();
      const result = await adapter.fetchOrders(ACCOUNT_HASH);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const order = result.value[0];
      expect(order).toBeDefined();
      if (!order) return;
      expect(order.orderId).toBe(111222333);
      expect(order.status).toBe("FILLED");
    });

    it("returns err({kind:'auth-expired'}) without calling fetch when token expired", async () => {
      const adapter = makeOrders(expiredToken());
      const result = await adapter.fetchOrders(ACCOUNT_HASH);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("auth-expired");
    });

    it("returns err on malformed body (no throw) — D-12", async () => {
      server.use(
        http.get(ORDERS_URL, () =>
          new HttpResponse("garbage", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          }),
        ),
      );
      const adapter = makeOrders();
      const result = await adapter.fetchOrders(ACCOUNT_HASH);
      expect(result.ok).toBe(false);
    });
  });
});

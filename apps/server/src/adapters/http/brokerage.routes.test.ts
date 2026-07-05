/**
 * brokerage.routes.test.ts — BRK-02 HTTP route tests for positions, transactions, orders.
 *
 * MCP-02: same positionsResponse/transactionsResponse/ordersResponse schemas used here
 * and in the MCP tools. A one-sided field rename fails typecheck.
 *
 * D-09: AUTH_EXPIRED from use-case → route responds 200 with paused payload.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { ForGettingPositions, ForGettingTransactions, ForGettingOrders } from "@morai/core";
import {
  positionsResponse,
  transactionsResponse,
  ordersResponse,
  brokerageAuthExpiredPayload,
} from "@morai/contracts";
import { brokerageRoutes } from "./brokerage.routes.ts";

// ─── Test doubles ─────────────────────────────────────────────────────────────

function makeOcc() {
  return formatOccSymbol({
    root: "SPX",
    expiry: new Date(2026, 5, 20),
    type: "P",
    strike: 5950,
  });
}

function buildTestApp(
  getPositions: ForGettingPositions,
  getTransactions: ForGettingTransactions,
  getOrders: ForGettingOrders,
) {
  const app = new Hono();
  app.route("/api", brokerageRoutes(getPositions, getTransactions, getOrders));
  return app;
}

const okGetPositions: ForGettingPositions = async () =>
  ok([
    {
      occSymbol: makeOcc(),
      putCall: "P",
      longQty: 0,
      shortQty: 1,
      averagePrice: 12.5,
      marketValue: -1250.0,
      underlyingSymbol: "SPX",
    },
  ]);

const emptyGetPositions: ForGettingPositions = async () => ok([]);

const authExpiredGetPositions: ForGettingPositions = async () =>
  err({ kind: "auth-expired" as const, appId: "trader" as const });

const errGetPositions: ForGettingPositions = async () =>
  err({ kind: "fetch-error", message: "network error" });

const okGetTransactions: ForGettingTransactions = async (_from, _to) =>
  ok([
    {
      activityId: 987654321,
      tradeDate: "2026-06-10",
      netAmount: -1250.0,
      orderId: 111222333,
      legs: [
        {
          occSymbol: makeOcc(),
          qty: 1,
          price: 12.5,
          positionEffect: "OPENING" as const,
          side: "buy" as const,
        },
      ],
    },
  ]);

const authExpiredGetTransactions: ForGettingTransactions = async (_from, _to) =>
  err({ kind: "auth-expired" as const, appId: "trader" as const });

const okGetOrders: ForGettingOrders = async () =>
  ok([
    {
      orderId: 111222333,
      status: "FILLED",
      legs: [
        {
          occSymbol: makeOcc(),
          qty: 1,
          side: "SELL" as const,
        },
      ],
    },
  ]);

const authExpiredGetOrders: ForGettingOrders = async () =>
  err({ kind: "auth-expired" as const, appId: "trader" as const });

// ─── GET /api/positions ───────────────────────────────────────────────────────

describe("GET /api/positions", () => {
  it("returns 200 with positions array matching positionsResponse schema", async () => {
    const app = buildTestApp(okGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/positions");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = positionsResponse.parse(body);
    expect(parsed.positions.length).toBe(1);
    expect(parsed.positions[0]?.putCall).toBe("P");
  });

  it("returns 200 with empty positions array", async () => {
    const app = buildTestApp(emptyGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/positions");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = positionsResponse.parse(body);
    expect(parsed.positions).toHaveLength(0);
  });

  it("returns 200 with paused payload when AUTH_EXPIRED (D-09)", async () => {
    const app = buildTestApp(authExpiredGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/positions");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = brokerageAuthExpiredPayload.parse(body);
    expect(parsed.paused).toBe(true);
    expect(parsed.reason).toBe("AUTH_EXPIRED");
  });

  it("returns 500 on fetch-error and surfaces the message (not generic 'internal')", async () => {
    const app = buildTestApp(errGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/positions");
    expect(res.status).toBe(500);
    const body: unknown = await res.json();
    // The adapter's FetchError message must reach the client for diagnosis.
    expect(body).toEqual({ error: "network error" });
  });
});

// ─── GET /api/transactions ────────────────────────────────────────────────────

describe("GET /api/transactions", () => {
  it("returns 200 with transactions array matching transactionsResponse schema", async () => {
    const app = buildTestApp(okGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/transactions?from=2026-06-01&to=2026-06-30");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = transactionsResponse.parse(body);
    expect(parsed.transactions.length).toBe(1);
    expect(parsed.transactions[0]?.activityId).toBe(987654321);
  });

  it("returns 200 with paused payload when AUTH_EXPIRED (D-09)", async () => {
    const app = buildTestApp(okGetPositions, authExpiredGetTransactions, okGetOrders);
    const res = await app.request("/api/transactions?from=2026-06-01&to=2026-06-30");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = brokerageAuthExpiredPayload.parse(body);
    expect(parsed.paused).toBe(true);
    expect(parsed.reason).toBe("AUTH_EXPIRED");
  });

  it("uses from/to defaults when query params absent", async () => {
    const app = buildTestApp(okGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/transactions");
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/orders ──────────────────────────────────────────────────────────

describe("GET /api/orders", () => {
  it("returns 200 with orders array matching ordersResponse schema", async () => {
    const app = buildTestApp(okGetPositions, okGetTransactions, okGetOrders);
    const res = await app.request("/api/orders");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = ordersResponse.parse(body);
    expect(parsed.orders.length).toBe(1);
    expect(parsed.orders[0]?.orderId).toBe(111222333);
  });

  it("returns 200 with paused payload when AUTH_EXPIRED (D-09)", async () => {
    const app = buildTestApp(okGetPositions, okGetTransactions, authExpiredGetOrders);
    const res = await app.request("/api/orders");
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = brokerageAuthExpiredPayload.parse(body);
    expect(parsed.paused).toBe(true);
    expect(parsed.reason).toBe("AUTH_EXPIRED");
  });
});

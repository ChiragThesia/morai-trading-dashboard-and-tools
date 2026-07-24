import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ok, err } from "@morai/shared";
import type {
  ForRunningGetTradeDetail,
  ForRunningGetTradeHistory,
  StorageError,
  TradeDetail,
  TradeHistory,
} from "@morai/core";
import { tradeDetailResponse, tradeHistoryResponse } from "@morai/contracts";
import { tradeHistoryRoutes } from "./trade-history.routes.ts";

const noopGetTradeDetail: ForRunningGetTradeDetail = async () => ok(null);

function buildTestApp(
  getTradeHistory: ForRunningGetTradeHistory,
  getTradeDetail: ForRunningGetTradeDetail = noopGetTradeDetail,
) {
  const app = new Hono();
  app.route("/api", tradeHistoryRoutes(getTradeHistory, getTradeDetail));
  return app;
}

const OPEN_CAL = "550e8400-e29b-41d4-a716-446655440001";
const CLOSED_CAL = "550e8400-e29b-41d4-a716-446655440002";

const FIXTURE: TradeHistory = {
  roundTrips: [
    {
      calendarId: OPEN_CAL,
      underlying: "SPXW",
      strike: 7400000,
      optionType: "P",
      frontExpiry: "2026-08-11",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "open",
      openedAt: new Date("2026-07-23T19:50:00Z"),
      closedAt: null,
      openNetDebit: 40.08,
      closeNetCredit: null,
      realizedPnl: null,
      greeks: {
        netDelta: 1.2,
        netTheta: 38.5,
        netVega: null,
        frontIv: 0.145,
        backIv: 0.139,
        termSlope: -0.006,
        asOf: new Date("2026-07-23T19:30:00Z"),
      },
    },
    {
      calendarId: CLOSED_CAL,
      underlying: "SPXW",
      strike: 7500000,
      optionType: "P",
      frontExpiry: "2026-08-07",
      backExpiry: "2026-08-31",
      qty: 1,
      status: "closed",
      openedAt: new Date("2026-07-16T14:00:00Z"),
      closedAt: new Date("2026-07-23T19:50:00Z"),
      openNetDebit: 43.27,
      closeNetCredit: 41.58,
      realizedPnl: -171.7,
      greeks: null,
    },
  ],
  executions: [
    {
      activityId: 126084076124,
      execTime: new Date("2026-07-23T19:50:12Z"),
      tradeDate: "2026-07-23",
      orderId: 1007316230828,
      occSymbol: "SPXW  260811P07400000",
      expiry: "2026-08-11",
      strike: 7400,
      type: "P",
      side: "sell",
      qty: 1,
      positionEffect: "OPENING",
      price: 103.36,
      netAmount: 10334.87,
      fees: -0.66,
    },
    {
      activityId: 126084076125,
      execTime: null,
      tradeDate: "2026-07-23",
      orderId: null,
      occSymbol: "SPXW  260807P07500000",
      expiry: "2026-08-07",
      strike: 7500,
      type: "P",
      side: "buy",
      qty: 1,
      positionEffect: "CLOSING",
      price: 143.35,
      netAmount: -14336.13,
      fees: null,
    },
  ],
  totals: { realizedPnl: -171.7 },
  vix: { value: 18.2, date: "2026-07-23" },
};

describe("GET /api/trade-history", () => {
  it("200: serializes the full ledger through the contract (dates → ISO strings)", async () => {
    const app = buildTestApp(async () => ok(FIXTURE));
    const res = await app.request("/api/trade-history");
    expect(res.status).toBe(200);

    const body = tradeHistoryResponse.parse(await res.json());
    expect(body.roundTrips).toHaveLength(2);
    expect(body.roundTrips[0]?.openedAt).toBe("2026-07-23T19:50:00.000Z");
    expect(body.roundTrips[0]?.greeks?.asOf).toBe("2026-07-23T19:30:00.000Z");
    expect(body.roundTrips[1]?.closedAt).toBe("2026-07-23T19:50:00.000Z");
    expect(body.roundTrips[1]?.realizedPnl).toBeCloseTo(-171.7, 10);
    expect(body.roundTrips[1]?.greeks).toBeNull();
    expect(body.executions[0]?.execTime).toBe("2026-07-23T19:50:12.000Z");
    expect(body.executions[1]?.execTime).toBeNull();
    expect(body.totals.realizedPnl).toBeCloseTo(-171.7, 10);
    expect(body.vix).toEqual({ value: 18.2, date: "2026-07-23" });
  });

  it("500: flat error body on use-case failure — no DB internals", async () => {
    const app = buildTestApp(async () =>
      err<StorageError>({ kind: "storage-error", message: "pg exploded" }),
    );
    const res = await app.request("/api/trade-history");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});

describe("GET /api/trade-history/:calendarId/detail", () => {
  const DETAIL: TradeDetail = {
    calendarId: OPEN_CAL,
    days: [
      {
        date: "2026-07-23",
        asOf: new Date("2026-07-23T19:30:00Z"),
        spot: 7400.5,
        pnlOpen: 2.0,
        netDelta: 1.2,
        netGamma: -0.05,
        netTheta: 38.5,
        netVega: 112.3,
        frontIv: 0.145,
        backIv: 0.139,
        termSlope: -0.006,
        front: { mark: 103.4, iv: 0.145, delta: -40, gamma: null, theta: 550, vega: -610 },
        back: { mark: 143.5, iv: 0.139, delta: 42, gamma: 0.2, theta: -310, vega: 720 },
      },
    ],
  };

  it("200: serializes days through the contract (asOf → ISO string)", async () => {
    const app = buildTestApp(async () => ok(FIXTURE), async () => ok(DETAIL));
    const res = await app.request(`/api/trade-history/${OPEN_CAL}/detail`);
    expect(res.status).toBe(200);
    const body = tradeDetailResponse.parse(await res.json());
    expect(body.calendarId).toBe(OPEN_CAL);
    expect(body.days[0]?.asOf).toBe("2026-07-23T19:30:00.000Z");
    expect(body.days[0]?.front.delta).toBeCloseTo(-40, 10);
    expect(body.days[0]?.back.gamma).toBeCloseTo(0.2, 10);
    expect(body.days[0]?.front.gamma).toBeNull();
  });

  it("404: unknown calendarId → not found", async () => {
    const app = buildTestApp(async () => ok(FIXTURE), async () => ok(null));
    const res = await app.request(`/api/trade-history/${OPEN_CAL}/detail`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  it("500: flat error body on failure", async () => {
    const app = buildTestApp(
      async () => ok(FIXTURE),
      async () => err<StorageError>({ kind: "storage-error", message: "pg exploded" }),
    );
    const res = await app.request(`/api/trade-history/${OPEN_CAL}/detail`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal" });
  });
});
